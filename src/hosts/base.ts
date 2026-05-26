import type { HostName, Skill, UsageDiagnostics, UsageStat } from "../types.ts";

/**
 * Options accepted by {@link Host.usageStats} and
 * {@link Host.usageStatsDetailed}. Hosts forward these through to
 * {@link import("../usage.ts").collectUsageStatsDetailed}.
 */
export interface HostUsageOptions {
  /**
   * Optional cutoff: transcripts older than `since` are skipped during the
   * parse pass. Directory enumeration is unaffected.
   */
  since?: Date | null;
}

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
  /**
   * Back-compat helper that returns only the usage map. New callers should
   * prefer {@link usageStatsDetailed} so the per-scan diagnostics survive.
   */
  usageStats(opts?: HostUsageOptions): Promise<Map<string, UsageStat>>;
  /**
   * Returns both the usage map and a {@link UsageDiagnostics} record
   * describing the scan (files enumerated, parsed, served from cache,
   * directories skipped due to permission errors, and wall-clock duration).
   */
  usageStatsDetailed(opts?: HostUsageOptions): Promise<{
    usage: Map<string, UsageStat>;
    diagnostics: UsageDiagnostics;
  }>;
  skillRoots(): Promise<string[]>;
}
