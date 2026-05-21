import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const CLI_PATH = join(REPO_ROOT, "src", "cli.ts");

async function makeFakeCodexUser(): Promise<{
  env: NodeJS.ProcessEnv;
  disabledSkillId: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "skill-router-cli-args-"));
  const codexHome = join(root, ".codex");
  const agentsHome = join(root, ".agents");
  const stateDir = join(root, ".skill-router");
  const projectRoot = join(root, "project");
  const cwd = join(projectRoot, "packages", "app");
  const adminSkillsRoot = join(root, "etc", "codex", "skills");

  await mkdir(join(projectRoot, ".git"), { recursive: true });
  await mkdir(cwd, { recursive: true });

  // One disabled-by-router skill so disable/enable/route have something to bite on.
  const disabledSkillDir = join(codexHome, "skills", "lark-mail");
  await mkdir(disabledSkillDir, { recursive: true });
  await writeFile(
    join(disabledSkillDir, "SKILL.md.skill-router-disabled"),
    "---\nname: lark-mail\ndescription: Lark mail workflows for office automation\n---\n\nbody\n",
  );

  // And one enabled user skill to keep the listing non-empty.
  const liveSkillDir = join(codexHome, "skills", "brand");
  await mkdir(liveSkillDir, { recursive: true });
  await writeFile(
    join(liveSkillDir, "SKILL.md"),
    "---\nname: brand\ndescription: Brand voice and identity\n---\n\nbody\n",
  );

  await mkdir(stateDir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SKILL_ROUTER_HOST: "codex",
    CODEX_HOME: codexHome,
    AGENTS_HOME: agentsHome,
    SKILL_ROUTER_CWD: cwd,
    CODEX_ADMIN_SKILLS_ROOT: adminSkillsRoot,
    SKILL_ROUTER_STATE_DIR: stateDir,
  };

  return {
    env,
    disabledSkillId: "user:codex:lark-mail",
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, ["--import", "tsx", CLI_PATH, ...args], { env });
}

async function expectUnknownOption(
  args: string[],
  env: NodeJS.ProcessEnv,
  expected: { option: string; suggestion?: string; commandName: string },
): Promise<void> {
  let caught: unknown;
  try {
    await runCli(args, env);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, `expected exit code 2 for ${args.join(" ")}`);
  const e = caught as { code?: number; stderr?: string };
  assert.equal(e.code, 2, `expected exit code 2, got ${e.code} for ${args.join(" ")}`);
  const stderr = e.stderr ?? "";
  assert.match(stderr, /unknown option/, `stderr should include "unknown option" for ${args.join(" ")}`);
  assert.ok(
    stderr.includes(expected.option),
    `stderr should mention the bad option ${expected.option}; got: ${stderr}`,
  );
  assert.ok(
    stderr.includes(expected.commandName),
    `stderr should mention the command path ${expected.commandName}; got: ${stderr}`,
  );
  if (expected.suggestion !== undefined) {
    assert.ok(
      stderr.includes(expected.suggestion),
      `stderr should suggest ${expected.suggestion}; got: ${stderr}`,
    );
  }
}

test("skills list rejects unknown option with exit code 2 and suggestion", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectUnknownOption(
      ["skills", "list", "--jsoon"],
      fake.env,
      { option: "--jsoon", suggestion: "--json", commandName: "skill-router skills list" },
    );
    // Happy path still works.
    const ok = await runCli(["skills", "list", "--json"], fake.env);
    const parsed = JSON.parse(ok.stdout) as Array<{ id: string }>;
    assert.ok(Array.isArray(parsed));
  } finally {
    await fake.cleanup();
  }
});

test("skills suggest rejects unknown option with exit code 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectUnknownOption(
      ["skills", "suggest", "--unsed-for=30d"],
      fake.env,
      { option: "--unsed-for", suggestion: "--unused-for", commandName: "skill-router skills suggest" },
    );
    const ok = await runCli(["skills", "suggest", "--unused-for=365d", "--json"], fake.env);
    assert.ok(ok.stdout.trim().startsWith("["));
  } finally {
    await fake.cleanup();
  }
});

test("skills route rejects --qurey but still accepts positional query", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectUnknownOption(
      ["skills", "route", "--qurey", "lark mail", "--json"],
      fake.env,
      { option: "--qurey", suggestion: "--query", commandName: "skill-router skills route" },
    );
    await expectUnknownOption(
      ["skills", "route", "--query=lark mail", "--jsoon"],
      fake.env,
      { option: "--jsoon", suggestion: "--json", commandName: "skill-router skills route" },
    );
    // Happy path: positional query.
    const ok = await runCli(["skills", "route", "lark", "mail", "office", "--json", "--no-record"], fake.env);
    const parsed = JSON.parse(ok.stdout) as { query: string };
    assert.equal(parsed.query, "lark mail office");
  } finally {
    await fake.cleanup();
  }
});

test("skills dci search rejects unknown option", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectUnknownOption(
      ["skills", "dci", "search", "--qurey=lark"],
      fake.env,
      { option: "--qurey", suggestion: "--query", commandName: "skill-router skills dci search" },
    );
    // Happy path: positional query for DCI search.
    const ok = await runCli(["skills", "dci", "search", "lark mail", "--json"], fake.env);
    const parsed = JSON.parse(ok.stdout) as { matches: unknown[] };
    assert.ok(Array.isArray(parsed.matches));
  } finally {
    await fake.cleanup();
  }
});

test("skills dci budget rejects unknown option", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectUnknownOption(
      ["skills", "dci", "budget", "--verbse"],
      fake.env,
      { option: "--verbse", commandName: "skill-router skills dci budget" },
    );
    const ok = await runCli(["skills", "dci", "budget", "--json"], fake.env);
    assert.ok(ok.stdout.includes("maxQueries"));
  } finally {
    await fake.cleanup();
  }
});

test("skills disable rejects unknown option but still accepts positional id", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectUnknownOption(
      ["skills", "disable", fake.disabledSkillId, "--yess"],
      fake.env,
      { option: "--yess", suggestion: "--yes", commandName: "skill-router skills disable" },
    );
    // Happy path: positional id still flows through. Without --yes, exit code 1
    // (would-disable preview). That confirms parsing accepted both arguments.
    let preview: unknown;
    try {
      await runCli(["skills", "disable", fake.disabledSkillId], fake.env);
    } catch (err) {
      preview = err;
    }
    assert.ok(preview);
    assert.equal((preview as { code?: number }).code, 1);
  } finally {
    await fake.cleanup();
  }
});

test("skills enable rejects unknown option", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectUnknownOption(
      ["skills", "enable", fake.disabledSkillId, "--jsoon"],
      fake.env,
      { option: "--jsoon", suggestion: "--json", commandName: "skill-router skills enable" },
    );
    // Happy path: enabling the already-disabled marker works.
    const ok = await runCli(["skills", "enable", fake.disabledSkillId, "--json"], fake.env);
    const parsed = JSON.parse(ok.stdout) as Array<{ id: string }>;
    assert.equal(parsed[0]?.id, fake.disabledSkillId);
  } finally {
    await fake.cleanup();
  }
});

test("skills status rejects unknown option", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectUnknownOption(
      ["skills", "status", "--jsoon"],
      fake.env,
      { option: "--jsoon", suggestion: "--json", commandName: "skill-router skills status" },
    );
    const ok = await runCli(["skills", "status", "--json"], fake.env);
    const parsed = JSON.parse(ok.stdout) as { disabledCount: number };
    assert.equal(typeof parsed.disabledCount, "number");
  } finally {
    await fake.cleanup();
  }
});

test("skills dci grep / find / open / inspect / read / select reject unknown option", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectUnknownOption(
      ["skills", "dci", "grep", "--pttn=foo"],
      fake.env,
      { option: "--pttn", commandName: "skill-router skills dci grep" },
    );
    await expectUnknownOption(
      ["skills", "dci", "find", fake.disabledSkillId, "--pattern=foo", "--regx"],
      fake.env,
      { option: "--regx", suggestion: "--regex", commandName: "skill-router skills dci find" },
    );
    await expectUnknownOption(
      ["skills", "dci", "open", fake.disabledSkillId, "--lne=10"],
      fake.env,
      { option: "--lne", suggestion: "--line", commandName: "skill-router skills dci open" },
    );
    await expectUnknownOption(
      ["skills", "dci", "inspect", fake.disabledSkillId, "--jsoon"],
      fake.env,
      { option: "--jsoon", suggestion: "--json", commandName: "skill-router skills dci inspect" },
    );
    await expectUnknownOption(
      ["skills", "dci", "read", fake.disabledSkillId, "--max-chrs=10"],
      fake.env,
      { option: "--max-chrs", suggestion: "--max-chars", commandName: "skill-router skills dci read" },
    );
    await expectUnknownOption(
      ["skills", "dci", "select", fake.disabledSkillId, "--query=x", "--confidence=high", "--reson=test"],
      fake.env,
      { option: "--reson", suggestion: "--reason", commandName: "skill-router skills dci select" },
    );
  } finally {
    await fake.cleanup();
  }
});
