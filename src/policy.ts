import { isPluginShortAmbiguous, lookupUsage, lookupUsageStrict } from "./usage.ts";
import type { Skill, Suggestion, UsageStat } from "./types.ts";

/**
 * The agentic-skill-router plugin's own routing skill. We never want to suggest the
 * tool that powers this command for disabling — match it by the stable
 * (pluginKey, name) tuple rather than by bare name so a user-authored skill
 * with the same display name is NOT auto-kept.
 */
const AGENTIC_SKILL_ROUTER_PLUGIN_KEY_PREFIX = "agentic-skill-router@";
const AGENTIC_SKILL_ROUTER_WORKFLOW_NAME = "agentic-skill-router-skills";

function isSkillRouterOwnSkill(skill: Skill): boolean {
  return (
    skill.source === "plugin" &&
    skill.pluginKey !== null &&
    skill.pluginKey.startsWith(AGENTIC_SKILL_ROUTER_PLUGIN_KEY_PREFIX) &&
    skill.name === AGENTIC_SKILL_ROUTER_WORKFLOW_NAME
  );
}

export interface PolicyOptions {
  unusedForDays: number;
  /** Override the "now" reference for deterministic tests. */
  now?: Date;
  /** Extra skill names to protect from disable suggestions. */
  keepNames?: readonly string[] | undefined;
  /** Extra skill ids to protect from disable suggestions. */
  keepIds?: readonly string[] | undefined;
}

export function suggest(
  skills: Skill[],
  usage: Map<string, UsageStat>,
  opts: PolicyOptions,
): Suggestion[] {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - opts.unusedForDays * 24 * 60 * 60 * 1000);
  const keepNames = new Set(opts.keepNames ?? []);
  const keepIds = new Set(opts.keepIds ?? []);
  const out: Suggestion[] = [];

  for (const skill of skills) {
    if (!skill.canDisable) continue;          // builtins
    if (skill.isDisabled) continue;           // already disabled
    if (skill.isPluginDisabled) continue;     // whole plugin off, no point per-skill
    if (skill.conflict) continue;             // split-brain — resolve first
    // Protect agentic-skill-router's own routing skill (only the plugin instance, not
    // user-authored skills that happen to share the name).
    if (isSkillRouterOwnSkill(skill)) continue;
    // Config-driven allowlists.
    if (keepIds.has(skill.id)) continue;
    if (keepNames.has(skill.name)) continue;

    // Strict lookup: don't fall through to a sibling's bare-name usage when
    // multiple skills share the same name (would mask a true never-used).
    const u = lookupUsageStrict(skill, usage, skills);
    const ambiguous = isPluginShortAmbiguous(skill, skills);
    if (!u || u.callCount === 0 || !u.lastUsed) {
      const details = ambiguous
        ? "no invocations found in transcripts (plugin-short attribution ambiguous; usage recorded under the bare 'pluginShort:name' form is shared with another plugin skill of the same name)"
        : "no invocations found in transcripts";
      const sugg: Suggestion = {
        skill,
        reason: "never-used",
        confidence: ambiguous ? "low" : "high",
        details,
      };
      if (ambiguous) sugg.attributionAmbiguous = true;
      out.push(sugg);
      continue;
    }
    if (u.lastUsed < cutoff) {
      const days = Math.floor((now.getTime() - u.lastUsed.getTime()) / (24 * 60 * 60 * 1000));
      const sugg: Suggestion = {
        skill,
        reason: "stale",
        confidence: "medium",
        details: `last used ${days} days ago (${u.callCount} total calls)`,
      };
      if (ambiguous) sugg.attributionAmbiguous = true;
      out.push(sugg);
    }
  }

  // Sort: high confidence first, then within same confidence by oldest-last-used
  out.sort((a, b) => {
    const cw = confidenceWeight(b.confidence) - confidenceWeight(a.confidence);
    if (cw !== 0) return cw;
    const aLast = lookupUsage(a.skill, usage, skills)?.lastUsed?.getTime() ?? 0;
    const bLast = lookupUsage(b.skill, usage, skills)?.lastUsed?.getTime() ?? 0;
    return aLast - bLast;
  });
  return out;
}

function confidenceWeight(c: "high" | "medium" | "low"): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}
