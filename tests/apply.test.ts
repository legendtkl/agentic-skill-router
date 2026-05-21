import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disableSkill, enableSkill, enableSkillFromState, findOrphanMarkers, reapplyMissing } from "../src/apply.ts";
import { loadState } from "../src/state.ts";
import type { Skill } from "../src/types.ts";

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
