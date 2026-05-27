import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUILTIN_SKILLS,
  BUILTIN_SKILLS_VERIFIED_AT,
  BUILTIN_SKILLS_VERSION,
  ClaudeCodeHost,
} from "../src/hosts/claude-code.ts";
import { projectSkill } from "../src/output.ts";
import type { UsageStat } from "../src/types.ts";

/**
 * Guards the drift policy added for issue #103: every builtin skill
 * surfaced by the Claude Code host must carry a `builtinListSource`
 * provenance struct, and the CLI projection used by `skills list --json`
 * must propagate it so consumers can detect stale snapshots without
 * having to import the constant directly.
 */
test("claude-code builtin skills carry the static-snapshot provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-claude-host-"));
  try {
    const host = new ClaudeCodeHost({
      claudeHome: join(root, ".claude"),
      projectsDir: join(root, ".claude", "projects"),
      cwd: root,
    });
    const skills = await host.listSkills();
    const builtins = skills.filter((s) => s.source === "builtin");
    assert.equal(
      builtins.length,
      BUILTIN_SKILLS.length,
      `expected ${BUILTIN_SKILLS.length} builtins, got ${builtins.length}`,
    );
    assert.ok(builtins.length > 0, "BUILTIN_SKILLS must not be empty");

    for (const b of builtins) {
      assert.ok(b.builtinListSource, `${b.id} missing builtinListSource`);
      assert.equal(b.builtinListSource?.kind, "static-snapshot");
      assert.equal(b.builtinListSource?.version, BUILTIN_SKILLS_VERSION);
      assert.equal(b.builtinListSource?.verifiedAt, BUILTIN_SKILLS_VERIFIED_AT);
    }

    // The verifiedAt constant should look like an ISO date so downstream
    // consumers can parse it directly. Bumping the format would be a
    // breaking change to the public JSON projection.
    assert.match(
      BUILTIN_SKILLS_VERIFIED_AT,
      /^\d{4}-\d{2}-\d{2}$/,
      "BUILTIN_SKILLS_VERIFIED_AT must be YYYY-MM-DD",
    );
    assert.ok(BUILTIN_SKILLS_VERSION.length > 0, "BUILTIN_SKILLS_VERSION must be non-empty");

    // The CLI projection used by `skills list --json` must forward the
    // field for builtin entries and omit it for non-builtin entries.
    const usage = new Map<string, UsageStat>();
    const projectedBuiltin = projectSkill(builtins[0]!, usage, skills);
    assert.ok(
      "builtinListSource" in projectedBuiltin,
      "projectSkill must surface builtinListSource for builtin skills",
    );
    assert.deepEqual(projectedBuiltin.builtinListSource, builtins[0]!.builtinListSource);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
