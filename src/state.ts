import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Confidence, DisableRecord, HostName, PendingOp, RoutedSkillRecord, SkillSource, State } from "./types.ts";

export const STATE_DIR = process.env["SKILL_ROUTER_STATE_DIR"] ?? join(homedir(), ".skill-router");
export const STATE_PATH = join(STATE_DIR, "state-claude-code.json");
const STATE_LOCK_METADATA = "owner.json";
const DEFAULT_STATE_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STATE_LOCK_STALE_MS = 60_000;

interface ParsedLockMetadata {
  pid: number | null;
  createdAtMs: number | null;
  token: string | null;
}

interface StateLockInfo {
  isDirectory: boolean;
  dev: number;
  ino: number;
  mtimeMs: number;
  metadata: ParsedLockMetadata | null;
}

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

function validatePendingOp(x: unknown): PendingOp | null {
  if (!isPlainObject(x)) return null;
  const op = x["op"];
  if (op !== "disable" && op !== "enable") return null;
  if (typeof x["id"] !== "string" || x["id"] === "") return null;
  if (typeof x["livePath"] !== "string" || x["livePath"] === "") return null;
  if (typeof x["disabledPath"] !== "string" || x["disabledPath"] === "") return null;
  if (typeof x["startedAt"] !== "string") return null;
  const record = x["record"] === undefined ? undefined : validateRecord(x["record"]);
  if (x["record"] !== undefined && !record) return null;
  const priorRecord = x["priorRecord"] === undefined ? undefined : validateRecord(x["priorRecord"]);
  if (x["priorRecord"] !== undefined && !priorRecord) return null;
  return {
    op,
    id: x["id"],
    livePath: x["livePath"],
    disabledPath: x["disabledPath"],
    startedAt: x["startedAt"],
    ...(record ? { record } : {}),
    ...(priorRecord ? { priorRecord } : {}),
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
  return x === "user" || x === "project" || x === "plugin" || x === "builtin";
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

  const pendingOps: PendingOp[] = [];
  const rawPending = parsed["pendingOps"];
  if (Array.isArray(rawPending)) {
    let droppedPending = 0;
    for (const item of rawPending) {
      const v = validatePendingOp(item);
      if (v) pendingOps.push(v);
      else droppedPending++;
    }
    if (droppedPending > 0) {
      process.stderr.write(`warning: ${droppedPending} malformed pending op(s) in ${path} were ignored.\n`);
    }
  }

  return { schema: 1, host, disabledSkills: validated, routedSkills, pendingOps };
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
  const timeoutMs = opts.timeoutMs ?? DEFAULT_STATE_LOCK_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STATE_LOCK_STALE_MS;
  const started = Date.now();
  let lockToken: string | null = null;
  while (true) {
    const token = await tryAcquireStateLock(lockPath, path);
    if (token) {
      lockToken = token;
      break;
    }

    await recoverStaleStateLock(lockPath, staleMs);
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for state lock: ${lockPath}`);
    }
    await sleep(25);
  }

  try {
    return await fn();
  } finally {
    await releaseStateLock(lockPath, lockToken);
  }
}

async function tryAcquireStateLock(lockPath: string, statePath: string): Promise<string | null> {
  return tryAcquireLockDirectory(lockPath, stateHostFromPath(statePath));
}

async function tryAcquireLockDirectory(lockPath: string, host: string): Promise<string | null> {
  const token = randomUUID();
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw err;
  }

  try {
    await writeFile(
      join(lockPath, STATE_LOCK_METADATA),
      JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        host,
        token,
      }, null, 2) + "\n",
      { mode: 0o600 },
    );
  } catch (err) {
    await rm(lockPath, { recursive: true, force: true });
    throw err;
  }
  return token;
}

async function recoverStaleStateLock(lockPath: string, staleMs: number): Promise<void> {
  const info = await readStateLockInfo(lockPath);
  if (!info || !isRecoverableStaleLock(info, staleMs)) return;

  const recoveryLockPath = `${lockPath}.recovering`;
  const recoveryToken = await tryAcquireRecoveryLock(recoveryLockPath, staleMs);
  if (!recoveryToken) return;
  try {
    const latest = await readStateLockInfo(lockPath);
    if (!latest || !isSameLockDirectory(info, latest) || !isRecoverableStaleLock(latest, staleMs)) return;

    await renameAndRemoveLockDirectory(lockPath);
  } finally {
    await releaseStateLock(recoveryLockPath, recoveryToken);
  }
}

async function tryAcquireRecoveryLock(lockPath: string, staleMs: number): Promise<string | null> {
  let token = await tryAcquireLockDirectory(lockPath, "state-lock-recovery");
  if (token) return token;

  await recoverStaleRecoveryLock(lockPath, staleMs);
  token = await tryAcquireLockDirectory(lockPath, "state-lock-recovery");
  return token;
}

async function recoverStaleRecoveryLock(lockPath: string, staleMs: number): Promise<void> {
  const info = await readStateLockInfo(lockPath);
  if (!info || !isRecoverableStaleLock(info, staleMs)) return;

  const latest = await readStateLockInfo(lockPath);
  if (!latest || !isSameLockDirectory(info, latest) || !isRecoverableStaleLock(latest, staleMs)) return;

  await renameAndRemoveLockDirectory(lockPath);
}

async function renameAndRemoveLockDirectory(lockPath: string): Promise<void> {
  const reapPath = `${lockPath}.reaped.${process.pid}.${Date.now()}.${randomUUID()}`;
  try {
    await rename(lockPath, reapPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  await rm(reapPath, { recursive: true, force: true });
}

async function releaseStateLock(lockPath: string, token: string | null): Promise<void> {
  if (!token) return;
  const metadata = await readStateLockMetadata(lockPath);
  if (metadata?.token !== token) return;
  await rm(lockPath, { recursive: true, force: true });
}

async function readStateLockInfo(lockPath: string): Promise<StateLockInfo | null> {
  let s;
  try {
    s = await stat(lockPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return {
    isDirectory: s.isDirectory(),
    dev: s.dev,
    ino: s.ino,
    mtimeMs: s.mtimeMs,
    metadata: s.isDirectory() ? await readStateLockMetadata(lockPath) : null,
  };
}

async function readStateLockMetadata(lockPath: string): Promise<ParsedLockMetadata | null> {
  let raw: string;
  try {
    raw = await readFile(join(lockPath, STATE_LOCK_METADATA), "utf8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const createdAtRaw = parsed["createdAt"];
  const createdAtMs = typeof createdAtRaw === "string" ? Date.parse(createdAtRaw) : NaN;
  const pid = parsed["pid"];
  const token = parsed["token"];
  return {
    pid: typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : null,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    token: typeof token === "string" && token !== "" ? token : null,
  };
}

function isRecoverableStaleLock(info: StateLockInfo, staleMs: number): boolean {
  if (!info.isDirectory || !Number.isFinite(staleMs) || staleMs < 0) return false;
  const pid = info.metadata?.pid ?? null;
  if (pid !== null) return !pidIsRunning(pid);

  const createdAtMs = info.metadata?.createdAtMs ?? info.mtimeMs;
  return Date.now() - createdAtMs > staleMs;
}

function isSameLockDirectory(a: StateLockInfo, b: StateLockInfo): boolean {
  if (!a.isDirectory || !b.isDirectory) return false;

  const aToken = a.metadata?.token ?? null;
  const bToken = b.metadata?.token ?? null;
  if (aToken !== null || bToken !== null) return aToken !== null && aToken === bToken;

  return hasReliableInode(a) && hasReliableInode(b) && a.dev === b.dev && a.ino === b.ino;
}

function hasReliableInode(info: StateLockInfo): boolean {
  return Number.isFinite(info.dev) && Number.isFinite(info.ino) && info.ino !== 0;
}

function pidIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    return true;
  }
}

function stateHostFromPath(path: string): string {
  const match = /^state-(.+)\.json$/.exec(basename(path));
  return match?.[1] ?? "unknown";
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

export function addPendingOp(state: State, op: PendingOp): State {
  const filtered = (state.pendingOps ?? []).filter((p) => p.id !== op.id);
  return { ...state, pendingOps: [...filtered, op] };
}

export function removePendingOp(state: State, id: string): State {
  const remaining = (state.pendingOps ?? []).filter((p) => p.id !== id);
  return { ...state, pendingOps: remaining };
}

export function findPendingOp(state: State, id: string): PendingOp | undefined {
  return state.pendingOps?.find((p) => p.id === id);
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
