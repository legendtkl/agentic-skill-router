import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
    AGENTIC_SKILL_ROUTER_STATE_DIR: join(root, ".agentic-skill-router"),
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
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-codex-project-"));
  try {
    const project = join(root, "project");
    const fakeCli = join(root, "runtime", "agentic-skill-router");
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
    assert.equal(parsed.action, "initialized-agentic-skill-router-skill");
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.scope, "project");
    assert.equal(parsed.cliPath, fakeCli);
    assert.match(parsed.skillMdPath, /\.agents\/skills\/agentic-skill-router-skills\/SKILL\.md$/);
    assert.ok(await fileExists(join(project, ".agents", "skills", "agentic-skill-router-skills", "SKILL.md")));

    const localCli = await readFile(
      join(project, ".agents", "skills", "agentic-skill-router-skills", "references", "local-cli.md"),
      "utf8",
    );
    assert.match(localCli, /initialized for Codex/);
    assert.match(localCli, /AGENTIC_SKILL_ROUTER_HOST=codex/);
    assert.match(localCli, new RegExp(escapeRegExp(fakeCli)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code global writes CLAUDE_HOME skill", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claude-global-"));
  try {
    const env = sandboxEnv(root);
    const { stdout, stderr } = await runInit(
      ["claude-code", "--scope", "global", "--cli", join(root, "bin", "agentic-skill-router"), "--json"],
      env,
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { agent: string; scope: string; skillMdPath: string };
    assert.equal(parsed.agent, "claude-code");
    assert.equal(parsed.scope, "global");
    assert.equal(parsed.skillMdPath, join(root, ".claude", "skills", "agentic-skill-router-skills", "SKILL.md"));
    assert.ok(await fileExists(parsed.skillMdPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init target without scope defaults to project in non-interactive mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-default-scope-"));
  try {
    const project = join(root, "project");
    const { stdout, stderr } = await runInit(
      ["codex", "--cwd", project, "--json"],
      sandboxEnv(root),
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { scope: string; skillMdPath: string };
    assert.equal(parsed.scope, "project");
    assert.equal(parsed.skillMdPath, join(project, ".agents", "skills", "agentic-skill-router-skills", "SKILL.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init accepts scope positional when agent is supplied by option", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-agent-option-"));
  try {
    const { stdout, stderr } = await runInit(
      ["--agent", "codex", "global", "--json"],
      sandboxEnv(root),
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { agent: string; scope: string; skillMdPath: string };
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.scope, "global");
    assert.equal(parsed.skillMdPath, join(root, ".agents", "skills", "agentic-skill-router-skills", "SKILL.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init help and parse errors use CLI output instead of stack traces", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-errors-"));
  try {
    const env = sandboxEnv(root);
    const help = await runInit(["--help"], env);
    assert.equal(help.stderr, "");
    assert.match(help.stdout, /usage: agentic-skill-router init/);

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
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-force-"));
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

test("init claude-code project creates CLAUDE.md routing block when missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-create-"));
  try {
    const project = join(root, "project");
    const { stdout, stderr } = await runInit(
      ["claude-code", "project", "--cwd", project, "--json"],
      sandboxEnv(root),
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { claudeMdPath?: string; claudeMdAction?: string };
    assert.equal(parsed.claudeMdAction, "created");
    assert.equal(parsed.claudeMdPath, join(project, "CLAUDE.md"));
    const body = await readFile(parsed.claudeMdPath!, "utf8");
    assert.match(body, /<!-- agentic-skill-router:claude-md:begin -->/);
    assert.match(body, /agentic-skill-router-skills/);
    assert.match(body, /<!-- agentic-skill-router:claude-md:end -->/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code global appends routing block without touching existing CLAUDE.md content", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-append-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    const original = "# My personal Claude rules\n\nAlways respond in markdown.\n";
    await writeFile(claudeMdPath, original);

    const { stdout, stderr } = await runInit(
      ["claude-code", "global", "--json"],
      env,
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { claudeMdPath?: string; claudeMdAction?: string };
    assert.equal(parsed.claudeMdAction, "appended");
    assert.equal(parsed.claudeMdPath, claudeMdPath);

    const body = await readFile(claudeMdPath, "utf8");
    assert.ok(body.startsWith(original), "original CLAUDE.md content must be preserved verbatim at the top");
    assert.match(body, /<!-- agentic-skill-router:claude-md:begin -->/);
    assert.match(body, /<!-- agentic-skill-router:claude-md:end -->\n?$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code global replaces an existing routing block in place", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-replace-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    const stale = [
      "# header",
      "",
      "<!-- agentic-skill-router:claude-md:begin -->",
      "old stale wording that must be replaced",
      "<!-- agentic-skill-router:claude-md:end -->",
      "",
      "# footer",
      "",
    ].join("\n");
    await writeFile(claudeMdPath, stale);

    const { stdout, stderr } = await runInit(
      ["claude-code", "global", "--json"],
      env,
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { claudeMdAction?: string };
    assert.equal(parsed.claudeMdAction, "replaced");

    const body = await readFile(claudeMdPath, "utf8");
    assert.ok(body.startsWith("# header\n"));
    assert.ok(body.includes("# footer"), "trailing content after the block must be preserved");
    assert.doesNotMatch(body, /old stale wording/);
    assert.match(body, /no other\s+enabled Skill clearly matches the user's query/);
    const occurrences = body.match(/<!-- agentic-skill-router:claude-md:begin -->/g) ?? [];
    assert.equal(occurrences.length, 1, "must have exactly one routing block after replace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code respects --no-claude-md opt-out", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-skip-"));
  try {
    const project = join(root, "project");
    const { stdout, stderr } = await runInit(
      ["claude-code", "project", "--cwd", project, "--no-claude-md", "--json"],
      sandboxEnv(root),
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { claudeMdPath?: string; claudeMdAction?: string };
    assert.equal(parsed.claudeMdAction, "skipped");
    assert.equal(parsed.claudeMdPath, undefined);
    assert.equal(await fileExists(join(project, "CLAUDE.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code collapses duplicate routing blocks into one", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-dedup-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    const messy = [
      "# top",
      "",
      "<!-- agentic-skill-router:claude-md:begin -->",
      "stale block A",
      "<!-- agentic-skill-router:claude-md:end -->",
      "",
      "middle user notes",
      "",
      "<!-- agentic-skill-router:claude-md:begin -->",
      "stale block B",
      "<!-- agentic-skill-router:claude-md:end -->",
      "",
      "# bottom",
      "",
    ].join("\n");
    await writeFile(claudeMdPath, messy);

    const { stdout } = await runInit(["claude-code", "global", "--json"], env);
    const parsed = JSON.parse(stdout) as { claudeMdAction?: string };
    assert.equal(parsed.claudeMdAction, "replaced");

    const body = await readFile(claudeMdPath, "utf8");
    const beginCount = (body.match(/<!-- agentic-skill-router:claude-md:begin -->/g) ?? []).length;
    const endCount = (body.match(/<!-- agentic-skill-router:claude-md:end -->/g) ?? []).length;
    assert.equal(beginCount, 1, "duplicate begin markers must be deduplicated");
    assert.equal(endCount, 1, "duplicate end markers must be deduplicated");
    assert.doesNotMatch(body, /stale block A/);
    assert.doesNotMatch(body, /stale block B/);
    assert.ok(body.includes("middle user notes"), "user content between stale blocks must survive");
    assert.ok(body.includes("# top"));
    assert.ok(body.includes("# bottom"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code preserves CRLF line endings on existing CLAUDE.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-crlf-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    const crlf = "# windows user rules\r\n\r\nrule one\r\n";
    await writeFile(claudeMdPath, crlf);

    await runInit(["claude-code", "global", "--json"], env);
    const body = await readFile(claudeMdPath, "utf8");

    assert.ok(body.startsWith("# windows user rules\r\n"), "original CRLF prefix preserved verbatim");
    assert.ok(!/(^|[^\r])\n/.test(body), "no bare LF must be introduced when the input was CRLF");
    assert.match(body, /<!-- agentic-skill-router:claude-md:begin -->\r\n/);
    assert.match(body, /<!-- agentic-skill-router:claude-md:end -->\r\n?$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code fails loudly if a stray :begin marker has no :end", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-broken-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    await writeFile(claudeMdPath, "# header\n\n<!-- agentic-skill-router:claude-md:begin -->\nunterminated\n");

    let caught: unknown;
    try {
      await runInit(["claude-code", "global", "--json"], env);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "init must fail when fence is unbalanced");
    const e = caught as { code?: number; stderr?: string };
    assert.equal(e.code, 1);
    assert.match(e.stderr ?? "", /without a matching/);

    const body = await readFile(claudeMdPath, "utf8");
    assert.ok(body.includes("unterminated"), "file must not be modified on fence error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code preserves content on the line immediately after :end", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-tight-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    const tight =
      "<!-- agentic-skill-router:claude-md:begin -->\nstale\n<!-- agentic-skill-router:claude-md:end -->\nTIGHT_TAIL";
    await writeFile(claudeMdPath, tight);

    await runInit(["claude-code", "global", "--json"], env);
    const body = await readFile(claudeMdPath, "utf8");
    assert.ok(body.includes("TIGHT_TAIL"), "content on the line after :end must be preserved");
    assert.doesNotMatch(body, /\bstale\b/);
    const beginCount = (body.match(/<!-- agentic-skill-router:claude-md:begin -->/g) ?? []).length;
    assert.equal(beginCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code dedupes existing block in a CRLF file instead of appending a duplicate", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-crlf-existing-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    const crlfWithBlock = [
      "# windows rules",
      "",
      "<!-- agentic-skill-router:claude-md:begin -->",
      "stale CRLF wording",
      "<!-- agentic-skill-router:claude-md:end -->",
      "",
      "# footer",
      "",
    ].join("\r\n");
    await writeFile(claudeMdPath, crlfWithBlock);

    const { stdout } = await runInit(["claude-code", "global", "--json"], env);
    const parsed = JSON.parse(stdout) as { claudeMdAction?: string };
    assert.equal(parsed.claudeMdAction, "replaced");

    const body = await readFile(claudeMdPath, "utf8");
    const beginCount = (body.match(/<!-- agentic-skill-router:claude-md:begin -->/g) ?? []).length;
    const endCount = (body.match(/<!-- agentic-skill-router:claude-md:end -->/g) ?? []).length;
    assert.equal(beginCount, 1, "CRLF file must have its existing block replaced in place, not appended");
    assert.equal(endCount, 1);
    assert.doesNotMatch(body, /stale CRLF wording/);
    assert.ok(!/(^|[^\r])\n/.test(body), "result must remain CRLF-only");
    assert.ok(body.includes("# footer"), "trailing user content must be preserved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code preserves block position at top of file across reruns", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-position-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    const pinned = [
      "<!-- agentic-skill-router:claude-md:begin -->",
      "stale wording at the very top",
      "<!-- agentic-skill-router:claude-md:end -->",
      "",
      "# My personal section",
      "",
      "Notes go here.",
      "",
    ].join("\n");
    await writeFile(claudeMdPath, pinned);

    await runInit(["claude-code", "global", "--json"], env);
    const body = await readFile(claudeMdPath, "utf8");

    assert.ok(
      body.startsWith("<!-- agentic-skill-router:claude-md:begin -->"),
      "block placed at top of file must stay at top after rerun, not be relocated to the bottom",
    );
    const beginIdx = body.indexOf("<!-- agentic-skill-router:claude-md:begin -->");
    const personalIdx = body.indexOf("# My personal section");
    assert.ok(personalIdx > beginIdx, "user section that came after the block must remain after the block");
    assert.doesNotMatch(body, /stale wording/);
    assert.match(body, /When the `agentic-skill-router-skills` Skill is available/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code pre-flights CLAUDE.md before touching the skill dir", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-preflight-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    await writeFile(
      claudeMdPath,
      "# header\n\n<!-- agentic-skill-router:claude-md:begin -->\nunterminated, no end marker\n",
    );
    const skillDir = join(root, ".claude", "skills", "agentic-skill-router-skills");

    let caught: unknown;
    try {
      await runInit(["claude-code", "global", "--json"], env);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "init must abort when CLAUDE.md is unbalanced");
    assert.equal((caught as { code?: number }).code, 1);
    assert.equal(
      await fileExists(join(skillDir, "SKILL.md")),
      false,
      "pre-flight failure must leave the skill dir untouched (no partial install)",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code ignores fence markers that are not on their own line", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-quoted-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    // The first :end is inline inside body text, NOT on its own line — the
    // line-anchored parser must skip it and treat the second one as the real end.
    const tricky = [
      "<!-- agentic-skill-router:claude-md:begin -->",
      "stale body text. The end marker looks like `<!-- agentic-skill-router:claude-md:end -->` when quoted inline.",
      "<!-- agentic-skill-router:claude-md:end -->",
      "",
      "# tail content",
      "",
    ].join("\n");
    await writeFile(claudeMdPath, tricky);

    const { stdout } = await runInit(["claude-code", "global", "--json"], env);
    const parsed = JSON.parse(stdout) as { claudeMdAction?: string };
    assert.equal(parsed.claudeMdAction, "replaced");

    const body = await readFile(claudeMdPath, "utf8");
    assert.doesNotMatch(body, /\bstale body text\b/);
    assert.ok(body.includes("# tail content"), "content past the real :end must be preserved");
    const beginCount = (body.match(/<!-- agentic-skill-router:claude-md:begin -->/g) ?? []).length;
    const endCount = (body.match(/<!-- agentic-skill-router:claude-md:end -->/g) ?? []).length;
    assert.equal(beginCount, 1);
    assert.equal(endCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init claude-code picks dominant EOL on mixed-EOL files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-mixed-eol-"));
  try {
    const env = sandboxEnv(root);
    const claudeMdPath = join(root, ".claude", "CLAUDE.md");
    await mkdir(dirname(claudeMdPath), { recursive: true });
    // 5 bare-LF terminators, 1 CRLF terminator → LF must win.
    const mostlyLf =
      "# header\n" +
      "rule one\n" +
      "rule two\n" +
      "stray windows line\r\n" +
      "rule four\n" +
      "rule five\n";
    await writeFile(claudeMdPath, mostlyLf);

    await runInit(["claude-code", "global", "--json"], env);
    const body = await readFile(claudeMdPath, "utf8");

    const blockSlice = body.slice(body.indexOf("<!-- agentic-skill-router:claude-md:begin -->"));
    assert.ok(
      !blockSlice.includes("\r\n"),
      "appended block on a mostly-LF file must use LF, not CRLF",
    );
    assert.ok(
      body.includes("stray windows line\r\n"),
      "the original stray CRLF line must not be normalized away",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init codex never writes CLAUDE.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-init-claudemd-codex-"));
  try {
    const project = join(root, "project");
    const { stdout, stderr } = await runInit(
      ["codex", "project", "--cwd", project, "--json"],
      sandboxEnv(root),
    );
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { claudeMdPath?: string; claudeMdAction?: string };
    assert.equal(parsed.claudeMdAction, undefined);
    assert.equal(parsed.claudeMdPath, undefined);
    assert.equal(await fileExists(join(project, "CLAUDE.md")), false);
    assert.equal(await fileExists(join(root, ".claude", "CLAUDE.md")), false);
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
