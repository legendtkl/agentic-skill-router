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
const CODEX_SLASH_SENTINEL = "SR_E2E_SLASH_PROMPT_K2D8";
const CODEX_WORKFLOW_SENTINEL = "SR_E2E_WORKFLOW_P6R4";
const PROCESS_TIMEOUT_MS = 120_000;
const GIT_TIMEOUT_MS = 60_000;
const CODEX_AGENT_TIMEOUT_MS = 180_000;

const CODEX_OPENAI_E2E_INSTALL_COMMANDS = [
  "HOME=<fresh-root> npm run install:codex-plugin",
  "git init <workdir>/openai-skills",
  `git -C <workdir>/openai-skills remote add origin ${OPENAI_SKILLS_REPO}`,
  `git -C <workdir>/openai-skills fetch --depth=1 origin ${OPENAI_SKILLS_REF}`,
  "git -C <workdir>/openai-skills checkout --detach FETCH_HEAD",
  "mkdir -p <fresh-codex-home>/skills",
  "cp -R <workdir>/openai-skills/skills/.curated/* <fresh-codex-home>/skills/",
] as const;

const ROUTE_CASES = [
  {
    skill: "gh-address-comments",
    query: "Address the unresolved GitHub PR review comments on this branch with gh and update the code.",
    sentinel: "SR_E2E_01_Q9K7GH_ADDRESS",
  },
  {
    skill: "gh-fix-ci",
    query: "Debug the failing GitHub Actions checks on my PR, inspect logs with gh, and plan a fix.",
    sentinel: "SR_E2E_02_R4M8GH_FIX_CI",
  },
  {
    skill: "openai-docs",
    query: "Use official OpenAI docs to help me choose the latest API model for a realtime voice app.",
    sentinel: "SR_E2E_03_N6P2OPENAI_DOCS",
  },
  {
    skill: "playwright",
    query: "Automate a browser from the terminal with Playwright to fill a form and capture page data.",
    sentinel: "SR_E2E_04_B7T5PLAYWRIGHT",
  },
  {
    skill: "playwright-interactive",
    query: "Keep a persistent Playwright interactive session open while debugging this local Electron app UI.",
    sentinel: "SR_E2E_05_V3H9PLAYWRIGHT_INTERACTIVE",
  },
  {
    skill: "screenshot",
    query: "Take an OS-level screenshot of the active app window and save it for inspection.",
    sentinel: "SR_E2E_06_X2D4SCREENSHOT",
  },
  {
    skill: "pdf",
    query: "Review this PDF visually, render pages, and extract layout-sensitive tables.",
    sentinel: "SR_E2E_07_J8L1PDF",
  },
  {
    skill: "speech",
    query: "Generate text-to-speech narration audio for these onboarding prompts with OpenAI voices.",
    sentinel: "SR_E2E_08_C5W6SPEECH",
  },
  {
    skill: "transcribe",
    query: "Transcribe this meeting recording and label speakers if diarization is possible.",
    sentinel: "SR_E2E_09_F1Z3TRANSCRIBE",
  },
  {
    skill: "sentry",
    query: "Inspect recent Sentry production errors and summarize the top issue events.",
    sentinel: "SR_E2E_10_A4Y8SENTRY",
  },
  {
    skill: "linear",
    query: "Create and update Linear issues for this implementation plan.",
    sentinel: "SR_E2E_11_M2N7LINEAR",
  },
  {
    skill: "cloudflare-deploy",
    query: "Deploy this worker and static site to Cloudflare Pages or Workers.",
    sentinel: "SR_E2E_12_K6P5CLOUDFLARE",
  },
  {
    skill: "netlify-deploy",
    query: "Publish this web project to Netlify and give me a preview deploy link.",
    sentinel: "SR_E2E_13_T9R2NETLIFY",
  },
  {
    skill: "render-deploy",
    query: "Create a Render deployment blueprint render.yaml for this service.",
    sentinel: "SR_E2E_14_D3S8RENDER",
  },
  {
    skill: "vercel-deploy",
    query: "Deploy this Next.js app to Vercel as a preview deployment.",
    sentinel: "SR_E2E_15_H7Q1VERCEL",
  },
  {
    skill: "security-threat-model",
    query: "Threat model this repository, enumerate assets, trust boundaries, abuse paths, and mitigations.",
    sentinel: "SR_E2E_16_L4V9THREAT_MODEL",
  },
  {
    skill: "security-best-practices",
    query: "Run a TypeScript security best-practices review and suggest secure-by-default fixes.",
    sentinel: "SR_E2E_17_E8B2SECURITY_BEST",
  },
  {
    skill: "security-ownership-map",
    query: "Build a security ownership map from git history showing sensitive code ownership and bus factor.",
    sentinel: "SR_E2E_18_W5C7OWNERSHIP",
  },
  {
    skill: "notion-research-documentation",
    query: "Research multiple Notion pages and synthesize a cited product brief.",
    sentinel: "SR_E2E_19_U1G6NOTION_RESEARCH",
  },
  {
    skill: "notion-spec-to-implementation",
    query: "Turn this Notion PRD into implementation tasks, plan, and progress tracking.",
    sentinel: "SR_E2E_20_Z9F4NOTION_SPEC",
  },
] as const;

const DISABLED_OPENAI_SKILLS = ROUTE_CASES.map((routeCase) => routeCase.skill);
const IMPLICIT_ROUTE_CASE = ROUTE_CASES.find((routeCase) => routeCase.skill === "vercel-deploy")!;
const IMPLICIT_ROUTE_QUERY = `${IMPLICIT_ROUTE_CASE.query} Dry run; do not contact Vercel or make external resource changes.`;

interface FreshCodexEnvironment {
  root: string;
  codexHome: string;
  agentsHome: string;
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
  "[agentic-skill-router-cli] Codex OpenAI skills e2e installs curated skills, disables a subset, and routes 20 queries",
  async () => {
    assert.ok(CODEX_OPENAI_E2E_INSTALL_COMMANDS.some((command) => command.includes(OPENAI_SKILLS_REPO)));
    assert.ok(CODEX_OPENAI_E2E_INSTALL_COMMANDS.some((command) => command.startsWith("HOME=")));
    assert.equal(ROUTE_CASES.length, 20);

    const fresh = await makeFreshCodexEnvironment();
    try {
      assert.equal(fresh.env.CODEX_HOME, undefined);
      assert.equal(fresh.env.AGENTS_HOME, undefined);
      assert.equal(fresh.env.AGENTIC_SKILL_ROUTER_HOST, undefined);
      await installSkillRouterForCodex(fresh.env);
      const installedOpenAiSkillCount = await installOpenAiCuratedSkillsFromGithub(
        fresh.workdir,
        fresh.codexHome,
        fresh.env,
      );
      assert.equal(installedOpenAiSkillCount, EXPECTED_OPENAI_CURATED_SKILL_COUNT);

      const routerBin = await installedCodexRouterBin(fresh.codexHome);
      assert.equal(await fileExists(routerBin), true);
      const config = await readFile(join(fresh.codexHome, "config.toml"), "utf8");
      assert.match(config, /\[plugins\."agentic-skill-router@local"\]\nenabled = true/);

      const listedEnvelope = await runRouterJson<{ skills: SkillListItem[] }>(routerBin, ["skills", "list", "--json"], fresh.env);
      const listed = listedEnvelope.skills;
      const codexOpenAiSkills = listed.filter((item) => item.id.startsWith("user:codex:"));
      assert.equal(codexOpenAiSkills.length, installedOpenAiSkillCount);
      assert.equal(codexOpenAiSkills.length, EXPECTED_OPENAI_CURATED_SKILL_COUNT);
      for (const skill of DISABLED_OPENAI_SKILLS) {
        assert.ok(listed.some((item) => item.id === `user:codex:${skill}`), `expected ${skill} to be installed`);
      }
      assert.ok(!listed.some((item) => item.id === "user:codex:skill-installer"));
      assert.ok(!listed.some((item) => item.id.startsWith("builtin:codex-system:")));
      assert.ok(listed.some((item) => item.id === "plugin:agentic-skill-router@local:agentic-skill-router-skills"));

      await runRouter(
        routerBin,
        [
          "skills",
          "disable",
          ...DISABLED_OPENAI_SKILLS.map((skill) => `user:codex:${skill}`),
          "--yes",
          "--reason=codex-openai-e2e",
          "--json",
        ],
        fresh.env,
      );
      for (const skill of DISABLED_OPENAI_SKILLS) {
        const skillDir = join(fresh.codexHome, "skills", skill);
        assert.equal(await fileExists(join(skillDir, "SKILL.md")), false);
        assert.equal(await fileExists(join(skillDir, "SKILL.md.agentic-skill-router-disabled")), true);
      }

      const status = await runRouterJson<StatusJson>(routerBin, ["skills", "status", "--json"], fresh.env);
      assert.equal(status.disabledCount, DISABLED_OPENAI_SKILLS.length);
      assert.deepEqual(
        status.disabled.map((record) => record.id).sort(),
        DISABLED_OPENAI_SKILLS.map((skill) => `user:codex:${skill}`).sort(),
      );

      for (const routeCase of ROUTE_CASES) {
        const expected = `user:codex:${routeCase.skill}`;
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
        const record = finalStatus.routed.find((item) => item.id === `user:codex:${routeCase.skill}`);
        assert.equal(record?.routeCount, 1);
        assert.equal(record?.lastQuery, routeCase.query);
      }
    } finally {
      await fresh.cleanup();
    }
  },
);

test(
  "[codex-cli] Codex CLI agent e2e routes disabled skills and reads their matched skill files",
  async (t) => {
    const codexBin = await findExecutable("codex");
    if (!codexBin) {
      t.skip("codex executable not found on PATH");
      return;
    }

    const authPath = await localCodexAuthPath();
    if (!authPath) {
      t.skip("local Codex auth.json not found");
      return;
    }

    const fresh = await makeFreshCodexEnvironment();
    try {
      await copyFile(authPath, join(fresh.codexHome, "auth.json"));
      await installSkillRouterForCodex(fresh.env);
      await appendCodexRouterWorkflowSentinels(fresh.codexHome);
      assert.equal(
        await installOpenAiCuratedSkillsFromGithub(fresh.workdir, fresh.codexHome, fresh.env),
        EXPECTED_OPENAI_CURATED_SKILL_COUNT,
      );
      await appendCodexE2eSentinels(fresh.codexHome);

      const routerBin = await installedCodexRouterBin(fresh.codexHome);
      await runRouter(
        routerBin,
        [
          "skills",
          "disable",
          ...DISABLED_OPENAI_SKILLS.map((skill) => `user:codex:${skill}`),
          "--yes",
          "--reason=codex-agent-openai-e2e",
          "--json",
        ],
        fresh.env,
      );

      const probePath = await writeCodexAgentProbe(fresh.projectCwd);
      const finalMessagePath = join(fresh.root, "codex-agent-final.json");
      const prompt = [
        "/agentic-skill-router:skills",
        "Run the agentic-skill-router Codex integration check.",
        `First, read the slash command prompt sentinel line named "Codex slash command sentinel" and keep its value.`,
        `Then use the installed agentic-skill-router-skills workflow, read its SKILL.md, and keep the value from the line named "Codex workflow sentinel".`,
        "Run this exact local probe command, passing the workflow sentinel value as the single argument:",
        `node ${JSON.stringify(probePath)} "<workflow-sentinel-value>"`,
        "The probe calls agentic-skill-router for 20 disabled OpenAI skill queries, reads each returned selected.skillMdPath, and extracts the Codex E2E sentinel line.",
        "Return only minified JSON in this exact shape: {\"slashSentinel\":\"...\",\"workflowSentinel\":\"...\",\"probe\":<probe stdout JSON>}.",
        "Do not infer or fabricate sentinel values.",
      ].join("\n");

      const codexResult = await spawnFileNoStdin(
        codexBin,
        [
          "-a",
          "never",
          "exec",
          "--json",
          "--ephemeral",
          "--skip-git-repo-check",
          "-C",
          fresh.projectCwd,
          "-s",
          "danger-full-access",
          "--output-last-message",
          finalMessagePath,
          prompt,
        ],
        {
          env: fresh.env,
          maxBuffer: 50 * 1024 * 1024,
          timeout: CODEX_AGENT_TIMEOUT_MS,
        },
      );

      assert.equal(
        await fileExists(finalMessagePath),
        true,
        `Codex did not write final output.\nstdout:\n${codexResult.stdout}\nstderr:\n${codexResult.stderr}`,
      );
      const finalMessage = await readFile(finalMessagePath, "utf8");
      const parsed = parseCodexSentinelResponse(finalMessage);
      assert.equal(parsed.slashSentinel, CODEX_SLASH_SENTINEL);
      assert.equal(parsed.workflowSentinel, CODEX_WORKFLOW_SENTINEL);
      assert.deepEqual(parsed.probe.sentinels, ROUTE_CASES.map((routeCase) => routeCase.sentinel));
      assert.deepEqual(parsed.probe.selectedIds, ROUTE_CASES.map((routeCase) => `user:codex:${routeCase.skill}`));
    } finally {
      await fresh.cleanup();
    }
  },
);

test(
  "[codex-cli] Codex CLI implicit agent e2e routes a natural query without slash",
  async (t) => {
    const codexBin = await findExecutable("codex");
    if (!codexBin) {
      t.skip("codex executable not found on PATH");
      return;
    }

    const authPath = await localCodexAuthPath();
    if (!authPath) {
      t.skip("local Codex auth.json not found");
      return;
    }

    const fresh = await makeFreshCodexEnvironment();
    try {
      await copyFile(authPath, join(fresh.codexHome, "auth.json"));
      await installSkillRouterForCodex(fresh.env);
      await appendCodexRouterWorkflowSentinels(fresh.codexHome);
      assert.equal(
        await installOpenAiCuratedSkillsFromGithub(fresh.workdir, fresh.codexHome, fresh.env),
        EXPECTED_OPENAI_CURATED_SKILL_COUNT,
      );
      await appendCodexE2eSentinels(fresh.codexHome);

      const routerBin = await installedCodexRouterBin(fresh.codexHome);
      await runRouter(
        routerBin,
        [
          "skills",
          "disable",
          ...DISABLED_OPENAI_SKILLS.map((skill) => `user:codex:${skill}`),
          "--yes",
          "--reason=codex-agent-implicit-openai-e2e",
          "--json",
        ],
        fresh.env,
      );

      const finalMessagePath = join(fresh.root, "codex-agent-implicit-final.json");
      const prompt = [
        IMPLICIT_ROUTE_QUERY,
        "",
        "---",
        "E2E verification constraints:",
        "The task is the first line only; the lines below are safety and output constraints.",
        "Do not use slash commands.",
        "Follow any applicable local workflow instructions before answering.",
        "Return only minified JSON in this exact shape: {\"ok\":true}.",
      ].join("\n");

      assert.ok(!prompt.includes("/agentic-skill-router:skills"));
      const codexResult = await spawnFileNoStdin(
        codexBin,
        [
          "-a",
          "never",
          "exec",
          "--json",
          "--ephemeral",
          "--skip-git-repo-check",
          "-C",
          fresh.projectCwd,
          "-s",
          "danger-full-access",
          "--output-last-message",
          finalMessagePath,
          prompt,
        ],
        {
          env: fresh.env,
          maxBuffer: 50 * 1024 * 1024,
          timeout: CODEX_AGENT_TIMEOUT_MS,
        },
      );

      assert.equal(
        await fileExists(finalMessagePath),
        true,
        `Codex did not write final output.\nstdout:\n${codexResult.stdout}\nstderr:\n${codexResult.stderr}`,
      );
      const finalMessage = await readFile(finalMessagePath, "utf8");
      assert.deepEqual(parseCodexImplicitRouteResponse(finalMessage), { ok: true });
      const selected = assertCodexStreamShowsCorpusRouting(
        codexResult.stdout,
        codexResult.stderr,
        `user:codex:${IMPLICIT_ROUTE_CASE.skill}`,
      );
      const selectedSkillMd = await readFile(selected.selected.skillMdPath, "utf8");
      assert.match(selectedSkillMd, new RegExp(`^Codex E2E sentinel: ${IMPLICIT_ROUTE_CASE.sentinel}$`, "m"));

      const status = await runRouterJson<StatusJson>(routerBin, ["skills", "status", "--json"], fresh.env);
      const routedRecord = status.routed.find((item) => item.id === `user:codex:${IMPLICIT_ROUTE_CASE.skill}`);
      assert.equal(routedRecord?.routeCount, 1);
      assert.equal(routedRecord?.lastQuery, IMPLICIT_ROUTE_QUERY);
    } finally {
      await fresh.cleanup();
    }
  },
);

async function makeFreshCodexEnvironment(): Promise<FreshCodexEnvironment> {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-codex-openai-e2e-"));
  const codexHome = join(root, ".codex");
  const agentsHome = join(root, ".agents");
  const workdir = join(root, "work");
  const projectCwd = join(root, "project");
  const stateDir = join(projectCwd, ".agentic-skill-router");

  await mkdir(codexHome, { recursive: true });
  await mkdir(agentsHome, { recursive: true });
  await mkdir(workdir, { recursive: true });
  await mkdir(join(projectCwd, ".git"), { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    AGENTIC_SKILL_ROUTER_STATE_DIR: stateDir,
    AGENTIC_SKILL_ROUTER_CWD: projectCwd,
  };
  delete env.CODEX_HOME;
  delete env.AGENTS_HOME;
  delete env.CLAUDE_HOME;
  delete env.AGENTIC_SKILL_ROUTER_HOST;

  return {
    root,
    codexHome,
    agentsHome,
    stateDir,
    workdir,
    projectCwd,
    env,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function installSkillRouterForCodex(env: NodeJS.ProcessEnv): Promise<void> {
  await execFileAsync("npm", ["run", "install:codex-plugin"], {
    cwd: REPO_ROOT,
    env,
    maxBuffer: MAX_BUFFER,
    timeout: PROCESS_TIMEOUT_MS,
  });
}

async function installOpenAiCuratedSkillsFromGithub(
  workdir: string,
  codexHome: string,
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

  const skillsRoot = join(codexHome, "skills");
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

async function appendCodexE2eSentinels(codexHome: string): Promise<void> {
  for (const routeCase of ROUTE_CASES) {
    await appendFile(
      join(codexHome, "skills", routeCase.skill, "SKILL.md"),
      `\n\n## Codex E2E Probe\n\nCodex E2E sentinel: ${routeCase.sentinel}\n`,
    );
  }
}

async function appendCodexRouterWorkflowSentinels(codexHome: string): Promise<void> {
  const skillPath = await installedCodexRouterSkillPath(codexHome);
  await appendFile(
    skillPath,
    `\n\n## Codex E2E Workflow Probe\n\nCodex workflow sentinel: ${CODEX_WORKFLOW_SENTINEL}\n`,
  );
  await appendFile(
    join(codexHome, "prompts", "agentic-skill-router-skills.md"),
    `\nCodex slash command sentinel: ${CODEX_SLASH_SENTINEL}\n`,
  );
}

async function writeCodexAgentProbe(projectCwd: string): Promise<string> {
  const probePath = join(projectCwd, "codex-agentic-skill-router-agent-probe.mjs");
  const source = `import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const expectedWorkflowSentinel = process.argv[2];
if (!expectedWorkflowSentinel) throw new Error("workflow sentinel argument is required");
const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");

const pluginRoot = join(codexHome, "plugins", "cache", "local", "agentic-skill-router");
const versions = readdirSync(pluginRoot)
  .filter((version) => existsSync(join(pluginRoot, version, "bin", "agentic-skill-router")))
  .sort((a, b) => statSync(join(pluginRoot, b)).mtimeMs - statSync(join(pluginRoot, a)).mtimeMs);
if (versions.length === 0) throw new Error("installed agentic-skill-router plugin bundle not found");

const installedPluginRoot = join(pluginRoot, versions[0]);
const routerBin = join(installedPluginRoot, "bin", "agentic-skill-router");
const workflowSkillPath = join(installedPluginRoot, "skills", "agentic-skill-router-skills", "SKILL.md");
const workflowSkill = readFileSync(workflowSkillPath, "utf8");
if (!workflowSkill.includes(\`Codex workflow sentinel: \${expectedWorkflowSentinel}\`)) {
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
  sentinels.push(skillMd.match(/^Codex E2E sentinel: (.+)$/m)?.[1] ?? "MISSING");
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

async function localCodexAuthPath(): Promise<string | null> {
  const codexHome = process.env["CODEX_HOME"] || join(homedir(), ".codex");
  const authPath = join(codexHome, "auth.json");
  try {
    return (await stat(authPath)).isFile() ? authPath : null;
  } catch {
    return null;
  }
}

async function installedCodexRouterBin(codexHome: string): Promise<string> {
  const manifestRaw = await readFile(join(REPO_ROOT, "plugins", "codex", ".codex-plugin", "plugin.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as { version: string };
  return join(codexHome, "plugins", "cache", "local", "agentic-skill-router", manifest.version, "bin", "agentic-skill-router");
}

async function installedCodexRouterSkillPath(codexHome: string): Promise<string> {
  const manifestRaw = await readFile(join(REPO_ROOT, "plugins", "codex", ".codex-plugin", "plugin.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as { version: string };
  return join(
    codexHome,
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

function parseCodexSentinelResponse(raw: string): {
  slashSentinel: string;
  workflowSentinel: string;
  probe: { sentinels: string[]; selectedIds: string[] };
} {
  const json = raw.trim().match(/\{[\s\S]*\}/)?.[0] ?? "";
  const parsed = JSON.parse(json) as {
    slashSentinel?: unknown;
    workflowSentinel?: unknown;
    probe?: { sentinels?: unknown; selectedIds?: unknown };
  };
  assert.equal(typeof parsed.slashSentinel, "string", "Codex final response must include slashSentinel");
  assert.equal(typeof parsed.workflowSentinel, "string", "Codex final response must include workflowSentinel");
  assert.ok(parsed.probe && typeof parsed.probe === "object", "Codex final response must include probe object");
  assert.ok(Array.isArray(parsed.probe.sentinels), "Codex final probe response must include a sentinels array");
  assert.ok(Array.isArray(parsed.probe.selectedIds), "Codex final probe response must include a selectedIds array");
  return {
    slashSentinel: String(parsed.slashSentinel),
    workflowSentinel: String(parsed.workflowSentinel),
    probe: {
      sentinels: parsed.probe.sentinels.map((item) => String(item)),
      selectedIds: parsed.probe.selectedIds.map((item) => String(item)),
    },
  };
}

function parseCodexImplicitRouteResponse(raw: string): {
  ok: true;
} {
  const json = raw.trim().match(/\{[\s\S]*\}/)?.[0] ?? "";
  const parsed = JSON.parse(json) as {
    ok?: unknown;
  };
  assert.equal(parsed.ok, true, "Codex final response must include ok: true");
  return { ok: true };
}

interface CodexCommandExecution {
  command: string;
  aggregatedOutput: string;
  exitCode: number;
}

function assertCodexStreamShowsCorpusRouting(
  stdout: string,
  stderr: string,
  expectedSkillId: string,
): {
  action: "read-skill-file";
  recorded: true;
  selected: { id: string; skillMdPath: string };
} {
  const commands = extractCodexCompletedCommandExecutions(stdout);
  const commandText = commands.map((item) => item.command).join("\n");
  const stream = `${stdout}\n${stderr}`.replaceAll("\\n", "\n").replaceAll('\\"', '"');
  assert.match(
    stream,
    /agentic-skill-router-skills/,
    `Codex stream did not show implicit router skill use.\nstdout tail:\n${stdout.slice(-4000)}\nstderr tail:\n${stderr.slice(-2000)}`,
  );
  const searchCommand = commands.find((item) => /\bskills\s+corpus\s+search\b/.test(item.command));
  assert.ok(
    searchCommand,
    `Codex command stream did not show an executed corpus search.\ncommands:\n${commandText || "(none)"}`,
  );
  const selectCommand = commands.find((item) => /\bskills\s+corpus\s+select\b/.test(item.command));
  assert.ok(
    selectCommand,
    `Codex command stream did not show an executed corpus select.\ncommands:\n${commandText || "(none)"}`,
  );
  const selected = parseCorpusSelectOutput(selectCommand.aggregatedOutput);
  assert.equal(selected.action, "read-skill-file");
  assert.equal(selected.recorded, true);
  assert.equal(selected.selected?.id, expectedSkillId);
  const skillMdPath = selected.selected?.skillMdPath;
  if (typeof skillMdPath !== "string") {
    assert.fail(`corpus select output did not include selected.skillMdPath:\n${JSON.stringify(selected, null, 2)}`);
  }
  return {
    action: "read-skill-file",
    recorded: true,
    selected: {
      id: expectedSkillId,
      skillMdPath,
    },
  };
}

function extractCodexCompletedCommandExecutions(stdout: string): CodexCommandExecution[] {
  const commands: CodexCommandExecution[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "type" in parsed &&
      parsed.type === "item.completed" &&
      "item" in parsed &&
      parsed.item &&
      typeof parsed.item === "object" &&
      "type" in parsed.item &&
      parsed.item.type === "command_execution" &&
      "command" in parsed.item &&
      typeof parsed.item.command === "string" &&
      "aggregated_output" in parsed.item &&
      typeof parsed.item.aggregated_output === "string" &&
      "exit_code" in parsed.item &&
      typeof parsed.item.exit_code === "number" &&
      parsed.item.exit_code === 0
    ) {
      commands.push({
        command: parsed.item.command,
        aggregatedOutput: parsed.item.aggregated_output,
        exitCode: parsed.item.exit_code,
      });
    }
  }
  return commands;
}

function parseCorpusSelectOutput(output: string): {
  action?: unknown;
  recorded?: unknown;
  selected?: { id?: unknown; skillMdPath?: unknown } | null;
} {
  const json = output.trim().match(/\{[\s\S]*\}/)?.[0] ?? "";
  assert.ok(json, `corpus select command did not emit JSON output:\n${output}`);
  return JSON.parse(json) as {
    action?: unknown;
    recorded?: unknown;
    selected?: { id?: unknown; skillMdPath?: unknown } | null;
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
