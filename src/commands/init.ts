import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseStrict } from "../args.ts";

type InitAgent = "claude-code" | "codex";
type InitScope = "project" | "global";

interface InitResult {
  action: "initialized-agentic-skill-router-skill";
  agent: InitAgent;
  scope: InitScope;
  targetRoot: string;
  skillDir: string;
  skillMdPath: string;
  cliPath: string;
  claudeMdPath?: string;
  claudeMdAction?: "created" | "replaced" | "appended" | "skipped";
}

const CLAUDE_MD_BEGIN = "<!-- agentic-skill-router:claude-md:begin -->";
const CLAUDE_MD_END = "<!-- agentic-skill-router:claude-md:end -->";

/**
 * Routing-trigger guidance injected into Claude Code's CLAUDE.md. The wording
 * mirrors the validated probe in experiments/dci-compare/claudemd-policy-probe.mjs
 * (which raised router trigger rate from 78% to 97.6% and accuracy from 69% to
 * 86.9% on the 150-skill paired Claude Code run) with the skill id rewritten
 * for this package.
 */
const CLAUDE_MD_BODY = [
  "## Skill routing",
  "",
  "`agentic-skill-router-skills` is a routing Skill that searches a catalog of",
  "locally-installed disabled skills.",
  "",
  "When the `agentic-skill-router-skills` Skill is available and no other",
  "enabled Skill clearly matches the user's query, call",
  "`agentic-skill-router-skills` before answering. Do not invent a Skill name",
  "or fabricate a routing result without a Skill/tool result. If",
  "`agentic-skill-router-skills` is not installed in this environment, this",
  "section does not apply.",
].join("\n");

/**
 * `agentic-skill-router init` creates a router skill for one supported code agent.
 * Without a target it prompts interactively; scripts can pass `codex` or
 * `claude-code` as the first positional argument and `project` or `global` as
 * the optional second positional argument.
 */
export async function cmdInit(argv: string[]): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(
      [
        "usage: agentic-skill-router init [codex|claude-code] [project|global]",
        "",
        "Options:",
        "  --agent <codex|claude-code>",
        "  --scope <project|global>",
        "  --cwd <path>",
        "  --cli <path>",
        "  --force",
        "  --json",
        "  --no-claude-md            (claude-code only) skip writing the routing-trigger block into CLAUDE.md",
        "",
      ].join("\n"),
    );
    return 0;
  }

  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router init",
    config: {
      args: argv,
      options: {
        agent: { type: "string" },
        scope: { type: "string" },
        cwd: { type: "string" },
        cli: { type: "string" },
        force: { type: "boolean" },
        json: { type: "boolean" },
        "no-claude-md": { type: "boolean" },
      },
      allowPositionals: true,
    },
  });

  if (positionals.length > 2) {
    process.stderr.write("usage: agentic-skill-router init [codex|claude-code] [project|global]\n");
    return 2;
  }

  const decoded = decodeInitInputs(
    positionals,
    values.agent as string | undefined,
    values.scope as string | undefined,
  );
  if (decoded.extra.length > 0) {
    process.stderr.write("usage: agentic-skill-router init [codex|claude-code] [project|global]\n");
    return 2;
  }

  let agent = parseInitAgent(decoded.agentRaw);
  if (!agent) {
    if (decoded.agentRaw !== undefined) {
      process.stderr.write("target agent must be codex or claude-code\n");
      return 2;
    }
    agent = await promptForAgent();
    if (!agent) {
      process.stderr.write("specify a target agent in non-interactive mode: agentic-skill-router init codex\n");
      return 2;
    }
  }

  let scope = parseInitScope(decoded.scopeRaw);
  if (!scope) {
    if (decoded.scopeRaw !== undefined) {
      process.stderr.write("scope must be project or global\n");
      return 2;
    }
    scope = input.isTTY ? await promptForScope(agent) : "project";
    if (!scope) {
      process.stderr.write("specify a scope in non-interactive mode: agentic-skill-router init codex project\n");
      return 2;
    }
  }

  const projectRoot = resolve((values.cwd as string | undefined) ?? process.cwd());
  let result: InitResult;
  try {
    const sourceDir = await findRouterSkillSourceDir();
    const cliPath = await resolveCliPath(values.cli as string | undefined);
    result = await initializeSkill({
      agent,
      scope,
      projectRoot,
      sourceDir,
      cliPath,
      force: Boolean(values.force),
      writeClaudeMd: !values["no-claude-md"],
    });
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  if (values.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`initialized agentic-skill-router for ${displayAgent(agent)} (${result.scope})\n`);
  process.stdout.write(`skill: ${result.skillMdPath}\n`);
  process.stdout.write(`cli:   ${result.cliPath}\n`);
  if (result.claudeMdPath && result.claudeMdAction) {
    process.stdout.write(`claudemd: ${result.claudeMdPath} (${result.claudeMdAction})\n`);
  } else if (result.claudeMdAction === "skipped") {
    process.stdout.write("claudemd: skipped\n");
  }
  return 0;
}

function decodeInitInputs(
  positionals: string[],
  optionAgent: string | undefined,
  optionScope: string | undefined,
): { agentRaw: string | undefined; scopeRaw: string | undefined; extra: string[] } {
  let agentRaw = optionAgent;
  let scopeRaw = optionScope;
  const rest = [...positionals];

  if (!agentRaw && rest[0] && parseInitAgent(rest[0])) agentRaw = rest.shift();
  if (!scopeRaw && rest[0] && parseInitScope(rest[0])) scopeRaw = rest.shift();
  if (!agentRaw && rest[0] && parseInitAgent(rest[0])) agentRaw = rest.shift();
  if (!scopeRaw && rest[0] && parseInitScope(rest[0])) scopeRaw = rest.shift();
  if (rest.length === 1) {
    if (!agentRaw) agentRaw = rest.shift();
    else if (!scopeRaw) scopeRaw = rest.shift();
  }

  return { agentRaw, scopeRaw, extra: rest };
}

async function initializeSkill(opts: {
  agent: InitAgent;
  scope: InitScope;
  projectRoot: string;
  sourceDir: string;
  cliPath: string;
  force: boolean;
  writeClaudeMd: boolean;
}): Promise<InitResult> {
  const targetRoot = skillRootFor(opts.agent, opts.scope, opts.projectRoot);
  const skillRoot = join(targetRoot, "skills");
  const skillDir = join(skillRoot, "agentic-skill-router-skills");
  const skillDirExists = await pathExists(skillDir);
  if (skillDirExists && !opts.force) {
    throw new Error(`${skillDir} already exists; re-run with --force to replace it`);
  }

  // Pre-flight validate CLAUDE.md BEFORE we touch the skill dir. If the file
  // exists with an unbalanced fence we want to fail without leaving a
  // half-installed skill behind on disk.
  let claudeMdPath: string | null = null;
  if (opts.agent === "claude-code" && opts.writeClaudeMd) {
    claudeMdPath = claudeMdPathFor(opts.scope, opts.projectRoot);
    await validateClaudeMdFormat(claudeMdPath);
  }

  if (skillDirExists) {
    await rm(skillDir, { recursive: true, force: true });
  }
  await mkdir(skillRoot, { recursive: true });
  await cp(opts.sourceDir, skillDir, { recursive: true });
  await writeLocalCliReference(skillDir, opts.agent, opts.scope, opts.cliPath);

  const result: InitResult = {
    action: "initialized-agentic-skill-router-skill",
    agent: opts.agent,
    scope: opts.scope,
    targetRoot,
    skillDir,
    skillMdPath: join(skillDir, "SKILL.md"),
    cliPath: opts.cliPath,
  };

  if (opts.agent === "claude-code") {
    if (!opts.writeClaudeMd) {
      result.claudeMdAction = "skipped";
    } else if (claudeMdPath) {
      result.claudeMdPath = claudeMdPath;
      result.claudeMdAction = await upsertClaudeMdBlock(claudeMdPath);
    }
  }

  return result;
}

function claudeMdPathFor(scope: InitScope, projectRoot: string): string {
  if (scope === "project") return join(projectRoot, "CLAUDE.md");
  const home = process.env["CLAUDE_HOME"] ?? join(homedir(), ".claude");
  return join(home, "CLAUDE.md");
}

// Fence markers must appear as a full line (column 0, optional trailing
// whitespace) so a marker quoted inside a paragraph or code block cannot
// close the fence early. The trailing `\r?` handles CRLF files: with the
// `m` flag `$` matches before `\n`, so on `<!-- ...:begin -->\r\n` the `\r`
// would otherwise sit between the marker text and `$` and block the match.
const BEGIN_LINE = new RegExp(`^${escapeForRegex(CLAUDE_MD_BEGIN)}[ \\t]*\\r?$`, "m");
const END_LINE = new RegExp(`^${escapeForRegex(CLAUDE_MD_END)}[ \\t]*\\r?$`, "m");

interface FenceSpan {
  start: number;
  end: number;
}

/**
 * Pre-flight read of CLAUDE.md to fail fast on an unbalanced fence before
 * the skill dir is touched. The subsequent `upsertClaudeMdBlock` re-reads
 * the file; the pair is intentionally not atomic. For a local CLI driven
 * by one user at a time, the TOCTOU window between these two reads is
 * acceptable — concurrent edits to CLAUDE.md during `init` are not a
 * supported scenario.
 */
async function validateClaudeMdFormat(path: string): Promise<void> {
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (existing === null) return;
  findAllFenceSpans(existing, path);
}

async function upsertClaudeMdBlock(
  path: string,
): Promise<"created" | "replaced" | "appended"> {
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const eol = pickEol(existing);
  const block = renderClaudeMdBlock(eol);

  if (existing === null) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, block);
    return "created";
  }

  if (existing.length === 0) {
    await writeFile(path, block);
    return "appended";
  }

  const spans = findAllFenceSpans(existing, path);

  if (spans.length === 0) {
    const separator = existing.endsWith(eol + eol)
      ? ""
      : existing.endsWith(eol)
        ? eol
        : eol + eol;
    const next = existing + separator + block;
    if (next !== existing) await writeFile(path, next);
    return "appended";
  }

  // Replace the first fence in place (preserves user-chosen position) and
  // strip any duplicate fences in the tail. Iterating tail-first keeps the
  // earlier span indices valid in the mutating string.
  let next = existing;
  for (let i = spans.length - 1; i >= 1; i -= 1) {
    const span = spans[i]!;
    let removeStart = span.start;
    if (
      removeStart >= 2 &&
      next.charAt(removeStart - 2) === "\r" &&
      next.charAt(removeStart - 1) === "\n"
    ) {
      removeStart -= 2;
    } else if (removeStart >= 1 && next.charAt(removeStart - 1) === "\n") {
      removeStart -= 1;
    }
    next = next.slice(0, removeStart) + next.slice(span.end);
  }
  const first = spans[0]!;
  next = next.slice(0, first.start) + block + next.slice(first.end);
  if (next !== existing) await writeFile(path, next);
  return "replaced";
}

function renderClaudeMdBlock(eol: string): string {
  const lf = `${CLAUDE_MD_BEGIN}\n${CLAUDE_MD_BODY}\n${CLAUDE_MD_END}\n`;
  return eol === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf;
}

/** Pick CRLF only when it is at least as common as bare LF in the source. */
function pickEol(source: string | null): string {
  if (source === null || source.length === 0) return "\n";
  const crlfCount = (source.match(/\r\n/g) ?? []).length;
  const totalLfCount = (source.match(/\n/g) ?? []).length;
  const bareLfCount = totalLfCount - crlfCount;
  return crlfCount > 0 && crlfCount >= bareLfCount ? "\r\n" : "\n";
}

/**
 * Return spans for every fence pair in `source` in document order. Each
 * span runs from the first character of the begin marker to one position
 * past the trailing line terminator (so removing or replacing the span
 * does not leave the surrounding line broken). Throws on an unbalanced
 * begin marker so a hand-edited file fails loudly instead of being
 * silently rewritten.
 */
function findAllFenceSpans(source: string, path: string): FenceSpan[] {
  const spans: FenceSpan[] = [];
  let offset = 0;
  while (offset < source.length) {
    const remaining = source.slice(offset);
    const beginMatch = BEGIN_LINE.exec(remaining);
    if (!beginMatch) break;
    const beginStart = offset + beginMatch.index;
    const beginEnd = beginStart + beginMatch[0].length;

    const endMatch = END_LINE.exec(source.slice(beginEnd));
    if (!endMatch) {
      throw new Error(
        `${path} contains ${CLAUDE_MD_BEGIN} without a matching ${CLAUDE_MD_END}; edit the file by hand or remove the stray marker`,
      );
    }
    const endStop = beginEnd + endMatch.index + endMatch[0].length;
    let spanEnd = endStop;
    if (source.charAt(spanEnd) === "\r" && source.charAt(spanEnd + 1) === "\n") {
      spanEnd += 2;
    } else if (source.charAt(spanEnd) === "\n") {
      spanEnd += 1;
    }
    spans.push({ start: beginStart, end: spanEnd });
    offset = spanEnd;
  }
  return spans;
}

function escapeForRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function skillRootFor(agent: InitAgent, scope: InitScope, projectRoot: string): string {
  if (scope === "project") {
    return agent === "codex"
      ? join(projectRoot, ".agents")
      : join(projectRoot, ".claude");
  }
  if (agent === "codex") {
    return process.env["AGENTS_HOME"] ?? join(homedir(), ".agents");
  }
  return process.env["CLAUDE_HOME"] ?? join(homedir(), ".claude");
}

async function writeLocalCliReference(
  skillDir: string,
  agent: InitAgent,
  scope: InitScope,
  cliPath: string,
): Promise<void> {
  const referenceDir = join(skillDir, "references");
  await mkdir(referenceDir, { recursive: true });
  const body = [
    "# Local CLI",
    "",
    `This ${scope} skill was initialized for ${displayAgent(agent)}.`,
    "Use this helper before running agentic-skill-router commands from this skill:",
    "",
    "```bash",
    `agentic_skill_router() { AGENTIC_SKILL_ROUTER_HOST=${agent} ${shellQuote(cliPath)} "$@"; }`,
    "```",
    "",
  ].join("\n");
  await writeFile(join(referenceDir, "local-cli.md"), body);
}

async function promptForAgent(): Promise<InitAgent | null> {
  if (!input.isTTY) return null;
  output.write("Initialize agentic-skill-router for:\n");
  output.write("  1) Codex (.agents/skills)\n");
  output.write("  2) Claude Code (.claude/skills)\n");
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question("Select [1-2]: ")).trim().toLowerCase();
    if (answer === "1" || answer === "codex") return "codex";
    if (answer === "2" || answer === "claude" || answer === "claude-code") return "claude-code";
    return null;
  } finally {
    rl.close();
  }
}

async function promptForScope(agent: InitAgent): Promise<InitScope | null> {
  if (!input.isTTY) return null;
  output.write(`Install ${displayAgent(agent)} agentic-skill-router skill into:\n`);
  output.write(`  1) Project (${agent === "codex" ? ".agents/skills" : ".claude/skills"})\n`);
  output.write(`  2) Global (${agent === "codex" ? "~/.agents/skills" : "~/.claude/skills"})\n`);
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question("Select [1-2]: ")).trim().toLowerCase();
    if (answer === "1" || answer === "project" || answer === "local") return "project";
    if (answer === "2" || answer === "global") return "global";
    return null;
  } finally {
    rl.close();
  }
}

function parseInitAgent(value: string | undefined): InitAgent | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "codex") return "codex";
  if (normalized === "claude" || normalized === "claude-code") return "claude-code";
  return null;
}

function parseInitScope(value: string | undefined): InitScope | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "project" || normalized === "local") return "project";
  if (normalized === "global") return "global";
  return null;
}

async function resolveCliPath(cliFlag: string | undefined): Promise<string> {
  const explicit = cliFlag || process.env["AGENTIC_SKILL_ROUTER_CLI"];
  if (explicit) return resolve(expandHome(explicit));

  const packageRoot = await findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  const packagedBin = join(packageRoot, "bin", "agentic-skill-router");
  if (await fileExists(packagedBin)) return packagedBin;

  const entry = process.argv[1];
  return entry ? resolve(entry) : packagedBin;
}

async function findRouterSkillSourceDir(): Promise<string> {
  const roots: string[] = [];
  const assetRoot = process.env["AGENTIC_SKILL_ROUTER_ASSET_ROOT"];
  if (assetRoot) roots.push(resolve(expandHome(assetRoot)));
  roots.push(await findPackageRoot(dirname(fileURLToPath(import.meta.url))));

  for (const root of roots) {
    const candidate = join(root, "skills", "agentic-skill-router-skills");
    if (await fileExists(join(candidate, "SKILL.md"))) return candidate;
  }
  throw new Error("could not locate skills/agentic-skill-router-skills next to the agentic-skill-router package");
}

async function findPackageRoot(start: string): Promise<string> {
  let current = resolve(start);
  while (true) {
    if (
      await fileExists(join(current, "package.json")) ||
      await fileExists(join(current, "skills", "agentic-skill-router-skills", "SKILL.md"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(start, "..");
    current = parent;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function displayAgent(agent: InitAgent): string {
  return agent === "codex" ? "Codex" : "Claude Code";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
