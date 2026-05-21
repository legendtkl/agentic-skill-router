import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";
import type { Skill, SkillMetadata } from "./types.ts";

export const DISABLED_SUFFIX = ".skill-router-disabled";

interface InstalledPlugin {
  pluginKey: string;
  installPath: string;
  version: string;
}

interface InstalledPluginsFile {
  version?: number;
  plugins?: Record<string, Array<{ installPath?: string; version?: string }>>;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

export async function readInstalledPlugins(path: string): Promise<InstalledPlugin[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write(`warning: ${path} is not valid JSON; skipping plugin enumeration\n`);
    return [];
  }
  if (!isPlainObject(parsed)) return [];
  const plugins = parsed["plugins"];
  if (!isPlainObject(plugins)) return [];
  const out: InstalledPlugin[] = [];
  for (const [pluginKey, entries] of Object.entries(plugins)) {
    if (!Array.isArray(entries)) continue;
    const candidates: InstalledPlugin[] = [];
    for (const entry of entries) {
      if (!isPlainObject(entry)) continue;
      const installPath = entry["installPath"];
      if (typeof installPath !== "string" || installPath === "") continue;
      const version = typeof entry["version"] === "string" ? entry["version"] : "unknown";
      candidates.push({ pluginKey, installPath, version });
    }
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      // Same plugin key with multiple install entries (e.g. user + project
      // scope, or two retained versions). The id scheme can't distinguish
      // them without changing on-disk state shape, so pick the highest version
      // deterministically and surface a warning so the user knows we ignored
      // the others.
      candidates.sort((a, b) => compareVersions(b.version, a.version));
      const dropped = candidates.slice(1).map((c) => `${c.version}@${c.installPath}`).join(", ");
      process.stderr.write(
        `warning: plugin "${pluginKey}" has ${candidates.length} install entries; using ${candidates[0]!.version}@${candidates[0]!.installPath} and ignoring: ${dropped}\n`,
      );
    }
    out.push(candidates[0]!);
  }
  return out;
}

/** Naive dotted-numeric comparison; falls back to lexical for non-numeric. */
export function compareVersions(a: string, b: string): number {
  const ap = a.split(/[.\-+]/);
  const bp = b.split(/[.\-+]/);
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const an = Number.parseInt(ap[i] ?? "0", 10);
    const bn = Number.parseInt(bp[i] ?? "0", 10);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    if (!Number.isFinite(an) || !Number.isFinite(bn)) {
      const ax = ap[i] ?? "";
      const bx = bp[i] ?? "";
      if (ax !== bx) return ax < bx ? -1 : 1;
    }
  }
  return 0;
}

interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>;
}

export async function readClaudeSettings(path: string): Promise<ClaudeSettings> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!isPlainObject(parsed)) return {};
  const enabledPlugins = parsed["enabledPlugins"];
  if (!isPlainObject(enabledPlugins)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(enabledPlugins)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return { enabledPlugins: out };
}

export async function readCodexPluginSettings(path: string): Promise<ClaudeSettings> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }

  const enabledPlugins: Record<string, boolean> = {};
  let currentPlugin: string | null = null;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (line === "") continue;
    const section = /^\[plugins\."([^"]+)"\]$/.exec(line) ?? /^\[plugins\.([^\]]+)\]$/.exec(line);
    if (section) {
      currentPlugin = section[1] ?? null;
      continue;
    }
    if (!currentPlugin) continue;
    const enabled = /^enabled\s*=\s*(true|false)\s*$/.exec(line);
    if (enabled) enabledPlugins[currentPlugin] = enabled[1] === "true";
  }
  return { enabledPlugins };
}

/**
 * Walk a directory like `<root>/skills/` and return Skills found beneath it.
 * Each immediate child should be a directory (or symlink to one) containing
 * SKILL.md or SKILL.md.skill-router-disabled. Anything else is silently
 * skipped. If a child has BOTH files (split-brain after a crash or manual
 * edit), the live `SKILL.md` wins and we mark the skill via the `conflict`
 * channel passed to `build` so callers can surface it for repair.
 *
 * When a child is a symlink whose realpath escapes `skillsRoot`, the skill is
 * still surfaced (so the user can see and act on it manually), but `outOfRoot`
 * is true so callers can mark it un-disable-able. Renaming via the symlink
 * would otherwise mutate a directory the user never put under their skills
 * root.
 */
export async function walkSkillsDir(
  skillsRoot: string,
  build: (
    skillName: string,
    skillMdPath: string,
    isDisabled: boolean,
    conflict: boolean,
    outOfRoot: boolean,
  ) => Promise<Skill | null>,
): Promise<Skill[]> {
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const canonicalRoot = await canonicalizeRoot(skillsRoot);
  const out: Skill[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const skillDir = join(skillsRoot, ent.name);
    // Accept directories AND symlinks-to-directories
    let isDir = ent.isDirectory();
    const isSymlink = ent.isSymbolicLink();
    if (!isDir && isSymlink) {
      try {
        const s = await stat(skillDir);
        isDir = s.isDirectory();
      } catch { /* dangling symlink */ }
    }
    if (!isDir) continue;

    // For symlinks, canonicalize and verify the target lives inside the same
    // skills root. We deliberately only enforce this for symlinks: a real
    // subdirectory of skillsRoot is in-root by construction, and walking
    // every regular directory's realpath would add useless syscalls.
    const outOfRoot = isSymlink
      ? !(await isInsideCanonicalRoot(skillDir, canonicalRoot))
      : false;

    const livePath = join(skillDir, "SKILL.md");
    const disabledPath = livePath + DISABLED_SUFFIX;
    const liveExists = await fileExists(livePath);
    const disabledExists = await fileExists(disabledPath);

    let resolvedPath: string | null = null;
    let isDisabled = false;
    let conflict = false;
    if (liveExists && disabledExists) {
      resolvedPath = livePath;
      isDisabled = false;
      conflict = true;
    } else if (liveExists) {
      resolvedPath = livePath;
    } else if (disabledExists) {
      resolvedPath = disabledPath;
      isDisabled = true;
    }
    if (!resolvedPath) continue;
    const skill = await build(ent.name, resolvedPath, isDisabled, conflict, outOfRoot);
    if (skill) out.push(skill);
  }
  return out;
}

async function canonicalizeRoot(root: string): Promise<string | null> {
  try {
    return await realpath(root);
  } catch {
    // Root may not exist (caller handled ENOENT above), or be a broken
    // symlink. Fall back to the resolved input path so containment is still
    // a structural comparison.
    return resolve(root);
  }
}

async function canonicalizePath(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

function pathStartsWith(child: string, parent: string): boolean {
  if (child === parent) return true;
  const withSep = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(withSep);
}

async function isInsideCanonicalRoot(skillDir: string, canonicalRoot: string | null): Promise<boolean> {
  if (!canonicalRoot) return false;
  const canonicalSkill = await canonicalizePath(skillDir);
  if (!canonicalSkill) return false;
  return pathStartsWith(canonicalSkill, canonicalRoot);
}

/**
 * Shared path-safety helper: returns true if `path` (after `realpath`) lives
 * inside any of `roots` (each `realpath`'d). Disable/enable use the per-skill
 * `outOfRoot` flag computed by `walkSkillsDir`; this helper is exposed for
 * future callers that want to revalidate a path against the current skill
 * roots without re-scanning the whole tree.
 */
export async function isPathInsideAnyRoot(path: string, roots: string[]): Promise<boolean> {
  const canonicalPath = await canonicalizePath(path);
  if (!canonicalPath) return false;
  for (const root of roots) {
    const canonicalRoot = await canonicalizeRoot(root);
    if (!canonicalRoot) continue;
    if (pathStartsWith(canonicalPath, canonicalRoot)) return true;
  }
  return false;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

export async function readSkillFrontmatter(
  skillMdPath: string,
): Promise<SkillMetadata> {
  const raw = await readFile(skillMdPath, "utf8");
  const fm = parseFrontmatter(raw);
  const name = scalar(fm["name"]) ?? basename(dirname(skillMdPath)) ?? "";
  const description = scalar(fm["description"]) ?? "";
  return {
    name,
    description,
    ...optionalArray("aliases", fm["aliases"]),
    ...optionalArray("tags", fm["tags"]),
    ...optionalArray("tools", fm["tools"]),
    ...optionalArray("domains", fm["domains"]),
    ...optionalArray("intents", fm["intents"]),
    ...optionalArray("examples", fm["examples"]),
  };
}

function scalar(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return undefined;
}

function optionalArray<K extends keyof SkillMetadata>(
  key: K,
  value: string | string[] | undefined,
): Partial<Pick<SkillMetadata, K>> {
  const arr = Array.isArray(value)
    ? value
    : typeof value === "string" && value !== ""
      ? [value]
      : [];
  if (arr.length === 0) return {};
  return { [key]: arr } as Partial<Pick<SkillMetadata, K>>;
}
