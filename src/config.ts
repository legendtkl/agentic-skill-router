import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Config, RouteMode } from "./types.ts";

export const DEFAULT_CONFIG_PATH = join(homedir(), ".skill-router", "config.json");
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
 * The active config path. Honors `SKILL_ROUTER_CONFIG_PATH` at call time so
 * tests can run multiple in-process invocations against different fake
 * config files without rebuilding the module. Falls back to
 * {@link DEFAULT_CONFIG_PATH} (typically `~/.skill-router/config.json`).
 */
export function configPath(): string {
  return process.env["SKILL_ROUTER_CONFIG_PATH"] ?? DEFAULT_CONFIG_PATH;
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
 * same directory then `rename` it into place so a crash during the write
 * cannot leave a partial file at the canonical path.
 */
export async function saveRawConfigObject(
  config: Record<string, unknown>,
  path: string = configPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, path);
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
 * Serialize a read-modify-write on the config file via a sibling `.lock`
 * file. Acquires by opening with `O_CREAT | O_EXCL | O_WRONLY` (only the
 * first writer wins), retries with a small backoff while another holder is
 * in flight, and deletes the lock file on completion. Times out so a
 * crashed previous run on the same path eventually surfaces as an error
 * rather than hanging the CLI forever.
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
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.close();
      break;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() - started > CONFIG_LOCK_TIMEOUT_MS) {
        throw new Error(`timed out waiting for config lock: ${lockPath}`);
      }
      await sleep(CONFIG_LOCK_RETRY_MS);
    }
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
