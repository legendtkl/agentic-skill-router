import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { atomicWriteJson } from "./atomic-write.ts";
import type { HostName, Skill, UsageDiagnostics, UsageStat } from "./types.ts";

/**
 * Returns true when another plugin skill in `inventory` shares the same
 * `pluginShort` (= part of `pluginKey` before `@`) AND the same skill name as
 * `skill`. In that case the short-namespaced transcript form
 * ("<pluginShort>:<name>") cannot be uniquely attributed and lookups should
 * refuse to fall through to it.
 *
 * Returns false for non-plugin skills or for skills whose pluginShort+name
 * pair is unique in the inventory.
 */
export function isPluginShortAmbiguous(skill: Skill, inventory: Skill[]): boolean {
  if (!skill.pluginKey) return false;
  const pluginShort = skill.pluginKey.split("@")[0];
  if (!pluginShort) return false;
  let count = 0;
  for (const s of inventory) {
    if (!s.pluginKey) continue;
    if (s.name !== skill.name) continue;
    if (s.pluginKey.split("@")[0] !== pluginShort) continue;
    count += 1;
    if (count > 1) return true;
  }
  return false;
}

/**
 * Look up a skill's usage. Transcripts record key skills by the name the
 * model invoked them with. Resolution order:
 *
 *   1. Full plugin-key form: "plugin:<pluginKey>:<name>" (matches `skill.id`).
 *      Transcripts that carry the fully-qualified plugin key win over every
 *      other form because it is unambiguous.
 *   2. Short plugin-namespaced form: "<pluginShort>:<name>" — only used when
 *      `pluginShort` (the part of `pluginKey` before `@`) is unique within
 *      the inventory for this skill name. If two inventory entries share the
 *      same `pluginShort` but live under different marketplaces (e.g.
 *      "codex@market-a" and "codex@market-b"), the short form is ambiguous
 *      and we refuse to attribute it.
 *   3. Bare name fallback ("foo"). Skipped when `inventory` is provided and
 *      multiple skills claim the same name — see {@link lookupUsageStrict}.
 */
export function lookupUsage(
  skill: Skill,
  usage: Map<string, UsageStat>,
  inventory?: Skill[],
): UsageStat | undefined {
  // (1) full plugin key form takes precedence — always unambiguous.
  if (skill.pluginKey) {
    const full = usage.get(skill.id);
    if (full) return full;
  }
  // (2) plugin short form — only when not ambiguous.
  if (skill.pluginKey) {
    const pluginShort = skill.pluginKey.split("@")[0];
    if (pluginShort) {
      const ambiguous = inventory ? isPluginShortAmbiguous(skill, inventory) : false;
      if (!ambiguous) {
        const ns = usage.get(`${pluginShort}:${skill.name}`);
        if (ns) return ns;
      }
    }
  }
  // (3) bare name fallback (caller may filter via lookupUsageStrict).
  return usage.get(skill.name);
}

/**
 * Variant of `lookupUsage` that only returns a hit when attribution is
 * unambiguous. Pass the full inventory so we can detect collisions on bare
 * names AND on the plugin-short namespace. Used by policy.ts to avoid hiding
 * a never-used skill behind a sibling's usage.
 */
export function lookupUsageStrict(
  skill: Skill,
  usage: Map<string, UsageStat>,
  inventory: Skill[],
): UsageStat | undefined {
  // (1) full plugin key form is always safe.
  if (skill.pluginKey) {
    const full = usage.get(skill.id);
    if (full) return full;
  }
  // (2) plugin short form — only when not ambiguous in inventory.
  if (skill.pluginKey) {
    const pluginShort = skill.pluginKey.split("@")[0];
    if (pluginShort && !isPluginShortAmbiguous(skill, inventory)) {
      const ns = usage.get(`${pluginShort}:${skill.name}`);
      if (ns) return ns;
    }
  }
  // (3) bare name — only when this skill is the unique claimant of the name.
  const sameName = inventory.filter((s) => s.name === skill.name);
  if (sameName.length > 1) return undefined;
  return usage.get(skill.name);
}

const COMMAND_NAME_RE = /<command-name>\s*\/?([^<\s]+?)\s*<\/command-name>/g;

interface MutableStat {
  lastUsed: Date | null;
  callCount: number;
  firstSeen: Date | null;
}

/**
 * Serializable per-file stat entry used by the on-disk cache. Each
 * `[skillName, {...}]` tuple captures everything the in-memory aggregation
 * needs to fold this file's contribution back into the global Map.
 * `lastUsed` / `firstSeen` are ISO-8601 strings or null because Date does
 * not survive JSON.stringify.
 */
interface SerializedStat {
  skillName: string;
  callCount: number;
  lastUsed: string | null;
  firstSeen: string | null;
}

interface CachedFileEntry {
  size: number;
  mtimeMs: number;
  stats: SerializedStat[];
}

interface UsageCache {
  version: 1;
  files: Record<string, CachedFileEntry>;
}

const CACHE_VERSION = 1;

/**
 * Resolves the cache dir. Mirrors `state.ts`'s `AGENTIC_SKILL_ROUTER_STATE_DIR`
 * convention so users can redirect both state and cache the same way.
 */
function cacheDir(): string {
  return process.env["AGENTIC_SKILL_ROUTER_STATE_DIR"] ?? join(homedir(), ".agentic-skill-router");
}

/**
 * Per-host cache file path. Keeping them separate avoids cross-contamination
 * if a user runs both Claude Code and Codex from the same `$HOME`.
 */
export function usageCachePathForHost(host: HostName): string {
  return join(cacheDir(), `usage-cache-${host}.json`);
}

function cacheBypassed(): boolean {
  return process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"] === "0";
}

export interface CollectUsageOptions {
  /** When provided, enables on-disk per-file caching keyed by (size, mtimeMs). */
  host?: HostName;
  /** Override the cache file path (mostly for tests). */
  cachePath?: string;
  /**
   * Optional cutoff: any transcript file whose mtime is strictly older than
   * `since` is skipped (no parse, no cache lookup) and counted as `cachedFiles`
   * in the diagnostics. Pass `null` or omit to scan every file.
   *
   * Note: directory enumeration still walks every subdirectory under the
   * transcript root because a directory's own mtime does not reliably reflect
   * the recency of its contents. The `since` filter only bounds *parse* cost,
   * not enumeration cost.
   */
  since?: Date | null;
}

export interface CollectUsageResult {
  usage: Map<string, UsageStat>;
  diagnostics: UsageDiagnostics;
}

/**
 * Walk every .jsonl transcript under projectsDir/sessionsDir and aggregate
 * skill invocations. Skills surface as either:
 *
 *   - `Skill` tool_use blocks: {"type":"tool_use","name":"Skill","input":{"skill":"X"}}
 *   - <command-name>X</command-name> tags inside any text content
 *
 * Each line carries `timestamp` (ISO-8601). We never load a whole file into
 * memory; readline streams line-by-line.
 *
 * The returned Map is keyed by *transcript-observed* skill name (e.g. "lark-mail",
 * "codex:rescue"). Resolution to canonical Skill ids happens at policy time:
 * we try `user:<name>`, then `plugin:*:<name>`, then `builtin:<name>`.
 *
 * When `opts.host` (or `opts.cachePath`) is provided AND the
 * `AGENTIC_SKILL_ROUTER_USAGE_CACHE` env var is not "0", per-file scan results are
 * cached on disk keyed by `(absolutePath, size, mtimeMs)`. Files whose size
 * and mtime match the cached entry are skipped; the cache is rewritten at
 * the end with stale entries (deleted files) pruned.
 */
export async function collectUsageStats(
  projectsDir: string,
  opts: CollectUsageOptions = {},
): Promise<Map<string, UsageStat>> {
  const result = await collectUsageStatsDetailed(projectsDir, opts);
  return result.usage;
}

/**
 * Detailed variant of {@link collectUsageStats} that returns the aggregated
 * usage map *together with* a {@link UsageDiagnostics} record describing how
 * many files were enumerated, parsed, served from cache, how many directories
 * were skipped due to permission errors, and how long the scan took.
 *
 * Honors the optional `since` cutoff: files whose mtime is older than `since`
 * are skipped without parsing and counted as `cachedFiles` (we treat
 * "didn't parse" as a single bucket regardless of cause). When the on-disk
 * cache holds an entry for such a file we still consult that entry so the
 * caller never sees a regression in coverage just because the cutoff moved
 * forward — old cache entries are still merged into the result. If the cache
 * has no entry, the file is dropped entirely from this scan.
 */
export async function collectUsageStatsDetailed(
  projectsDir: string,
  opts: CollectUsageOptions = {},
): Promise<CollectUsageResult> {
  const startedAt = Date.now();
  const enumeration = await listJsonlFilesWithSkips(projectsDir);
  const files = enumeration.files;

  const cachePath = opts.cachePath ?? (opts.host ? usageCachePathForHost(opts.host) : null);
  const useCache = cachePath !== null && !cacheBypassed();
  const previous = useCache ? await readCache(cachePath) : null;
  const next: Record<string, CachedFileEntry> = {};

  const sinceMs = opts.since instanceof Date && !Number.isNaN(opts.since.getTime())
    ? opts.since.getTime()
    : null;

  const stats = new Map<string, MutableStat>();

  let scannedFiles = 0;
  let cachedFiles = 0;
  let parsedFiles = 0;

  for (const file of files) {
    // Stat up front whenever we need either the cache key OR the since cutoff.
    let size = 0;
    let mtimeMs = 0;
    let haveMeta = false;
    if (useCache || sinceMs !== null) {
      const meta = await safeStat(file);
      if (!meta) continue; // file disappeared between listing and stat
      size = meta.size;
      mtimeMs = meta.mtimeMs;
      haveMeta = true;
    }

    scannedFiles += 1;

    let fileStats: SerializedStat[] | null = null;
    let servedWithoutParse = false;

    if (useCache) {
      const cached = previous?.files[file];
      if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
        fileStats = cached.stats;
        servedWithoutParse = true;
      }
    }

    // Apply the since cutoff: if we still need to parse the file but its mtime
    // is older than the cutoff, skip the parse. Reuse any cached stats so
    // historical attribution is preserved even when the cutoff hides the file
    // from re-scanning.
    if (!fileStats && sinceMs !== null && haveMeta && mtimeMs < sinceMs) {
      // Try the cache one more time without the size/mtime equality check —
      // an old cache hit is still better than dropping the file entirely.
      const stale = previous?.files[file];
      if (stale) {
        fileStats = stale.stats;
        // Re-emit the stale entry into `next` so it survives this scan; we
        // intentionally use the *stale* size/mtime so a future scan can still
        // detect a real change and re-parse.
        next[file] = { size: stale.size, mtimeMs: stale.mtimeMs, stats: stale.stats };
      }
      cachedFiles += 1;
      if (fileStats) mergeSerialized(stats, fileStats);
      continue;
    }

    if (!fileStats) {
      try {
        fileStats = await scanFileSerialized(file);
      } catch (err: unknown) {
        if (isSkippableScanError(err)) {
          // Treat a per-file permission failure the same as a missing file:
          // it occupied a slot in `scannedFiles` but contributed nothing.
          continue;
        }
        throw err;
      }
      parsedFiles += 1;
    } else if (servedWithoutParse) {
      cachedFiles += 1;
    }

    if (useCache) {
      next[file] = { size, mtimeMs, stats: fileStats };
    }

    mergeSerialized(stats, fileStats);
  }

  if (useCache && cachePath) {
    await writeCache(cachePath, { version: CACHE_VERSION, files: next });
  }

  const out = new Map<string, UsageStat>();
  for (const [skillId, m] of stats) {
    out.set(skillId, {
      skillId,
      lastUsed: m.lastUsed,
      callCount: m.callCount,
      firstSeen: m.firstSeen,
    });
  }

  const diagnostics: UsageDiagnostics = {
    scannedFiles,
    cachedFiles,
    parsedFiles,
    skippedDirs: enumeration.skippedDirs,
    durationMs: Date.now() - startedAt,
  };
  return { usage: out, diagnostics };
}

function isSkippableScanError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM";
}

interface EnumerationResult {
  files: string[];
  skippedDirs: number;
}

async function listJsonlFilesWithSkips(root: string): Promise<EnumerationResult> {
  const out: string[] = [];
  const skipped = { count: 0 };
  await walkJsonl(root, out, skipped);
  return { files: out, skippedDirs: skipped.count };
}

async function walkJsonl(root: string, out: string[], skipped: { count: number }): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    // Treat unreadable transcript subtrees (e.g. mode-000 dirs left over by
    // other tooling) as empty rather than letting a single permission error
    // crash `skills list` / `skills suggest`. Surface a one-line warning so
    // the user can investigate without losing the rest of the scan, and bump
    // the diagnostics counter so callers can see how many subtrees were
    // silently dropped.
    if (code === "EACCES" || code === "EPERM") {
      skipped.count += 1;
      console.error(`agentic-skill-router: skipping unreadable transcript dir ${root} (${code})`);
      return;
    }
    throw err;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const path = join(root, ent.name);
    if (ent.isDirectory()) {
      await walkJsonl(path, out, skipped);
    } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
      out.push(path);
    }
  }
}

async function safeStat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const s = await stat(path);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Scan a single transcript file and return its per-skill stats in
 * serializable form. Each call produces an independent snapshot that the
 * caller can either cache or fold directly into the global aggregation.
 */
async function scanFileSerialized(path: string): Promise<SerializedStat[]> {
  const local = new Map<string, MutableStat>();
  await scanFile(path, local);
  const out: SerializedStat[] = [];
  for (const [skillName, m] of local) {
    out.push({
      skillName,
      callCount: m.callCount,
      lastUsed: m.lastUsed ? m.lastUsed.toISOString() : null,
      firstSeen: m.firstSeen ? m.firstSeen.toISOString() : null,
    });
  }
  return out;
}

function mergeSerialized(target: Map<string, MutableStat>, entries: SerializedStat[]): void {
  for (const e of entries) {
    let s = target.get(e.skillName);
    if (!s) {
      s = { lastUsed: null, callCount: 0, firstSeen: null };
      target.set(e.skillName, s);
    }
    s.callCount += e.callCount;
    if (e.lastUsed) {
      const d = new Date(e.lastUsed);
      if (!Number.isNaN(d.getTime()) && (!s.lastUsed || d > s.lastUsed)) s.lastUsed = d;
    }
    if (e.firstSeen) {
      const d = new Date(e.firstSeen);
      if (!Number.isNaN(d.getTime()) && (!s.firstSeen || d < s.firstSeen)) s.firstSeen = d;
    }
  }
}

async function scanFile(path: string, stats: Map<string, MutableStat>): Promise<void> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0) continue;
    // Cheap precheck — skip lines that can't possibly contain a skill ref
    if (!line.includes("Skill") && !line.includes("<command-name>")) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    const ts = typeof r["timestamp"] === "string" ? r["timestamp"] : null;
    extractSkillCalls(r, ts, stats);
    extractCommandNameTags(r, ts, stats);
  }
}

function extractSkillCalls(rec: Record<string, unknown>, ts: string | null, stats: Map<string, MutableStat>): void {
  const message = messagePayload(rec);
  if (!message) return;
  const content = message["content"];
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b["type"] !== "tool_use" || b["name"] !== "Skill") continue;
    const input = b["input"];
    if (!input || typeof input !== "object") continue;
    const skill = (input as Record<string, unknown>)["skill"];
    if (typeof skill !== "string" || skill === "") continue;
    record(stats, skill, ts);
  }
}

function extractCommandNameTags(
  rec: Record<string, unknown>,
  ts: string | null,
  stats: Map<string, MutableStat>,
): void {
  const message = messagePayload(rec);
  if (!message) return;
  const content = message["content"];
  const texts: string[] = [];
  if (typeof content === "string") texts.push(content);
  else if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === "object") {
        const t = (b as Record<string, unknown>)["text"];
        if (typeof t === "string") texts.push(t);
      }
    }
  }
  for (const t of texts) {
    COMMAND_NAME_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = COMMAND_NAME_RE.exec(t)) !== null) {
      const name = m[1];
      if (!name) continue;
      record(stats, name, ts);
    }
  }
}

function messagePayload(rec: Record<string, unknown>): Record<string, unknown> | null {
  const message = rec["message"];
  if (message && typeof message === "object") return message as Record<string, unknown>;
  const payload = rec["payload"];
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  return p["type"] === "message" ? p : null;
}

function record(stats: Map<string, MutableStat>, skillName: string, ts: string | null): void {
  let s = stats.get(skillName);
  if (!s) {
    s = { lastUsed: null, callCount: 0, firstSeen: null };
    stats.set(skillName, s);
  }
  s.callCount += 1;
  if (ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) {
      if (!s.lastUsed || d > s.lastUsed) s.lastUsed = d;
      if (!s.firstSeen || d < s.firstSeen) s.firstSeen = d;
    }
  }
}

// ─── cache I/O ──────────────────────────────────────────────────────────────

async function readCache(path: string): Promise<UsageCache | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null; // any read error: treat as cache miss rather than abort
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (p["version"] !== CACHE_VERSION) return null;
  const files = p["files"];
  if (!files || typeof files !== "object" || Array.isArray(files)) return null;
  const out: Record<string, CachedFileEntry> = {};
  for (const [key, value] of Object.entries(files as Record<string, unknown>)) {
    const entry = validateCachedEntry(value);
    if (entry) out[key] = entry;
  }
  return { version: CACHE_VERSION, files: out };
}

function validateCachedEntry(value: unknown): CachedFileEntry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v["size"] !== "number" || !Number.isFinite(v["size"])) return null;
  if (typeof v["mtimeMs"] !== "number" || !Number.isFinite(v["mtimeMs"])) return null;
  if (!Array.isArray(v["stats"])) return null;
  const stats: SerializedStat[] = [];
  for (const item of v["stats"]) {
    if (!item || typeof item !== "object") return null;
    const it = item as Record<string, unknown>;
    if (typeof it["skillName"] !== "string" || it["skillName"] === "") return null;
    if (typeof it["callCount"] !== "number" || !Number.isFinite(it["callCount"])) return null;
    const lastUsed = it["lastUsed"];
    const firstSeen = it["firstSeen"];
    if (lastUsed !== null && typeof lastUsed !== "string") return null;
    if (firstSeen !== null && typeof firstSeen !== "string") return null;
    stats.push({
      skillName: it["skillName"],
      callCount: it["callCount"],
      lastUsed: lastUsed as string | null,
      firstSeen: firstSeen as string | null,
    });
  }
  return { size: v["size"], mtimeMs: v["mtimeMs"], stats };
}

async function writeCache(path: string, cache: UsageCache): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    // Durable atomic write: fsync the data, then fsync the parent dir after
    // rename. randomUUID() in the temp name avoids same-millisecond collisions
    // between concurrent writers.
    await atomicWriteJson(path, cache, { mode: 0o600, durable: true, pretty: false });
  } catch {
    // Cache write failures must never break the user-visible scan. We
    // intentionally swallow errors here; the next scan will simply re-scan
    // from scratch.
  }
}
