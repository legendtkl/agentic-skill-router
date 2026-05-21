export type HostName = "claude-code" | "codex";
export type RouteMode = "lexical" | "metadata" | "body" | "dci" | "auto";

export type SkillSource = "user" | "plugin" | "builtin";

export interface SkillMetadata {
  name: string;
  description: string;
  aliases?: string[];
  tags?: string[];
  tools?: string[];
  domains?: string[];
  intents?: string[];
  examples?: string[];
}

export interface Skill {
  /** stable global id, e.g. "user:lark-mail" or "plugin:codex@openai-codex:codex-cli-runtime" */
  id: string;
  /** display name from SKILL.md frontmatter */
  name: string;
  description: string;
  metadata?: SkillMetadata;
  source: SkillSource;
  /** "<plugin>@<marketplace>" when source==="plugin", else null */
  pluginKey: string | null;
  /** absolute path to SKILL.md (or to the disabled marker file when isDisabled); "" for builtin */
  skillMdPath: string;
  isDisabled: boolean;
  /** only meaningful when source==="plugin": upstream plugin disabled in enabledPlugins */
  isPluginDisabled: boolean;
  /** false for builtin skills (we cannot rename binary-bundled SKILL.md) */
  canDisable: boolean;
  /** both SKILL.md and SKILL.md.skill-router-disabled exist — needs repair */
  conflict: boolean;
  /**
   * True when the skill directory is a symlink whose realpath resolves outside
   * the skills root that contained it. The CLI still lists such skills for
   * visibility, but disable/enable refuses to act on them to avoid renaming
   * files in user directories the agent was never granted access to.
   */
  outOfRoot?: boolean;
}

export interface UsageStat {
  skillId: string;
  lastUsed: Date | null;
  callCount: number;
  firstSeen: Date | null;
}

export type SuggestionReason = "never-used" | "stale";
export type Confidence = "high" | "medium" | "low";

export interface Suggestion {
  skill: Skill;
  reason: SuggestionReason;
  confidence: Confidence;
  details: string;
  /**
   * True when the skill is a plugin whose `pluginShort` (part of pluginKey
   * before "@") collides with another installed plugin skill of the same
   * name (e.g. "plugin:codex@market-a:rescue" vs
   * "plugin:codex@market-b:rescue"). Transcript usage recorded as the short
   * form "codex:rescue" cannot be uniquely attributed in this case, so
   * usage-based reasoning falls back to "treat as never-used unless a
   * full-key record exists". Surfaced so CLI consumers can warn the user.
   */
  attributionAmbiguous?: boolean;
}

export interface DisableRecord {
  /**
   * Stable per-instance identity derived from `{id, skillMdPath}`. Two skills
   * with the same logical `id` but different on-disk locations are tracked as
   * separate instances under different `instanceKey` values. Legacy records
   * loaded from disk are synthesized on the fly when missing.
   */
  instanceKey: string;
  id: string;
  pluginKey: string | null;
  skillMdPath: string;
  skillName?: string;
  source?: SkillSource;
  disabledAt: string;
  reason: string;
}

/**
 * Two-phase intent journal entry. Written to state BEFORE the disk rename so
 * that a crash between the rename and the final state save can be reconciled
 * deterministically: the live + disabled file presence reveals whether the
 * rename completed, and the pending op tells us which final state the user
 * intended.
 */
export interface PendingOp {
  op: "disable" | "enable";
  id: string;
  livePath: string;
  disabledPath: string;
  startedAt: string;
  /** Snapshot of the disable record the caller intends to commit on success. */
  record?: DisableRecord;
  /**
   * Snapshot of any pre-existing disable record for this id at the moment the
   * pending op was written. Lets rollback restore the prior record instead of
   * silently dropping a still-valid user intent. Absent means there was no
   * pre-existing record.
   */
  priorRecord?: DisableRecord;
}

export interface RoutedSkillRecord {
  /** Stable per-instance identity, see {@link DisableRecord.instanceKey}. */
  instanceKey: string;
  id: string;
  pluginKey: string | null;
  skillMdPath: string;
  name: string;
  routeCount: number;
  firstRoutedAt: string;
  lastRoutedAt: string;
  lastQuery: string;
  lastConfidence: Confidence;
}

export interface State {
  schema: 1;
  host: HostName;
  disabledSkills: DisableRecord[];
  routedSkills?: RoutedSkillRecord[];
  /**
   * In-flight disable/enable intents that have not yet been committed. The
   * presence of an entry means a rename was either in progress or completed
   * but the final state save was interrupted. `status` reconciles these on
   * the next run.
   */
  pendingOps?: PendingOp[];
}

export interface Config {
  unusedForDays: number;
  routeMode: RouteMode;
  /**
   * Extra skill names to protect from the "suggest disable" policy.
   * Matches against `skill.name` for any source. Use this when you want to
   * keep a skill by display name regardless of where it came from.
   */
  keepNames?: string[];
  /**
   * Extra skill ids to protect from the "suggest disable" policy.
   * Matches against the canonical `skill.id` (e.g. `user:foo`, or
   * `plugin:<plugin>@<marketplace>:<name>`). Prefer this over `keepNames`
   * when you want to disambiguate between same-named skills from different
   * sources.
   */
  keepIds?: string[];
}

export class BuiltinSkillCannotDisableError extends Error {
  constructor(skillId: string) {
    super(`Cannot disable builtin skill "${skillId}" — this skill is protected and cannot be disabled.`);
    this.name = "BuiltinSkillCannotDisableError";
  }
}

export class SkillConflictError extends Error {
  constructor(skillId: string, livePath: string) {
    super(
      `Skill "${skillId}" is in a split-brain state: both ${livePath} and ` +
      `${livePath}.skill-router-disabled exist. Manually delete one (typically ` +
      `the .skill-router-disabled file if you want the skill enabled, or the ` +
      `live SKILL.md if you want it disabled) and retry.`,
    );
    this.name = "SkillConflictError";
  }
}

/**
 * Raised when disable/enable is asked to act on a skill whose realpath
 * resolves outside the skills root that discovered it (e.g. a symlink
 * targeting a directory the user did not put under their skills root).
 * Renaming through such a symlink would silently mutate the link target
 * elsewhere on the filesystem, which is almost never what the user wants.
 */
export class SkillOutOfRootError extends Error {
  constructor(skillId: string, skillMdPath: string) {
    super(
      `Refusing to modify skill "${skillId}": its SKILL.md (${skillMdPath}) ` +
      `resolves outside the skills root that discovered it. Skills that live ` +
      `via a symlink whose target is outside the skills root are visible but ` +
      `cannot be disabled or enabled by skill-router. Move the skill into a ` +
      `skills root (or replace the symlink with a real directory) and retry.`,
    );
    this.name = "SkillOutOfRootError";
  }
}
