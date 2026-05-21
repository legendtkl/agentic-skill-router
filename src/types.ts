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
}

export interface DisableRecord {
  id: string;
  pluginKey: string | null;
  skillMdPath: string;
  skillName?: string;
  source?: SkillSource;
  disabledAt: string;
  reason: string;
}

export interface RoutedSkillRecord {
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
}

export interface Config {
  unusedForDays: number;
  routeMode: RouteMode;
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
