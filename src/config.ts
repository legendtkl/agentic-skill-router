import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { atomicWriteJson } from "./atomic-write.ts";
import type { Config, RouteMode } from "./types.ts";

export const DEFAULT_CONFIG_PATH = join(homedir(), ".agentic-skill-router", "config.json");
export const DEFAULT_UNUSED_FOR_DAYS = 30;

export const DEFAULT_CONFIG: Config = {
  unusedForDays: DEFAULT_UNUSED_FOR_DAYS,
  routeMode: "auto",
};

/** Keys the CLI accepts via `config set <key> <value>`. */
export const CONFIG_KEYS = ["unusedForDays", "routeMode", "keepNames", "keepIds"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

/** Valid values for `routeMode`. Kept in sync with {@link parseRouteMode}. */
export const ROUTE_MODES: ReadonlyArray<RouteMode> = ["auto", "metadata", "body", "lexical", "dci"];

/**
 * The active config path. Honors `AGENTIC_SKILL_ROUTER_CONFIG_PATH` at call time so
 * tests can run multiple in-process invocations against different fake
 * config files without rebuilding the module. Falls back to
 * {@link DEFAULT_CONFIG_PATH} (typically `~/.agentic-skill-router/config.json`).
 */
export function configPath(): string {
  return process.env["AGENTIC_SKILL_ROUTER_CONFIG_PATH"] ?? DEFAULT_CONFIG_PATH;
}

/**
 * Backwards-compatible alias kept for existing imports. New code should
 * prefer the {@link configPath} function so the env-var override is
 * honored at call time.
 */
export const CONFIG_PATH = configPath();

export async function loadConfig(path: string = configPath()): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_CONFIG };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`config file at ${path} is not valid JSON`);
  }
  const obj = (parsed && typeof parsed === "object") ? (parsed as Record<string, unknown>) : {};
  const cfg: Config = { ...DEFAULT_CONFIG };
  if (typeof obj.unusedForDays === "number" && Number.isFinite(obj.unusedForDays) && obj.unusedForDays >= 0) {
    cfg.unusedForDays = Math.floor(obj.unusedForDays);
  }
  const routeMode = parseRouteMode(obj.routeMode);
  if (routeMode) cfg.routeMode = routeMode;
  const keepNames = parseStringArray(obj["keepNames"]);
  if (keepNames) cfg.keepNames = keepNames;
  const keepIds = parseStringArray(obj["keepIds"]);
  if (keepIds) cfg.keepIds = keepIds;
  return cfg;
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item !== "") out.push(item);
  }
  return out;
}

export function parseRouteMode(value: unknown): RouteMode | null {
  return value === "lexical" || value === "metadata" || value === "body" || value === "dci" || value === "auto" ? value : null;
}

/**
 * Parse a duration spec into days. Accepts:
 *   "30"  -> 30 (bare number = days)
 *   "30d" -> 30
 *   "2w"  -> 14
 *   "3m"  -> 90 (months treated as 30 days)
 *   "1y"  -> 365
 * Throws on invalid input.
 */
export function parseDuration(spec: string): number {
  const s = spec.trim().toLowerCase();
  if (s === "") throw new Error("duration cannot be empty");
  const m = s.match(/^(\d+)\s*(d|w|m|y)?$/);
  if (!m) throw new Error(`invalid duration: ${spec} (expected e.g. 30, 30d, 2w, 3m, 1y)`);
  const n = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid duration: ${spec}`);
  const unit = (m[2] ?? "d") as "d" | "w" | "m" | "y";
  switch (unit) {
    case "d": return n;
    case "w": return n * 7;
    case "m": return n * 30;
    case "y": return n * 365;
  }
}

export function resolveUnusedForDays(opts: {
  cliFlag?: string | undefined;
  config: Config;
}): number {
  if (opts.cliFlag !== undefined && opts.cliFlag !== "") {
    return parseDuration(opts.cliFlag);
  }
  return opts.config.unusedForDays;
}

/**
 * Read the raw config file as a JSON object, ignoring unknown keys at the
 * top level. Returns an empty object when the file is missing. Throws when
 * the file exists but is not valid JSON, or when it parses to a non-object.
 * Used by {@link setConfigValue} so writes can update a single key without
 * dropping unknown sibling keys a future schema might add.
 */
export async function loadRawConfigObject(path: string = configPath()): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`config file at ${path} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`config file at ${path} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Atomically write the given config object to disk: write a temp file in the
 * same directory, fsync it, then `rename` it into place and fsync the parent
 * directory so the write survives an abrupt power loss. The temp filename
 * includes randomUUID() so two writers in the same millisecond cannot collide
 * on the temp path.
 */
export async function saveRawConfigObject(
  config: Record<string, unknown>,
  path: string = configPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteJson(path, config, { mode: 0o600, durable: true });
}

/**
 * Validate a textual `value` for the given config `key` and return the
 * value the on-disk JSON should hold. Throws {@link ConfigValueError} when
 * the value is not acceptable. Pure: does not touch disk.
 */
export function parseConfigValue(key: ConfigKey, value: string): unknown {
  switch (key) {
    case "unusedForDays": {
      const trimmed = value.trim();
      // Number("") is 0, which would otherwise quietly pass the integer check.
      // Reject empty input explicitly so the user sees the expectation.
      if (trimmed === "") {
        throw new ConfigValueError(`unusedForDays must be a non-negative integer (got ${JSON.stringify(value)})`);
      }
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0) {
        throw new ConfigValueError(`unusedForDays must be a non-negative integer (got ${JSON.stringify(value)})`);
      }
      return n;
    }
    case "routeMode": {
      const parsed = parseRouteMode(value);
      if (!parsed) {
        throw new ConfigValueError(`routeMode must be one of: ${ROUTE_MODES.join(", ")} (got ${JSON.stringify(value)})`);
      }
      return parsed;
    }
    case "keepNames":
    case "keepIds":
      return parseStringArrayValue(key, value);
  }
}

/**
 * Update one key in the on-disk config atomically. Reads the current raw
 * JSON object, applies the validated value, and writes the result back via
 * {@link saveRawConfigObject}. Unknown sibling keys are preserved.
 *
 * The read-modify-write block is serialized by {@link withLockedConfigUpdate}
 * so two concurrent `skills config set` invocations on the same machine do
 * not drop each other's keys.
 */
export async function setConfigValue(
  key: ConfigKey,
  value: string,
  path: string = configPath(),
): Promise<{ key: ConfigKey; value: unknown }> {
  // Validate before taking the lock so bad input fails fast and doesn't
  // briefly block another writer.
  const parsed = parseConfigValue(key, value);
  return withLockedConfigUpdate(path, async () => {
    const current = await loadRawConfigObject(path);
    current[key] = parsed;
    await saveRawConfigObject(current, path);
    return { key, value: parsed };
  });
}

const CONFIG_LOCK_TIMEOUT_MS = 5_000;
const CONFIG_LOCK_RETRY_MS = 25;
/**
 * Maximum age before a lock file is considered stale and reaped, even if
 * its recorded PID happens to still be alive. 60 seconds is far longer than
 * any normal `skills config set` read-modify-write should take, so this is
 * a safe upper bound that also defends against PID recycling (where a dead
 * writer's PID was reassigned to an unrelated long-running process).
 */
const CONFIG_LOCK_MAX_AGE_MS = 60_000;

interface LockOwner {
  pid: number;
  startedAt: number;
}

/**
 * Serialize a read-modify-write on the config file via a sibling `.lock`
 * file. Acquires by writing a fully-formed owner record to a private temp
 * file and then `link()`-ing it into place at the canonical lock path — an
 * atomic operation on POSIX. The first linker wins; everyone else sees
 * `EEXIST` against a lock file that is guaranteed to already contain a
 * complete owner record, eliminating the window where a contender could
 * observe an "owned but empty" lock and incorrectly reap it.
 *
 * Retries with a small backoff while another holder is in flight and
 * deletes the lock file on completion. Times out so a crashed previous run
 * on the same path eventually surfaces as an error rather than hanging the
 * CLI forever.
 *
 * To recover from abrupt termination (SIGKILL, power loss) that leaves a
 * stale lock behind, the lock file records the owner's PID and start time.
 * On `EEXIST`, the contender reads that record and reaps the lock when the
 * recorded PID is dead OR the lock is older than {@link CONFIG_LOCK_MAX_AGE_MS}.
 * The age fallback covers the PID-recycling case where the original owner
 * died but its PID was reassigned to an unrelated live process.
 *
 * This is a same-machine guard; it is not a multi-host concurrency primitive.
 */
export async function withLockedConfigUpdate<T>(
  path: string,
  fn: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const started = Date.now();
  while (true) {
    const acquired = await tryAcquireLock(lockPath);
    if (acquired) break;
    if (await tryReapStaleLock(lockPath)) {
      // Loop immediately to re-attempt acquisition; another contender may
      // win the race after our unlink, in which case we fall back to the
      // normal retry path below.
      continue;
    }
    if (Date.now() - started > CONFIG_LOCK_TIMEOUT_MS) {
      throw new Error(`timed out waiting for config lock: ${lockPath}`);
    }
    await sleep(CONFIG_LOCK_RETRY_MS);
  }
  try {
    return await fn();
  } finally {
    try {
      await unlink(lockPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

/**
 * Try to atomically acquire the lock by writing a complete owner record to
 * a private temp file and `link()`-ing it into place at `lockPath`. Returns
 * `true` if this caller now owns the lock, `false` if another holder beat
 * us to it (EEXIST). Any other error is re-thrown.
 *
 * Using `link()` rather than `open(..., 'wx')` plus a follow-up `writeFile`
 * eliminates the small window where a contender could observe the lock as
 * "owned but empty": by the time anyone else can see `lockPath`, the file
 * it points to already contains a fully serialized owner record.
 */
async function tryAcquireLock(lockPath: string): Promise<boolean> {
  const owner: LockOwner = { pid: process.pid, startedAt: Date.now() };
  // Per-attempt unique tmp name so a previous failed attempt by the same
  // process cannot collide with this one.
  const tmpPath = `${lockPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
  try {
    await link(tmpPath, lockPath);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    // The tmp file is just a vehicle for the atomic link; once linked (or
    // failed to link) it has served its purpose. Best-effort unlink — if
    // this fails the file is orphaned but harmless.
    try {
      await unlink(tmpPath);
    } catch {
      // ignore
    }
  }
}

/**
 * Decide whether the lock at `lockPath` is stale and, if so, unlink it.
 * Returns `true` when the caller should retry acquisition immediately.
 *
 * A lock is considered stale only when its owner record is fully parseable
 * AND either:
 *   - the recorded `pid` is not a live process (`process.kill(pid, 0)`
 *     throws `ESRCH`), or
 *   - the recorded `startedAt` is older than {@link CONFIG_LOCK_MAX_AGE_MS}.
 *
 * The age check protects against PID recycling: even if the OS reassigned
 * the dead writer's PID to an unrelated live process, the lock will still
 * be reaped after the timeout.
 *
 * Critically, an empty or unparseable owner record is NEVER reaped. The
 * atomic `link()`-based acquisition in {@link tryAcquireLock} guarantees
 * that any lock file visible to a contender already contains a complete
 * owner record, so an empty/partial record indicates either external
 * corruption or a stranger writing to the path — neither case justifies
 * silently hijacking the lock. Returning `false` here forces the caller
 * down the normal retry-with-backoff path until the lock either becomes
 * legible or the age fallback fires (the file's age is invisible until we
 * can parse its `startedAt`, so a permanently-corrupt lock will surface as
 * a timeout, which is the correct loud failure mode).
 *
 * The unlink itself is best-effort: a concurrent reaper may have already
 * removed the file. The caller retries via the normal acquisition loop, so
 * losing a reap race is harmless.
 */
async function tryReapStaleLock(lockPath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (err: unknown) {
    // File vanished between EEXIST and our read; the previous holder
    // already cleaned up. Tell the caller to retry acquisition.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    return false;
  }
  const owner = parseLockOwner(raw);
  if (owner === null) {
    // Empty / malformed owner record. With atomic link acquisition this
    // should not happen for locks we created; treat as a live (but
    // unreadable) holder rather than a stale one, and let the caller retry
    // until either the record becomes legible or the overall timeout fires.
    return false;
  }
  const stale = !isPidAlive(owner.pid) || Date.now() - owner.startedAt > CONFIG_LOCK_MAX_AGE_MS;
  if (!stale) return false;
  try {
    await unlink(lockPath);
  } catch (err: unknown) {
    // Another contender already reaped it; fine, just retry.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  return true;
}

function parseLockOwner(raw: string): LockOwner | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const pid = obj["pid"];
  const startedAt = obj["startedAt"];
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  return { pid, startedAt };
}

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 performs no signal but still does the existence and
    // permission checks. ESRCH means no such process; EPERM means the
    // process exists but we can't signal it (treat as alive).
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    // EPERM (or anything else): assume alive to avoid reaping a live owner.
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isConfigKey(value: string): value is ConfigKey {
  return (CONFIG_KEYS as ReadonlyArray<string>).includes(value);
}

export class ConfigValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValueError";
  }
}

function parseStringArrayValue(key: "keepNames" | "keepIds", value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ConfigValueError(
      `${key} must be a JSON array of strings, e.g. '["foo","bar"]' (got ${JSON.stringify(value)})`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new ConfigValueError(
      `${key} must be a JSON array of strings, e.g. '["foo","bar"]' (got ${JSON.stringify(value)})`,
    );
  }
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") {
      throw new ConfigValueError(`${key} array entries must be strings (got ${JSON.stringify(item)})`);
    }
    if (item !== "") out.push(item);
  }
  return out;
}
