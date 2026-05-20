import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Config, RouteMode } from "./types.ts";

export const CONFIG_PATH = join(homedir(), ".skill-router", "config.json");
export const DEFAULT_UNUSED_FOR_DAYS = 30;

export const DEFAULT_CONFIG: Config = {
  unusedForDays: DEFAULT_UNUSED_FOR_DAYS,
  routeMode: "auto",
};

export async function loadConfig(path: string = CONFIG_PATH): Promise<Config> {
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
  return cfg;
}

export function parseRouteMode(value: unknown): RouteMode | null {
  return value === "lexical" || value === "dci" || value === "auto" ? value : null;
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
