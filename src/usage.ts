import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Skill, UsageStat } from "./types.ts";

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
 */
export async function collectUsageStats(projectsDir: string): Promise<Map<string, UsageStat>> {
  const stats = new Map<string, MutableStat>();

  for (const file of await listJsonlFiles(projectsDir)) {
    await scanFile(file, stats);
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
  return out;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const path = join(root, ent.name);
    if (ent.isDirectory()) {
      out.push(...await listJsonlFiles(path));
    } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
      out.push(path);
    }
  }
  return out;
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
