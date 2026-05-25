import { execFile, spawn } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFile, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const MAX_BUFFER = 10 * 1024 * 1024;

const OPENAI_SKILLS_REPO = "https://github.com/openai/skills.git";
const OPENAI_SKILLS_SSH_REPO = "git@github.com:openai/skills.git";
const OPENAI_SKILLS_REF = "590b49edc158611a2b2ed715ae73f27eb70d251a";
const EXPECTED_OPENAI_CURATED_SKILL_COUNT = 38;
const CLAUDE_WORKFLOW_SENTINEL = "SR_E2E_CC_WORKFLOW_Q8J3";
const PROCESS_TIMEOUT_MS = 120_000;
const GIT_TIMEOUT_MS = 60_000;
const CLAUDE_AGENT_TIMEOUT_MS = 180_000;

const CLAUDE_OPENAI_E2E_INSTALL_COMMANDS = [
  "HOME=<fresh-root> npm run install:plugin",
  "git init <workdir>/openai-skills",
  `git -C <workdir>/openai-skills remote add origin ${OPENAI_SKILLS_REPO}`,
  `git -C <workdir>/openai-skills fetch --depth=1 origin ${OPENAI_SKILLS_REF}`,
  "git -C <workdir>/openai-skills checkout --detach FETCH_HEAD",
  "mkdir -p <fresh-claude-home>/skills",
  "cp -R <workdir>/openai-skills/skills/.curated/* <fresh-claude-home>/skills/",
] as const;

const ROUTE_CASES = [
  {
    skill: "gh-address-comments",
    query: "Address the unresolved GitHub PR review comments on this branch with gh and update the code.",
    sentinel: "SR_E2E_CC_01_Q9K7GH_ADDRESS",
  },
  {
    skill: "gh-fix-ci",
    query: "Debug the failing GitHub Actions checks on my PR, inspect logs with gh, and plan a fix.",
    sentinel: "SR_E2E_CC_02_R4M8GH_FIX_CI",
  },
  {
    skill: "openai-docs",
    query: "Use official OpenAI docs to help me choose the latest API model for a realtime voice app.",
    sentinel: "SR_E2E_CC_03_N6P2OPENAI_DOCS",
  },
  {
    skill: "playwright",
    query: "Automate a browser from the terminal with Playwright to fill a form and capture page data.",
    sentinel: "SR_E2E_CC_04_B7T5PLAYWRIGHT",
  },
  {
    skill: "playwright-interactive",
    query: "Keep a persistent Playwright interactive session open while debugging this local Electron app UI.",
    sentinel: "SR_E2E_CC_05_V3H9PLAYWRIGHT_INTERACTIVE",
  },
  {
    skill: "screenshot",
    query: "Take an OS-level screenshot of the active app window and save it for inspection.",
    sentinel: "SR_E2E_CC_06_X2D4SCREENSHOT",
  },
  {
    skill: "pdf",
    query: "Review this PDF visually, render pages, and extract layout-sensitive tables.",
    sentinel: "SR_E2E_CC_07_J8L1PDF",
  },
  {
    skill: "speech",
    query: "Generate text-to-speech narration audio for these onboarding prompts with OpenAI voices.",
    sentinel: "SR_E2E_CC_08_C5W6SPEECH",
  },
  {
    skill: "transcribe",
    query: "Transcribe this meeting recording and label speakers if diarization is possible.",
    sentinel: "SR_E2E_CC_09_F1Z3TRANSCRIBE",
  },
  {
    skill: "sentry",
    query: "Inspect recent Sentry production errors and summarize the top issue events.",
    sentinel: "SR_E2E_CC_10_A4Y8SENTRY",
  },
  {
    skill: "linear",
    query: "Create and update Linear issues for this implementation plan.",
    sentinel: "SR_E2E_CC_11_M2N7LINEAR",
  },
  {
    skill: "cloudflare-deploy",
    query: "Deploy this worker and static site to Cloudflare Pages or Workers.",
    sentinel: "SR_E2E_CC_12_K6P5CLOUDFLARE",
  },
  {
    skill: "netlify-deploy",
    query: "Publish this web project to Netlify and give me a preview deploy link.",
    sentinel: "SR_E2E_CC_13_T9R2NETLIFY",
  },
  {
    skill: "render-deploy",
    query: "Create a Render deployment blueprint render.yaml for this service.",
    sentinel: "SR_E2E_CC_14_D3S8RENDER",
  },
  {
    skill: "vercel-deploy",
    query: "Deploy this Next.js app to Vercel as a preview deployment.",
    sentinel: "SR_E2E_CC_15_H7Q1VERCEL",
  },
  {
    skill: "security-threat-model",
    query: "Threat model this repository, enumerate assets, trust boundaries, abuse paths, and mitigations.",
    sentinel: "SR_E2E_CC_16_L4V9THREAT_MODEL",
  },
  {
    skill: "security-best-practices",
    query: "Run a TypeScript security best-practices review and suggest secure-by-default fixes.",
    sentinel: "SR_E2E_CC_17_E8B2SECURITY_BEST",
  },
  {
    skill: "security-ownership-map",
    query: "Build a security ownership map from git history showing sensitive code ownership and bus factor.",
    sentinel: "SR_E2E_CC_18_W5C7OWNERSHIP",
  },
  {
    skill: "notion-research-documentation",
    query: "Research multiple Notion pages and synthesize a cited product brief.",
    sentinel: "SR_E2E_CC_19_U1G6NOTION_RESEARCH",
  },
  {
    skill: "notion-spec-to-implementation",
    query: "Turn this Notion PRD into implementation tasks, plan, and progress tracking.",
    sentinel: "SR_E2E_CC_20_Z9F4NOTION_SPEC",
  },
] as const;

const DISABLED_OPENAI_SKILLS = ROUTE_CASES.map((routeCase) => routeCase.skill);

interface FreshClaudeEnvironment {
  root: string;
  claudeHome: string;
  stateDir: string;
  workdir: string;
  projectCwd: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}

interface SkillListItem {
  id: string;
  isDisabled: boolean;
  pluginKey: string | null;
}

interface RouteJson {
  action: "read-skill-file" | "no-confident-match";
  routeMode: string;
  recorded: boolean;
  selected: { id: string; skillMdPath: string; confidence: string } | null;
  matches: Array<{ id: string; confidence: string; score: number }>;
}

interface StatusJson {
  disabledCount: number;
  disabled: Array<{ id: string; skillMdPath: string }>;
  routed: Array<{ id: string; routeCount: number; lastQuery: string }>;
}

test(
  "[agentic-skill-router-cli] Claude Code OpenAI skills e2e installs curated skills, disables a subset, and routes 20 queries",
  async () => {
    assert.ok(CLAUDE_OPENAI_E2E_INSTALL_COMMANDS.some((command) => command.includes(OPENAI_SKILLS_REPO)));
    assert.ok(CLAUDE_OPENAI_E2E_INSTALL_COMMANDS.some((command) => command.startsWith("HOME=")));
    assert.equal(ROUTE_CASES.length, 20);

    const fresh = await makeFreshClaudeEnvironment();
    try {
      assert.equal(fresh.env.CLAUDE_HOME, undefined);
      assert.equal(fresh.env.AGENTIC_SKILL_ROUTER_HOST, undefined);
      await installSkillRouterForClaude(fresh.env);
      const installedOpenAiSkillCount = await installOpenAiCuratedSkillsFromGithub(
        fresh.workdir,
        fresh.claudeHome,
        fresh.env,
      );
      assert.equal(installedOpenAiSkillCount, EXPECTED_OPENAI_CURATED_SKILL_COUNT);

      const routerBin = await installedClaudeRouterBin(fresh.claudeHome);
      assert.equal(await fileExists(routerBin), true);
      const settings = JSON.parse(await readFile(join(fresh.claudeHome, "settings.json"), "utf8")) as {
        enabledPlugins?: Record<string, boolean>;
      };
      assert.equal(settings.enabledPlugins?.["agentic-skill-router@local"], true);

      const listed = await runRouterJson<SkillListItem[]>(routerBin, ["skills", "list", "--json"], fresh.env);
      const claudeOpenAiSkills = listed.filter((item) => {
        if (item.pluginKey !== null) return false;
        // Accept only simple user:<name> ids; reject project:claude:* and
        // any other multi-segment forms that don't represent ~/.claude/skills.
        return item.id.startsWith("user:") && item.id.split(":").length === 2;
      });
      assert.equal(claudeOpenAiSkills.length, installedOpenAiSkillCount);
      assert.equal(claudeOpenAiSkills.length, EXPECTED_OPENAI_CURATED_SKILL_COUNT);
      for (const skill of DISABLED_OPENAI_SKILLS) {
        assert.ok(listed.some((item) => item.id === `user:${skill}`), `expected ${skill} to be installed`);
      }
      assert.ok(!listed.some((item) => item.id === "user:skill-installer"));
      assert.ok(listed.some((item) => item.id === "plugin:agentic-skill-router@local:agentic-skill-router-skills"));

      await runRouter(
        routerBin,
        [
          "skills",
          "disable",
          ...DISABLED_OPENAI_SKILLS.map((skill) => `user:${skill}`),
          "--yes",
          "--reason=claude-openai-e2e",
          "--json",
        ],
        fresh.env,
      );
      for (const skill of DISABLED_OPENAI_SKILLS) {
        const skillDir = join(fresh.claudeHome, "skills", skill);
        assert.equal(await fileExists(join(skillDir, "SKILL.md")), false);
        assert.equal(await fileExists(join(skillDir, "SKILL.md.agentic-skill-router-disabled")), true);
      }

      const status = await runRouterJson<StatusJson>(routerBin, ["skills", "status", "--json"], fresh.env);
      assert.equal(status.disabledCount, DISABLED_OPENAI_SKILLS.length);
      assert.deepEqual(
        status.disabled.map((record) => record.id).sort(),
        DISABLED_OPENAI_SKILLS.map((skill) => `user:${skill}`).sort(),
      );

      for (const routeCase of ROUTE_CASES) {
        const expected = `user:${routeCase.skill}`;
        const routed = await runRouterJson<RouteJson>(
          routerBin,
          ["skills", "route", "--query", routeCase.query, "--json"],
          fresh.env,
        );
        assert.equal(routed.action, "read-skill-file");
        assert.equal(routed.recorded, true);
        assert.equal(routed.selected?.id, expected);
        assert.match(routed.selected?.skillMdPath ?? "", /SKILL\.md\.agentic-skill-router-disabled$/);
        assert.ok(routed.matches.some((match) => match.id === expected));
      }

      const finalStatus = await runRouterJson<StatusJson>(routerBin, ["skills", "status", "--json"], fresh.env);
      for (const routeCase of ROUTE_CASES) {
        const record = finalStatus.routed.find((item) => item.id === `user:${routeCase.skill}`);
        assert.equal(record?.routeCount, 1);
        assert.equal(record?.lastQuery, routeCase.query);
      }
    } finally {
      await fresh.cleanup();
    }
  },
);

test(
  "[claude-cli] Claude Code CLI agent e2e routes disabled skills and reads their matched skill files",
  async (t) => {
    const claudeBin = await findExecutable("claude");
    if (!claudeBin) {
      t.skip("claude executable not found on PATH");
      return;
    }

    const authPath = await localClaudeAuthPath();
    if (!authPath) {
      t.skip("local Claude .credentials.json not found");
      return;
    }

    const fresh = await makeFreshClaudeEnvironment();
    try {
      await copyFile(authPath, join(fresh.claudeHome, ".credentials.json"));
      await installSkillRouterForClaude(fresh.env);
      await appendClaudeRouterWorkflowSentinel(fresh.claudeHome);
      assert.equal(
        await installOpenAiCuratedSkillsFromGithub(fresh.workdir, fresh.claudeHome, fresh.env),
        EXPECTED_OPENAI_CURATED_SKILL_COUNT,
      );
      await appendClaudeE2eSentinels(fresh.claudeHome);

      const routerBin = await installedClaudeRouterBin(fresh.claudeHome);
      await runRouter(
        routerBin,
        [
          "skills",
          "disable",
          ...DISABLED_OPENAI_SKILLS.map((skill) => `user:${skill}`),
          "--yes",
          "--reason=claude-agent-openai-e2e",
          "--json",
        ],
        fresh.env,
      );

      const probePath = await writeClaudeAgentProbe(fresh.projectCwd);
      const prompt = [
        "Run the agentic-skill-router Claude Code integration check.",
        "Read the installed agentic-skill-router-skills SKILL.md, and keep the value from the line named",
        `"Claude workflow sentinel".`,
        "Run this exact local probe command, passing the workflow sentinel value as the single argument:",
        `node ${JSON.stringify(probePath)} "<workflow-sentinel-value>"`,
        "The probe calls agentic-skill-router for 20 disabled OpenAI skill queries, reads each returned selected.skillMdPath, and extracts the Claude E2E sentinel line.",
        "Return only minified JSON in this exact shape: {\"workflowSentinel\":\"...\",\"probe\":<probe stdout JSON>}.",
        "Do not infer or fabricate sentinel values.",
      ].join("\n");

      const claudeResult = await spawnFileNoStdin(
        claudeBin,
        [
          "-p",
          prompt,
          "--permission-mode",
          "bypassPermissions",
        ],
        {
          cwd: fresh.projectCwd,
          env: fresh.env,
          maxBuffer: 50 * 1024 * 1024,
          timeout: CLAUDE_AGENT_TIMEOUT_MS,
        },
      );

      const parsed = parseClaudeSentinelResponse(claudeResult.stdout);
      assert.equal(parsed.workflowSentinel, CLAUDE_WORKFLOW_SENTINEL);
      assert.deepEqual(parsed.probe.sentinels, ROUTE_CASES.map((routeCase) => routeCase.sentinel));
      assert.deepEqual(parsed.probe.selectedIds, ROUTE_CASES.map((routeCase) => `user:${routeCase.skill}`));
    } finally {
      await fresh.cleanup();
    }
  },
);

async function makeFreshClaudeEnvironment(): Promise<FreshClaudeEnvironment> {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-claude-openai-e2e-"));
  const claudeHome = join(root, ".claude");
  const workdir = join(root, "work");
  const projectCwd = join(root, "project");
  const stateDir = join(projectCwd, ".agentic-skill-router");

  await mkdir(claudeHome, { recursive: true });
  await mkdir(workdir, { recursive: true });
  await mkdir(join(projectCwd, ".git"), { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    AGENTIC_SKILL_ROUTER_STATE_DIR: stateDir,
    AGENTIC_SKILL_ROUTER_CWD: projectCwd,
  };
  delete env.CLAUDE_HOME;
  delete env.CODEX_HOME;
  delete env.AGENTS_HOME;
  delete env.AGENTIC_SKILL_ROUTER_HOST;

  return {
    root,
    claudeHome,
    stateDir,
    workdir,
    projectCwd,
    env,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function installSkillRouterForClaude(env: NodeJS.ProcessEnv): Promise<void> {
  await execFileAsync("npm", ["run", "install:plugin"], {
    cwd: REPO_ROOT,
    env,
    maxBuffer: MAX_BUFFER,
    timeout: PROCESS_TIMEOUT_MS,
  });
}

async function installOpenAiCuratedSkillsFromGithub(
  workdir: string,
  claudeHome: string,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const repoDir = join(workdir, "openai-skills");
  await execFileAsync("git", ["init", repoDir], { env, maxBuffer: MAX_BUFFER, timeout: PROCESS_TIMEOUT_MS });
  await execFileAsync("git", ["-C", repoDir, "remote", "add", "origin", OPENAI_SKILLS_REPO], {
    env,
    maxBuffer: MAX_BUFFER,
    timeout: PROCESS_TIMEOUT_MS,
  });
  await fetchOpenAiSkills(repoDir, env);
  await execFileAsync("git", ["-C", repoDir, "checkout", "--detach", "FETCH_HEAD"], {
    env,
    maxBuffer: MAX_BUFFER,
    timeout: PROCESS_TIMEOUT_MS,
  });

  const skillsRoot = join(claudeHome, "skills");
  const sourceRoot = join(repoDir, "skills", ".curated");
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  let installed = 0;
  await mkdir(skillsRoot, { recursive: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const source = join(sourceRoot, entry.name);
    await stat(join(source, "SKILL.md"));
    await cp(source, join(skillsRoot, entry.name), { recursive: true });
    installed++;
  }
  return installed;
}

async function appendClaudeE2eSentinels(claudeHome: string): Promise<void> {
  for (const routeCase of ROUTE_CASES) {
    await appendFile(
      join(claudeHome, "skills", routeCase.skill, "SKILL.md"),
      `\n\n## Claude E2E Probe\n\nClaude E2E sentinel: ${routeCase.sentinel}\n`,
    );
  }
}

async function appendClaudeRouterWorkflowSentinel(claudeHome: string): Promise<void> {
  const skillPath = await installedClaudeRouterSkillPath(claudeHome);
  await appendFile(
    skillPath,
    `\n\n## Claude E2E Workflow Probe\n\nClaude workflow sentinel: ${CLAUDE_WORKFLOW_SENTINEL}\n`,
  );
}

async function writeClaudeAgentProbe(projectCwd: string): Promise<string> {
  const probePath = join(projectCwd, "claude-agentic-skill-router-agent-probe.mjs");
  const source = `import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const expectedWorkflowSentinel = process.argv[2];
if (!expectedWorkflowSentinel) throw new Error("workflow sentinel argument is required");
const claudeHome = process.env.CLAUDE_HOME ?? join(homedir(), ".claude");

const pluginRoot = join(claudeHome, "plugins", "cache", "local", "agentic-skill-router");
const versions = readdirSync(pluginRoot)
  .filter((version) => existsSync(join(pluginRoot, version, "bin", "agentic-skill-router")))
  .sort((a, b) => statSync(join(pluginRoot, b)).mtimeMs - statSync(join(pluginRoot, a)).mtimeMs);
if (versions.length === 0) throw new Error("installed agentic-skill-router plugin bundle not found");

const installedPluginRoot = join(pluginRoot, versions[0]);
const routerBin = join(installedPluginRoot, "bin", "agentic-skill-router");
const workflowSkillPath = join(installedPluginRoot, "skills", "agentic-skill-router-skills", "SKILL.md");
const workflowSkill = readFileSync(workflowSkillPath, "utf8");
if (!workflowSkill.includes(\`Claude workflow sentinel: \${expectedWorkflowSentinel}\`)) {
  throw new Error("workflow sentinel argument did not match installed agentic-skill-router-skills SKILL.md");
}

const queries = ${JSON.stringify(ROUTE_CASES.map((routeCase) => routeCase.query), null, 2)};
const sentinels = [];
const selectedIds = [];

for (const query of queries) {
  const raw = execFileSync(routerBin, ["skills", "route", "--query", query, "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const routed = JSON.parse(raw);
  selectedIds.push(routed.selected?.id ?? null);
  if (routed.action !== "read-skill-file" || !routed.selected?.skillMdPath) {
    sentinels.push("MISSING");
    continue;
  }
  const skillMd = readFileSync(routed.selected.skillMdPath, "utf8");
  sentinels.push(skillMd.match(/^Claude E2E sentinel: (.+)$/m)?.[1] ?? "MISSING");
}

process.stdout.write(JSON.stringify({ sentinels, selectedIds }));
`;
  await writeFile(probePath, source);
  return probePath;
}

async function fetchOpenAiSkills(repoDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await execFileAsync("git", ["-C", repoDir, "fetch", "--depth=1", "origin", OPENAI_SKILLS_REF], {
      env: gitTestEnv(env),
      maxBuffer: MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
    });
  } catch (err) {
    await execFileAsync("git", ["-C", repoDir, "remote", "set-url", "origin", OPENAI_SKILLS_SSH_REPO], {
      env,
      maxBuffer: MAX_BUFFER,
      timeout: PROCESS_TIMEOUT_MS,
    });
    try {
      await execFileAsync("git", ["-C", repoDir, "fetch", "--depth=1", "origin", OPENAI_SKILLS_REF], {
        env: gitTestEnv(env),
        maxBuffer: MAX_BUFFER,
        timeout: GIT_TIMEOUT_MS,
      });
    } catch {
      throw err;
    }
  }
}

function gitTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new",
  };
}

async function findExecutable(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", `command -v ${name}`]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function localClaudeAuthPath(): Promise<string | null> {
  const claudeHome = process.env["CLAUDE_HOME"] || join(homedir(), ".claude");
  const authPath = join(claudeHome, ".credentials.json");
  try {
    return (await stat(authPath)).isFile() ? authPath : null;
  } catch {
    return null;
  }
}

async function installedClaudeRouterBin(claudeHome: string): Promise<string> {
  const manifestRaw = await readFile(join(REPO_ROOT, "plugins", "claude-code", ".claude-plugin", "plugin.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as { version: string };
  return join(claudeHome, "plugins", "cache", "local", "agentic-skill-router", manifest.version, "bin", "agentic-skill-router");
}

async function installedClaudeRouterSkillPath(claudeHome: string): Promise<string> {
  const manifestRaw = await readFile(join(REPO_ROOT, "plugins", "claude-code", ".claude-plugin", "plugin.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as { version: string };
  return join(
    claudeHome,
    "plugins",
    "cache",
    "local",
    "agentic-skill-router",
    manifest.version,
    "skills",
    "agentic-skill-router-skills",
    "SKILL.md",
  );
}

async function runRouter(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(bin, args, { env, maxBuffer: MAX_BUFFER });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function runRouterJson<T>(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<T> {
  const { stdout } = await runRouter(bin, args, env);
  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    const tail = stdout.slice(-500);
    throw new Error(`failed to parse agentic-skill-router JSON output (${stdout.length} chars): ${(err as Error).message}\n${tail}`);
  }
}

function parseClaudeSentinelResponse(raw: string): {
  workflowSentinel: string;
  probe: { sentinels: string[]; selectedIds: string[] };
} {
  const json = raw.trim().match(/\{[\s\S]*\}/)?.[0] ?? "";
  const parsed = JSON.parse(json) as {
    workflowSentinel?: unknown;
    probe?: { sentinels?: unknown; selectedIds?: unknown };
  };
  assert.equal(typeof parsed.workflowSentinel, "string", "Claude final response must include workflowSentinel");
  assert.ok(parsed.probe && typeof parsed.probe === "object", "Claude final response must include probe object");
  assert.ok(Array.isArray(parsed.probe.sentinels), "Claude final probe response must include a sentinels array");
  assert.ok(Array.isArray(parsed.probe.selectedIds), "Claude final probe response must include a selectedIds array");
  return {
    workflowSentinel: String(parsed.workflowSentinel),
    probe: {
      sentinels: parsed.probe.sentinels.map((item) => String(item)),
      selectedIds: parsed.probe.selectedIds.map((item) => String(item)),
    },
  };
}

interface SpawnFileOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  timeout?: number;
}

function spawnFileNoStdin(
  file: string,
  args: string[],
  options: SpawnFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const maxBuffer = options.maxBuffer ?? MAX_BUFFER;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer =
      options.timeout === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
          }, options.timeout);

    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      callback();
    };

    const failWithOutput = (message: string): void => {
      settle(() => reject(new Error(`${message}\nstdout:\n${stdout}\nstderr:\n${stderr}`)));
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > maxBuffer) {
        failWithOutput(`${file} exceeded stdout maxBuffer`);
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > maxBuffer) {
        failWithOutput(`${file} exceeded stderr maxBuffer`);
        child.kill("SIGTERM");
      }
    });
    child.on("error", (err) => {
      settle(() => reject(err));
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      if (timedOut) {
        failWithOutput(`${file} timed out after ${options.timeout}ms`);
      } else if (code !== 0) {
        failWithOutput(`${file} exited with code ${code ?? "null"} and signal ${signal ?? "null"}`);
      } else {
        settle(() => resolve({ stdout, stderr }));
      }
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
