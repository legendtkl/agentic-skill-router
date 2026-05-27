import { open as openFile, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseFrontmatterWithWarnings } from "./frontmatter.ts";
import type { Skill, SkillMetadata } from "./types.ts";

export interface FrontmatterReadResult {
  metadata: SkillMetadata;
  warnings: string[];
}

export const DISABLED_SUFFIX = ".agentic-skill-router-disabled";
const MAX_FRONTMATTER_BYTES = 32_000;

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

// Strict semver 2.0: MAJOR.MINOR.PATCH with optional -PRERELEASE and +BUILD.
// PRERELEASE and BUILD identifiers are dot-separated, alphanumeric or hyphen,
// and numeric identifiers cannot have leading zeros.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

// Loose dotted-numeric form: one or more numeric segments separated by dots,
// optionally followed by `-PRERELEASE` and/or `+BUILD`. Catches partial
// versions like "1", "1.0", and extended versions like "1.2.3.4" that strict
// semver rejects, so they can still be ordered through the same numeric path.
const LOOSE_VERSION_RE =
  /^(\d+(?:\.\d+)*)(?:-((?:[0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

interface ParsedVersion {
  kind: "version";
  // Numeric segments left-to-right. Always at least three (zero-padded if the
  // source had fewer), with any extra segments appended after patch so longer
  // versions still order correctly against shorter ones.
  numeric: number[];
  // Empty means stable release. Per semver 11.3 a stable release has higher
  // precedence than any prerelease of the same MAJOR.MINOR.PATCH.
  prerelease: string[];
}

interface ParsedUnparsable {
  kind: "unparsable";
  raw: string;
}

type Parsed = ParsedVersion | ParsedUnparsable;

function parseVersion(v: string): Parsed {
  // Prefer strict semver so canonical inputs parse identically to before.
  const strict = SEMVER_RE.exec(v);
  if (strict) {
    return {
      kind: "version",
      numeric: [
        Number.parseInt(strict[1]!, 10),
        Number.parseInt(strict[2]!, 10),
        Number.parseInt(strict[3]!, 10),
      ],
      prerelease: strict[4] ? strict[4].split(".") : [],
      // BUILD metadata (strict[5]) intentionally discarded; ignored for ordering.
    };
  }
  // Fall back to loose dotted-numeric so partial ("1.0") and extended
  // ("1.2.3.4") strings still parse through the same numeric ordering and
  // stay transitive against strict semver values.
  const loose = LOOSE_VERSION_RE.exec(v);
  if (loose) {
    const nums = loose[1]!.split(".").map((s) => Number.parseInt(s, 10));
    // Zero-pad to at least MAJOR.MINOR.PATCH so "1" and "1.0" compare equal
    // to "1.0.0" on the numeric axis.
    while (nums.length < 3) nums.push(0);
    return {
      kind: "version",
      numeric: nums,
      prerelease: loose[2] ? loose[2].split(".") : [],
    };
  }
  return { kind: "unparsable", raw: v };
}

function isNumericIdentifier(id: string): boolean {
  // Numeric identifiers are non-empty digit strings with no leading zeros
  // (or just "0"). Loose-parsed prerelease ids may not satisfy this; only the
  // strict-semver parser guarantees it. We re-check here per-id.
  return /^(0|[1-9]\d*)$/.test(id);
}

function comparePrereleaseIds(a: string, b: string): number {
  const aNum = isNumericIdentifier(a);
  const bNum = isNumericIdentifier(b);
  if (aNum && bNum) {
    const an = Number.parseInt(a, 10);
    const bn = Number.parseInt(b, 10);
    if (an !== bn) return an < bn ? -1 : 1;
    return 0;
  }
  // Per semver: numeric identifiers always have lower precedence than
  // alphanumeric identifiers.
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  if (a !== b) return a < b ? -1 : 1;
  return 0;
}

function comparePrerelease(a: string[], b: string[]): number {
  // Per semver: a version without prerelease has higher precedence than one
  // that has a prerelease. Callers handle the "both stable" case before
  // entering identifier-by-identifier compare.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // stable > prerelease
  if (b.length === 0) return -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const cmp = comparePrereleaseIds(a[i]!, b[i]!);
    if (cmp !== 0) return cmp;
  }
  // All shared identifiers equal: a larger set of fields has higher precedence.
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return 0;
}

function compareNumeric(a: number[], b: number[]): number {
  // Pairwise compare with implicit 0 for missing trailing positions so a
  // shorter list ("1.0.0") compares equal to its zero-padded longer form
  // ("1.0.0.0").
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const an = i < a.length ? a[i]! : 0;
    const bn = i < b.length ? b[i]! : 0;
    if (an !== bn) return an < bn ? -1 : 1;
  }
  return 0;
}

/**
 * Compare two version strings with a single, transitive total order so sort
 * comparators (e.g. picking the highest installed plugin entry) stay stable
 * even when inputs mix strict semver, partial versions like "1.0", extended
 * dotted-numeric like "1.2.3.4", and arbitrary sentinel strings like
 * "unknown".
 *
 * Algorithm — single path, no branching by input shape:
 *   1. Parse each input. Strict semver wins; otherwise loose dotted-numeric
 *      (zero-padded to MAJOR.MINOR.PATCH, optional prerelease/build);
 *      otherwise treat as unparsable.
 *   2. Two parsed versions: compare by numeric tuple, then by prerelease per
 *      semver 11.3-11.4. BUILD metadata is ignored.
 *   3. Two unparsable strings: lexical compare on the raw string.
 *   4. Mixed (one parsed, one unparsable): the parsed version always wins.
 *      This is the load-bearing transitivity invariant — every parsed value
 *      ranks above every unparsable value, so the relation stays a total
 *      order and `Array#sort` produces consistent "highest" picks across
 *      heterogeneous inputs.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa.kind === "version" && pb.kind === "version") {
    const numeric = compareNumeric(pa.numeric, pb.numeric);
    if (numeric !== 0) return numeric;
    return comparePrerelease(pa.prerelease, pb.prerelease);
  }
  if (pa.kind === "unparsable" && pb.kind === "unparsable") {
    if (pa.raw === pb.raw) return 0;
    return pa.raw < pb.raw ? -1 : 1;
  }
  // Mixed: any parsed version outranks any unparsable string.
  return pa.kind === "version" ? 1 : -1;
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

/**
 * Strip a TOML line comment in a quote-aware way.
 *
 * The previous implementation did `line.replace(/#.*\/, "")`, which corrupts
 * any value or section header that legitimately contains `#` inside a string.
 * Example: `name = "skill#1"` would lose `#1"` and parse wrong, and
 * `[plugins."weird#name"]` would be split mid-name.
 *
 * The walker tracks four mutually exclusive string states recognised by TOML:
 *   - basic (double-quoted): supports `\\` escapes including `\"`.
 *   - literal (single-quoted): no escapes — `'\'` is a backslash; the next
 *     `'` closes the string.
 *   - multi-line basic (`"""..."""`): no `#` inside is a comment; escapes
 *     work the same as basic but newlines/quotes embed literally.
 *   - multi-line literal (`'''...'''`): like multi-line basic, no escapes.
 *
 * A `#` only starts a comment when the walker is outside every string state.
 * Everything from that `#` to end of line is dropped and trailing whitespace
 * is trimmed. The leading whitespace of the line is preserved so the caller's
 * own `.trim()`/structural regex behaves the same as before for normal lines.
 *
 * This is a single-line walker — callers feed it one physical line at a time.
 * Multi-line strings that actually span lines are not used by Codex's
 * config.toml plugin section, so this is sufficient for the values we parse.
 */
export function stripTomlComment(line: string): string {
  type State =
    | "none"
    | "basic"
    | "literal"
    | "multiBasic"
    | "multiLiteral";
  let state: State = "none";
  let i = 0;
  const len = line.length;
  while (i < len) {
    const ch = line[i]!;
    switch (state) {
      case "none": {
        if (ch === "#") {
          // Comment starts here; drop the rest of the line and trim trailing
          // whitespace from the kept prefix so structural regexes downstream
          // see the same shape they would have with the old replace().
          return line.slice(0, i).replace(/[ \t]+$/, "");
        }
        if (ch === '"') {
          if (line.startsWith('"""', i)) {
            state = "multiBasic";
            i += 3;
            continue;
          }
          state = "basic";
          i += 1;
          continue;
        }
        if (ch === "'") {
          if (line.startsWith("'''", i)) {
            state = "multiLiteral";
            i += 3;
            continue;
          }
          state = "literal";
          i += 1;
          continue;
        }
        i += 1;
        continue;
      }
      case "basic": {
        if (ch === "\\" && i + 1 < len) {
          // Skip the escaped char so an escaped quote (\") does not close
          // the string. We don't decode the escape; only consume it.
          i += 2;
          continue;
        }
        if (ch === '"') {
          state = "none";
          i += 1;
          continue;
        }
        i += 1;
        continue;
      }
      case "literal": {
        // TOML literal strings have NO escapes; the first single quote ends.
        if (ch === "'") {
          state = "none";
          i += 1;
          continue;
        }
        i += 1;
        continue;
      }
      case "multiBasic": {
        if (ch === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        if (ch === '"' && line.startsWith('"""', i)) {
          state = "none";
          i += 3;
          continue;
        }
        i += 1;
        continue;
      }
      case "multiLiteral": {
        if (ch === "'" && line.startsWith("'''", i)) {
          state = "none";
          i += 3;
          continue;
        }
        i += 1;
        continue;
      }
    }
  }
  // No comment encountered; trim trailing whitespace to match the old
  // replace().trim() shape callers expect to operate on.
  return line.replace(/[ \t]+$/, "");
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
    const line = stripTomlComment(rawLine).trim();
    if (line === "") continue;
    // Quoted plugin key: `[plugins."foo@bar"]`. The captured name may itself
    // contain `#` because the comment stripper above already protected the
    // quoted region. Match the outermost quote pair non-greedily so a
    // trailing `]` after the closing quote can still close the section.
    const quotedSection = /^\[plugins\."(.+)"\]$/.exec(line);
    if (quotedSection) {
      currentPlugin = quotedSection[1] ?? null;
      continue;
    }
    // Bare-key fallback: `[plugins.foo]`. TOML bare keys forbid `#`, so the
    // `[^\]#]+` class is safe and also rejects accidental embedded comments.
    const bareSection = /^\[plugins\.([^\]#]+)\]$/.exec(line);
    if (bareSection) {
      currentPlugin = bareSection[1]!.trim();
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
 * SKILL.md or SKILL.md.agentic-skill-router-disabled. Anything else is silently
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
  return (await readSkillFrontmatterDetailed(skillMdPath)).metadata;
}

export async function readSkillFrontmatterDetailed(
  skillMdPath: string,
): Promise<FrontmatterReadResult> {
  const raw = await readSkillFrontmatterBlock(skillMdPath);
  const { data: fm, warnings } = parseFrontmatterWithWarnings(raw);
  const name = scalar(fm["name"]) ?? basename(dirname(skillMdPath)) ?? "";
  const description = scalar(fm["description"]) ?? "";
  const metadata: SkillMetadata = {
    name,
    description,
    ...optionalArray("aliases", fm["aliases"]),
    ...optionalArray("tags", fm["tags"]),
    ...optionalArray("tools", fm["tools"]),
    ...optionalArray("domains", fm["domains"]),
    ...optionalArray("intents", fm["intents"]),
    ...optionalArray("examples", fm["examples"]),
  };
  return { metadata, warnings };
}

export async function readSkillFrontmatterBlock(skillMdPath: string): Promise<string> {
  const handle = await openFile(skillMdPath, "r");
  const bytes: number[] = [];
  let lineBytes: number[] = [];
  let bytesReadTotal = 0;
  let sawOpening = false;
  const buffer = Buffer.allocUnsafe(Math.min(4096, MAX_FRONTMATTER_BYTES));
  try {
    while (bytesReadTotal < MAX_FRONTMATTER_BYTES) {
      const bytesToRead = Math.min(buffer.length, MAX_FRONTMATTER_BYTES - bytesReadTotal);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, bytesReadTotal);
      if (bytesRead === 0) break;

      for (let i = 0; i < bytesRead; i++) {
        const byte = buffer[i]!;
        bytes.push(byte);
        lineBytes.push(byte);
        if (byte !== 0x0a) continue;

        const trimmed = Buffer.from(lineBytes).toString("utf8").trim();
        if (!sawOpening) {
          if (trimmed === "") {
            lineBytes = [];
            continue;
          }
          if (trimmed !== "---") return Buffer.from(bytes).toString("utf8");
          sawOpening = true;
          lineBytes = [];
          continue;
        }
        if (trimmed === "---") return Buffer.from(bytes).toString("utf8");
        lineBytes = [];
      }
      bytesReadTotal += bytesRead;
    }
    return Buffer.from(bytes).toString("utf8");
  } finally {
    await handle.close();
  }
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
