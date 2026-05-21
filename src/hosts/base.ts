import type { HostName, Skill, UsageStat } from "../types.ts";

/**
 * A `Host` is responsible solely for discovering skills and reporting their
 * usage. Mutating disk state (disable/enable, with state-file journaling,
 * locking, conflict handling, and reapply on plugin upgrade) is the
 * responsibility of `src/apply.ts`. Hosts intentionally do NOT expose disable
 * or enable — every caller must funnel through `apply.ts` so the state machine
 * stays the single source of truth and safety checks (out-of-root, builtin,
 * conflict) cannot be bypassed by renaming SKILL.md directly through a host.
 */
export interface Host {
  readonly name: HostName;
  listSkills(): Promise<Skill[]>;
  usageStats(): Promise<Map<string, UsageStat>>;
  skillRoots(): Promise<string[]>;
}
