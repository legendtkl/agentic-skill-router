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

test("skills status --json emits parseable object with expected keys", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const { stdout, stderr } = await runOk(["skills", "status", "--json"], fake.env);
    assert.equal(stderr, "", `stderr must be empty on success; got: ${stderr}`);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    for (const key of [
      "disabledCount", "reapplied", "orphaned", "conflicted",
      "recoveredCommits", "recoveredRollbacks", "skipped", "orphanMarkers",
      "disabled", "pendingOps", "routed",
    ]) {
      assert.ok(key in parsed, `status --json missing key ${key}: ${JSON.stringify(parsed)}`);
    }
    assert.equal(typeof parsed.disabledCount, "number");
    for (const arrKey of ["reapplied", "orphaned", "conflicted", "recoveredCommits", "recoveredRollbacks", "skipped", "orphanMarkers", "disabled", "pendingOps", "routed"]) {
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
