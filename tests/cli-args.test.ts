import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildSkillCorpusBm25Index } from "../src/corpus.ts";
import type { Skill } from "../src/types.ts";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const CLI_PATH = join(REPO_ROOT, "src", "cli.ts");

async function assertFileAbsent(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (err) {
    // Treating any error as "absent" can mask permission or transient FS
    // failures and produce a false positive. Insist on ENOENT specifically.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw err;
  }
  assert.fail(`expected file to be absent: ${path}`);
}

async function makeFakeCodexUser(): Promise<{
  env: NodeJS.ProcessEnv;
  root: string;
  codexHome: string;
  adminSkillsRoot: string;
  disabledSkillId: string;
  stateDir: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-cli-args-"));
  const codexHome = join(root, ".codex");
  const agentsHome = join(root, ".agents");
  const stateDir = join(root, ".agentic-skill-router");
  const projectRoot = join(root, "project");
  const cwd = join(projectRoot, "packages", "app");
  const adminSkillsRoot = join(root, "etc", "codex", "skills");

  await mkdir(join(projectRoot, ".git"), { recursive: true });
  await mkdir(cwd, { recursive: true });

  // One disabled-by-router skill so disable/enable/route have something to bite on.
  const disabledSkillDir = join(codexHome, "skills", "lark-mail");
  await mkdir(disabledSkillDir, { recursive: true });
  await writeFile(
    join(disabledSkillDir, "SKILL.md.agentic-skill-router-disabled"),
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
    AGENTIC_SKILL_ROUTER_HOST: "codex",
    CODEX_HOME: codexHome,
    AGENTS_HOME: agentsHome,
    AGENTIC_SKILL_ROUTER_CWD: cwd,
    CODEX_ADMIN_SKILLS_ROOT: adminSkillsRoot,
    AGENTIC_SKILL_ROUTER_STATE_DIR: stateDir,
  };

  return {
    env,
    root,
    codexHome,
    adminSkillsRoot,
    disabledSkillId: "user:codex:lark-mail",
    stateDir,
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
      { option: "--jsoon", suggestion: "--json", commandName: "agentic-skill-router skills list" },
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
      { option: "--unsed-for", suggestion: "--unused-for", commandName: "agentic-skill-router skills suggest" },
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
      { option: "--qurey", suggestion: "--query", commandName: "agentic-skill-router skills route" },
    );
    await expectUnknownOption(
      ["skills", "route", "--query=lark mail", "--jsoon"],
      fake.env,
      { option: "--jsoon", suggestion: "--json", commandName: "agentic-skill-router skills route" },
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
      { option: "--qurey", suggestion: "--query", commandName: "agentic-skill-router skills dci search" },
    );
    // Happy path: positional query for DCI search.
    const ok = await runCli(["skills", "dci", "search", "lark mail", "--metadata-only", "--json"], fake.env);
    const parsed = JSON.parse(ok.stdout) as {
      metadataOnly: boolean;
      budget: { maxSkillBytes: number; maxCorpusBytes: number };
      corpus: { bytesRead: number };
      matches: unknown[];
    };
    assert.equal(parsed.metadataOnly, true);
    assert.equal(parsed.budget.maxSkillBytes, 0);
    assert.equal(parsed.budget.maxCorpusBytes, 0);
    assert.equal(parsed.corpus.bytesRead, 0);
    assert.ok(Array.isArray(parsed.matches));
  } finally {
    await fake.cleanup();
  }
});

test("skills corpus search and inspect expose agentic metadata primitives", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectUnknownOption(
      ["skills", "corpus", "search", "--anny=lark"],
      fake.env,
      { option: "--anny", suggestion: "--any", commandName: "agentic-skill-router skills corpus search" },
    );

    const search = await runCli([
      "skills",
      "corpus",
      "search",
      "--any=lark",
      "--all=mail",
      "--ranker=bm25",
      "--limit=5",
      "--json",
    ], fake.env);
    const parsed = JSON.parse(search.stdout) as {
      mode: string;
      ranker: string;
      query: { any: string[]; all: string[] };
      budget: { readsBody: boolean; maxResults: number };
      corpus: { totalMatches: number; returned: number; truncated: boolean };
      matches: Array<{ shortId: string; skillMdPath?: string }>;
    };
    assert.equal(parsed.mode, "disabled-skill-metadata");
    assert.equal(parsed.ranker, "bm25");
    assert.deepEqual(parsed.query.any, ["lark"]);
    assert.deepEqual(parsed.query.all, ["mail"]);
    assert.equal(parsed.budget.readsBody, false);
    assert.equal(parsed.budget.maxResults, 5);
    assert.equal(parsed.corpus.totalMatches, 1);
    assert.equal(parsed.corpus.returned, 1);
    assert.equal(parsed.corpus.truncated, false);
    assert.equal(parsed.matches[0]?.shortId, "lark-mail");
    assert.equal(parsed.matches[0]?.skillMdPath, undefined);
    const cacheRaw = await readFile(join(fake.stateDir, "corpus-cache-codex.json"), "utf8");
    assert.ok(!cacheRaw.includes("SKILL.md"), "corpus cache should not expose skill file paths");

    const noMatch = await runCli(["skills", "corpus", "search", "--any=does-not-exist", "--json"], fake.env);
    const noMatchParsed = JSON.parse(noMatch.stdout) as { corpus: { totalMatches: number }; matches: unknown[] };
    assert.equal(noMatchParsed.corpus.totalMatches, 0);
    assert.deepEqual(noMatchParsed.matches, []);

    const inspect = await runCli(["skills", "corpus", "inspect", "lark-mail", "--json"], fake.env);
    const inspected = JSON.parse(inspect.stdout) as {
      inspected: Array<{ id: string; shortId: string; skillMdPath?: string }>;
    };
    assert.equal(inspected.inspected[0]?.id, fake.disabledSkillId);
    assert.equal(inspected.inspected[0]?.shortId, "lark-mail");
    assert.equal(inspected.inspected[0]?.skillMdPath, undefined);
  } finally {
    await fake.cleanup();
  }
});

test("skills corpus inspect can resolve a fresh bm25 index snapshot", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const cachedSkill: Skill = {
      id: "user:codex:sr-cached",
      name: "sr-cached",
      description: "Cached 80K corpus skill metadata",
      metadata: {
        name: "sr-cached",
        description: "Cached 80K corpus skill metadata",
        aliases: [],
        tags: [],
        tools: [],
        domains: [],
        intents: [],
        examples: [],
      },
      source: "user",
      pluginKey: null,
      skillMdPath: "corpus-cache:sr-cached",
      isDisabled: true,
      isPluginDisabled: false,
      canDisable: true,
      conflict: false,
    };
    await writeFile(join(fake.stateDir, "corpus-bm25-index-codex.json"), JSON.stringify({
      version: 1,
      host: "codex",
      createdAtMs: Date.now(),
      fingerprint: "external-corpus-snapshot",
      index: buildSkillCorpusBm25Index([cachedSkill]),
    }));

    const inspect = await runCli(["skills", "corpus", "inspect", "sr-cached", "--json"], fake.env);
    const parsed = JSON.parse(inspect.stdout) as {
      inspected: Array<{ id: string; shortId: string; skillMdPath?: string }>;
    };

    assert.equal(parsed.inspected[0]?.id, "user:codex:sr-cached");
    assert.equal(parsed.inspected[0]?.shortId, "sr-cached");
    assert.equal(parsed.inspected[0]?.skillMdPath, undefined);
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
      { option: "--verbse", commandName: "agentic-skill-router skills dci budget" },
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
      { option: "--yess", suggestion: "--yes", commandName: "agentic-skill-router skills disable" },
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
      { option: "--jsoon", suggestion: "--json", commandName: "agentic-skill-router skills enable" },
    );
    // Happy path: enabling the already-disabled marker works.
    const ok = await runCli(["skills", "enable", fake.disabledSkillId, "--json"], fake.env);
    const parsed = JSON.parse(ok.stdout) as Array<{ id: string }>;
    assert.equal(parsed[0]?.id, fake.disabledSkillId);
  } finally {
    await fake.cleanup();
  }
});

test("skills disable on out-of-root symlink refuses without --allow-symlink-target-mutation", async () => {
  // `--yes` alone confirms intent to disable, not intent to rename files
  // outside the host's skills root. Out-of-root symlink targets must require
  // the explicit `--allow-symlink-target-mutation` flag (issue #94).
  const fake = await makeFakeCodexUser();
  try {
    const externalSkillDir = join(fake.root, "external-skills", "linked-skill");
    await mkdir(externalSkillDir, { recursive: true });
    await writeFile(
      join(externalSkillDir, "SKILL.md"),
      "---\nname: linked-skill\ndescription: linked user skill\n---\n",
    );
    await symlink(externalSkillDir, join(fake.codexHome, "skills", "linked-skill"));

    const listed = await runCli(["skills", "list", "--json"], fake.env);
    const parsed = JSON.parse(listed.stdout) as Array<{ id: string; outOfRoot: boolean; canDisable: boolean }>;
    const linked = parsed.find((skill) => skill.id === "user:codex:linked-skill");
    assert.ok(linked);
    assert.equal(linked!.outOfRoot, true);
    assert.equal(linked!.canDisable, false);

    // Default: refuses with a clear error mentioning the linked target path
    // and the required flag. SKILL.md must NOT be renamed.
    let refused: unknown;
    try {
      await runCli(["skills", "disable", "user:codex:linked-skill", "--yes"], fake.env);
    } catch (err) {
      refused = err;
    }
    assert.ok(refused, "disable without --allow-symlink-target-mutation must fail");
    assert.equal((refused as { code?: number }).code, 1);
    const refusedStderr = (refused as { stderr?: string }).stderr ?? "";
    assert.match(refusedStderr, /refusing to disable user:codex:linked-skill/);
    assert.match(refusedStderr, /symlink target outside this host's skills root/);
    assert.match(refusedStderr, /--allow-symlink-target-mutation/);
    assert.ok(
      refusedStderr.includes(externalSkillDir),
      `error should disclose the linked target path; got: ${refusedStderr}`,
    );
    // The live SKILL.md under the external dir is untouched.
    await stat(join(externalSkillDir, "SKILL.md"));
    await assertFileAbsent(join(externalSkillDir, "SKILL.md.agentic-skill-router-disabled"));
  } finally {
    await fake.cleanup();
  }
});

test("skills disable on out-of-root symlink with --allow-symlink-target-mutation modifies the target", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const externalSkillDir = join(fake.root, "external-skills", "linked-skill");
    await mkdir(externalSkillDir, { recursive: true });
    await writeFile(
      join(externalSkillDir, "SKILL.md"),
      "---\nname: linked-skill\ndescription: linked user skill\n---\n",
    );
    await symlink(externalSkillDir, join(fake.codexHome, "skills", "linked-skill"));

    const disabled = await runCli(
      ["skills", "disable", "user:codex:linked-skill", "--yes", "--allow-symlink-target-mutation"],
      fake.env,
    );
    assert.match(disabled.stderr, /warning: user:codex:linked-skill is a symlink/);
    const linkedSkillPath = join(fake.codexHome, "skills", "linked-skill", "SKILL.md");
    const realSkillPath = join(externalSkillDir, "SKILL.md");
    assert.ok(
      disabled.stderr.includes(`${linkedSkillPath} -> ${realSkillPath}`),
      `disable warning should identify linked target path; got: ${disabled.stderr}`,
    );
    await stat(join(externalSkillDir, "SKILL.md.agentic-skill-router-disabled"));

    // enable also requires the flag.
    let enableRefused: unknown;
    try {
      await runCli(["skills", "enable", "user:codex:linked-skill"], fake.env);
    } catch (err) {
      enableRefused = err;
    }
    assert.ok(enableRefused, "enable without flag must fail too");
    assert.equal((enableRefused as { code?: number }).code, 1);
    const enableStderr = (enableRefused as { stderr?: string }).stderr ?? "";
    assert.match(enableStderr, /refusing to enable user:codex:linked-skill/);
    assert.match(enableStderr, /--allow-symlink-target-mutation/);

    const enabled = await runCli(
      ["skills", "enable", "user:codex:linked-skill", "--allow-symlink-target-mutation"],
      fake.env,
    );
    assert.match(enabled.stderr, /warning: user:codex:linked-skill is a symlink/);
    const linkedDisabledPath = join(fake.codexHome, "skills", "linked-skill", "SKILL.md.agentic-skill-router-disabled");
    const realDisabledPath = join(externalSkillDir, "SKILL.md.agentic-skill-router-disabled");
    assert.ok(
      enabled.stderr.includes(`${linkedDisabledPath} -> ${realDisabledPath}`),
      `enable warning should identify linked target path; got: ${enabled.stderr}`,
    );
    await stat(join(externalSkillDir, "SKILL.md"));
  } finally {
    await fake.cleanup();
  }
});

test("skills disable --all-suggested --yes never mutates out-of-root symlinks and still disables in-root ones", async () => {
  // End-to-end guard for issue #94: the batch path must NOT silently rename
  // SKILL.md files outside the host's skills root. Today `policy.suggest`
  // already filters them out via `canDisable=false`, and the CLI also carries
  // a defensive skip for the same case in case that policy ever relaxes. This
  // test verifies the net effect: the external target is untouched while
  // in-root suggestions still get disabled.
  const fake = await makeFakeCodexUser();
  try {
    const externalSkillDir = join(fake.root, "external-skills", "linked-stale");
    await mkdir(externalSkillDir, { recursive: true });
    await writeFile(
      join(externalSkillDir, "SKILL.md"),
      "---\nname: linked-stale\ndescription: stale linked skill\n---\n",
    );
    await symlink(externalSkillDir, join(fake.codexHome, "skills", "linked-stale"));

    const inRootDir = join(fake.codexHome, "skills", "in-root-stale");
    await mkdir(inRootDir, { recursive: true });
    await writeFile(
      join(inRootDir, "SKILL.md"),
      "---\nname: in-root-stale\ndescription: in-root stale skill\n---\n",
    );

    await runCli(
      ["skills", "disable", "--all-suggested", "--yes", "--unused-for=1d"],
      fake.env,
    );

    // The external (out-of-root) target must NOT have been renamed.
    await stat(join(externalSkillDir, "SKILL.md"));
    await assertFileAbsent(join(externalSkillDir, "SKILL.md.agentic-skill-router-disabled"));

    // In-root suggestion did get disabled.
    await stat(join(inRootDir, "SKILL.md.agentic-skill-router-disabled"));
  } finally {
    await fake.cleanup();
  }
});

test("skills disable still rejects builtin out-of-root symlink skills", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const externalSkillDir = join(fake.root, "external-skills", "admin-linked");
    await mkdir(externalSkillDir, { recursive: true });
    await writeFile(
      join(externalSkillDir, "SKILL.md"),
      "---\nname: admin-linked\ndescription: protected admin symlink\n---\n",
    );
    await mkdir(fake.adminSkillsRoot, { recursive: true });
    await symlink(externalSkillDir, join(fake.adminSkillsRoot, "admin-linked"));

    let caught: unknown;
    try {
      await runCli(["skills", "disable", "builtin:codex-admin:admin-linked", "--yes"], fake.env);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught);
    assert.equal((caught as { code?: number }).code, 1);
    assert.match((caught as { stderr?: string }).stderr ?? "", /resolves outside the skills root|Cannot disable builtin/);
    await stat(join(externalSkillDir, "SKILL.md"));
  } finally {
    await fake.cleanup();
  }
});

test("skills status never silently re-disables out-of-root symlink targets after external restore", async () => {
  // Threat scenario (issue #124): user disables a skill that resolves through
  // an out-of-root symlink (with --allow-symlink-target-mutation). Some
  // external process later restores the live SKILL.md at the linked target.
  // The next `skills status` call must NOT silently rename the file at the
  // linked target back to `.agentic-skill-router-disabled`; that would mutate
  // a file outside the host's skills root from a read-only-looking command.
  // Instead, status reports the skill in a "skipped (manual repair required)"
  // section and prints the explicit fix command.
  const fake = await makeFakeCodexUser();
  try {
    const externalSkillDir = join(fake.root, "external-skills", "linked-skill");
    await mkdir(externalSkillDir, { recursive: true });
    const externalLive = join(externalSkillDir, "SKILL.md");
    const externalDisabled = externalLive + ".agentic-skill-router-disabled";
    await writeFile(
      externalLive,
      "---\nname: linked-skill\ndescription: linked user skill\n---\n",
    );
    await symlink(externalSkillDir, join(fake.codexHome, "skills", "linked-skill"));

    // 1) Explicitly opt in to disabling the symlink target. This is the only
    //    path that writes a disable record for an out-of-root skill.
    const disabled = await runCli(
      ["skills", "disable", "user:codex:linked-skill", "--yes", "--allow-symlink-target-mutation"],
      fake.env,
    );
    assert.match(disabled.stderr, /warning: user:codex:linked-skill is a symlink/);
    await stat(externalDisabled);

    // 2) Simulate an external process restoring the live SKILL.md (e.g. a
    //    plugin reinstall that re-creates the file behind our back).
    await rm(externalDisabled);
    await writeFile(
      externalLive,
      "---\nname: linked-skill\ndescription: linked user skill (restored)\n---\n",
    );

    // 3) Run `skills status`. The fix: it must NOT rename the live SKILL.md
    //    behind the symlink. Status itself does not take a symlink flag —
    //    that's exactly the point of issue #124: status is supposed to be a
    //    safe inspection surface.
    const status = await runCli(["skills", "status", "--json"], fake.env);
    const parsed = JSON.parse(status.stdout) as {
      reapplied: string[];
      skipped: Array<{
        id: string;
        instanceKey: string;
        livePath: string;
        linkedTarget: string;
        fixCommand: string | null;
        manualRepairHint?: string;
      }>;
    };
    assert.ok(Array.isArray(parsed.skipped), "status --json must expose a skipped array");
    assert.equal(parsed.reapplied.length, 0, `must not reapply: ${JSON.stringify(parsed.reapplied)}`);
    const skipped = parsed.skipped.find((s) => s.id === "user:codex:linked-skill");
    assert.ok(skipped, `expected skipped entry for linked-skill; got: ${JSON.stringify(parsed.skipped)}`);
    // Single inventory instance for this id → unambiguous, so a
    // copy-pasteable fixCommand is emitted and manualRepairHint is absent.
    assert.equal(typeof skipped!.fixCommand, "string");
    assert.match(
      skipped!.fixCommand!,
      /agentic-skill-router skills disable user:codex:linked-skill .*--allow-symlink-target-mutation/,
    );
    assert.equal(skipped!.manualRepairHint, undefined);
    // The linkedTarget points at the external SKILL.md, NOT a path inside
    // codexHome — the whole reason we refused to rename.
    assert.ok(
      skipped!.linkedTarget.includes(externalSkillDir),
      `linkedTarget must surface the out-of-root path; got ${skipped!.linkedTarget}`,
    );

    // 4) The live external SKILL.md is still live; the disabled marker was
    //    not re-created. This is the load-bearing safety assertion: status
    //    has not mutated a file outside the host's skills root.
    await stat(externalLive);
    let disabledMarkerAbsent = false;
    try {
      await stat(externalDisabled);
    } catch {
      disabledMarkerAbsent = true;
    }
    assert.ok(
      disabledMarkerAbsent,
      "skills status must not have re-renamed the out-of-root symlink target",
    );

    // 5) Text output mentions the skip section and the fix command so a user
    //    running `skills status` without --json sees actionable guidance.
    const statusText = await runCli(["skills", "status"], fake.env);
    assert.match(statusText.stdout, /skipped \(out-of-root symlink, manual repair required\)/);
    assert.match(statusText.stdout, /user:codex:linked-skill/);
    assert.match(
      statusText.stdout,
      /agentic-skill-router skills disable user:codex:linked-skill .*--allow-symlink-target-mutation/,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills status still reapplies in-root skills with the same state", async () => {
  // Regression guard for issue #124: the new out-of-root skip MUST NOT affect
  // ordinary in-root skills. If a normal user skill's SKILL.md was restored
  // upstream, `skills status` should still re-rename it to honor the disable
  // record the same way it did before the fix.
  const fake = await makeFakeCodexUser();
  try {
    // lark-mail is seeded by the fixture as already-disabled (only the
    // .agentic-skill-router-disabled file exists). Add a disable record so
    // reapplyMissing knows the user wants it disabled, then restore the live
    // SKILL.md to simulate an upstream plugin upgrade.
    const liveLark = join(fake.codexHome, "skills", "lark-mail", "SKILL.md");
    const disabledLark = liveLark + ".agentic-skill-router-disabled";
    // First do a real enable→disable cycle so a disable record is written
    // through the normal CLI path (which is what we want to exercise).
    await runCli(["skills", "enable", fake.disabledSkillId], fake.env);
    await runCli(["skills", "disable", fake.disabledSkillId, "--yes"], fake.env);
    await stat(disabledLark);

    // Simulate upstream restoring the live SKILL.md behind our back.
    await rm(disabledLark);
    await writeFile(
      liveLark,
      "---\nname: lark-mail\ndescription: Lark mail workflows for office automation\n---\n",
    );

    const status = await runCli(["skills", "status", "--json"], fake.env);
    const parsed = JSON.parse(status.stdout) as {
      reapplied: string[];
      skipped: Array<{ id: string }>;
    };
    assert.ok(
      parsed.reapplied.includes(fake.disabledSkillId),
      `in-root skill must be reapplied; got reapplied=${JSON.stringify(parsed.reapplied)}`,
    );
    assert.equal(
      parsed.skipped.find((s) => s.id === fake.disabledSkillId),
      undefined,
      "in-root skill must not appear in skipped",
    );

    // Disk reflects the reapply: live gone, disabled marker present.
    await stat(disabledLark);
    let liveAbsent = false;
    try {
      await stat(liveLark);
    } catch {
      liveAbsent = true;
    }
    assert.ok(liveAbsent, "in-root SKILL.md should have been renamed back to disabled marker");
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
      { option: "--jsoon", suggestion: "--json", commandName: "agentic-skill-router skills status" },
    );
    const ok = await runCli(["skills", "status", "--json"], fake.env);
    const parsed = JSON.parse(ok.stdout) as { disabledCount: number };
    assert.equal(typeof parsed.disabledCount, "number");
  } finally {
    await fake.cleanup();
  }
});

async function expectParseArgsUsageError(
  args: string[],
  env: NodeJS.ProcessEnv,
  expected: { stderrMatch: RegExp; commandName: string },
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
  assert.match(stderr, expected.stderrMatch, `stderr should match ${expected.stderrMatch} for ${args.join(" ")}; got: ${stderr}`);
  assert.ok(
    stderr.includes(expected.commandName),
    `stderr should mention the command path ${expected.commandName}; got: ${stderr}`,
  );
  assert.doesNotMatch(
    stderr,
    /\sat\s.*\(.*:\d+:\d+\)/,
    `stderr must not include a stack trace for ${args.join(" ")}; got: ${stderr}`,
  );
}

test("skills list rejects --json=1 (boolean flag with value) with exit code 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectParseArgsUsageError(
      ["skills", "list", "--json=1"],
      fake.env,
      {
        stderrMatch: /does not take an argument/i,
        commandName: "agentic-skill-router skills list",
      },
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills route rejects --query with missing value with exit code 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    // --query at end of argv with no value triggers
    // ERR_PARSE_ARGS_INVALID_OPTION_VALUE ("argument missing").
    await expectParseArgsUsageError(
      ["skills", "route", "--query"],
      fake.env,
      {
        stderrMatch: /argument missing/i,
        commandName: "agentic-skill-router skills route",
      },
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills list rejects unexpected positional with exit code 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    // `skills list` does not set allowPositionals, so extra positionals
    // trigger ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL.
    await expectParseArgsUsageError(
      ["skills", "list", "unexpected-arg"],
      fake.env,
      {
        stderrMatch: /does not take positional arguments|unexpected argument/i,
        commandName: "agentic-skill-router skills list",
      },
    );
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
      { option: "--pttn", commandName: "agentic-skill-router skills dci grep" },
    );
    await expectUnknownOption(
      ["skills", "dci", "find", fake.disabledSkillId, "--pattern=foo", "--regx"],
      fake.env,
      { option: "--regx", suggestion: "--regex", commandName: "agentic-skill-router skills dci find" },
    );
    await expectUnknownOption(
      ["skills", "dci", "open", fake.disabledSkillId, "--lne=10"],
      fake.env,
      { option: "--lne", suggestion: "--line", commandName: "agentic-skill-router skills dci open" },
    );
    await expectUnknownOption(
      ["skills", "dci", "inspect", fake.disabledSkillId, "--jsoon"],
      fake.env,
      { option: "--jsoon", suggestion: "--json", commandName: "agentic-skill-router skills dci inspect" },
    );
    await expectUnknownOption(
      ["skills", "dci", "read", fake.disabledSkillId, "--max-chrs=10"],
      fake.env,
      { option: "--max-chrs", suggestion: "--max-chars", commandName: "agentic-skill-router skills dci read" },
    );
    await expectUnknownOption(
      ["skills", "dci", "select", fake.disabledSkillId, "--query=x", "--confidence=high", "--reson=test"],
      fake.env,
      { option: "--reson", suggestion: "--reason", commandName: "agentic-skill-router skills dci select" },
    );
  } finally {
    await fake.cleanup();
  }
});

// ────────────────── JSON output schema validation ──────────────────
//
// These tests assert the shape of `--json` payloads so accidental CLI
// schema changes are caught here rather than only by callers/agents that
// consume the JSON. They also assert that the JSON lands cleanly on
// stdout (no stray banner / debug noise that would break `JSON.parse`).

async function runOk(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return runCli(args, env);
}

test("skills list --json emits parseable array of skills with expected keys", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const { stdout, stderr } = await runOk(["skills", "list", "--json"], fake.env);
    assert.equal(stderr, "", `stderr must be empty on success; got: ${stderr}`);
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(parsed), "list --json must be an array");
    assert.ok(parsed.length >= 2, `expected fixture to expose >=2 skills, got ${parsed.length}`);
    const requiredKeys = [
      "id", "name", "source", "isDisabled", "isPluginDisabled",
      "canDisable", "conflict", "outOfRoot", "description", "lastUsed", "callCount",
    ];
    for (const entry of parsed) {
      for (const key of requiredKeys) {
        assert.ok(key in entry, `list --json entry missing required key ${key}: ${JSON.stringify(entry)}`);
      }
      assert.equal(typeof entry.id, "string");
      assert.equal(typeof entry.name, "string");
      assert.equal(typeof entry.callCount, "number");
      assert.equal(typeof entry.isDisabled, "boolean");
    }
    // Fixture sanity: both disabled and live skills present.
    const ids = parsed.map((p) => p.id);
    assert.ok(ids.includes("user:codex:lark-mail"), `expected lark-mail in list; got ${ids.join(",")}`);
    assert.ok(ids.includes("user:codex:brand"), `expected brand in list; got ${ids.join(",")}`);
  } finally {
    await fake.cleanup();
  }
});

test("skills route --json emits parseable object with selected/matches schema", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const { stdout, stderr } = await runOk(
      ["skills", "route", "--query", "lark mail office", "--json", "--no-record"],
      fake.env,
    );
    assert.equal(stderr, "", `stderr must be empty on success; got: ${stderr}`);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    for (const key of ["query", "mode", "routeMode", "action", "recorded", "warnings", "selected", "matches", "diagnostics"]) {
      assert.ok(key in parsed, `route --json missing required key ${key}: ${JSON.stringify(parsed)}`);
    }
    assert.equal(parsed.query, "lark mail office");
    assert.equal(typeof parsed.recorded, "boolean");
    assert.ok(Array.isArray(parsed.warnings), "warnings must be an array");
    assert.ok(Array.isArray(parsed.matches), "matches must be an array");
    // selected may be null when no confident match; both shapes allowed.
    assert.ok(parsed.selected === null || typeof parsed.selected === "object");
    if (parsed.selected && typeof parsed.selected === "object") {
      const sel = parsed.selected as Record<string, unknown>;
      for (const key of ["id", "name", "source", "confidence", "score", "reason", "skillMdPath", "action"]) {
        assert.ok(key in sel, `selected missing key ${key}: ${JSON.stringify(sel)}`);
      }
    }
  } finally {
    await fake.cleanup();
  }
});

test("skills route --mode=body and --mode=dci return identical selection (#111)", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const query = "lark mail office";
    const body = await runOk(
      ["skills", "route", "--query", query, "--mode=body", "--json", "--no-record"],
      fake.env,
    );
    const dci = await runOk(
      ["skills", "route", "--query", query, "--mode=dci", "--json", "--no-record"],
      fake.env,
    );
    const parsedBody = JSON.parse(body.stdout) as Record<string, unknown>;
    const parsedDci = JSON.parse(dci.stdout) as Record<string, unknown>;

    // body is an alias for dci: same selection, same match ordering.
    const selectedBody = parsedBody.selected as Record<string, unknown> | null;
    const selectedDci = parsedDci.selected as Record<string, unknown> | null;
    assert.equal(selectedBody?.id, selectedDci?.id, "body alias must pick the same skill as dci");
    const matchesBody = parsedBody.matches as Array<Record<string, unknown>>;
    const matchesDci = parsedDci.matches as Array<Record<string, unknown>>;
    assert.deepEqual(
      matchesBody.map((m) => m.id),
      matchesDci.map((m) => m.id),
      "body alias must return the same matches in the same order as dci",
    );

    // routeMode reflects what the caller asked for; alias is only surfaced
    // for the body spelling, never for the canonical dci.
    assert.equal(parsedBody.routeMode, "body");
    assert.equal(parsedBody.routeModeAlias, "dci");
    assert.equal(parsedDci.routeMode, "dci");
    assert.ok(!("routeModeAlias" in parsedDci), "dci canonical mode must not emit routeModeAlias");
  } finally {
    await fake.cleanup();
  }
});

test("skills --help mentions that body is an alias for dci (#111)", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const { stdout } = await runOk(["--help"], fake.env);
    assert.match(
      stdout,
      /--mode=body is an alias for --mode=dci/,
      `--help must group body and dci together as aliases; got:\n${stdout}`,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills status --json emits parseable object with expected keys", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const { stdout, stderr } = await runOk(["skills", "status", "--json"], fake.env);
    assert.equal(stderr, "", `stderr must be empty on success; got: ${stderr}`);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    for (const key of [
      "disabledCount", "reapplied", "orphaned", "conflicted",
      "recoveredCommits", "recoveredRollbacks", "skipped",
      "symlinkMismatches", "orphanMarkers",
      "disabled", "pendingOps", "routed",
    ]) {
      assert.ok(key in parsed, `status --json missing key ${key}: ${JSON.stringify(parsed)}`);
    }
    assert.equal(typeof parsed.disabledCount, "number");
    for (const arrKey of ["reapplied", "orphaned", "conflicted", "recoveredCommits", "recoveredRollbacks", "skipped", "symlinkMismatches", "orphanMarkers", "disabled", "pendingOps", "routed"]) {
      assert.ok(Array.isArray(parsed[arrKey]), `${arrKey} must be an array`);
    }
  } finally {
    await fake.cleanup();
  }
});

test("skills dci budget --json emits parseable budget object", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const { stdout, stderr } = await runOk(["skills", "dci", "budget", "--json"], fake.env);
    assert.equal(stderr, "", `stderr must be empty on success; got: ${stderr}`);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    for (const key of ["maxQueries", "maxCandidates", "maxSkillBytes", "maxCorpusBytes"]) {
      assert.ok(key in parsed, `budget --json missing key ${key}: ${JSON.stringify(parsed)}`);
      assert.equal(typeof parsed[key], "number");
    }
  } finally {
    await fake.cleanup();
  }
});

test("skills suggest --json emits parseable array", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const { stdout, stderr } = await runOk(
      ["skills", "suggest", "--unused-for=365d", "--json"],
      fake.env,
    );
    assert.equal(stderr, "", `stderr must be empty on success; got: ${stderr}`);
    const parsed = JSON.parse(stdout) as unknown[];
    assert.ok(Array.isArray(parsed), "suggest --json must be an array");
    // Schema for each suggestion entry when present.
    for (const entry of parsed) {
      const e = entry as Record<string, unknown>;
      for (const key of ["id", "name", "source", "reason", "confidence", "details"]) {
        assert.ok(key in e, `suggest entry missing key ${key}: ${JSON.stringify(e)}`);
      }
    }
  } finally {
    await fake.cleanup();
  }
});

// ────────────────── user-error vs parse-error exit codes ──────────────────
//
// Convention in src/cli.ts:
//   - parse-error (parseStrict throws) → exit 2 via reportParseArgsError.
//   - user-error (missing required arg, bad enum, bad numeric flag) →
//     also exit 2, returned directly from the cmd handler.
//   - operational failure (disable preview without --yes, no-route) →
//     exit 1.
//
// These tests pin down those exits so silent regressions show up here.

async function expectExitCode(
  args: string[],
  env: NodeJS.ProcessEnv,
  expectedCode: number,
  expectedStderrMatch?: RegExp,
): Promise<{ stdout: string; stderr: string }> {
  let caught: unknown;
  let okResult: { stdout: string; stderr: string } | undefined;
  try {
    okResult = await runCli(args, env);
  } catch (err) {
    caught = err;
  }
  if (expectedCode === 0) {
    assert.ok(okResult, `expected exit 0 for ${args.join(" ")}, got error`);
    return okResult;
  }
  assert.ok(caught, `expected exit ${expectedCode} for ${args.join(" ")}, got success`);
  const e = caught as { code?: number; stdout?: string; stderr?: string };
  assert.equal(e.code, expectedCode, `expected exit ${expectedCode}, got ${e.code} for ${args.join(" ")}`);
  if (expectedStderrMatch) {
    assert.match(
      e.stderr ?? "",
      expectedStderrMatch,
      `stderr must match ${expectedStderrMatch} for ${args.join(" ")}; got: ${e.stderr}`,
    );
  }
  return { stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
}

test("skills route without --query and no positional exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "route"],
      fake.env,
      2,
      /specify --query|pass the query as positional/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills route with empty positional query (single empty arg) exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    // Empty positional joins to "" which is rejected by the same guard
    // that handles a missing --query. This pins the current behavior.
    await expectExitCode(
      ["skills", "route", ""],
      fake.env,
      2,
      /specify --query|pass the query as positional/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills route with --top-k=abc exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "route", "--query=lark mail", "--top-k=abc"],
      fake.env,
      2,
      /--top-k must be a positive integer/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills route with --top-k=0 exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "route", "--query=lark mail", "--top-k=0"],
      fake.env,
      2,
      /--top-k must be a positive integer/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills route with --mode=bogus exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "route", "--query=lark mail", "--mode=bogus"],
      fake.env,
      2,
      /--mode must be one of/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills dci search --top-k=abc exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "dci", "search", "--query=lark", "--top-k=abc"],
      fake.env,
      2,
      /--top-k must be a positive integer/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills dci search without --query exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "dci", "search"],
      fake.env,
      2,
      /specify --query/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills disable without <id> and no --all-suggested exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    // src/cli.ts:706-709 returns 2 for "specify <id...> or --all-suggested".
    // Pinning this exit code so future refactors don't silently flip the
    // contract from parse-error (2) to user-error (1).
    await expectExitCode(
      ["skills", "disable"],
      fake.env,
      2,
      /specify <id\.\.\.>|--all-suggested/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills disable <id> without --yes exits 1 (preview, not parse-error)", async () => {
  const fake = await makeFakeCodexUser();
  try {
    // Operational preview: parsing succeeded, but the apply was skipped
    // because --yes was not passed. That is an exit-1 case per cli.ts.
    await expectExitCode(
      ["skills", "disable", fake.disabledSkillId],
      fake.env,
      1,
      /would disable .* pass --yes/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills disable with unknown <id> exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "disable", "user:codex:does-not-exist", "--yes"],
      fake.env,
      2,
      /unknown skill id/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills enable without <id> exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "enable"],
      fake.env,
      2,
      /specify <id\.\.\.>/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills dci inspect without <id> exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "dci", "inspect"],
      fake.env,
      2,
      /specify <id-or-ref>/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("unknown top-level command exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["bogus-command"],
      fake.env,
      2,
      /unknown command/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("unknown skills subcommand exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "bogus"],
      fake.env,
      2,
      /unknown subcommand/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("unknown dci subcommand exits 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["skills", "dci", "bogus"],
      fake.env,
      2,
      /unknown dci subcommand/i,
    );
  } finally {
    await fake.cleanup();
  }
});

test("deprecated --host flag is rejected with exit 2", async () => {
  const fake = await makeFakeCodexUser();
  try {
    await expectExitCode(
      ["--host=codex", "skills", "list"],
      fake.env,
      2,
      /--host has been removed/i,
    );
  } finally {
    await fake.cleanup();
  }
});

// ────────────────── stdout vs stderr separation ──────────────────
//
// JSON must be emitted to stdout exclusively so callers can pipe
// `skills ... --json` through `jq`/`JSON.parse` without sanitization.
// Errors and warnings must land on stderr so they don't corrupt stdout.

test("skills list --json: stdout is pure JSON, stderr is empty", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const { stdout, stderr } = await runOk(["skills", "list", "--json"], fake.env);
    assert.equal(stderr, "", `stderr must be empty on success; got: ${stderr}`);
    // No leading/trailing junk - JSON.parse on the raw stdout must work.
    const parsed = JSON.parse(stdout);
    assert.ok(Array.isArray(parsed));
    // Trailing newline is fine, but the first non-whitespace char must be "[".
    assert.match(stdout.trimStart()[0] ?? "", /\[/);
  } finally {
    await fake.cleanup();
  }
});

test("skills route --json: stdout is pure JSON even when no match found", async () => {
  const fake = await makeFakeCodexUser();
  try {
    // A query unlikely to match the disabled fixture skill. Even when the
    // router yields no selection, the JSON envelope must still parse and
    // stderr must remain quiet (no warnings since --no-record).
    const { stdout, stderr } = await runOk(
      ["skills", "route", "--query", "completely unrelated zzz qqq", "--json", "--no-record"],
      fake.env,
    );
    assert.equal(stderr, "", `stderr must be empty on success; got: ${stderr}`);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    assert.ok("matches" in parsed && "selected" in parsed);
    // selected is null when no confident match.
    if (parsed.selected !== null) {
      assert.equal(typeof parsed.selected, "object");
    }
  } finally {
    await fake.cleanup();
  }
});

test("parse error: stderr carries the message, stdout stays empty", async () => {
  const fake = await makeFakeCodexUser();
  try {
    let caught: unknown;
    try {
      await runCli(["skills", "list", "--unknown-flag"], fake.env);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected parse-error to throw");
    const e = caught as { code?: number; stdout?: string; stderr?: string };
    assert.equal(e.code, 2);
    assert.equal(e.stdout ?? "", "", "stdout must be empty on parse-error");
    assert.match(e.stderr ?? "", /unknown option/i);
  } finally {
    await fake.cleanup();
  }
});

test("skills enable refuses state-only out-of-root record without --allow-symlink-target-mutation (#125)", async () => {
  // Regression guard for issues #100 + #125. The inventory-path enable flow
  // is already gated by PR #123 (`--allow-symlink-target-mutation`), but the
  // state-only branch (`enableSkillFromState`) reached when no inventory
  // entry matches the record's instanceKey used to skip the gate entirely.
  // Construct that scenario directly by hand-writing a state record whose
  // `skillMdPath` is textually inside the codex skills tree but whose realpath
  // resolves to a SKILL.md.agentic-skill-router-disabled outside any host
  // skill root.
  const fake = await makeFakeCodexUser();
  try {
    // Plant the real out-of-root file (this is the file the unguarded
    // rename would mutate).
    const externalSkillDir = join(fake.root, "external-skills", "drifted-skill");
    await mkdir(externalSkillDir, { recursive: true });
    const externalLive = join(externalSkillDir, "SKILL.md");
    const externalDisabled = externalLive + ".agentic-skill-router-disabled";
    await writeFile(
      externalDisabled,
      "---\nname: drifted-skill\ndescription: drifted out-of-root\n---\n",
    );

    // Symlink the codex-side parent directory at a path the host's scan does
    // not surface as `drifted-skill` (we deliberately give the inventory dir
    // a distinct name so the instanceKey won't match the state record).
    const codexInRootDir = join(fake.codexHome, "skills", "drifted-stub");
    await symlink(externalSkillDir, codexInRootDir);

    // The recorded `skillMdPath` points at the codex-side symlinked path.
    // realpath() will follow the link and land on `externalDisabled`, which
    // sits outside the codex skill root → must trip the gate.
    const recordedDisabledPath = join(codexInRootDir, "SKILL.md.agentic-skill-router-disabled");

    const statePath = join(fake.stateDir, "state-codex.json");
    // Populate `discoveredViaSymlink` + `canonicalSkillMdPath` so the record
    // represents a legitimate symlink-targeted disable that THIS CLI wrote
    // (post-#97 / PR #132 shape). The flag's bypass is now restricted to
    // authenticated symlink records (#100 follow-up): records missing those
    // fields refuse even with the flag.
    const state = {
      schema: 1,
      host: "codex",
      disabledSkills: [
        {
          id: "user:codex:drifted-skill",
          skillMdPath: recordedDisabledPath,
          skillName: "drifted-skill",
          source: "user",
          pluginKey: null,
          disabledAt: new Date().toISOString(),
          reason: "manual",
          discoveredViaSymlink: true,
          // canonicalSkillMdPath is the SKILL.md-form realpath captured at
          // disable time. `externalLive` is the canonical live path; the
          // marker-suffix form lives at `externalDisabled` on disk today.
          canonicalSkillMdPath: externalLive,
        },
      ],
    };
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");

    // Step 1: enable without the flag must fail with the same refusal text
    // the inventory branch produces, and the disabled marker MUST NOT be
    // renamed at the linked target.
    let refused: unknown;
    try {
      await runCli(["skills", "enable", "user:codex:drifted-skill"], fake.env);
    } catch (err) {
      refused = err;
    }
    assert.ok(refused, "state-only enable without flag must fail");
    assert.equal((refused as { code?: number }).code, 1);
    const refusedStderr = (refused as { stderr?: string }).stderr ?? "";
    assert.match(refusedStderr, /refusing to enable user:codex:drifted-skill/);
    assert.match(refusedStderr, /symlink target outside this host's skills root/);
    assert.match(refusedStderr, /--allow-symlink-target-mutation/);
    assert.ok(
      refusedStderr.includes(externalSkillDir),
      `refusal must disclose the realpath target; got: ${refusedStderr}`,
    );
    // Load-bearing safety: the out-of-root disabled marker is still present
    // and the live file was NOT silently created by an unguarded rename.
    await stat(externalDisabled);
    await assertFileAbsent(externalLive);

    // Step 2: re-run with the flag — same state-only path now succeeds
    // because the record is authenticated (discoveredViaSymlink + canonical
    // present, canonical matches realpath today).
    const enabled = await runCli(
      ["skills", "enable", "user:codex:drifted-skill", "--allow-symlink-target-mutation"],
      fake.env,
    );
    assert.equal(
      enabled.stderr.includes("refusing to enable"),
      false,
      `enable with flag should not refuse; got: ${enabled.stderr}`,
    );
    await stat(externalLive);
    await assertFileAbsent(externalDisabled);
  } finally {
    await fake.cleanup();
  }
});

test("skills enable on an in-root state record still works without --allow-symlink-target-mutation", async () => {
  // Regression guard: the new state-path realpath gate must NOT break the
  // common case where the state record points at an in-root SKILL.md (no
  // symlink involved). This is the bread-and-butter `skills enable` path.
  const fake = await makeFakeCodexUser();
  try {
    // `fake.disabledSkillId` is `user:codex:lark-mail`. The fixture drops the
    // `.agentic-skill-router-disabled` marker directly on disk but no state
    // record exists for it — calling `skills enable` should still succeed via
    // the inventory path here. To exercise the state-only branch with an
    // in-root path, disable a separate live skill via the CLI first, then
    // enable it.
    const liveSkillDir = join(fake.codexHome, "skills", "in-root-disabled");
    await mkdir(liveSkillDir, { recursive: true });
    await writeFile(
      join(liveSkillDir, "SKILL.md"),
      "---\nname: in-root-disabled\ndescription: in-root skill\n---\n",
    );

    await runCli(["skills", "disable", "user:codex:in-root-disabled", "--yes"], fake.env);
    await stat(join(liveSkillDir, "SKILL.md.agentic-skill-router-disabled"));

    // The skill is still in inventory (as a disabled entry); the cmdEnable
    // inventory path will pick it up — but the in-root realpath check would
    // also pass on the state-only branch. Verify the happy path still returns
    // 0 and renames the file back.
    const enabled = await runCli(["skills", "enable", "user:codex:in-root-disabled"], fake.env);
    assert.equal(enabled.stderr.includes("refusing to enable"), false);
    await stat(join(liveSkillDir, "SKILL.md"));
    await assertFileAbsent(join(liveSkillDir, "SKILL.md.agentic-skill-router-disabled"));
  } finally {
    await fake.cleanup();
  }
});

test("skills enable rejects a tampered state record whose skillMdPath escapes the host's skill roots (#100)", async () => {
  // Threat scenario from issue #100: the state file is plain JSON; a tampered
  // or hand-edited record could direct `skills enable` to rename an arbitrary
  // file outside the host's skill roots. Even when the on-disk path contains
  // path-traversal segments that resolve outside the roots, the realpath gate
  // in `enableSkillFromState` must refuse without --allow-symlink-target-mutation.
  const fake = await makeFakeCodexUser();
  try {
    // Plant a file at a path that obviously lives outside the codex skills
    // root, then hand-write a state record claiming it is a disabled skill.
    const escapedDir = join(fake.root, "totally-outside", "evil-skill");
    await mkdir(escapedDir, { recursive: true });
    const escapedDisabled = join(escapedDir, "SKILL.md.agentic-skill-router-disabled");
    await writeFile(
      escapedDisabled,
      "---\nname: evil-skill\ndescription: planted file outside skill roots\n---\n",
    );
    // Use a path that survives realpath but is unambiguously not under any
    // codex skill root. We embed a `..` segment so the recorded `skillMdPath`
    // textually points "into" the skills tree but resolves elsewhere; the
    // realpath gate must catch this regardless of textual prefix matching.
    const traversalPath = join(
      fake.codexHome,
      "skills",
      "decoy",
      "..",
      "..",
      "..",
      "totally-outside",
      "evil-skill",
      "SKILL.md.agentic-skill-router-disabled",
    );

    const statePath = join(fake.stateDir, "state-codex.json");
    const state = {
      schema: 1,
      host: "codex",
      disabledSkills: [
        {
          id: "user:codex:evil-skill",
          skillMdPath: traversalPath,
          skillName: "evil-skill",
          source: "user",
          pluginKey: null,
          disabledAt: new Date().toISOString(),
          reason: "tampered",
        },
      ],
    };
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");

    let refused: unknown;
    try {
      await runCli(["skills", "enable", "user:codex:evil-skill"], fake.env);
    } catch (err) {
      refused = err;
    }
    assert.ok(refused, "enable of a tampered out-of-root state record must fail");
    assert.equal((refused as { code?: number }).code, 1);
    const refusedStderr = (refused as { stderr?: string }).stderr ?? "";
    assert.match(refusedStderr, /refusing to enable user:codex:evil-skill/);
    assert.match(refusedStderr, /--allow-symlink-target-mutation/);
    // Load-bearing: the planted file MUST still be on disk under its disabled
    // name. A silent rename of an arbitrary local path is exactly what #100
    // warned about.
    await stat(escapedDisabled);
    await assertFileAbsent(join(escapedDir, "SKILL.md"));
  } finally {
    await fake.cleanup();
  }
});

test("skills enable refuses broken-symlink record when canonical disabled marker still exists (#100/#125 + #97)", async () => {
  // Reachable post-#97/#132: a record disabled through an out-of-root symlink
  // carries `discoveredViaSymlink: true` + `canonicalSkillMdPath` (the
  // canonical SKILL.md-form realpath). If the user later deletes or breaks
  // the in-root symlink, both in-root probes miss but the canonical
  // SKILL.md.agentic-skill-router-disabled file is still on disk. Without
  // consulting the canonical fields, `enableSkillFromState` would fall
  // through to the orphan-cleanup branch and silently drop the disable
  // record, stranding the canonical disabled marker AND bypassing the root
  // gate. The fix probes the canonical paths too and refuses without
  // --allow-symlink-target-mutation.
  const fake = await makeFakeCodexUser();
  try {
    // External (out-of-root) live skill, then disable through the symlink
    // with explicit consent. After this, state holds a record with
    // canonicalSkillMdPath pointing at the canonical SKILL.md outside the
    // host's skill roots.
    const externalSkillDir = join(fake.root, "external-skills", "broken-link-skill");
    await mkdir(externalSkillDir, { recursive: true });
    const externalLive = join(externalSkillDir, "SKILL.md");
    const externalDisabled = externalLive + ".agentic-skill-router-disabled";
    await writeFile(
      externalLive,
      "---\nname: broken-link-skill\ndescription: out-of-root via symlink\n---\n",
    );
    const inRootDir = join(fake.codexHome, "skills", "broken-link-skill");
    await symlink(externalSkillDir, inRootDir);

    await runCli(
      ["skills", "disable", "user:codex:broken-link-skill", "--yes", "--allow-symlink-target-mutation"],
      fake.env,
    );
    // Sanity: the canonical disabled marker is now the only on-disk artifact.
    await stat(externalDisabled);

    // Verify state captured the canonical fields (defends against a future
    // refactor accidentally turning this back into a no-op probe scenario).
    const statePath = join(fake.stateDir, "state-codex.json");
    const stateAfterDisable = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{
        id: string;
        canonicalSkillMdPath?: string;
        discoveredViaSymlink?: boolean;
      }>;
    };
    const recAfterDisable = stateAfterDisable.disabledSkills.find(
      (r) => r.id === "user:codex:broken-link-skill",
    );
    assert.ok(recAfterDisable, "disable should have written a state record");
    assert.equal(recAfterDisable!.discoveredViaSymlink, true);
    assert.ok(
      recAfterDisable!.canonicalSkillMdPath && recAfterDisable!.canonicalSkillMdPath.includes(externalSkillDir),
      `canonicalSkillMdPath should point into the external dir; got ${recAfterDisable!.canonicalSkillMdPath}`,
    );

    // Now break the in-root symlink. After this, both `inRoot/SKILL.md` and
    // `inRoot/SKILL.md.agentic-skill-router-disabled` probes miss (the
    // parent symlink dangles), but the canonical disabled marker is still
    // present at externalDisabled.
    await rm(inRootDir, { force: true });

    // Step 1: enable without the flag MUST refuse. The refusal must name the
    // skill and the canonical out-of-root target, and the canonical disabled
    // marker MUST still be on disk (the safety-load-bearing assertion).
    let refused: unknown;
    try {
      await runCli(["skills", "enable", "user:codex:broken-link-skill"], fake.env);
    } catch (err) {
      refused = err;
    }
    assert.ok(refused, "enable of broken-symlink record without flag must fail");
    assert.equal((refused as { code?: number }).code, 1);
    const refusedStderr = (refused as { stderr?: string }).stderr ?? "";
    assert.match(refusedStderr, /refusing to enable user:codex:broken-link-skill/);
    assert.match(refusedStderr, /symlink target outside this host's skills root/);
    assert.match(refusedStderr, /--allow-symlink-target-mutation/);
    assert.ok(
      refusedStderr.includes(externalSkillDir),
      `refusal must disclose the canonical out-of-root target; got: ${refusedStderr}`,
    );
    await stat(externalDisabled);
    await assertFileAbsent(externalLive);
    // The state record must still be present — we refused, we didn't clean
    // up. (This guards against the pre-fix orphan-cleanup leak.)
    const stateAfterRefuse = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{ id: string }>;
    };
    assert.ok(
      stateAfterRefuse.disabledSkills.some((r) => r.id === "user:codex:broken-link-skill"),
      "refused enable must not drop the disable record",
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills enable succeeds on broken-symlink record with --allow-symlink-target-mutation (#100/#125 + #97)", async () => {
  // Companion to the refusal test above: with explicit consent, the
  // state-only enable path uses the canonical realpath as both the gate
  // probe AND the rename source, so the canonical disabled marker is
  // restored to SKILL.md at the out-of-root location and the disable record
  // is cleared from state.
  const fake = await makeFakeCodexUser();
  try {
    const externalSkillDir = join(fake.root, "external-skills", "broken-link-skill-2");
    await mkdir(externalSkillDir, { recursive: true });
    const externalLive = join(externalSkillDir, "SKILL.md");
    const externalDisabled = externalLive + ".agentic-skill-router-disabled";
    await writeFile(
      externalLive,
      "---\nname: broken-link-skill-2\ndescription: out-of-root via symlink\n---\n",
    );
    const inRootDir = join(fake.codexHome, "skills", "broken-link-skill-2");
    await symlink(externalSkillDir, inRootDir);

    await runCli(
      ["skills", "disable", "user:codex:broken-link-skill-2", "--yes", "--allow-symlink-target-mutation"],
      fake.env,
    );
    await stat(externalDisabled);

    // Break the in-root symlink so we go through the state-only branch.
    await rm(inRootDir, { force: true });

    const enabled = await runCli(
      [
        "skills",
        "enable",
        "user:codex:broken-link-skill-2",
        "--allow-symlink-target-mutation",
      ],
      fake.env,
    );
    assert.equal(
      enabled.stderr.includes("refusing to enable"),
      false,
      `enable with flag should not refuse; got: ${enabled.stderr}`,
    );
    // Canonical file restored to live; disabled marker gone.
    await stat(externalLive);
    await assertFileAbsent(externalDisabled);

    // State record dropped after a successful enable.
    const statePath = join(fake.stateDir, "state-codex.json");
    const stateAfter = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{ id: string }>;
    };
    assert.ok(
      !stateAfter.disabledSkills.some((r) => r.id === "user:codex:broken-link-skill-2"),
      "successful enable should clear the disable record",
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills enable still orphan-cleans a broken-symlink record when canonical files are ALSO gone (regression)", async () => {
  // Regression guard for the canonical-fallback fix: the new branch must
  // ONLY redirect to canonical paths when at least one of them exists on
  // disk. If both the in-root paths AND the canonical paths are missing
  // (plugin uninstalled, external dir wiped), the record is a true orphan
  // and `skills enable` must clean up state without refusing — exactly the
  // pre-#97 behavior for a fully gone skill.
  const fake = await makeFakeCodexUser();
  try {
    const externalSkillDir = join(fake.root, "external-skills", "fully-gone-skill");
    await mkdir(externalSkillDir, { recursive: true });
    const externalLive = join(externalSkillDir, "SKILL.md");
    const externalDisabled = externalLive + ".agentic-skill-router-disabled";
    await writeFile(
      externalLive,
      "---\nname: fully-gone-skill\ndescription: orphan candidate\n---\n",
    );
    const inRootDir = join(fake.codexHome, "skills", "fully-gone-skill");
    await symlink(externalSkillDir, inRootDir);

    await runCli(
      ["skills", "disable", "user:codex:fully-gone-skill", "--yes", "--allow-symlink-target-mutation"],
      fake.env,
    );
    await stat(externalDisabled);

    // Now wipe both the in-root symlink AND the external dir, leaving the
    // state record as a true orphan with nowhere to land.
    await rm(inRootDir, { force: true });
    await rm(externalSkillDir, { recursive: true, force: true });

    // Plain `skills enable` must succeed (orphan cleanup), NOT refuse with
    // the new gate. Use --json so we can read the result deterministically.
    const enabled = await runCli(
      ["skills", "enable", "user:codex:fully-gone-skill", "--json"],
      fake.env,
    );
    assert.equal(
      enabled.stderr.includes("refusing to enable"),
      false,
      `orphan enable must not refuse; got stderr: ${enabled.stderr}`,
    );
    const parsed = JSON.parse(enabled.stdout) as Array<{ id: string; alreadyEnabled: boolean }>;
    assert.equal(parsed[0]?.id, "user:codex:fully-gone-skill");

    // State record must be gone.
    const statePath = join(fake.stateDir, "state-codex.json");
    const stateAfter = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{ id: string }>;
    };
    assert.ok(
      !stateAfter.disabledSkills.some((r) => r.id === "user:codex:fully-gone-skill"),
      "orphan enable should clear the disable record",
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills enable refuses out-of-root record with flag when canonical fields are missing (#100 follow-up)", async () => {
  // #100 follow-up: `--allow-symlink-target-mutation` MUST NOT be a blanket
  // bypass. A tampered or hand-edited state record whose `skillMdPath`
  // resolves out-of-root but lacks `discoveredViaSymlink` + `canonicalSkillMdPath`
  // could otherwise ride the flag into an arbitrary-path rename. Restrict
  // the bypass to records this CLI itself wrote for a genuine symlink
  // disable; everything else must refuse even with the flag.
  const fake = await makeFakeCodexUser();
  try {
    // Plant an out-of-root SKILL.md.agentic-skill-router-disabled, then
    // hand-write a state record pointing at it through an in-root symlink
    // WITHOUT the canonical fields a real CLI-driven disable would set.
    const externalSkillDir = join(fake.root, "external-skills", "tampered-no-canonical");
    await mkdir(externalSkillDir, { recursive: true });
    const externalLive = join(externalSkillDir, "SKILL.md");
    const externalDisabled = externalLive + ".agentic-skill-router-disabled";
    await writeFile(
      externalDisabled,
      "---\nname: tampered-no-canonical\ndescription: planted out-of-root\n---\n",
    );
    const codexInRootDir = join(fake.codexHome, "skills", "tampered-stub");
    await symlink(externalSkillDir, codexInRootDir);
    const recordedDisabledPath = join(codexInRootDir, "SKILL.md.agentic-skill-router-disabled");

    const statePath = join(fake.stateDir, "state-codex.json");
    const state = {
      schema: 1,
      host: "codex",
      disabledSkills: [
        {
          id: "user:codex:tampered-no-canonical",
          skillMdPath: recordedDisabledPath,
          skillName: "tampered-no-canonical",
          source: "user",
          pluginKey: null,
          disabledAt: new Date().toISOString(),
          reason: "manual",
          // Deliberately NO discoveredViaSymlink + NO canonicalSkillMdPath:
          // this is the tampered-record shape #100 warned about.
        },
      ],
    };
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");

    let refused: unknown;
    try {
      await runCli(
        ["skills", "enable", "user:codex:tampered-no-canonical", "--allow-symlink-target-mutation"],
        fake.env,
      );
    } catch (err) {
      refused = err;
    }
    assert.ok(refused, "enable with flag must still refuse a tampered record");
    assert.equal((refused as { code?: number }).code, 1);
    const refusedStderr = (refused as { stderr?: string }).stderr ?? "";
    assert.match(refusedStderr, /refusing to enable user:codex:tampered-no-canonical/);
    assert.match(refusedStderr, /cannot prove it originated from a symlink mutation written by this CLI/);
    assert.match(refusedStderr, /canonical fields missing or mismatched/);
    // Load-bearing safety: the out-of-root planted file was NOT renamed.
    await stat(externalDisabled);
    await assertFileAbsent(externalLive);
    // State record still present — refusal must not silently drop it.
    const stateAfter = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{ id: string }>;
    };
    assert.ok(
      stateAfter.disabledSkills.some((r) => r.id === "user:codex:tampered-no-canonical"),
      "refused enable must not drop the disable record",
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills enable succeeds with flag when discoveredViaSymlink + canonical matches realpath (#100 follow-up)", async () => {
  // Companion to the refusal above: the authenticated symlink record shape
  // (discoveredViaSymlink: true + canonicalSkillMdPath matching the
  // realpath today) MUST proceed with the flag. This is the legitimate
  // path-shifting scenario where a user disabled via the CLI through a
  // symlink and now wants to re-enable.
  const fake = await makeFakeCodexUser();
  try {
    const externalSkillDir = join(fake.root, "external-skills", "authenticated-skill");
    await mkdir(externalSkillDir, { recursive: true });
    const externalLive = join(externalSkillDir, "SKILL.md");
    const externalDisabled = externalLive + ".agentic-skill-router-disabled";
    await writeFile(
      externalDisabled,
      "---\nname: authenticated-skill\ndescription: legitimate symlink-disabled record\n---\n",
    );
    const codexInRootDir = join(fake.codexHome, "skills", "authenticated-stub");
    await symlink(externalSkillDir, codexInRootDir);
    const recordedDisabledPath = join(codexInRootDir, "SKILL.md.agentic-skill-router-disabled");

    const statePath = join(fake.stateDir, "state-codex.json");
    const state = {
      schema: 1,
      host: "codex",
      disabledSkills: [
        {
          id: "user:codex:authenticated-skill",
          skillMdPath: recordedDisabledPath,
          skillName: "authenticated-skill",
          source: "user",
          pluginKey: null,
          disabledAt: new Date().toISOString(),
          reason: "manual",
          discoveredViaSymlink: true,
          canonicalSkillMdPath: externalLive,
        },
      ],
    };
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");

    const enabled = await runCli(
      ["skills", "enable", "user:codex:authenticated-skill", "--allow-symlink-target-mutation"],
      fake.env,
    );
    assert.equal(
      enabled.stderr.includes("refusing to enable"),
      false,
      `authenticated enable with flag must not refuse; got: ${enabled.stderr}`,
    );
    await stat(externalLive);
    await assertFileAbsent(externalDisabled);
  } finally {
    await fake.cleanup();
  }
});

test("skills enable refuses with flag when canonical drifted from recorded realpath (#100 follow-up)", async () => {
  // Symlink retarget scenario: record carries discoveredViaSymlink + a
  // canonical, but the symlink target was retargeted between disable and
  // now, so the realpath today differs from the recorded canonical. Even
  // with the flag we must refuse — the user only ever approved a mutation
  // on the originally-disabled file. Mirror the existing #97 mismatch
  // guard from enableSkillPaths.
  const fake = await makeFakeCodexUser();
  try {
    // The CURRENT symlink target (what realpath returns today).
    const currentTargetDir = join(fake.root, "external-skills", "current-target");
    await mkdir(currentTargetDir, { recursive: true });
    const currentDisabled = join(currentTargetDir, "SKILL.md.agentic-skill-router-disabled");
    await writeFile(
      currentDisabled,
      "---\nname: drifted\ndescription: current target after retarget\n---\n",
    );
    const codexInRootDir = join(fake.codexHome, "skills", "drift-stub");
    await symlink(currentTargetDir, codexInRootDir);
    const recordedDisabledPath = join(codexInRootDir, "SKILL.md.agentic-skill-router-disabled");

    // The ORIGINAL canonical at disable time (different path — this is what
    // the state record claims was disabled). Doesn't need to exist on disk
    // anymore; we only compare strings against current realpath.
    const originalCanonicalLive = join(
      fake.root,
      "external-skills",
      "original-target",
      "SKILL.md",
    );

    const statePath = join(fake.stateDir, "state-codex.json");
    const state = {
      schema: 1,
      host: "codex",
      disabledSkills: [
        {
          id: "user:codex:drifted",
          skillMdPath: recordedDisabledPath,
          skillName: "drifted",
          source: "user",
          pluginKey: null,
          disabledAt: new Date().toISOString(),
          reason: "manual",
          discoveredViaSymlink: true,
          canonicalSkillMdPath: originalCanonicalLive,
        },
      ],
    };
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");

    let refused: unknown;
    try {
      await runCli(
        ["skills", "enable", "user:codex:drifted", "--allow-symlink-target-mutation"],
        fake.env,
      );
    } catch (err) {
      refused = err;
    }
    assert.ok(refused, "drifted canonical with flag must refuse");
    assert.equal((refused as { code?: number }).code, 1);
    const refusedStderr = (refused as { stderr?: string }).stderr ?? "";
    // Match the SkillSymlinkTargetMismatchError shape from src/types.ts.
    assert.match(refusedStderr, /Refusing to modify skill "user:codex:drifted"/);
    assert.match(refusedStderr, /now resolves to/);
    assert.match(refusedStderr, /disable record was captured for/);
    assert.ok(
      refusedStderr.includes(originalCanonicalLive),
      `mismatch error must surface the recorded canonical; got: ${refusedStderr}`,
    );
    // The current canonical file (what the symlink resolves to today) MUST
    // NOT have been renamed.
    await stat(currentDisabled);
    await assertFileAbsent(join(currentTargetDir, "SKILL.md"));
  } finally {
    await fake.cleanup();
  }
});

test("skills enable cleans state-only record for already-enabled out-of-root skill without flag (P2 follow-up)", async () => {
  // P2 follow-up to the #100/#125 + #97 gate work: the root gate must only
  // fire when an actual rename will occur. If the live SKILL.md exists at
  // the recorded path and the disabled marker is absent, the user already
  // enabled the skill out of band; `enableSkillPaths` would just drop the
  // stale record with no on-disk mutation. The previous P1 commit
  // accidentally refused this case for out-of-root paths and left users
  // unable to clean stale state without hand-editing JSON.
  const fake = await makeFakeCodexUser();
  try {
    const externalSkillDir = join(fake.root, "external-skills", "already-enabled");
    await mkdir(externalSkillDir, { recursive: true });
    const externalLive = join(externalSkillDir, "SKILL.md");
    await writeFile(
      externalLive,
      "---\nname: already-enabled\ndescription: user re-enabled out of band\n---\n",
    );
    const codexInRootDir = join(fake.codexHome, "skills", "already-enabled-stub");
    await symlink(externalSkillDir, codexInRootDir);

    // Hand-write a stale state record claiming the skill is disabled, but
    // on disk the live file is present (no disabled marker). This is the
    // shape `enableSkillPaths` treats as "alreadyEnabled" — pure state
    // cleanup, no rename. Include canonical fields so the record is
    // post-#97-shaped; the test still passes without them, but the
    // realistic post-disable record carries them.
    const recordedDisabledPath = join(codexInRootDir, "SKILL.md.agentic-skill-router-disabled");
    const statePath = join(fake.stateDir, "state-codex.json");
    const state = {
      schema: 1,
      host: "codex",
      disabledSkills: [
        {
          id: "user:codex:already-enabled",
          skillMdPath: recordedDisabledPath,
          skillName: "already-enabled",
          source: "user",
          pluginKey: null,
          disabledAt: new Date().toISOString(),
          reason: "manual",
          discoveredViaSymlink: true,
          canonicalSkillMdPath: externalLive,
        },
      ],
    };
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");

    // Enable WITHOUT the flag must succeed: no rename, no out-of-root file
    // mutation, just state cleanup. The pre-fix behavior refused here.
    const enabled = await runCli(
      ["skills", "enable", "user:codex:already-enabled", "--json"],
      fake.env,
    );
    assert.equal(
      enabled.stderr.includes("refusing to enable"),
      false,
      `state-cleanup enable must not refuse; got stderr: ${enabled.stderr}`,
    );
    const parsed = JSON.parse(enabled.stdout) as Array<{ id: string; alreadyEnabled: boolean }>;
    assert.equal(parsed[0]?.id, "user:codex:already-enabled");
    assert.equal(parsed[0]?.alreadyEnabled, true, "must report alreadyEnabled=true");

    // The out-of-root live SKILL.md is untouched (no rename happened).
    await stat(externalLive);
    await assertFileAbsent(externalLive + ".agentic-skill-router-disabled");
    // State record is gone.
    const stateAfter = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{ id: string }>;
    };
    assert.ok(
      !stateAfter.disabledSkills.some((r) => r.id === "user:codex:already-enabled"),
      "successful state-cleanup enable should clear the disable record",
    );
  } finally {
    await fake.cleanup();
  }
});

test("skills enable still refuses out-of-root record when disabled marker actually exists (P2 regression guard)", async () => {
  // Companion / regression guard for the P2 fix above: the gate-skip is
  // gated on `disabledBefore && !liveBefore` (a real rename would occur).
  // When the disabled marker IS on disk out-of-root, the original #100/#125
  // refusal must still fire without the flag — otherwise we would silently
  // mutate an out-of-root file. This re-asserts the security guarantee in
  // exactly the rename-bearing scenario the gate is meant to protect.
  const fake = await makeFakeCodexUser();
  try {
    const externalSkillDir = join(fake.root, "external-skills", "still-disabled");
    await mkdir(externalSkillDir, { recursive: true });
    const externalLive = join(externalSkillDir, "SKILL.md");
    const externalDisabled = externalLive + ".agentic-skill-router-disabled";
    await writeFile(
      externalDisabled,
      "---\nname: still-disabled\ndescription: actually disabled out-of-root\n---\n",
    );
    const codexInRootDir = join(fake.codexHome, "skills", "still-disabled-stub");
    await symlink(externalSkillDir, codexInRootDir);

    const recordedDisabledPath = join(codexInRootDir, "SKILL.md.agentic-skill-router-disabled");
    const statePath = join(fake.stateDir, "state-codex.json");
    const state = {
      schema: 1,
      host: "codex",
      disabledSkills: [
        {
          id: "user:codex:still-disabled",
          skillMdPath: recordedDisabledPath,
          skillName: "still-disabled",
          source: "user",
          pluginKey: null,
          disabledAt: new Date().toISOString(),
          reason: "manual",
          discoveredViaSymlink: true,
          canonicalSkillMdPath: externalLive,
        },
      ],
    };
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");

    let refused: unknown;
    try {
      await runCli(["skills", "enable", "user:codex:still-disabled"], fake.env);
    } catch (err) {
      refused = err;
    }
    assert.ok(refused, "rename-bearing out-of-root enable without flag MUST still refuse");
    assert.equal((refused as { code?: number }).code, 1);
    const refusedStderr = (refused as { stderr?: string }).stderr ?? "";
    assert.match(refusedStderr, /refusing to enable user:codex:still-disabled/);
    assert.match(refusedStderr, /symlink target outside this host's skills root/);
    assert.match(refusedStderr, /--allow-symlink-target-mutation/);
    // Load-bearing safety: the out-of-root disabled marker is NOT renamed.
    await stat(externalDisabled);
    await assertFileAbsent(externalLive);
    // State record stays.
    const stateAfter = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{ id: string }>;
    };
    assert.ok(
      stateAfter.disabledSkills.some((r) => r.id === "user:codex:still-disabled"),
      "refused enable must not drop the disable record",
    );
  } finally {
    await fake.cleanup();
  }
});

test("user error: stderr carries the message, stdout stays empty", async () => {
  const fake = await makeFakeCodexUser();
  try {
    let caught: unknown;
    try {
      await runCli(["skills", "route"], fake.env);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected user-error to throw");
    const e = caught as { code?: number; stdout?: string; stderr?: string };
    assert.equal(e.code, 2);
    assert.equal(e.stdout ?? "", "", "stdout must be empty on user-error");
    assert.match(e.stderr ?? "", /specify --query|pass the query as positional/i);
  } finally {
    await fake.cleanup();
  }
});
