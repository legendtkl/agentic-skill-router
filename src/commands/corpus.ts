import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseStrict } from "../args.ts";
import {
  buildSkillCorpusBm25Index,
  inspectSkillCorpus,
  searchSkillCorpus,
  searchSkillCorpusBm25Index,
  selectSkillCorpus,
  type CorpusBm25Index,
  type CorpusRanker,
} from "../corpus.ts";
import { createHost } from "../host-resolve.ts";
import {
  parseConfidence,
  parsePositiveFlag,
  printCorpusInspect,
  printCorpusSearch,
  stringValues,
  usage,
} from "../output.ts";
import type { Host } from "../hosts/base.ts";
import type { HostName, Skill } from "../types.ts";
import { loadState, recordRoutedSkill, saveState, statePathForHost, withStateLock } from "../state.ts";

/**
 * Agentic corpus primitives for skill routing. These commands intentionally
 * sit outside the DCI namespace: they expose bounded, metadata-first search
 * and inspection tools that an agent can compose into its own retrieval loop.
 */
export async function cmdCorpus(argv: string[], hostName: HostName): Promise<number> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case "search":
      return cmdCorpusSearch(rest, hostName);
    case "inspect":
      return cmdCorpusInspect(rest, hostName);
    case "select":
      return cmdCorpusSelect(rest, hostName);
    case undefined:
    case "-h":
    case "--help":
      return usage();
    default:
      console.error(`unknown corpus subcommand: ${subcommand}`);
      return usage(2);
  }
}

async function cmdCorpusSelect(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills corpus select",
    config: {
      args: argv,
      options: {
        query: { type: "string", short: "q" },
        confidence: { type: "string" },
        reason: { type: "string" },
        json: { type: "boolean" },
        "no-record": { type: "boolean" },
      },
      allowPositionals: true,
    },
  });
  const idOrRef = positionals[0];
  if (!idOrRef || positionals.length > 1) {
    console.error("specify exactly one <id-or-name-or-ref>");
    return 2;
  }
  const query = (values.query as string | undefined)?.trim();
  if (!query) {
    console.error("specify --query=<text>");
    return 2;
  }
  const confidence = parseConfidence(values.confidence as string | undefined);
  if (!confidence || confidence === "low") {
    console.error("--confidence must be high or medium");
    return 2;
  }
  const reason = (values.reason as string | undefined)?.trim();
  if (!reason) {
    console.error("specify --reason=<text>");
    return 2;
  }

  const host = createHost(hostName);
  try {
    const selected = selectSkillCorpus(await host.listSkills(), idOrRef, confidence, reason);
    const warnings: string[] = [];
    let recorded = false;
    if (!values["no-record"]) {
      try {
        const statePath = statePathForHost(host.name);
        await withStateLock(statePath, async () => {
          const state = await loadState(statePath, host.name);
          await saveState(
            recordRoutedSkill(state, {
              id: selected.id,
              pluginKey: selected.pluginKey,
              skillMdPath: selected.skillMdPath,
              name: selected.name,
              query,
              confidence,
              routedAt: new Date().toISOString(),
            }),
            statePath,
          );
        });
        recorded = true;
      } catch (err) {
        const warning = `routed usage was not recorded: ${(err as Error).message}`;
        warnings.push(warning);
        process.stderr.write(`warning: ${warning}\n`);
      }
    }

    const result = { action: selected.action, query, recorded, warnings, selected };
    if (values.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      console.log(`select: [${selected.confidence}] ${selected.id} (${selected.ref})`);
      console.log(`read:   ${selected.skillMdPath}`);
      console.log(`why:    ${selected.reason}`);
      if (recorded) console.log("usage:  recorded routed use");
    }
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
}

async function cmdCorpusSearch(argv: string[], hostName: HostName): Promise<number> {
  const { values } = parseStrict({
    commandName: "agentic-skill-router skills corpus search",
    config: {
      args: argv,
      options: {
        any: { type: "string", multiple: true },
        all: { type: "string", multiple: true },
        limit: { type: "string" },
        ranker: { type: "string" },
        json: { type: "boolean" },
      },
      allowPositionals: false,
    },
  });
  const any = stringValues(values.any);
  const all = stringValues(values.all);
  if (any.length === 0 && all.length === 0) {
    console.error("specify at least one --any=<term> or --all=<term>");
    return 2;
  }
  const limit = parsePositiveFlag(values.limit as string | undefined, "--limit");
  if (limit === null) return 2;
  const ranker = parseCorpusRanker(values.ranker as string | undefined);
  if (!ranker) return 2;

  const host = createHost(hostName);
  const searchOpts = { any, all, ranker, ...(limit === undefined ? {} : { limit }) };
  const result =
    ranker === "bm25"
      ? searchSkillCorpusBm25Index(await loadCorpusBm25Index(host), searchOpts)
      : searchSkillCorpus((await loadCorpusSkills(host)).skills, searchOpts);
  if (values.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }
  printCorpusSearch(result);
  return result.matches.length > 0 ? 0 : 1;
}

function parseCorpusRanker(raw: string | undefined): CorpusRanker | null {
  if (raw === undefined || raw === "weighted") return "weighted";
  if (raw === "bm25") return "bm25";
  console.error(`invalid --ranker: ${raw} (expected weighted or bm25)`);
  return null;
}

async function cmdCorpusInspect(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills corpus inspect",
    config: {
      args: argv,
      options: {
        json: { type: "boolean" },
      },
      allowPositionals: true,
    },
  });
  if (positionals.length === 0) {
    console.error("specify <id-or-name-or-ref...>");
    return 2;
  }

  const host = createHost(hostName);
  try {
    const result = inspectSkillCorpus((await loadCorpusSkills(host)).skills, positionals);
    if (values.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    else printCorpusInspect(result);
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
}

interface CorpusCacheFile {
  version: 2;
  host: HostName;
  createdAtMs: number;
  fingerprint: string;
  skills: Skill[];
}

interface CorpusBm25IndexCacheFile {
  version: 1;
  host: HostName;
  createdAtMs: number;
  fingerprint: string;
  index: CorpusBm25Index;
}

interface LoadedCorpus {
  fingerprint: string;
  skills: Skill[];
}

const CORPUS_CACHE_VERSION = 2;
const CORPUS_BM25_INDEX_CACHE_VERSION = 1;
const DEFAULT_CORPUS_CACHE_TTL_MS = 30_000;

async function loadCorpusSkills(host: Host): Promise<LoadedCorpus> {
  if (process.env["AGENTIC_SKILL_ROUTER_CORPUS_CACHE"] === "0") {
    const [fingerprint, skills] = await Promise.all([corpusFingerprint(host), host.listSkills()]);
    return { fingerprint, skills: sanitizeCorpusSkills(skills) };
  }
  const cachePath = corpusCachePath(host.name);
  const cached = await readCorpusCache(cachePath);
  const now = Date.now();
  const ttlMs = corpusCacheTtlMs();
  if (isCorpusCacheForHost(cached, host.name) && now - cached.createdAtMs < ttlMs) {
    return { fingerprint: cached.fingerprint, skills: sanitizeCorpusSkills(cached.skills) };
  }
  const bm25Corpus = await readFreshCorpusFromBm25IndexCache(host, now, ttlMs);
  if (bm25Corpus) return bm25Corpus;

  const fingerprint = await corpusFingerprint(host);
  if (isCorpusCacheForHost(cached, host.name) && cached.fingerprint === fingerprint) {
    const skills = sanitizeCorpusSkills(cached.skills);
    await writeCorpusCacheBestEffort(cachePath, { ...cached, createdAtMs: now, skills });
    return { fingerprint, skills };
  }

  const skills = sanitizeCorpusSkills(await host.listSkills());
  await writeCorpusCacheBestEffort(cachePath, {
    version: CORPUS_CACHE_VERSION,
    host: host.name,
    createdAtMs: now,
    fingerprint,
    skills,
  });
  return { fingerprint, skills };
}

async function loadCorpusBm25Index(host: Host): Promise<CorpusBm25Index> {
  if (process.env["AGENTIC_SKILL_ROUTER_CORPUS_CACHE"] === "0") {
    return buildSkillCorpusBm25Index((await loadCorpusSkills(host)).skills);
  }
  const cachePath = corpusBm25IndexCachePath(host.name);
  const cached = await readCorpusBm25IndexCache(cachePath);
  const now = Date.now();
  const ttlMs = corpusCacheTtlMs();
  if (isCorpusBm25IndexCacheForHost(cached, host.name) && now - cached.createdAtMs < ttlMs) {
    return sanitizeCorpusBm25Index(cached.index);
  }

  const corpus = await loadCorpusSkills(host);
  if (isCorpusBm25IndexCacheForHost(cached, host.name) && cached.fingerprint === corpus.fingerprint) {
    const index = sanitizeCorpusBm25Index(cached.index);
    await writeJsonBestEffort(cachePath, { ...cached, createdAtMs: now, index });
    return index;
  }

  const index = buildSkillCorpusBm25Index(corpus.skills);
  await writeJsonBestEffort(cachePath, {
    version: CORPUS_BM25_INDEX_CACHE_VERSION,
    host: host.name,
    createdAtMs: now,
    fingerprint: corpus.fingerprint,
    index,
  });
  return index;
}

async function corpusFingerprint(host: Host): Promise<string> {
  const roots = await host.skillRoots();
  const hash = createHash("sha256");
  await updateHostConfigFingerprint(hash, host.name);
  for (const root of roots.sort()) {
    hash.update(root);
    hash.update("\0");
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      hash.update("missing-root\0");
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      hash.update(entry.name);
      hash.update("\0");
      await updateMarkerFingerprint(hash, join(root, entry.name, "SKILL.md"));
      await updateMarkerFingerprint(hash, join(root, entry.name, "SKILL.md.agentic-skill-router-disabled"));
    }
  }
  return hash.digest("hex");
}

async function updateHostConfigFingerprint(hash: ReturnType<typeof createHash>, hostName: HostName): Promise<void> {
  const paths = hostConfigPaths(hostName);
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    await updateMarkerFingerprint(hash, path);
  }
}

function hostConfigPaths(hostName: HostName): string[] {
  if (hostName === "codex") {
    const codexHome = process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
    return [join(codexHome, "config.toml")];
  }
  const claudeHome = process.env["CLAUDE_HOME"] ?? join(homedir(), ".claude");
  return [join(claudeHome, "settings.json"), join(claudeHome, "plugins", "installed_plugins.json")];
}

async function updateMarkerFingerprint(hash: ReturnType<typeof createHash>, path: string): Promise<void> {
  try {
    const s = await stat(path);
    hash.update(`${s.size}:${Math.round(s.mtimeMs)}`);
    hash.update("\0");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    hash.update("missing\0");
  }
}

function sanitizeCorpusSkills(skills: Skill[]): Skill[] {
  return skills.map((skill) => ({
    ...skill,
    skillMdPath: sanitizeSkillPath(skill),
  }));
}

function pathIdentity(skill: Skill): string {
  return createHash("sha256").update(`${skill.id}\0${skill.skillMdPath}`).digest("hex").slice(0, 16);
}

function sanitizeSkillPath(skill: Skill): string {
  if (!skill.skillMdPath) return "";
  if (skill.skillMdPath.startsWith("corpus-cache:")) return skill.skillMdPath;
  return `corpus-cache:${pathIdentity(skill)}`;
}

async function writeCorpusCache(path: string, cache: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(cache));
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function writeCorpusCacheBestEffort(path: string, cache: CorpusCacheFile): Promise<void> {
  await writeJsonBestEffort(path, cache);
}

async function writeJsonBestEffort(path: string, value: unknown): Promise<void> {
  try {
    await writeCorpusCache(path, value);
  } catch {
    // Cache writes are an optimization; corpus search should still work on
    // read-only homes or under concurrent command invocations.
  }
}

function corpusBm25IndexCachePath(host: HostName): string {
  const dir = process.env["AGENTIC_SKILL_ROUTER_STATE_DIR"] ?? join(homedir(), ".agentic-skill-router");
  return join(dir, `corpus-bm25-index-${host}.json`);
}

function corpusCachePath(host: HostName): string {
  const dir = process.env["AGENTIC_SKILL_ROUTER_STATE_DIR"] ?? join(homedir(), ".agentic-skill-router");
  return join(dir, `corpus-cache-${host}.json`);
}

function corpusCacheTtlMs(): number {
  const raw = process.env["AGENTIC_SKILL_ROUTER_CORPUS_CACHE_TTL_MS"];
  if (!raw) return DEFAULT_CORPUS_CACHE_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CORPUS_CACHE_TTL_MS;
  return parsed;
}

async function readJsonFile(path: string): Promise<unknown | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function readCorpusCache(path: string): Promise<CorpusCacheFile | null> {
  const parsed = (await readJsonFile(path)) as Partial<CorpusCacheFile> | null;
  if (!parsed) return null;
  try {
    if (parsed.version !== CORPUS_CACHE_VERSION) return null;
    if (parsed.host !== "claude-code" && parsed.host !== "codex") return null;
    if (typeof parsed.fingerprint !== "string") return null;
    if (!Array.isArray(parsed.skills)) return null;
    if (typeof parsed.createdAtMs !== "number") return null;
    return parsed as CorpusCacheFile;
  } catch {
    return null;
  }
}

async function readCorpusBm25IndexCache(path: string): Promise<CorpusBm25IndexCacheFile | null> {
  const parsed = (await readJsonFile(path)) as Partial<CorpusBm25IndexCacheFile> | null;
  if (!parsed) return null;
  try {
    if (parsed.version !== CORPUS_BM25_INDEX_CACHE_VERSION) return null;
    if (parsed.host !== "claude-code" && parsed.host !== "codex") return null;
    if (typeof parsed.fingerprint !== "string") return null;
    if (typeof parsed.createdAtMs !== "number") return null;
    if (!parsed.index || parsed.index.version !== 1) return null;
    if (!Array.isArray(parsed.index.documents)) return null;
    if (!Array.isArray(parsed.index.documentFrequency)) return null;
    if (!Array.isArray(parsed.index.postings)) return null;
    return parsed as CorpusBm25IndexCacheFile;
  } catch {
    return null;
  }
}

async function readFreshCorpusFromBm25IndexCache(host: Host, now: number, ttlMs: number): Promise<LoadedCorpus | null> {
  const cached = await readCorpusBm25IndexCache(corpusBm25IndexCachePath(host.name));
  if (!isCorpusBm25IndexCacheForHost(cached, host.name) || now - cached.createdAtMs >= ttlMs) {
    return null;
  }
  return {
    fingerprint: cached.fingerprint,
    skills: skillsFromBm25Index(sanitizeCorpusBm25Index(cached.index)),
  };
}

function isCorpusCacheForHost(cache: CorpusCacheFile | null, host: HostName): cache is CorpusCacheFile {
  return cache !== null && cache.host === host;
}

function isCorpusBm25IndexCacheForHost(
  cache: CorpusBm25IndexCacheFile | null,
  host: HostName,
): cache is CorpusBm25IndexCacheFile {
  return cache !== null && cache.host === host;
}

function sanitizeCorpusBm25Index(index: CorpusBm25Index): CorpusBm25Index {
  return {
    ...index,
    documents: index.documents.map((doc) => ({
      ...doc,
      skill: {
        ...doc.skill,
        skillMdPath: sanitizeSkillPath(doc.skill),
      },
    })),
  };
}

function skillsFromBm25Index(index: CorpusBm25Index): Skill[] {
  return index.documents.map((doc) => doc.skill);
}
