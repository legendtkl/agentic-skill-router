import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Confidence, DisableRecord, HostName, RoutedSkillRecord, SkillSource, State } from "./types.ts";

export const STATE_DIR = process.env["SKILL_ROUTER_STATE_DIR"] ?? join(homedir(), ".skill-router");
export const STATE_PATH = join(STATE_DIR, "state-claude-code.json");

function emptyState(host: HostName): State {
  return {
    schema: 1,
    host,
    disabledSkills: [],
  };
}

export function statePathForHost(host: HostName): string {
  const dir = process.env["SKILL_ROUTER_STATE_DIR"] ?? join(homedir(), ".skill-router");
  return join(dir, `state-${host}.json`);
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function validateRecord(x: unknown): DisableRecord | null {
  if (!isPlainObject(x)) return null;
  if (typeof x["id"] !== "string" || x["id"] === "") return null;
  if (typeof x["skillMdPath"] !== "string") return null;
  if (typeof x["disabledAt"] !== "string") return null;
  if (typeof x["reason"] !== "string") return null;
  if (x["pluginKey"] !== null && typeof x["pluginKey"] !== "string") return null;
  if (x["skillName"] !== undefined && typeof x["skillName"] !== "string") return null;
  if (x["source"] !== undefined && !isSkillSource(x["source"])) return null;
  return {
    id: x["id"],
    skillMdPath: x["skillMdPath"],
    ...(typeof x["skillName"] === "string" ? { skillName: x["skillName"] } : {}),
    ...(isSkillSource(x["source"]) ? { source: x["source"] } : {}),
    disabledAt: x["disabledAt"],
    reason: x["reason"],
    pluginKey: x["pluginKey"] as string | null,
  };
}

function validateRoutedRecord(x: unknown): RoutedSkillRecord | null {
  if (!isPlainObject(x)) return null;
  if (typeof x["id"] !== "string" || x["id"] === "") return null;
  if (x["pluginKey"] !== null && typeof x["pluginKey"] !== "string") return null;
  if (typeof x["skillMdPath"] !== "string" || x["skillMdPath"] === "") return null;
  if (typeof x["name"] !== "string" || x["name"] === "") return null;
  if (typeof x["routeCount"] !== "number" || !Number.isFinite(x["routeCount"]) || x["routeCount"] < 1) return null;
  if (typeof x["firstRoutedAt"] !== "string") return null;
  if (typeof x["lastRoutedAt"] !== "string") return null;
  if (typeof x["lastQuery"] !== "string") return null;
  if (!isConfidence(x["lastConfidence"])) return null;
  return {
    id: x["id"],
    pluginKey: x["pluginKey"] as string | null,
    skillMdPath: x["skillMdPath"],
    name: x["name"],
    routeCount: x["routeCount"],
    firstRoutedAt: x["firstRoutedAt"],
    lastRoutedAt: x["lastRoutedAt"],
    lastQuery: x["lastQuery"],
    lastConfidence: x["lastConfidence"],
  };
}

function isConfidence(x: unknown): x is Confidence {
  return x === "high" || x === "medium" || x === "low";
}

function isSkillSource(x: unknown): x is SkillSource {
  return x === "user" || x === "plugin" || x === "builtin";
}

export async function loadState(path: string = STATE_PATH, host: HostName = "claude-code"): Promise<State> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyState(host);
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`state file at ${path} is not valid JSON`);
  }
  if (
    !isPlainObject(parsed) ||
    parsed["schema"] !== 1 ||
    parsed["host"] !== host ||
    !Array.isArray(parsed["disabledSkills"])
  ) {
    throw new Error(`state file at ${path} has unexpected schema`);
  }
  // Validate each record; drop invalid ones and emit a warning to stderr so the
  // user sees data integrity issues without aborting `status`/`list`.
  const validated: DisableRecord[] = [];
  let dropped = 0;
  for (const item of parsed["disabledSkills"]) {
    const v = validateRecord(item);
    if (v) validated.push(v);
    else dropped++;
  }
  if (dropped > 0) {
    // Before any subsequent saveState overwrites the file, snapshot the
    // original so the dropped records are actually recoverable. The bak path
    // includes a timestamp so multiple corruption events don't clobber each
    // other.
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = `${path}.malformed.${ts}.bak`;
    try {
      await copyFile(path, bak);
      process.stderr.write(
        `warning: ${dropped} malformed disable record(s) in ${path} were ignored. ` +
        `Original snapshotted to ${bak}.\n`,
      );
    } catch (err) {
      process.stderr.write(
        `warning: ${dropped} malformed disable record(s) in ${path} were ignored. ` +
        `Failed to snapshot original to ${bak}: ${(err as Error).message}\n`,
      );
    }
  }

  const routedSkills: RoutedSkillRecord[] = [];
  const rawRouted = parsed["routedSkills"];
  if (Array.isArray(rawRouted)) {
    let droppedRouted = 0;
    for (const item of rawRouted) {
      const v = validateRoutedRecord(item);
      if (v) routedSkills.push(v);
      else droppedRouted++;
    }
    if (droppedRouted > 0) {
      process.stderr.write(`warning: ${droppedRouted} malformed routed skill record(s) in ${path} were ignored.\n`);
    }
  }

  return { schema: 1, host, disabledSkills: validated, routedSkills };
}

export async function saveState(state: State, path: string = STATE_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Per-process unique temp name avoids two CLI invocations clobbering each
  // other's temp file before rename. Truly concurrent state mutations are
  // still racy (read-modify-write), but rename atomicity protects the final
  // file.
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, path);
}

export async function withStateLock<T>(
  path: string = STATE_PATH,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number; staleMs?: number } = {},
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out waiting for state lock: ${lockPath}`);
      }
      await sleep(25);
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function addDisableRecord(state: State, record: DisableRecord): State {
  const filtered = state.disabledSkills.filter((r) => r.id !== record.id);
  return { ...state, disabledSkills: [...filtered, record] };
}

export function removeDisableRecord(state: State, id: string): State {
  return { ...state, disabledSkills: state.disabledSkills.filter((r) => r.id !== id) };
}

export function findDisableRecord(state: State, id: string): DisableRecord | undefined {
  return state.disabledSkills.find((r) => r.id === id);
}

export function recordRoutedSkill(
  state: State,
  record: {
    id: string;
    pluginKey: string | null;
    skillMdPath: string;
    name: string;
    query: string;
    confidence: Confidence;
    routedAt: string;
  },
): State {
  const existing = state.routedSkills?.find((r) => r.id === record.id);
  const routed: RoutedSkillRecord = {
    id: record.id,
    pluginKey: record.pluginKey,
    skillMdPath: record.skillMdPath,
    name: record.name,
    routeCount: (existing?.routeCount ?? 0) + 1,
    firstRoutedAt: existing?.firstRoutedAt ?? record.routedAt,
    lastRoutedAt: record.routedAt,
    lastQuery: record.query,
    lastConfidence: record.confidence,
  };
  const rest = (state.routedSkills ?? []).filter((r) => r.id !== record.id);
  rest.push(routed);
  rest.sort((a, b) => b.lastRoutedAt.localeCompare(a.lastRoutedAt));
  return { ...state, routedSkills: rest };
}
