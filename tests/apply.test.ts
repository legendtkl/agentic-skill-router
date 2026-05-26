import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, stat, symlink, unlink, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disableSkill, enableSkill, enableSkillFromState, findOrphanMarkers, reapplyMissing } from "../src/apply.ts";
import { addPendingOp, loadState, recordRoutedSkill, saveState, skillInstanceKey, withStateLock } from "../src/state.ts";
import type { PendingOp, Skill, State } from "../src/types.ts";

async function setup(): Promise<{
  workdir: string;
  statePath: string;
  skill: Skill;
  cleanup: () => Promise<void>;
}> {
  const workdir = await mkdtemp(join(tmpdir(), "agentic-skill-router-apply-"));
  const skillDir = join(workdir, "skills/foo");
  await mkdir(skillDir, { recursive: true });
  const skillMdPath = join(skillDir, "SKILL.md");
  await writeFile(skillMdPath, "---\nname: foo\ndescription: x\n---\n");

  return {
    workdir,
    statePath: join(workdir, "state.json"),
    skill: {
      id: "user:foo",
      name: "foo",
      description: "x",
      source: "user",
      pluginKey: null,
      skillMdPath,
      isDisabled: false,
      isPluginDisabled: false,
      canDisable: true,
      conflict: false,
    },
    cleanup: () => rm(workdir, { recursive: true, force: true }),
  };
}

async function fileExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

test("disable renames SKILL.md and writes state", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    const result = await disableSkill(skill, "manual", { statePath });
    assert.equal(result.alreadyDisabled, false);
    assert.equal(await fileExists(skill.skillMdPath), false);
    assert.equal(await fileExists(skill.skillMdPath + ".agentic-skill-router-disabled"), true);
    assert.equal(result.state.disabledSkills.length, 1);
    assert.equal(result.state.disabledSkills[0]!.id, "user:foo");
    assert.equal(result.state.disabledSkills[0]!.reason, "manual");
  } finally {
    await cleanup();
  }
});

test("disable is idempotent if already renamed", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "first", { statePath });
    // Update skill record to reflect new path
    const disabledSkill = { ...skill, isDisabled: true, skillMdPath: skill.skillMdPath + ".agentic-skill-router-disabled" };
    const result = await disableSkill(disabledSkill, "second", { statePath });
    assert.equal(result.alreadyDisabled, true);
    assert.equal(result.state.disabledSkills.length, 1);
    assert.equal(result.state.disabledSkills[0]!.reason, "second");
  } finally {
    await cleanup();
  }
});

test("enable renames back and removes state record", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    const disabledSkill = { ...skill, isDisabled: true, skillMdPath: skill.skillMdPath + ".agentic-skill-router-disabled" };
    const result = await enableSkill(disabledSkill, { statePath });
    assert.equal(result.alreadyEnabled, false);
    assert.equal(await fileExists(skill.skillMdPath), true);
    assert.equal(await fileExists(skill.skillMdPath + ".agentic-skill-router-disabled"), false);
    assert.equal(result.state.disabledSkills.length, 0);
  } finally {
    await cleanup();
  }
});

test("enableSkillFromState cleans orphan record when both files are gone", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    await rm(skill.skillMdPath + ".agentic-skill-router-disabled");

    const result = await enableSkillFromState("user:foo", { statePath });
    assert.equal(result.cleanedStateOnly, true);
    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 0);
  } finally {
    await cleanup();
  }
});

test("enableSkillFromState restores disabled marker and clears state", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });

    const result = await enableSkillFromState("user:foo", { statePath });
    assert.equal(result.alreadyEnabled, false);
    assert.equal(await fileExists(skill.skillMdPath), true);
    assert.equal(await fileExists(skill.skillMdPath + ".agentic-skill-router-disabled"), false);
    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 0);
  } finally {
    await cleanup();
  }
});

test("enable refuses split-brain and preserves state", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    await writeFile(skill.skillMdPath, "live again\n");

    await assert.rejects(() => enableSkillFromState("user:foo", { statePath }), /split-brain|both/i);
    assert.equal(await fileExists(skill.skillMdPath), true);
    assert.equal(await fileExists(skill.skillMdPath + ".agentic-skill-router-disabled"), true);
    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 1);
  } finally {
    await cleanup();
  }
});

test("reapplyMissing detects upstream-recreated SKILL.md and renames again", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    // Simulate upstream restoring the original (e.g. plugin upgrade)
    await rename(skill.skillMdPath + ".agentic-skill-router-disabled", skill.skillMdPath);
    assert.equal(await fileExists(skill.skillMdPath), true);

    const result = await reapplyMissing({ statePath });
    assert.deepEqual(result.reapplied, ["user:foo"]);
    assert.deepEqual(result.orphaned, []);
    assert.equal(await fileExists(skill.skillMdPath + ".agentic-skill-router-disabled"), true);
  } finally {
    await cleanup();
  }
});

test("reapplyMissing reports orphans when SKILL.md is gone entirely", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    await rm(skill.skillMdPath + ".agentic-skill-router-disabled");

    const result = await reapplyMissing({ statePath });
    assert.deepEqual(result.reapplied, []);
    assert.deepEqual(result.orphaned, ["user:foo"]);
  } finally {
    await cleanup();
  }
});

test("reapplyMissing reconciles state path from current inventory after plugin upgrade", async () => {
  const { skill, statePath, cleanup, workdir } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    await rm(skill.skillMdPath + ".agentic-skill-router-disabled");

    const upgradedDir = join(workdir, "skills/foo-v2");
    await mkdir(upgradedDir, { recursive: true });
    const upgradedLive = join(upgradedDir, "SKILL.md");
    await writeFile(upgradedLive, "new live\n");
    const upgradedSkill: Skill = { ...skill, skillMdPath: upgradedLive };

    const result = await reapplyMissing({ statePath, skills: [upgradedSkill] });
    assert.deepEqual(result.reapplied, ["user:foo"]);
    assert.deepEqual(result.orphaned, []);
    assert.equal(await fileExists(upgradedLive), false);
    assert.equal(await fileExists(upgradedLive + ".agentic-skill-router-disabled"), true);
    const state = await loadState(statePath);
    assert.equal(state.disabledSkills[0]?.skillMdPath, upgradedLive + ".agentic-skill-router-disabled");
  } finally {
    await cleanup();
  }
});

test("disable refuses when both SKILL.md and SKILL.md.agentic-skill-router-disabled exist", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    // Create the disabled marker alongside the live file (split-brain)
    await writeFile(skill.skillMdPath + ".agentic-skill-router-disabled", "stale\n");
    await assert.rejects(
      () => disableSkill(skill, "x", { statePath }),
      /split-brain|both/i,
    );
    // Live file should still be live
    assert.equal(await fileExists(skill.skillMdPath), true);
  } finally {
    await cleanup();
  }
});

test("reapplyMissing flags conflicted records (both files exist)", async () => {
  const { skill, statePath, cleanup, workdir } = await setup();
  try {
    await disableSkill(skill, "first", { statePath });
    // Create live SKILL.md alongside the disabled marker (e.g. plugin upgrade
    // happened but somehow our disabled marker survived)
    await writeFile(skill.skillMdPath, "live\n");
    const result = await reapplyMissing({ statePath });
    assert.deepEqual(result.conflicted, ["user:foo"]);
    assert.deepEqual(result.reapplied, []);
    assert.deepEqual(result.orphaned, []);
    // Both files should still exist (we don't auto-resolve)
    assert.equal(await fileExists(skill.skillMdPath), true);
    assert.equal(await fileExists(skill.skillMdPath + ".agentic-skill-router-disabled"), true);
    void workdir;
  } finally {
    await cleanup();
  }
});

test("reapplyMissing skips out-of-root symlink targets and emits a copy-pasteable fixCommand for unambiguous ids", async () => {
  // Issue #124 (P0): `skills status` must not silently re-rename SKILL.md
  // through an out-of-root symlink. When the id is unambiguous in the
  // current inventory, the emitted `fixCommand` is safe to copy-paste.
  const { skill, statePath, cleanup, workdir } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    // Simulate upstream restoring the live SKILL.md.
    await rename(skill.skillMdPath + ".agentic-skill-router-disabled", skill.skillMdPath);

    // Mark the current inventory entry as an out-of-root mutable symlink.
    const linkedSkill: Skill = { ...skill, outOfRoot: true };
    const result = await reapplyMissing({ statePath, skills: [linkedSkill] });

    assert.deepEqual(result.reapplied, [], "must not silently rename out-of-root symlink");
    assert.equal(result.skipped.length, 1, `expected exactly one skipped entry: ${JSON.stringify(result.skipped)}`);
    const entry = result.skipped[0]!;
    assert.equal(entry.id, "user:foo");
    assert.equal(entry.livePath, skill.skillMdPath);
    assert.equal(typeof entry.fixCommand, "string");
    assert.match(
      entry.fixCommand!,
      /agentic-skill-router skills disable user:foo .*--allow-symlink-target-mutation/,
    );
    assert.equal(entry.manualRepairHint, undefined);

    // Load-bearing: the live file is still live; no silent rename.
    assert.equal(await fileExists(skill.skillMdPath), true);
    assert.equal(await fileExists(skill.skillMdPath + ".agentic-skill-router-disabled"), false);
    void workdir;
  } finally {
    await cleanup();
  }
});

test("reapplyMissing skips ambiguous-id symlinks with manualRepairHint (no fixCommand)", async () => {
  // Issue #124 (P1 follow-up): `skills disable <id>` resolves bare positional
  // ids via `new Map(skills.map((s) => [s.id, s]))`, which collapses
  // duplicate ids to a single arbitrary instance. When the current inventory
  // has multiple skills sharing this id, emitting `disable <id>` could
  // rename the WRONG instance, so `reapplyMissing` must withhold the
  // copy-pasteable command and surface a path/instanceKey-level hint
  // instead.
  const workdir = await mkdtemp(join(tmpdir(), "agentic-skill-router-apply-dup-"));
  try {
    // Two on-disk skills under different roots that both produce `user:foo`.
    const skillDirA = join(workdir, "rootA/skills/foo");
    const skillDirB = join(workdir, "rootB/skills/foo");
    await mkdir(skillDirA, { recursive: true });
    await mkdir(skillDirB, { recursive: true });
    const skillMdA = join(skillDirA, "SKILL.md");
    const skillMdB = join(skillDirB, "SKILL.md");
    await writeFile(skillMdA, "---\nname: foo\ndescription: x\n---\n");
    await writeFile(skillMdB, "---\nname: foo\ndescription: x\n---\n");

    const statePath = join(workdir, "state.json");
    const skillA: Skill = {
      id: "user:foo",
      name: "foo",
      description: "x",
      source: "user",
      pluginKey: null,
      skillMdPath: skillMdA,
      isDisabled: false,
      isPluginDisabled: false,
      canDisable: true,
      conflict: false,
      outOfRoot: true,
    };
    const skillB: Skill = { ...skillA, skillMdPath: skillMdB };

    // Disable A through the supported `allowOutOfRoot` path so the state has
    // a disable record bound to A's instanceKey. Then restore A's SKILL.md
    // to simulate an upstream re-create, exactly like the threat scenario.
    await disableSkill(skillA, "manual", { statePath, allowOutOfRoot: true });
    await rename(skillMdA + ".agentic-skill-router-disabled", skillMdA);

    // Inventory now has two entries with id="user:foo" (A and B).
    const result = await reapplyMissing({ statePath, skills: [skillA, skillB] });

    assert.deepEqual(result.reapplied, [], "must not rename through ambiguous symlink");
    assert.equal(result.skipped.length, 1, `expected one skipped entry: ${JSON.stringify(result.skipped)}`);
    const entry = result.skipped[0]!;
    assert.equal(entry.id, "user:foo");
    assert.equal(entry.fixCommand, null, "ambiguous id must NOT emit a copy-pasteable disable command");
    assert.equal(typeof entry.manualRepairHint, "string");
    assert.match(entry.manualRepairHint!, /Multiple skills share id `user:foo`/);
    // Hint must disambiguate via the specific instanceKey AND a path-level
    // repair so the user can act on the correct skill without guessing.
    assert.ok(
      entry.manualRepairHint!.includes(entry.instanceKey),
      `hint must mention the specific instanceKey; got: ${entry.manualRepairHint}`,
    );
    assert.ok(
      entry.manualRepairHint!.includes(skillMdA),
      `hint must surface the live path so the user can rename it manually; got: ${entry.manualRepairHint}`,
    );

    // No silent rename happened on disk.
    assert.equal(await fileExists(skillMdA), true);
    assert.equal(await fileExists(skillMdA + ".agentic-skill-router-disabled"), false);
    assert.equal(await fileExists(skillMdB), true);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("findOrphanMarkers detects disabled SKILL.md without state record", async () => {
  const { workdir, statePath, cleanup } = await setup();
  try {
    // Create a fully-orphaned skill: disabled marker, no state record at all
    const orphanDir = join(workdir, "skills/orphan");
    await mkdir(orphanDir, { recursive: true });
    const orphanPath = join(orphanDir, "SKILL.md.agentic-skill-router-disabled");
    await writeFile(orphanPath, "abandoned\n");

    const orphans = await findOrphanMarkers([join(workdir, "skills")], { statePath });
    assert.deepEqual(orphans, [orphanPath]);
  } finally {
    await cleanup();
  }
});

// ────────────────── journal / partial-failure recovery ──────────────────

test("disable commits the journal entry on success (no pendingOps left behind)", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    const result = await disableSkill(skill, "manual", { statePath });
    assert.equal(result.state.pendingOps?.length ?? 0, 0);
    const loaded = await loadState(statePath);
    assert.equal(loaded.pendingOps?.length ?? 0, 0);
    assert.equal(loaded.disabledSkills.length, 1);
  } finally {
    await cleanup();
  }
});

test("enable commits the journal entry on success (no pendingOps left behind)", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    const disabledSkill = { ...skill, isDisabled: true, skillMdPath: skill.skillMdPath + ".agentic-skill-router-disabled" };
    const result = await enableSkill(disabledSkill, { statePath });
    assert.equal(result.state.pendingOps?.length ?? 0, 0);
    const loaded = await loadState(statePath);
    assert.equal(loaded.pendingOps?.length ?? 0, 0);
    assert.equal(loaded.disabledSkills.length, 0);
  } finally {
    await cleanup();
  }
});

test("status recovers a disable where rename completed but state save crashed", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    // Simulate phase 1 (intent written) followed by a successful rename, but
    // the phase-2 commit never reached disk: the live file is gone, the
    // disabled marker exists, the state has an enable-style journal entry
    // pointing at a disable intent, and disabledSkills is still empty.
    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";
    await rename(skill.skillMdPath, disabledPath);

    const pending: PendingOp = {
      instanceKey: skillInstanceKey(skill.id, disabledPath),
      op: "disable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath,
      startedAt: "2026-05-22T00:00:00.000Z",
      record: {
        instanceKey: skillInstanceKey(skill.id, disabledPath),
        id: skill.id,
        pluginKey: skill.pluginKey,
        skillMdPath: disabledPath,
        skillName: skill.name,
        source: skill.source,
        disabledAt: "2026-05-22T00:00:00.000Z",
        reason: "manual",
      },
    };
    const initial: State = addPendingOp(
      { schema: 1, host: "claude-code", disabledSkills: [] },
      pending,
    );
    await saveState(initial, statePath);

    const result = await reapplyMissing({ statePath });
    assert.deepEqual(result.recoveredCommits, [skill.id]);
    assert.deepEqual(result.recoveredRollbacks, []);
    assert.deepEqual(result.reapplied, []);

    const after = await loadState(statePath);
    assert.equal(after.pendingOps?.length ?? 0, 0);
    assert.equal(after.disabledSkills.length, 1);
    assert.equal(after.disabledSkills[0]!.reason, "manual");
  } finally {
    await cleanup();
  }
});

test("status rolls back a disable where rename never happened", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    // Intent written, but the rename never completed: live file still present,
    // no disabled marker, no disable record.
    const pending: PendingOp = {
      instanceKey: skillInstanceKey(skill.id, skill.skillMdPath + ".agentic-skill-router-disabled"),
      op: "disable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath: skill.skillMdPath + ".agentic-skill-router-disabled",
      startedAt: "2026-05-22T00:00:00.000Z",
    };
    const initial: State = addPendingOp(
      { schema: 1, host: "claude-code", disabledSkills: [] },
      pending,
    );
    await saveState(initial, statePath);

    const result = await reapplyMissing({ statePath });
    assert.deepEqual(result.recoveredRollbacks, [skill.id]);
    assert.deepEqual(result.recoveredCommits, []);

    const after = await loadState(statePath);
    assert.equal(after.pendingOps?.length ?? 0, 0);
    assert.equal(after.disabledSkills.length, 0);
    assert.equal(await fileExists(skill.skillMdPath), true);
  } finally {
    await cleanup();
  }
});

test("status rolls back a disable pending op when both files are absent", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await rm(skill.skillMdPath);
    const record = {
      instanceKey: skillInstanceKey(skill.id, skill.skillMdPath + ".agentic-skill-router-disabled"),
      id: skill.id,
      pluginKey: skill.pluginKey,
      skillMdPath: skill.skillMdPath + ".agentic-skill-router-disabled",
      skillName: skill.name,
      source: skill.source,
      disabledAt: "2026-05-22T00:00:00.000Z",
      reason: "manual",
    } as const;
    const pending: PendingOp = {
      instanceKey: record.instanceKey,
      op: "disable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath: skill.skillMdPath + ".agentic-skill-router-disabled",
      startedAt: "2026-05-22T00:00:00.000Z",
      record,
    };
    const initial: State = addPendingOp(
      {
        schema: 1,
        host: "claude-code",
        disabledSkills: [record],
      },
      pending,
    );
    await saveState(initial, statePath);

    const result = await reapplyMissing({ statePath });
    assert.deepEqual(result.recoveredRollbacks, [skill.id]);
    assert.deepEqual(result.recoveredCommits, []);

    const after = await loadState(statePath);
    assert.equal(after.pendingOps?.length ?? 0, 0);
    assert.equal(after.disabledSkills.length, 0, "stale disable record should be removed");
  } finally {
    await cleanup();
  }
});

test("status does NOT re-disable an enabled skill when the post-rename state save failed", async () => {
  // Regression guard for issue #26: enable succeeded on disk (live file is
  // back) but the final state save was interrupted. The journal must finish
  // removing the disable record so that the next status doesn't reapply
  // disable and undo the user's enable.
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";

    // Manually rebuild the "post-rename, pre-final-save" state: disable
    // record still present, pending enable intent recorded, live SKILL.md
    // restored on disk, disabled marker removed.
    await rename(disabledPath, skill.skillMdPath);
    const stateAfterCrash = await loadState(statePath);
    assert.equal(stateAfterCrash.disabledSkills.length, 1);
    const pending: PendingOp = {
      instanceKey: skillInstanceKey(skill.id, disabledPath),
      op: "enable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath,
      startedAt: "2026-05-22T00:00:00.000Z",
    };
    await saveState(addPendingOp(stateAfterCrash, pending), statePath);

    const result = await reapplyMissing({ statePath, skills: [skill] });
    assert.deepEqual(result.recoveredCommits, [skill.id]);
    assert.deepEqual(result.reapplied, [], "must NOT re-disable a successfully enabled skill");

    const after = await loadState(statePath);
    assert.equal(after.pendingOps?.length ?? 0, 0);
    assert.equal(after.disabledSkills.length, 0);
    assert.equal(await fileExists(skill.skillMdPath), true);
    assert.equal(await fileExists(disabledPath), false);
  } finally {
    await cleanup();
  }
});

test("status leaves an enable split-brain pending op alone for manual repair", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";
    await writeFile(skill.skillMdPath, "live again\n");

    const stateAfterCrash = await loadState(statePath);
    const pending: PendingOp = {
      instanceKey: skillInstanceKey(skill.id, disabledPath),
      op: "enable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath,
      startedAt: "2026-05-22T00:00:00.000Z",
    };
    await saveState(addPendingOp(stateAfterCrash, pending), statePath);

    const result = await reapplyMissing({ statePath });
    assert.deepEqual(result.recoveredCommits, []);
    assert.deepEqual(result.recoveredRollbacks, []);
    assert.deepEqual(result.conflicted, [skill.id]);

    const after = await loadState(statePath);
    assert.equal(after.pendingOps?.length, 1);
    assert.equal(after.pendingOps?.[0]?.op, "enable");
    assert.equal(after.disabledSkills.length, 1);
  } finally {
    await cleanup();
  }
});

test("status rolls back an enable where rename never happened (disable record stays)", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";

    // Enable intent was journaled, but the rename never ran: disabled marker
    // still present, live file still absent, disable record still present.
    const stateAfterCrash = await loadState(statePath);
    const pending: PendingOp = {
      instanceKey: skillInstanceKey(skill.id, disabledPath),
      op: "enable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath,
      startedAt: "2026-05-22T00:00:00.000Z",
    };
    await saveState(addPendingOp(stateAfterCrash, pending), statePath);

    const result = await reapplyMissing({ statePath, skills: [skill] });
    assert.deepEqual(result.recoveredRollbacks, [skill.id]);
    assert.deepEqual(result.recoveredCommits, []);

    const after = await loadState(statePath);
    assert.equal(after.pendingOps?.length ?? 0, 0);
    assert.equal(after.disabledSkills.length, 1, "disable record preserved when enable rollback fires");
    assert.equal(await fileExists(disabledPath), true);
  } finally {
    await cleanup();
  }
});

test("status leaves a split-brain pending op alone for manual repair", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";
    await writeFile(disabledPath, "stale\n");
    const pending: PendingOp = {
      instanceKey: skillInstanceKey(skill.id, disabledPath),
      op: "disable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath,
      startedAt: "2026-05-22T00:00:00.000Z",
      record: {
        instanceKey: skillInstanceKey(skill.id, disabledPath),
        id: skill.id,
        pluginKey: skill.pluginKey,
        skillMdPath: disabledPath,
        skillName: skill.name,
        source: skill.source,
        disabledAt: "2026-05-22T00:00:00.000Z",
        reason: "manual",
      },
    };
    const initial: State = addPendingOp(
      { schema: 1, host: "claude-code", disabledSkills: [] },
      pending,
    );
    await saveState(initial, statePath);

    const result = await reapplyMissing({ statePath });
    // Both files exist on disk → leave it alone for the user to resolve.
    assert.deepEqual(result.recoveredCommits, []);
    assert.deepEqual(result.recoveredRollbacks, []);

    const after = await loadState(statePath);
    assert.equal(after.pendingOps?.length, 1);
    assert.equal(after.pendingOps?.[0]?.op, "disable");
  } finally {
    await cleanup();
  }
});

test("loadState ignores pendingOps from older state files (back-compat)", async () => {
  const { statePath, cleanup } = await setup();
  try {
    // Older state files written before this change have no pendingOps key.
    const legacy = {
      schema: 1,
      host: "claude-code",
      disabledSkills: [],
    };
    await writeFile(statePath, JSON.stringify(legacy));
    const loaded = await loadState(statePath);
    assert.deepEqual(loaded.pendingOps, []);
    assert.equal(loaded.disabledSkills.length, 0);
  } finally {
    await cleanup();
  }
});

test("status preserves a pre-existing disable record when disable rollback fires", async () => {
  // Regression: an upstream tool temporarily restored SKILL.md while state
  // already recorded the skill as disabled. A fresh disable attempt is then
  // interrupted before the rename completes (live file still present, no
  // disabled marker). Rollback must restore the original disable record so a
  // subsequent `status` can reapply the user's intent — not silently forget it.
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "first", { statePath });
    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";
    // Upstream tool restores the live file but the disabled marker also stays
    // around briefly; remove it to model the moment the new disable attempt
    // is journaled (live present, disabled absent).
    await rename(disabledPath, skill.skillMdPath);

    // Drive a second disableSkill attempt that journals its intent (snapshotting
    // the still-valid prior record into priorRecord). We then simulate a crash
    // before the rename by reverting the live/disabled state and asking
    // reapplyMissing to reconcile the journal.
    const stateBeforeAttempt = await loadState(statePath);
    assert.equal(
      stateBeforeAttempt.disabledSkills.length,
      1,
      "prior disable record should still be in state",
    );
    const pending: PendingOp = {
      instanceKey: stateBeforeAttempt.disabledSkills[0]!.instanceKey,
      op: "disable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath,
      startedAt: "2026-05-22T00:00:00.000Z",
      record: {
        ...stateBeforeAttempt.disabledSkills[0]!,
        disabledAt: "2026-05-22T00:00:00.000Z",
        reason: "second",
      },
      priorRecord: stateBeforeAttempt.disabledSkills[0]!,
    };
    await saveState(addPendingOp(stateBeforeAttempt, pending), statePath);

    const result = await reapplyMissing({ statePath, skills: [skill] });
    assert.deepEqual(result.recoveredRollbacks, [skill.id]);
    assert.deepEqual(result.recoveredCommits, []);
    // Because the prior record survived the rollback, the same reapplyMissing
    // run also re-renames the upstream-restored live file back to disabled.
    // Without the fix the record would be gone and `reapplied` would be empty,
    // silently dropping the user's intent.
    assert.deepEqual(result.reapplied, [skill.id]);

    const after = await loadState(statePath);
    assert.equal(after.pendingOps?.length ?? 0, 0);
    assert.equal(
      after.disabledSkills.length,
      1,
      "prior disable record must survive a rollback",
    );
    assert.equal(after.disabledSkills[0]!.reason, "first");
    assert.equal(await fileExists(skill.skillMdPath), false);
    assert.equal(await fileExists(disabledPath), true);
  } finally {
    await cleanup();
  }
});

test("disable on builtin throws BuiltinSkillCannotDisableError", async () => {
  const { statePath, cleanup } = await setup();
  try {
    const builtin: Skill = {
      id: "builtin:init",
      name: "init",
      description: "",
      source: "builtin",
      pluginKey: null,
      skillMdPath: "",
      isDisabled: false,
      isPluginDisabled: false,
      canDisable: false,
      conflict: false,
    };
    await assert.rejects(() => disableSkill(builtin, "x", { statePath }), /Cannot disable builtin/);
  } finally {
    await cleanup();
  }
});

test("disableSkill refuses skills flagged outOfRoot and leaves SKILL.md alone", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    const outOfRoot: Skill = { ...skill, outOfRoot: true };
    await assert.rejects(
      () => disableSkill(outOfRoot, "x", { statePath }),
      /resolves outside the skills root/i,
    );
    // The original SKILL.md must still be live; nothing was renamed.
    assert.equal(await fileExists(skill.skillMdPath), true);
    assert.equal(await fileExists(skill.skillMdPath + ".agentic-skill-router-disabled"), false);
    // No state record should have been written.
    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 0);
  } finally {
    await cleanup();
  }
});

test("disableSkill allowOutOfRoot permits non-builtin symlink targets only", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    const userSymlink: Skill = { ...skill, outOfRoot: true, canDisable: false };
    await disableSkill(userSymlink, "web", { statePath, allowOutOfRoot: true });
    assert.equal(await fileExists(skill.skillMdPath), false);
    assert.equal(await fileExists(skill.skillMdPath + ".agentic-skill-router-disabled"), true);

    const builtinSymlink: Skill = {
      ...userSymlink,
      id: "builtin:admin-linked",
      source: "builtin",
      skillMdPath: skill.skillMdPath + ".agentic-skill-router-disabled",
      isDisabled: true,
    };
    await assert.rejects(
      () => disableSkill(builtinSymlink, "web", { statePath, allowOutOfRoot: true }),
      /Cannot disable builtin/,
    );
    await assert.rejects(
      () => enableSkill(builtinSymlink, { statePath, allowOutOfRoot: true }),
      /Cannot disable builtin/,
    );
  } finally {
    await cleanup();
  }
});

async function setupTwoInstances(): Promise<{
  workdir: string;
  statePath: string;
  skillA: Skill;
  skillB: Skill;
  cleanup: () => Promise<void>;
}> {
  const workdir = await mkdtemp(join(tmpdir(), "agentic-skill-router-apply-multi-"));
  const skillADir = join(workdir, "skills-a/foo");
  const skillBDir = join(workdir, "skills-b/foo");
  await mkdir(skillADir, { recursive: true });
  await mkdir(skillBDir, { recursive: true });
  const aPath = join(skillADir, "SKILL.md");
  const bPath = join(skillBDir, "SKILL.md");
  await writeFile(aPath, "---\nname: foo\ndescription: a\n---\n");
  await writeFile(bPath, "---\nname: foo\ndescription: b\n---\n");
  const baseSkill = {
    id: "user:foo",
    name: "foo",
    description: "x",
    source: "user" as const,
    pluginKey: null,
    isDisabled: false,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  };
  return {
    workdir,
    statePath: join(workdir, "state.json"),
    skillA: { ...baseSkill, skillMdPath: aPath, description: "a" },
    skillB: { ...baseSkill, skillMdPath: bPath, description: "b" },
    cleanup: () => rm(workdir, { recursive: true, force: true }),
  };
}

test("two skills sharing an id at different paths are tracked as separate instances", async () => {
  const { skillA, skillB, statePath, cleanup } = await setupTwoInstances();
  try {
    // Disable only instance A.
    await disableSkill(skillA, "manual", { statePath });

    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 1);
    assert.equal(state.disabledSkills[0]!.id, "user:foo");
    assert.equal(state.disabledSkills[0]!.skillMdPath, skillA.skillMdPath + ".agentic-skill-router-disabled");
    assert.equal(
      state.disabledSkills[0]!.instanceKey,
      skillInstanceKey(skillA.id, skillA.skillMdPath),
    );

    // Route usage to instance B; the records must coexist.
    await withStateLock(statePath, async () => {
      const s = await loadState(statePath);
      await saveState(recordRoutedSkill(s, {
        id: skillB.id,
        pluginKey: null,
        skillMdPath: skillB.skillMdPath,
        name: skillB.name,
        query: "use B",
        confidence: "high",
        routedAt: "2026-05-21T00:00:00.000Z",
      }), statePath);
    });

    const after = await loadState(statePath);
    assert.equal(after.disabledSkills.length, 1, "disabled A is still present");
    assert.equal(after.routedSkills?.length, 1, "routed entry for B is recorded");
    assert.equal(after.routedSkills?.[0]?.skillMdPath, skillB.skillMdPath);
    assert.notEqual(
      after.disabledSkills[0]!.instanceKey,
      after.routedSkills?.[0]?.instanceKey,
    );

    // Enabling instance A by its own Skill restores A only and leaves B alone.
    const disabledA = { ...skillA, isDisabled: true, skillMdPath: skillA.skillMdPath + ".agentic-skill-router-disabled" };
    await enableSkill(disabledA, { statePath });

    const final = await loadState(statePath);
    assert.equal(final.disabledSkills.length, 0);
    assert.equal(final.routedSkills?.length, 1, "B routed record survives enabling A");
    assert.equal(final.routedSkills?.[0]?.skillMdPath, skillB.skillMdPath);
  } finally {
    await cleanup();
  }
});

test("disableSkill checks outOfRoot before canDisable so symlink-escape reports the specific error", async () => {
  // Regression guard: Host.listSkills() now marks out-of-root symlink
  // skills with canDisable=false, so if disableSkill checked canDisable first
  // it would surface a misleading "builtin" error and hide the real
  // remediation path. The outOfRoot guard must fire first because apply.ts
  // is now the only place these safety checks live (hosts no longer expose
  // disable/enable — see #32).
  const { skill, statePath, cleanup } = await setup();
  try {
    const outOfRootAndNotDisableable: Skill = {
      ...skill,
      outOfRoot: true,
      canDisable: false,
    };
    await assert.rejects(
      () => disableSkill(outOfRootAndNotDisableable, "x", { statePath }),
      (err: Error) =>
        err.name === "SkillOutOfRootError" &&
        /resolves outside the skills root/i.test(err.message),
    );
  } finally {
    await cleanup();
  }
});

test("enableSkillFromState refuses to silently pick one of multiple same-id instances", async () => {
  const { skillA, skillB, statePath, cleanup } = await setupTwoInstances();
  try {
    await disableSkill(skillA, "manual", { statePath });
    await disableSkill(skillB, "manual", { statePath });

    // The ambiguity error must recommend the actual CLI form
    // (`skills enable <instanceKey>`, positional) — not a non-existent
    // `--instance-key=<key>` flag. The examples should be copy-pasteable.
    await assert.rejects(
      () => enableSkillFromState("user:foo", { statePath }),
      (err: Error) => {
        const msg = err.message;
        assert.match(msg, /ambiguous skill id/i);
        assert.match(msg, /agentic-skill-router skills enable /);
        assert.doesNotMatch(msg, /--instance-key/);
        const keyA = skillInstanceKey(skillA.id, skillA.skillMdPath);
        const keyB = skillInstanceKey(skillB.id, skillB.skillMdPath);
        assert.match(msg, new RegExp(`agentic-skill-router skills enable ${keyA}\\b`));
        assert.match(msg, new RegExp(`agentic-skill-router skills enable ${keyB}\\b`));
        return true;
      },
    );
    // Both records still on disk.
    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 2);
  } finally {
    await cleanup();
  }
});

test("enableSkill refuses skills flagged outOfRoot", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    const outOfRoot: Skill = { ...skill, outOfRoot: true, isDisabled: true };
    await assert.rejects(
      () => enableSkill(outOfRoot, { statePath }),
      /resolves outside the skills root/i,
    );
  } finally {
    await cleanup();
  }
});

test("enableSkillFromState resolves an explicit instanceKey unambiguously", async () => {
  const { skillA, skillB, statePath, cleanup } = await setupTwoInstances();
  try {
    await disableSkill(skillA, "manual", { statePath });
    await disableSkill(skillB, "manual", { statePath });
    const keyA = skillInstanceKey(skillA.id, skillA.skillMdPath);

    const result = await enableSkillFromState(keyA, { statePath });
    assert.equal(result.alreadyEnabled, false);
    assert.equal(await fileExists(skillA.skillMdPath), true);
    assert.equal(await fileExists(skillB.skillMdPath + ".agentic-skill-router-disabled"), true);

    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 1);
    assert.equal(state.disabledSkills[0]!.skillMdPath, skillB.skillMdPath + ".agentic-skill-router-disabled");
  } finally {
    await cleanup();
  }
});

test("pending enable op for one same-id instance survives an enable on the other", async () => {
  // Regression guard: pending journal entries used to be keyed by bare `id`,
  // so two same-id instances would overwrite each other's in-flight intents.
  // Concretely: A crash leaves a pending enable for instance A behind (rename
  // never completed, so A still looks disabled on disk). The user then enables
  // instance B successfully. With the old `id`-keyed journal, B's enable would
  // remove A's pending entry, and a later `status` would have no record of
  // A's intent. With instanceKey-keyed journals the two entries coexist, and
  // `status` reconciles each one correctly.
  const { skillA, skillB, statePath, cleanup } = await setupTwoInstances();
  try {
    await disableSkill(skillA, "manual", { statePath });
    await disableSkill(skillB, "manual", { statePath });
    const disabledA = skillA.skillMdPath + ".agentic-skill-router-disabled";
    const disabledB = skillB.skillMdPath + ".agentic-skill-router-disabled";
    const keyA = skillInstanceKey(skillA.id, skillA.skillMdPath);
    const keyB = skillInstanceKey(skillB.id, skillB.skillMdPath);

    // Manually inject a pending enable for A that did not complete its rename
    // (live absent, disabled present). This is the exact crash shape that
    // exposes the keying bug if the journal collapses by `id`.
    const stateAfterDisables = await loadState(statePath);
    const pendingForA: PendingOp = {
      instanceKey: keyA,
      op: "enable",
      id: skillA.id,
      livePath: skillA.skillMdPath,
      disabledPath: disabledA,
      startedAt: "2026-05-22T00:00:00.000Z",
    };
    await saveState(addPendingOp(stateAfterDisables, pendingForA), statePath);

    // Now enable instance B. This drives the same journal API; if pending ops
    // were keyed by `id`, B's enable would clobber A's pending entry.
    const result = await enableSkillFromState(keyB, { statePath });
    assert.equal(result.id, skillB.id);
    assert.equal(result.instanceKey, keyB);
    assert.equal(await fileExists(skillB.skillMdPath), true, "B is enabled on disk");
    assert.equal(await fileExists(disabledB), false);
    assert.equal(await fileExists(disabledA), true, "A's disabled marker is untouched");
    assert.equal(await fileExists(skillA.skillMdPath), false);

    // A's pending enable journal entry MUST still be present after B's enable.
    const afterB = await loadState(statePath);
    const pendingEntries = afterB.pendingOps ?? [];
    assert.equal(
      pendingEntries.length,
      1,
      "A's pending entry must not be removed when B is enabled",
    );
    assert.equal(pendingEntries[0]!.instanceKey, keyA);
    assert.equal(pendingEntries[0]!.op, "enable");
    // A's disable record must also still be present (B's commit only cleared
    // its own record, identified by instanceKey).
    const disabledRecords = afterB.disabledSkills;
    assert.equal(disabledRecords.length, 1);
    assert.equal(disabledRecords[0]!.instanceKey, keyA);

    // Running status (reapplyMissing) now reconciles A: rename never happened,
    // so the pending op rolls back and A's disable record stays valid.
    const recon = await reapplyMissing({ statePath, skills: [skillA, skillB] });
    assert.deepEqual(recon.recoveredRollbacks, [skillA.id]);
    assert.deepEqual(recon.recoveredCommits, []);
    const final = await loadState(statePath);
    assert.equal(final.pendingOps?.length ?? 0, 0);
    assert.equal(final.disabledSkills.length, 1, "A's disable record survives rollback");
    assert.equal(final.disabledSkills[0]!.instanceKey, keyA);
    assert.equal(await fileExists(disabledA), true);
    assert.equal(await fileExists(skillB.skillMdPath), true);
  } finally {
    await cleanup();
  }
});

test("loadState synthesizes instanceKey for legacy pending ops missing the field", async () => {
  // Migration safety: state files written before instanceKey was added to
  // PendingOp should still reconcile cleanly. We hand-write a legacy entry
  // (no instanceKey key) and verify the validator synthesizes one from
  // (id, disabledPath) so subsequent journal operations key by it.
  const { skill, statePath, cleanup } = await setup();
  try {
    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";
    const legacy = {
      schema: 1,
      host: "claude-code",
      disabledSkills: [],
      pendingOps: [{
        op: "disable",
        id: skill.id,
        livePath: skill.skillMdPath,
        disabledPath,
        startedAt: "2026-05-22T00:00:00.000Z",
      }],
    };
    await writeFile(statePath, JSON.stringify(legacy));
    const loaded = await loadState(statePath);
    assert.equal(loaded.pendingOps?.length, 1);
    assert.equal(
      loaded.pendingOps?.[0]?.instanceKey,
      skillInstanceKey(skill.id, disabledPath),
    );
  } finally {
    await cleanup();
  }
});

/**
 * Issue #97: a disable that traverses an out-of-root symlink must record the
 * canonical realpath of the file it renamed. Without that, a later
 * enable/reapply has no way to detect that the symlink was retargeted to a
 * different external file between disable and enable, and would silently
 * mutate the unrelated new target.
 */
async function setupSymlinkSkill(): Promise<{
  workdir: string;
  statePath: string;
  externalDirA: string;
  externalDirB: string;
  symlinkSkillDir: string;
  skill: Skill;
  cleanup: () => Promise<void>;
}> {
  const workdir = await mkdtemp(join(tmpdir(), "agentic-skill-router-apply-symlink-"));
  const externalDirA = join(workdir, "external", "skill-a");
  const externalDirB = join(workdir, "external", "skill-b");
  await mkdir(externalDirA, { recursive: true });
  await mkdir(externalDirB, { recursive: true });
  await writeFile(join(externalDirA, "SKILL.md"), "---\nname: linked\ndescription: a\n---\n");
  await writeFile(join(externalDirB, "SKILL.md"), "---\nname: linked\ndescription: b\n---\n");

  const skillsRoot = join(workdir, "skills");
  await mkdir(skillsRoot, { recursive: true });
  const symlinkSkillDir = join(skillsRoot, "linked");
  await symlink(externalDirA, symlinkSkillDir);

  const skillMdPath = join(symlinkSkillDir, "SKILL.md");
  return {
    workdir,
    statePath: join(workdir, "state.json"),
    externalDirA,
    externalDirB,
    symlinkSkillDir,
    skill: {
      id: "user:linked",
      name: "linked",
      description: "x",
      source: "user",
      pluginKey: null,
      skillMdPath,
      isDisabled: false,
      isPluginDisabled: false,
      // Mirror Host.listSkills() behavior: out-of-root symlinks have
      // canDisable=false; allowOutOfRoot is the explicit caller opt-in.
      canDisable: false,
      conflict: false,
      outOfRoot: true,
    },
    cleanup: () => rm(workdir, { recursive: true, force: true }),
  };
}

test("disableSkill on out-of-root symlink records canonicalSkillMdPath in state (#97)", async () => {
  const { skill, statePath, externalDirA, cleanup } = await setupSymlinkSkill();
  try {
    await disableSkill(skill, "manual", { statePath, allowOutOfRoot: true });
    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 1);
    const rec = state.disabledSkills[0]!;
    // Recorded canonical resolves through the symlink to the real external file.
    assert.equal(rec.discoveredViaSymlink, true);
    assert.ok(rec.canonicalSkillMdPath, "canonicalSkillMdPath must be populated");
    // The recorded canonical is SKILL.md-form (suffix stripped) so a single
    // value works no matter which marker the on-disk file currently has —
    // see canonicalSkillFile() in src/apply.ts.
    const expectedCanonical = await realpath(join(externalDirA, "SKILL.md.agentic-skill-router-disabled"));
    const expectedStripped = expectedCanonical.endsWith(".agentic-skill-router-disabled")
      ? expectedCanonical.slice(0, -".agentic-skill-router-disabled".length)
      : expectedCanonical;
    assert.equal(rec.canonicalSkillMdPath, expectedStripped);
  } finally {
    await cleanup();
  }
});

test("disableSkill on in-root non-symlink skill does NOT add canonical fields (#97)", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 1);
    const rec = state.disabledSkills[0]!;
    assert.equal(rec.canonicalSkillMdPath, undefined);
    assert.equal(rec.discoveredViaSymlink, undefined);
  } finally {
    await cleanup();
  }
});

test("enableSkill refuses when symlink target retargeted to a different external file (#97)", async () => {
  const { skill, statePath, externalDirA, externalDirB, symlinkSkillDir, cleanup } = await setupSymlinkSkill();
  try {
    // Step 1: disable through the symlink. State now records the canonical
    // realpath under externalDirA.
    await disableSkill(skill, "manual", { statePath, allowOutOfRoot: true });

    // Sanity: the external A file got renamed to the disabled marker.
    assert.equal(await fileExists(join(externalDirA, "SKILL.md.agentic-skill-router-disabled")), true);
    // External B is still untouched.
    assert.equal(await fileExists(join(externalDirB, "SKILL.md")), true);
    assert.equal(await fileExists(join(externalDirB, "SKILL.md.agentic-skill-router-disabled")), false);

    // Step 2: retarget the symlink to externalDirB. Now the in-root path
    // resolves to a different external skill.
    await unlink(symlinkSkillDir);
    await symlink(externalDirB, symlinkSkillDir);

    // Step 3: enable. The recorded canonical points at A's file, but the
    // current realpath resolves to B's. enableSkill must refuse to rename
    // and surface a SkillSymlinkTargetMismatchError naming BOTH canonical
    // paths.
    const disabledSkillForEnable: Skill = {
      ...skill,
      isDisabled: true,
      skillMdPath: skill.skillMdPath + ".agentic-skill-router-disabled",
      outOfRoot: true,
    };
    let captured: Error | null = null;
    try {
      await enableSkill(disabledSkillForEnable, { statePath, allowOutOfRoot: true });
    } catch (err) {
      captured = err as Error;
    }
    assert.ok(captured, "enableSkill must throw on canonical mismatch");
    assert.equal(captured!.name, "SkillSymlinkTargetMismatchError");
    // Canonicals are normalized to SKILL.md-form (suffix stripped) by both
    // disable-time recording and enable-time comparison.
    const canonicalARaw = await realpath(join(externalDirA, "SKILL.md.agentic-skill-router-disabled"));
    const canonicalA = canonicalARaw.endsWith(".agentic-skill-router-disabled")
      ? canonicalARaw.slice(0, -".agentic-skill-router-disabled".length)
      : canonicalARaw;
    // externalDirB still has the live SKILL.md (was never renamed).
    const canonicalB = await realpath(join(externalDirB, "SKILL.md"));
    assert.ok(
      captured!.message.includes(canonicalA),
      `error must name recorded canonical (${canonicalA}); got: ${captured!.message}`,
    );
    assert.ok(
      captured!.message.includes(canonicalB),
      `error must name current canonical (${canonicalB}); got: ${captured!.message}`,
    );

    // External B's SKILL.md must NOT have been renamed.
    assert.equal(await fileExists(join(externalDirB, "SKILL.md")), true);
    assert.equal(await fileExists(join(externalDirB, "SKILL.md.agentic-skill-router-disabled")), false);
    // External A's disabled marker is still in place — nothing was mutated.
    assert.equal(await fileExists(join(externalDirA, "SKILL.md.agentic-skill-router-disabled")), true);

    // The disable record stays so a follow-up `status` keeps reporting the
    // mismatch until the user repairs the symlink.
    const after = await loadState(statePath);
    assert.equal(after.disabledSkills.length, 1);
  } finally {
    await cleanup();
  }
});

test("reapplyMissing precedence: out-of-root symlink wins over #97 canonical mismatch", async () => {
  // Both #124 (broader: out-of-root inventory entry never silently mutated)
  // and #97 (narrower: recorded canonical no longer matches current realpath)
  // could refuse the live-restored re-rename here. The agreed precedence is
  // that #124 fires FIRST so a single class of refusal (one `skipped` entry
  // with a fixCommand) is surfaced consistently, regardless of whether we
  // happened to record a canonical at disable time.
  const { skill, statePath, externalDirA, externalDirB, symlinkSkillDir, cleanup } = await setupSymlinkSkill();
  try {
    await disableSkill(skill, "manual", { statePath, allowOutOfRoot: true });

    // Restore the live file under external A so reapply sees `live present,
    // disabled absent` — the branch where it would normally re-rename.
    await rename(
      join(externalDirA, "SKILL.md.agentic-skill-router-disabled"),
      join(externalDirA, "SKILL.md"),
    );

    // Retarget the symlink to external B. This drives BOTH guards to want
    // to fire: out-of-root inventory entry (still flagged), AND canonical
    // mismatch (was A, now B).
    await unlink(symlinkSkillDir);
    await symlink(externalDirB, symlinkSkillDir);

    // The inventory entry still carries outOfRoot=true, mirroring how
    // Host.listSkills() would report this skill after the retarget.
    const reScannedSkill: Skill = { ...skill, outOfRoot: true };
    const result = await reapplyMissing({ statePath, skills: [reScannedSkill] });

    // Precedence: out-of-root wins. The entry lands in `skipped`, NOT in
    // `symlinkMismatches`, and `reapplied` stays empty.
    assert.equal(result.reapplied.length, 0, "must not re-rename through retargeted symlink");
    assert.equal(
      result.symlinkMismatches.length,
      0,
      `out-of-root entry must NOT also appear in symlinkMismatches; got: ${JSON.stringify(result.symlinkMismatches)}`,
    );
    assert.equal(result.skipped.length, 1, `expected one skipped entry: ${JSON.stringify(result.skipped)}`);
    const entry = result.skipped[0]!;
    assert.equal(entry.id, skill.id);
    assert.equal(typeof entry.fixCommand, "string");
    assert.match(
      entry.fixCommand!,
      /agentic-skill-router skills disable user:linked --yes --allow-symlink-target-mutation/,
    );

    // Nothing on disk was mutated.
    assert.equal(await fileExists(join(externalDirA, "SKILL.md")), true);
    assert.equal(await fileExists(join(externalDirA, "SKILL.md.agentic-skill-router-disabled")), false);
    assert.equal(await fileExists(join(externalDirB, "SKILL.md")), true);
    assert.equal(await fileExists(join(externalDirB, "SKILL.md.agentic-skill-router-disabled")), false);
  } finally {
    await cleanup();
  }
});

test("reapplyMissing on out-of-root unchanged target lands in skipped (#124 policy)", async () => {
  // Companion to the precedence test: even when the symlink target is
  // unchanged and #97's canonical check would happily allow the rename,
  // #124's broader "status never silently mutates out-of-root targets"
  // policy refuses and surfaces a `skipped` entry with a copy-pasteable
  // fix command. The original "happy path" test for #97 alone would have
  // expected `reapplied`; after the #129 integration that policy moves the
  // entry to `skipped` and the user opts back in explicitly.
  const { skill, statePath, externalDirA, cleanup } = await setupSymlinkSkill();
  try {
    await disableSkill(skill, "manual", { statePath, allowOutOfRoot: true });

    // Simulate upstream restoring the SKILL.md at the original external
    // target. The symlink is NOT retargeted.
    await rename(
      join(externalDirA, "SKILL.md.agentic-skill-router-disabled"),
      join(externalDirA, "SKILL.md"),
    );

    const reScannedSkill: Skill = { ...skill, outOfRoot: true };
    const result = await reapplyMissing({ statePath, skills: [reScannedSkill] });
    assert.equal(result.reapplied.length, 0, "out-of-root must not be silently re-renamed");
    assert.equal(result.symlinkMismatches.length, 0, "canonical matches so no mismatch entry");
    assert.equal(result.skipped.length, 1, `expected one skipped entry: ${JSON.stringify(result.skipped)}`);
    const entry = result.skipped[0]!;
    assert.equal(entry.id, skill.id);
    assert.equal(typeof entry.fixCommand, "string");
    // External target left alone — user must explicitly opt back in.
    assert.equal(await fileExists(join(externalDirA, "SKILL.md")), true);
    assert.equal(await fileExists(join(externalDirA, "SKILL.md.agentic-skill-router-disabled")), false);
  } finally {
    await cleanup();
  }
});

test("reapplyMissing surfaces symlinkMismatches when canonical drifts on a non-out-of-root inventory entry (#97)", async () => {
  // The #97 mismatch path is the narrower belt-and-suspenders guard: it
  // fires only when the broader #124 out-of-root policy has NOT already
  // taken the entry. The realistic shape is a record that was disabled
  // through an out-of-root symlink (so the canonical is recorded) but a
  // subsequent inventory re-scan dropped the outOfRoot flag (filesystem
  // race, broken symlink at scan time, or a host quirk) AND the canonical
  // has since drifted. The mismatch check catches the drift even though
  // #124 cannot see this entry as out-of-root anymore.
  const { skill, statePath, externalDirA, externalDirB, symlinkSkillDir, cleanup } = await setupSymlinkSkill();
  try {
    await disableSkill(skill, "manual", { statePath, allowOutOfRoot: true });

    // Restore the live file under external A so the reapply branch fires.
    await rename(
      join(externalDirA, "SKILL.md.agentic-skill-router-disabled"),
      join(externalDirA, "SKILL.md"),
    );

    // Retarget the symlink to external B.
    await unlink(symlinkSkillDir);
    await symlink(externalDirB, symlinkSkillDir);

    // Simulate the inventory re-scan returning the entry WITHOUT
    // outOfRoot=true. The #124 gate cannot apply, so the #97 guard takes
    // over and emits a `symlinkMismatches` entry instead.
    const reScannedSkill: Skill = { ...skill, outOfRoot: false };
    const result = await reapplyMissing({ statePath, skills: [reScannedSkill] });
    assert.equal(result.skipped.length, 0, "non-out-of-root entry must not land in skipped");
    assert.equal(result.reapplied.length, 0, "must not re-rename through retargeted symlink");
    assert.equal(result.symlinkMismatches.length, 1);
    assert.match(result.symlinkMismatches[0]!, new RegExp(`^${skill.id}: `));
    const canonicalA = await realpath(join(externalDirA, "SKILL.md"));
    const canonicalB = await realpath(join(externalDirB, "SKILL.md"));
    assert.ok(result.symlinkMismatches[0]!.includes(canonicalA));
    assert.ok(result.symlinkMismatches[0]!.includes(canonicalB));

    // Nothing on disk was mutated.
    assert.equal(await fileExists(join(externalDirA, "SKILL.md")), true);
    assert.equal(await fileExists(join(externalDirA, "SKILL.md.agentic-skill-router-disabled")), false);
    assert.equal(await fileExists(join(externalDirB, "SKILL.md")), true);
    assert.equal(await fileExists(join(externalDirB, "SKILL.md.agentic-skill-router-disabled")), false);
  } finally {
    await cleanup();
  }
});

test("reapplyMissing reapplies cleanly when symlink target is unchanged and inventory hides outOfRoot (#97 happy path)", async () => {
  // Regression guard for the original #97 P1.A defect: the recorded
  // canonical used to be the post-rename `.agentic-skill-router-disabled` path
  // while reapplyMissing realpath'd the `SKILL.md` (live) path, so the
  // two strings never matched and every legitimate reapply was wrongly
  // refused as a symlink retarget. With the SKILL.md-form normalization
  // in canonicalSkillFile, this case must succeed.
  //
  // To exercise the #97 path (not #124's skipped path) we present the
  // inventory entry as in-root (outOfRoot=false) — same shape as the
  // belt-and-suspenders test above, just without the retarget.
  const { skill, statePath, externalDirA, cleanup } = await setupSymlinkSkill();
  try {
    await disableSkill(skill, "manual", { statePath, allowOutOfRoot: true });

    // Simulate upstream restoring the SKILL.md at the original external
    // target. The symlink is NOT retargeted — this is the happy path.
    await rename(
      join(externalDirA, "SKILL.md.agentic-skill-router-disabled"),
      join(externalDirA, "SKILL.md"),
    );

    const reScannedSkill: Skill = { ...skill, outOfRoot: false };
    const result = await reapplyMissing({ statePath, skills: [reScannedSkill] });
    assert.equal(result.skipped.length, 0, "in-root re-scan must not hit the #124 gate");
    assert.equal(
      result.symlinkMismatches.length,
      0,
      `unchanged-target reapply must not flag a mismatch; got: ${JSON.stringify(result.symlinkMismatches)}`,
    );
    assert.deepEqual(result.reapplied, [skill.id], "unchanged-target reapply must re-rename");
    // The disabled marker should be back at the external target.
    assert.equal(await fileExists(join(externalDirA, "SKILL.md.agentic-skill-router-disabled")), true);
    assert.equal(await fileExists(join(externalDirA, "SKILL.md")), false);
  } finally {
    await cleanup();
  }
});

test("enableSkill succeeds when symlink target is unchanged (#97 happy path)", async () => {
  // Companion to the reapply happy-path: a normal enable through an
  // unchanged out-of-root symlink must restore the live file, not refuse.
  const { skill, statePath, externalDirA, cleanup } = await setupSymlinkSkill();
  try {
    await disableSkill(skill, "manual", { statePath, allowOutOfRoot: true });

    const disabledSkillForEnable: Skill = {
      ...skill,
      isDisabled: true,
      skillMdPath: skill.skillMdPath + ".agentic-skill-router-disabled",
      outOfRoot: true,
    };
    const result = await enableSkill(disabledSkillForEnable, {
      statePath,
      allowOutOfRoot: true,
    });
    assert.equal(result.alreadyEnabled, false);
    assert.equal(await fileExists(join(externalDirA, "SKILL.md")), true);
    assert.equal(await fileExists(join(externalDirA, "SKILL.md.agentic-skill-router-disabled")), false);
    const after = await loadState(statePath);
    assert.equal(after.disabledSkills.length, 0, "state record cleared after happy-path enable");
  } finally {
    await cleanup();
  }
});

test("reconcilePendingOp backfills canonicalSkillMdPath on crash recovery (#97 P1.C)", async () => {
  // Regression guard for P1.C from the first #97 review: a crash between
  // rename and the post-rename canonical save (or a disable where the
  // disable-time realpath silently failed) used to leave a recovered
  // record carrying `discoveredViaSymlink: true` with no canonical. The
  // enable-side guard then treated missing-canonical as legacy and
  // silently bypassed the retarget check. status (which triggers
  // reconcilePendingOp via reapplyMissing) must backfill the canonical
  // from the on-disk disabled marker so the safety net survives crashes.
  const { skill, statePath, externalDirA, symlinkSkillDir, cleanup } = await setupSymlinkSkill();
  try {
    // Pre-rename the disabled marker manually so the crash-recovery branch
    // (disabled exists, live absent) fires for our hand-written journal.
    await rename(
      join(externalDirA, "SKILL.md"),
      join(externalDirA, "SKILL.md.agentic-skill-router-disabled"),
    );

    // Hand-write a journal entry shaped like one the old code (or a failed
    // realpath at disable time) would leave behind: the record carries
    // `discoveredViaSymlink: true` but no `canonicalSkillMdPath`.
    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";
    const instanceKey = skillInstanceKey(skill.id, disabledPath);
    const journalState = {
      schema: 1,
      host: "claude-code",
      disabledSkills: [],
      pendingOps: [{
        instanceKey,
        op: "disable",
        id: skill.id,
        livePath: skill.skillMdPath,
        disabledPath,
        startedAt: "2026-05-22T00:00:00.000Z",
        record: {
          instanceKey,
          id: skill.id,
          pluginKey: null,
          skillMdPath: disabledPath,
          skillName: skill.name,
          source: "user",
          disabledAt: "2026-05-22T00:00:00.000Z",
          reason: "manual",
          discoveredViaSymlink: true,
          // Intentionally no canonicalSkillMdPath.
        },
      }],
    };
    await writeFile(statePath, JSON.stringify(journalState));

    const result = await reapplyMissing({ statePath, skills: [skill] });
    assert.equal(result.recoveredCommits.length, 1, "must commit the pending disable on recovery");
    assert.equal(result.recoveredCommits[0], skill.id);

    const after = await loadState(statePath);
    assert.equal(after.disabledSkills.length, 1);
    const rec = after.disabledSkills[0]!;
    // The backfill must populate canonicalSkillMdPath from the on-disk
    // disabled marker. The recorded value is SKILL.md-form (suffix stripped).
    assert.equal(rec.discoveredViaSymlink, true);
    const expectedCanonical = await realpath(join(externalDirA, "SKILL.md.agentic-skill-router-disabled"));
    const expectedStripped = expectedCanonical.endsWith(".agentic-skill-router-disabled")
      ? expectedCanonical.slice(0, -".agentic-skill-router-disabled".length)
      : expectedCanonical;
    assert.equal(rec.canonicalSkillMdPath, expectedStripped);

    // Cross-check: the safety net now works. Retarget the symlink and try
    // to enable — must refuse.
    await unlink(symlinkSkillDir);
    const externalDirC = join(externalDirA, "..", "skill-c");
    await mkdir(externalDirC, { recursive: true });
    await writeFile(join(externalDirC, "SKILL.md"), "---\nname: linked\ndescription: c\n---\n");
    await symlink(externalDirC, symlinkSkillDir);

    const disabledSkillForEnable: Skill = {
      ...skill,
      isDisabled: true,
      skillMdPath: disabledPath,
      outOfRoot: true,
    };
    await assert.rejects(
      () => enableSkill(disabledSkillForEnable, { statePath, allowOutOfRoot: true }),
      (err: Error) => err.name === "SkillSymlinkTargetMismatchError",
    );
  } finally {
    await cleanup();
  }
});

test("reconcilePendingOp consults canonical paths for symlink disable recovery (#97 round 3)", async () => {
  // Threat scenario:
  //   1. disable through an out-of-root symlink wrote the pending journal
  //      entry and the rename of the canonical SKILL.md ran;
  //   2. before the final state save committed the record, the process
  //      crashed;
  //   3. between crash and recovery, the in-root symlink got retargeted to
  //      a different (empty) external dir.
  //
  // Pre-fix behavior: reconcilePendingOp checked fileExists against
  // pending.livePath / pending.disabledPath, both of which now resolve
  // through the retargeted symlink to a directory with no SKILL.md. That
  // hits the `!live && !disabled` branch and ROLLS BACK the pending intent
  // — state and disk diverge (the canonical disabled marker is still
  // sitting at the ORIGINAL external target).
  //
  // Post-fix behavior: for `discoveredViaSymlink` records carrying
  // `canonicalSkillMdPath`, the check uses canonical paths. The canonical
  // disabled marker exists, the canonical live path does not — committed.
  const { skill, statePath, externalDirA, symlinkSkillDir, cleanup } = await setupSymlinkSkill();
  try {
    // Put the disk in the post-rename / pre-state-save state by hand.
    await rename(
      join(externalDirA, "SKILL.md"),
      join(externalDirA, "SKILL.md.agentic-skill-router-disabled"),
    );
    const canonicalLive = join(await realpath(externalDirA), "SKILL.md");
    const canonicalDisabled = canonicalLive + ".agentic-skill-router-disabled";

    // Hand-write the journal entry. canonicalSkillMdPath is in SKILL.md-form
    // (suffix stripped), matching what disableSkill writes today.
    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";
    const instanceKey = skillInstanceKey(skill.id, disabledPath);
    const journalState = {
      schema: 1,
      host: "claude-code",
      disabledSkills: [],
      pendingOps: [{
        instanceKey,
        op: "disable",
        id: skill.id,
        livePath: skill.skillMdPath,
        disabledPath,
        startedAt: "2026-05-26T00:00:00.000Z",
        record: {
          instanceKey,
          id: skill.id,
          pluginKey: null,
          skillMdPath: disabledPath,
          skillName: skill.name,
          source: "user",
          disabledAt: "2026-05-26T00:00:00.000Z",
          reason: "manual",
          discoveredViaSymlink: true,
          canonicalSkillMdPath: canonicalLive,
        },
      }],
    };
    await writeFile(statePath, JSON.stringify(journalState));

    // Retarget the in-root symlink so the symlink-path checks would mislead
    // recovery. The new external dir is fresh and contains no SKILL.md, so
    // BOTH pending.livePath and pending.disabledPath resolve through it to
    // nonexistent files — the pre-fix path-based branch would roll back.
    await unlink(symlinkSkillDir);
    const externalDirD = join(externalDirA, "..", "skill-d-empty");
    await mkdir(externalDirD, { recursive: true });
    await symlink(externalDirD, symlinkSkillDir);
    // Sanity: confirm the path-based view really does see neither file.
    assert.equal(await fileExists(skill.skillMdPath), false);
    assert.equal(await fileExists(disabledPath), false);
    // And the canonical view sees only the disabled marker.
    assert.equal(await fileExists(canonicalLive), false);
    assert.equal(await fileExists(canonicalDisabled), true);

    const result = await reapplyMissing({ statePath, skills: [{ ...skill, outOfRoot: false }] });
    // Must commit, not roll back. The retargeted symlink does not deceive
    // recovery because canonical paths are consulted.
    assert.deepEqual(result.recoveredCommits, [skill.id]);
    assert.deepEqual(result.recoveredRollbacks, []);

    const after = await loadState(statePath);
    assert.equal(after.pendingOps?.length ?? 0, 0, "journal entry must be cleared");
    assert.equal(after.disabledSkills.length, 1, "disable record must be committed");
    assert.equal(after.disabledSkills[0]!.canonicalSkillMdPath, canonicalLive);
    // Disk untouched: the canonical disabled marker is still there.
    assert.equal(await fileExists(canonicalDisabled), true);
  } finally {
    await cleanup();
  }
});

test("reconcilePendingOp consults canonical paths for symlink enable recovery (#97 round 3)", async () => {
  // Symmetric scenario for the enable journal:
  //   1. enable through an out-of-root symlink wrote the pending journal
  //      entry and the rename of the canonical disabled marker back to
  //      live SKILL.md ran;
  //   2. process crashed before clearing the disable record;
  //   3. in-root symlink got retargeted to a fresh empty dir.
  //
  // Pre-fix: path-based fileExists sees neither file, hits the `!live &&
  // !disabled` enable branch which COMMITS (removes the disable record).
  // Disk reality: canonical SKILL.md is live at the original external
  // target — committing happens to match disk by coincidence here, but
  // for the path-based logic that's accidental. The asymmetric danger is
  // the `disabledExists && !liveExists` rollback branch: if the path-based
  // check reported disabled-present at the new symlink target but the
  // canonical disabled marker was actually gone, the disable record would
  // wrongly survive. Use canonical paths so the decision matches reality.
  //
  // To pin a deterministic divergence, point the retargeted symlink at a
  // dir containing only a disabled marker. Path-based: disabled present,
  // live absent → ROLLBACK (keeps disable record, but canonical SKILL.md is
  // live — wrong). Canonical-based: live present, disabled absent →
  // COMMIT (removes disable record — correct).
  const { skill, statePath, externalDirA, symlinkSkillDir, cleanup } = await setupSymlinkSkill();
  try {
    const canonicalLive = join(await realpath(externalDirA), "SKILL.md");
    const canonicalDisabled = canonicalLive + ".agentic-skill-router-disabled";
    // Disk shape mimics post-rename of an enable: live present at canonical.
    // (Already true from setupSymlinkSkill — externalDirA has SKILL.md.)
    assert.equal(await fileExists(canonicalLive), true);

    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";
    const instanceKey = skillInstanceKey(skill.id, disabledPath);
    const journalState = {
      schema: 1,
      host: "claude-code",
      disabledSkills: [{
        instanceKey,
        id: skill.id,
        pluginKey: null,
        skillMdPath: disabledPath,
        skillName: skill.name,
        source: "user",
        disabledAt: "2026-05-26T00:00:00.000Z",
        reason: "manual",
        discoveredViaSymlink: true,
        canonicalSkillMdPath: canonicalLive,
      }],
      pendingOps: [{
        instanceKey,
        op: "enable",
        id: skill.id,
        livePath: skill.skillMdPath,
        disabledPath,
        startedAt: "2026-05-26T00:00:00.000Z",
      }],
    };
    await writeFile(statePath, JSON.stringify(journalState));

    // Retarget to a fresh dir containing only a disabled marker so the
    // path-based view would mislead recovery into a rollback.
    await unlink(symlinkSkillDir);
    const externalDirE = join(externalDirA, "..", "skill-e-disabled-only");
    await mkdir(externalDirE, { recursive: true });
    await writeFile(join(externalDirE, "SKILL.md.agentic-skill-router-disabled"), "decoy");
    await symlink(externalDirE, symlinkSkillDir);
    // Confirm the deceptive path-based view.
    assert.equal(await fileExists(skill.skillMdPath), false);
    assert.equal(await fileExists(disabledPath), true);

    const result = await reapplyMissing({ statePath, skills: [{ ...skill, outOfRoot: false }] });
    // Canonical-based: live present, disabled absent → committed
    // (disable record removed). Path-based would have rolled back.
    assert.deepEqual(result.recoveredCommits, [skill.id]);
    assert.deepEqual(result.recoveredRollbacks, []);

    const after = await loadState(statePath);
    assert.equal(after.pendingOps?.length ?? 0, 0);
    assert.equal(after.disabledSkills.length, 0, "disable record must be removed");
    // Canonical disk untouched.
    assert.equal(await fileExists(canonicalLive), true);
    assert.equal(await fileExists(canonicalDisabled), false);
  } finally {
    await cleanup();
  }
});

test("legacy disable records without canonical fields still enable cleanly (#97 back-compat)", async () => {
  // A state file written before issue #97 has no `canonicalSkillMdPath` or
  // `discoveredViaSymlink` keys. loadState must accept the legacy shape and
  // enable must operate exactly as before (no mismatch check, no refusal).
  const { skill, statePath, cleanup } = await setup();
  try {
    // Pre-disable manually so we can hand-craft a legacy state record.
    const disabledPath = skill.skillMdPath + ".agentic-skill-router-disabled";
    await rename(skill.skillMdPath, disabledPath);
    const legacyState = {
      schema: 1,
      host: "claude-code",
      disabledSkills: [{
        // No instanceKey, canonicalSkillMdPath, or discoveredViaSymlink —
        // exactly the shape an older version would have written.
        id: skill.id,
        pluginKey: null,
        skillMdPath: disabledPath,
        skillName: skill.name,
        source: "user",
        disabledAt: "2026-04-01T00:00:00.000Z",
        reason: "legacy",
      }],
    };
    await writeFile(statePath, JSON.stringify(legacyState));

    // loadState synthesizes instanceKey from (id, skillMdPath) and leaves
    // the new optional fields unset.
    const loaded = await loadState(statePath);
    assert.equal(loaded.disabledSkills.length, 1);
    assert.equal(loaded.disabledSkills[0]!.canonicalSkillMdPath, undefined);
    assert.equal(loaded.disabledSkills[0]!.discoveredViaSymlink, undefined);

    // enable proceeds as it always did: file is renamed back, record removed.
    const disabledSkill: Skill = { ...skill, isDisabled: true, skillMdPath: disabledPath };
    const result = await enableSkill(disabledSkill, { statePath });
    assert.equal(result.alreadyEnabled, false);
    assert.equal(await fileExists(skill.skillMdPath), true);
    assert.equal(await fileExists(disabledPath), false);
    const after = await loadState(statePath);
    assert.equal(after.disabledSkills.length, 0);
  } finally {
    await cleanup();
  }
});
