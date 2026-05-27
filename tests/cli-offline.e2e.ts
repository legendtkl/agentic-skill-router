import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const MAX_BUFFER = 10 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 120_000;

/**
 * Offline e2e: installs the local Codex plugin into a fresh temporary HOME,
 * drops a single fixture skill into the Codex skills directory, disables it
 * via the installed `agentic-skill-router` binary, and verifies `skills route --json`
 * picks the fixture back up.
 *
 * This e2e never reaches the network and never touches user-local state.
 * Suitable for CI on every PR / push.
 */

interface FreshHome {
  root: string;
  codexHome: string;
  projectCwd: string;
  stateDir: string;
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

const FIXTURE_SKILL_NAME = "offline-fixture-printer";
const FIXTURE_SKILL_DESCRIPTION =
  "Print a tax invoice receipt PDF for a finished customer order, including line items and totals.";
const FIXTURE_QUERY =
  "Generate a printable tax invoice receipt PDF for this customer order with line items and totals.";

test("[agentic-skill-router-cli] offline e2e installs the Codex plugin, disables a fixture skill, and routes back to it", async () => {
  const fresh = await makeFreshHome();
  try {
    // Sanity: nothing in the env should pre-bias host discovery.
    assert.equal(fresh.env.CODEX_HOME, undefined);
    assert.equal(fresh.env.AGENTS_HOME, undefined);
    assert.equal(fresh.env.CLAUDE_HOME, undefined);
    assert.equal(fresh.env.AGENTIC_SKILL_ROUTER_HOST, undefined);

    await installCodexPlugin(fresh.env);

    const skillDir = join(fresh.codexHome, "skills", FIXTURE_SKILL_NAME);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        `name: ${FIXTURE_SKILL_NAME}`,
        `description: ${FIXTURE_SKILL_DESCRIPTION}`,
        "---",
        "",
        "Body of the offline fixture skill.",
        "",
      ].join("\n"),
    );

    const routerBin = await installedCodexRouterBin(fresh.codexHome);
    assert.equal(await fileExists(routerBin), true);

    // Confirm the manifest enabled the plugin under [plugins."agentic-skill-router@local"].
    const config = await readFile(join(fresh.codexHome, "config.toml"), "utf8");
    assert.match(config, /\[plugins\."agentic-skill-router@local"\]\nenabled = true/);

    // The installed CLI must auto-detect the Codex host from the plugin bundle.
    const listed = await runRouterJson<{ skills: SkillListItem[] }>(routerBin, ["skills", "list", "--json"], fresh.env);
    const fixtureId = `user:codex:${FIXTURE_SKILL_NAME}`;
    assert.ok(
      listed.skills.some((item) => item.id === fixtureId),
      `expected ${fixtureId} in skills list`,
    );

    await runRouter(routerBin, ["skills", "disable", fixtureId, "--yes", "--reason=offline-e2e", "--json"], fresh.env);

    assert.equal(await fileExists(join(skillDir, "SKILL.md")), false);
    assert.equal(await fileExists(join(skillDir, "SKILL.md.agentic-skill-router-disabled")), true);

    const routed = await runRouterJson<RouteJson>(
      routerBin,
      ["skills", "route", "--query", FIXTURE_QUERY, "--json"],
      fresh.env,
    );
    assert.equal(routed.action, "read-skill-file");
    assert.equal(routed.recorded, true);
    assert.equal(routed.selected?.id, fixtureId);
    assert.match(routed.selected?.skillMdPath ?? "", /SKILL\.md\.agentic-skill-router-disabled$/);
    assert.ok(routed.matches.some((match) => match.id === fixtureId));
  } finally {
    await fresh.cleanup();
  }
});

async function makeFreshHome(): Promise<FreshHome> {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-offline-e2e-"));
  const codexHome = join(root, ".codex");
  const projectCwd = join(root, "project");
  const stateDir = join(projectCwd, ".agentic-skill-router");

  await mkdir(codexHome, { recursive: true });
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
    projectCwd,
    stateDir,
    env,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function installCodexPlugin(env: NodeJS.ProcessEnv): Promise<void> {
  await execFileAsync("npm", ["run", "install:codex-plugin"], {
    cwd: REPO_ROOT,
    env,
    maxBuffer: MAX_BUFFER,
    timeout: PROCESS_TIMEOUT_MS,
  });
}

async function installedCodexRouterBin(codexHome: string): Promise<string> {
  const manifestRaw = await readFile(join(REPO_ROOT, "plugins", "codex", ".codex-plugin", "plugin.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as { version: string };
  return join(
    codexHome,
    "plugins",
    "cache",
    "local",
    "agentic-skill-router",
    manifest.version,
    "bin",
    "agentic-skill-router",
  );
}

async function runRouter(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(bin, args, { env, maxBuffer: MAX_BUFFER });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function runRouterJson<T>(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<T> {
  const { stdout } = await runRouter(bin, args, env);
  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    const tail = stdout.slice(-500);
    throw new Error(
      `failed to parse agentic-skill-router JSON output (${stdout.length} chars): ${(err as Error).message}\n${tail}`,
    );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
