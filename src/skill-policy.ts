import type { Skill } from "./types.ts";

/**
 * Pure derivations from existing Skill fields that separate two distinct
 * permission questions:
 *
 *   1. canRouteSkill: are we allowed to READ the skill's SKILL.md (or its
 *      disabled marker) to surface it as a route match? This only requires a
 *      readable on-disk path, a non-conflicting state, and (for plugin skills)
 *      that the upstream plugin is still enabled. Mutation permission is
 *      irrelevant — the router only reads.
 *
 *   2. canMutateSkill: are we allowed to rename SKILL.md <->
 *      SKILL.md.agentic-skill-router-disabled to disable/enable this skill?
 *      This still gates on the on-disk `canDisable` flag computed at scan time
 *      (which already incorporates builtin protection and out-of-root symlink
 *      safety).
 *
 * Historically routing also required `canDisable`, which meant out-of-root
 * symlink skills (readable but not safely mutable) were silently excluded from
 * route results. Splitting the two concerns lets such skills still route while
 * keeping disable/enable refusal intact.
 */
export function canRouteSkill(skill: Skill): boolean {
  // No readable path means there is nothing to load (e.g. Claude Code's
  // bundled-into-binary builtin snapshot). These skills can be surfaced in
  // listings via their hand-maintained metadata, but the disabled-skill
  // router has no file to read, so they cannot route through this path.
  if (skill.skillMdPath === "") return false;
  // Split-brain on disk — both SKILL.md and the disabled marker exist. We
  // refuse to pick a winner until the user repairs the directory manually.
  if (skill.conflict) return false;
  // Upstream plugin was disabled in host settings; treat all of its skills
  // as offline regardless of their individual rename state.
  if (skill.isPluginDisabled) return false;
  return true;
}

/**
 * Mirror of the existing `canDisable` semantics. Callers that gate
 * disable/enable mutations should prefer this helper over reading the field
 * directly so the intent is explicit at the call site.
 */
export function canMutateSkill(skill: Skill): boolean {
  return skill.canDisable === true;
}
