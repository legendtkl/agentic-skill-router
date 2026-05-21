import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile, rename } from "node:fs/promises";
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
  const workdir = await mkdtemp(join(tmpdir(), "skill-router-apply-"));
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
    assert.equal(await fileExists(skill.skillMdPath + ".skill-router-disabled"), true);
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
    const disabledSkill = { ...skill, isDisabled: true, skillMdPath: skill.skillMdPath + ".skill-router-disabled" };
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
    const disabledSkill = { ...skill, isDisabled: true, skillMdPath: skill.skillMdPath + ".skill-router-disabled" };
    const result = await enableSkill(disabledSkill, { statePath });
    assert.equal(result.alreadyEnabled, false);
    assert.equal(await fileExists(skill.skillMdPath), true);
    assert.equal(await fileExists(skill.skillMdPath + ".skill-router-disabled"), false);
    assert.equal(result.state.disabledSkills.length, 0);
  } finally {
    await cleanup();
  }
});

test("enableSkillFromState cleans orphan record when both files are gone", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    await rm(skill.skillMdPath + ".skill-router-disabled");

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
    assert.equal(await fileExists(skill.skillMdPath + ".skill-router-disabled"), false);
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
    assert.equal(await fileExists(skill.skillMdPath + ".skill-router-disabled"), true);
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
    await rename(skill.skillMdPath + ".skill-router-disabled", skill.skillMdPath);
    assert.equal(await fileExists(skill.skillMdPath), true);

    const result = await reapplyMissing({ statePath });
    assert.deepEqual(result.reapplied, ["user:foo"]);
    assert.deepEqual(result.orphaned, []);
    assert.equal(await fileExists(skill.skillMdPath + ".skill-router-disabled"), true);
  } finally {
    await cleanup();
  }
});

test("reapplyMissing reports orphans when SKILL.md is gone entirely", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    await disableSkill(skill, "manual", { statePath });
    await rm(skill.skillMdPath + ".skill-router-disabled");

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
    await rm(skill.skillMdPath + ".skill-router-disabled");

    const upgradedDir = join(workdir, "skills/foo-v2");
    await mkdir(upgradedDir, { recursive: true });
    const upgradedLive = join(upgradedDir, "SKILL.md");
    await writeFile(upgradedLive, "new live\n");
    const upgradedSkill: Skill = { ...skill, skillMdPath: upgradedLive };

    const result = await reapplyMissing({ statePath, skills: [upgradedSkill] });
    assert.deepEqual(result.reapplied, ["user:foo"]);
    assert.deepEqual(result.orphaned, []);
    assert.equal(await fileExists(upgradedLive), false);
    assert.equal(await fileExists(upgradedLive + ".skill-router-disabled"), true);
    const state = await loadState(statePath);
    assert.equal(state.disabledSkills[0]?.skillMdPath, upgradedLive + ".skill-router-disabled");
  } finally {
    await cleanup();
  }
});

test("disable refuses when both SKILL.md and SKILL.md.skill-router-disabled exist", async () => {
  const { skill, statePath, cleanup } = await setup();
  try {
    // Create the disabled marker alongside the live file (split-brain)
    await writeFile(skill.skillMdPath + ".skill-router-disabled", "stale\n");
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
    assert.equal(await fileExists(skill.skillMdPath + ".skill-router-disabled"), true);
    void workdir;
  } finally {
    await cleanup();
  }
});

test("findOrphanMarkers detects disabled SKILL.md without state record", async () => {
  const { workdir, statePath, cleanup } = await setup();
  try {
    // Create a fully-orphaned skill: disabled marker, no state record at all
    const orphanDir = join(workdir, "skills/orphan");
    await mkdir(orphanDir, { recursive: true });
    const orphanPath = join(orphanDir, "SKILL.md.skill-router-disabled");
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
    const disabledSkill = { ...skill, isDisabled: true, skillMdPath: skill.skillMdPath + ".skill-router-disabled" };
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
    const disabledPath = skill.skillMdPath + ".skill-router-disabled";
    await rename(skill.skillMdPath, disabledPath);

    const pending: PendingOp = {
      op: "disable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath,
      startedAt: "2026-05-22T00:00:00.000Z",
      record: {
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
      op: "disable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath: skill.skillMdPath + ".skill-router-disabled",
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
      id: skill.id,
      pluginKey: skill.pluginKey,
      skillMdPath: skill.skillMdPath + ".skill-router-disabled",
      skillName: skill.name,
      source: skill.source,
      disabledAt: "2026-05-22T00:00:00.000Z",
      reason: "manual",
    } as const;
    const pending: PendingOp = {
      op: "disable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath: skill.skillMdPath + ".skill-router-disabled",
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
    const disabledPath = skill.skillMdPath + ".skill-router-disabled";

    // Manually rebuild the "post-rename, pre-final-save" state: disable
    // record still present, pending enable intent recorded, live SKILL.md
    // restored on disk, disabled marker removed.
    await rename(disabledPath, skill.skillMdPath);
    const stateAfterCrash = await loadState(statePath);
    assert.equal(stateAfterCrash.disabledSkills.length, 1);
    const pending: PendingOp = {
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
    const disabledPath = skill.skillMdPath + ".skill-router-disabled";
    await writeFile(skill.skillMdPath, "live again\n");

    const stateAfterCrash = await loadState(statePath);
    const pending: PendingOp = {
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
    const disabledPath = skill.skillMdPath + ".skill-router-disabled";

    // Enable intent was journaled, but the rename never ran: disabled marker
    // still present, live file still absent, disable record still present.
    const stateAfterCrash = await loadState(statePath);
    const pending: PendingOp = {
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
    const disabledPath = skill.skillMdPath + ".skill-router-disabled";
    await writeFile(disabledPath, "stale\n");
    const pending: PendingOp = {
      op: "disable",
      id: skill.id,
      livePath: skill.skillMdPath,
      disabledPath,
      startedAt: "2026-05-22T00:00:00.000Z",
      record: {
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
    const disabledPath = skill.skillMdPath + ".skill-router-disabled";
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
    assert.equal(await fileExists(skill.skillMdPath + ".skill-router-disabled"), false);
    // No state record should have been written.
    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 0);
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
  const workdir = await mkdtemp(join(tmpdir(), "skill-router-apply-multi-"));
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
    assert.equal(state.disabledSkills[0]!.skillMdPath, skillA.skillMdPath + ".skill-router-disabled");
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
    const disabledA = { ...skillA, isDisabled: true, skillMdPath: skillA.skillMdPath + ".skill-router-disabled" };
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
  // Regression guard: host-level listSkills() now marks out-of-root symlink
  // skills with canDisable=false, so if disableSkill checked canDisable first
  // it would surface a misleading "builtin" error and hide the real
  // remediation path. The outOfRoot guard must fire first to match the
  // host-level disable() ordering.
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
        assert.match(msg, /skill-router skills enable /);
        assert.doesNotMatch(msg, /--instance-key/);
        const keyA = skillInstanceKey(skillA.id, skillA.skillMdPath);
        const keyB = skillInstanceKey(skillB.id, skillB.skillMdPath);
        assert.match(msg, new RegExp(`skill-router skills enable ${keyA}\\b`));
        assert.match(msg, new RegExp(`skill-router skills enable ${keyB}\\b`));
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
    assert.equal(await fileExists(skillB.skillMdPath + ".skill-router-disabled"), true);

    const state = await loadState(statePath);
    assert.equal(state.disabledSkills.length, 1);
    assert.equal(state.disabledSkills[0]!.skillMdPath, skillB.skillMdPath + ".skill-router-disabled");
  } finally {
    await cleanup();
  }
});
