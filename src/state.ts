import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { DisableRecord, HostName, State } from "./types.ts";

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
  return {
    id: x["id"],
    skillMdPath: x["skillMdPath"],
    disabledAt: x["disabledAt"],
    reason: x["reason"],
    pluginKey: x["pluginKey"] as string | null,
  };
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
  return { schema: 1, host, disabledSkills: validated };
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
