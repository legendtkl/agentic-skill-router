import test from "node:test";
import assert from "node:assert/strict";
import { isRoutableDisabledSkill, routeDisabledSkills } from "../src/route.ts";
import { canMutateSkill, canRouteSkill } from "../src/skill-policy.ts";
import type { Skill } from "../src/types.ts";

function mkSkill(overrides: Partial<Skill> & { id: string; name: string; description: string }): Skill {
  return {
    source: "user",
    pluginKey: null,
    skillMdPath: `/tmp/${overrides.name}/SKILL.md`,
    isDisabled: false,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
    ...overrides,
  };
}

test("canRouteSkill: out-of-root disabled symlink routes even though it cannot be mutated", () => {
  const skill = mkSkill({
    id: "user:codex:external-tool",
    name: "external-tool",
    description: "Tool sourced from a symlink outside the skills root.",
    isDisabled: true,
    canDisable: false,
    outOfRoot: true,
    skillMdPath: "/tmp/external-tool/SKILL.md.agentic-skill-router-disabled",
  });

  // Routing is permitted because the disabled marker file is still readable.
  assert.equal(canRouteSkill(skill), true);
  // Mutation is refused because the on-disk skill lives behind a symlink the
  // user did not place under their skills root.
  assert.equal(canMutateSkill(skill), false);
  // The route-time predicate now agrees with canRouteSkill: previously it
  // also required canDisable, which silently dropped this skill from results.
  assert.equal(isRoutableDisabledSkill(skill), true);
});

test("canRouteSkill: out-of-root disabled symlink is INCLUDED in route matches", () => {
  const skills = [
    mkSkill({
      id: "user:codex:external-tool",
      name: "external-tool",
      description: "External symlinked skill for handling rare configuration audits.",
      isDisabled: true,
      canDisable: false,
      outOfRoot: true,
      skillMdPath: "/tmp/external-tool/SKILL.md.agentic-skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(skills, "configuration audit", { topK: 3 });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]!.skill.id, "user:codex:external-tool");
});

test("canRouteSkill: regular in-root disabled skill — both predicates true (regression guard)", () => {
  const skill = mkSkill({
    id: "user:codex:lark-mail",
    name: "lark-mail",
    description: "Lark mail workflows.",
    isDisabled: true,
    canDisable: true,
    skillMdPath: "/tmp/lark-mail/SKILL.md.agentic-skill-router-disabled",
  });
  assert.equal(canRouteSkill(skill), true);
  assert.equal(canMutateSkill(skill), true);
  assert.equal(isRoutableDisabledSkill(skill), true);
});

test("canRouteSkill: pathless builtin is NOT routable (nothing to read), and not mutable", () => {
  // Claude Code's bundled-into-binary builtins have skillMdPath="" — there is
  // no on-disk file to surface as a route match, so canRouteSkill is false.
  const skill = mkSkill({
    id: "builtin:review",
    name: "review",
    description: "Builtin review skill bundled with the host binary.",
    source: "builtin",
    canDisable: false,
    skillMdPath: "",
  });
  assert.equal(canRouteSkill(skill), false);
  assert.equal(canMutateSkill(skill), false);
});

test("canRouteSkill: builtin with on-disk path (Codex .system) is routable but not mutable", () => {
  // Codex's `.system/*` and `/etc/codex/skills/*` builtins are surfaced with
  // a real skillMdPath but canDisable=false. The router may read them; the
  // mutator must not rename them.
  const skill = mkSkill({
    id: "builtin:codex-system:openai-docs",
    name: "openai-docs",
    description: "Codex system skill bundled at install time.",
    source: "builtin",
    canDisable: false,
    skillMdPath: "/opt/codex/skills/.system/openai-docs/SKILL.md",
  });
  assert.equal(canRouteSkill(skill), true);
  assert.equal(canMutateSkill(skill), false);
});

test("canRouteSkill: conflicted skill is not routable until repaired", () => {
  const skill = mkSkill({
    id: "user:codex:lark-mail",
    name: "lark-mail",
    description: "Lark mail workflows.",
    isDisabled: false,
    conflict: true,
    skillMdPath: "/tmp/lark-mail/SKILL.md",
  });
  assert.equal(canRouteSkill(skill), false);
});

test("canRouteSkill: plugin-disabled skill is not routable", () => {
  const skill = mkSkill({
    id: "plugin:gmail@openai-curated:gmail",
    name: "gmail",
    description: "Gmail mailbox workflows.",
    source: "plugin",
    pluginKey: "gmail@openai-curated",
    isDisabled: true,
    isPluginDisabled: true,
    skillMdPath: "/tmp/gmail/SKILL.md.agentic-skill-router-disabled",
  });
  assert.equal(canRouteSkill(skill), false);
});
