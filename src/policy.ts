import { lookupUsage, lookupUsageStrict } from "./usage.ts";
import type { Skill, Suggestion, UsageStat } from "./types.ts";

/**
 * Skills that should never be suggested for disabling, regardless of usage.
 * Either the user can't disable them (builtins), or they're meta-tools the
 * user is unlikely to want gone (like skill-router itself).
 */
export const ALWAYS_KEEP: ReadonlySet<string> = new Set([
  "init",
  "review",
  "security-review",
  "update-config",
  "skill-router-skills",
]);

export interface PolicyOptions {
  unusedForDays: number;
  /** Override the "now" reference for deterministic tests. */
  now?: Date;
}

export function suggest(
  skills: Skill[],
  usage: Map<string, UsageStat>,
  opts: PolicyOptions,
): Suggestion[] {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - opts.unusedForDays * 24 * 60 * 60 * 1000);
  const out: Suggestion[] = [];

  for (const skill of skills) {
    if (!skill.canDisable) continue;          // builtins
    if (skill.isDisabled) continue;           // already disabled
    if (skill.isPluginDisabled) continue;     // whole plugin off, no point per-skill
    if (skill.conflict) continue;             // split-brain — resolve first
    if (ALWAYS_KEEP.has(skill.name)) continue;

    // Strict lookup: don't fall through to a sibling's bare-name usage when
    // multiple skills share the same name (would mask a true never-used).
    const u = lookupUsageStrict(skill, usage, skills);
    if (!u || u.callCount === 0 || !u.lastUsed) {
      out.push({
        skill,
        reason: "never-used",
        confidence: "high",
        details: "no invocations found in transcripts",
      });
      continue;
    }
    if (u.lastUsed < cutoff) {
      const days = Math.floor((now.getTime() - u.lastUsed.getTime()) / (24 * 60 * 60 * 1000));
      out.push({
        skill,
        reason: "stale",
        confidence: "medium",
        details: `last used ${days} days ago (${u.callCount} total calls)`,
      });
    }
  }

  // Sort: high confidence first, then within same confidence by oldest-last-used
  out.sort((a, b) => {
    const cw = confidenceWeight(b.confidence) - confidenceWeight(a.confidence);
    if (cw !== 0) return cw;
    const aLast = lookupUsage(a.skill, usage)?.lastUsed?.getTime() ?? 0;
    const bLast = lookupUsage(b.skill, usage)?.lastUsed?.getTime() ?? 0;
    return aLast - bLast;
  });
  return out;
}

function confidenceWeight(c: "high" | "medium" | "low"): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}
