import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const CLI_PATH = join(REPO_ROOT, "src", "cli.ts");
const MAX_BUFFER = 4 * 1024 * 1024;

function sandboxEnv(root: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    AGENTS_HOME: join(root, ".agents"),
    CLAUDE_HOME: join(root, ".claude"),
    SKILL_ROUTER_STATE_DIR: join(root, ".skill-router"),
  };
}

async function runInit(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, ["--import", "tsx", CLI_PATH, "init", ...args], {
    cwd: REPO_ROOT,
    env,
    maxBuffer: MAX_BUFFER,
  });
}

test("init codex project writes project .agents skill and local CLI reference", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-router-init-codex-project-"));
  try {
    const project = join(root, "project");
    const fakeCli = join(root, "runtime", "skill-router");
    const { stdout, stderr } = await runInit(
      ["codex", "project", "--cwd", project, "--cli", fakeCli, "--json"],
      sandboxEnv(root),
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as {
      action: string;
      agent: string;
      scope: string;
      skillMdPath: string;
      cliPath: string;
    };
    assert.equal(parsed.action, "initialized-skill-router-skill");
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.scope, "project");
    assert.equal(parsed.cliPath, fakeCli);
    assert.match(parsed.skillMdPath, /\.agents\/skills\/skill-router-skills\/SKILL\.md$/);
    assert.ok(await fileExists(join(project, ".agents", "skills", "skill-router-skills", "SKILL.md")));

    const localCli = await readFile(
      join(project, ".agents", "skills", "skill-router-skills", "references", "local-cli.md"),
      "utf8",
    );
    assert.match(localCli, /initialized for Codex/);
    assert.match(localCli, /SKILL_ROUTER_HOST=codex/);
    assert.match(localCli, new RegExp(escapeRegExp(fakeCli)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code global writes CLAUDE_HOME skill", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-router-init-claude-global-"));
  try {
    const env = sandboxEnv(root);
    const { stdout, stderr } = await runInit(
      ["claude-code", "--scope", "global", "--cli", join(root, "bin", "skill-router"), "--json"],
      env,
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { agent: string; scope: string; skillMdPath: string };
    assert.equal(parsed.agent, "claude-code");
    assert.equal(parsed.scope, "global");
    assert.equal(parsed.skillMdPath, join(root, ".claude", "skills", "skill-router-skills", "SKILL.md"));
    assert.ok(await fileExists(parsed.skillMdPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init target without scope defaults to project in non-interactive mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-router-init-default-scope-"));
  try {
    const project = join(root, "project");
    const { stdout, stderr } = await runInit(
      ["codex", "--cwd", project, "--json"],
      sandboxEnv(root),
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { scope: string; skillMdPath: string };
    assert.equal(parsed.scope, "project");
    assert.equal(parsed.skillMdPath, join(project, ".agents", "skills", "skill-router-skills", "SKILL.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init accepts scope positional when agent is supplied by option", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-router-init-agent-option-"));
  try {
    const { stdout, stderr } = await runInit(
      ["--agent", "codex", "global", "--json"],
      sandboxEnv(root),
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { agent: string; scope: string; skillMdPath: string };
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.scope, "global");
    assert.equal(parsed.skillMdPath, join(root, ".agents", "skills", "skill-router-skills", "SKILL.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init help and parse errors use CLI output instead of stack traces", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-router-init-errors-"));
  try {
    const env = sandboxEnv(root);
    const help = await runInit(["--help"], env);
    assert.equal(help.stderr, "");
    assert.match(help.stdout, /usage: skill-router init/);

    let caught: unknown;
    try {
      await runInit(["codex", "--jsoon"], env);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "unknown init option should fail");
    const e = caught as { code?: number; stderr?: string };
    assert.equal(e.code, 2);
    assert.match(e.stderr ?? "", /unknown option `--jsoon`/);
    assert.doesNotMatch(e.stderr ?? "", /at parseStrict|UnknownOptionError|stack/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init refuses to overwrite without --force", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-router-init-force-"));
  try {
    const project = join(root, "project");
    const env = sandboxEnv(root);
    await runInit(["codex", "project", "--cwd", project, "--json"], env);
    let caught: unknown;
    try {
      await runInit(["codex", "project", "--cwd", project, "--json"], env);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "second init should fail without --force");
    const e = caught as { code?: number; stderr?: string };
    assert.equal(e.code, 1);
    assert.match(e.stderr ?? "", /already exists/);

    const forced = await runInit(["codex", "project", "--cwd", project, "--force", "--json"], env);
    assert.equal(JSON.parse(forced.stdout).scope, "project");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
