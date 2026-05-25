import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
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
}

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
}): Promise<InitResult> {
  const targetRoot = skillRootFor(opts.agent, opts.scope, opts.projectRoot);
  const skillRoot = join(targetRoot, "skills");
  const skillDir = join(skillRoot, "agentic-skill-router-skills");
  if (await pathExists(skillDir)) {
    if (!opts.force) {
      throw new Error(`${skillDir} already exists; re-run with --force to replace it`);
    }
    await rm(skillDir, { recursive: true, force: true });
  }

  await mkdir(skillRoot, { recursive: true });
  await cp(opts.sourceDir, skillDir, { recursive: true });
  await writeLocalCliReference(skillDir, opts.agent, opts.scope, opts.cliPath);

  return {
    action: "initialized-agentic-skill-router-skill",
    agent: opts.agent,
    scope: opts.scope,
    targetRoot,
    skillDir,
    skillMdPath: join(skillDir, "SKILL.md"),
    cliPath: opts.cliPath,
  };
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
