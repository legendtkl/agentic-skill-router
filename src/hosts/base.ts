import type { HostName, Skill, UsageStat } from "../types.ts";

export interface Host {
  readonly name: HostName;
  listSkills(): Promise<Skill[]>;
  usageStats(): Promise<Map<string, UsageStat>>;
  skillRoots(): Promise<string[]>;
  disable(skill: Skill, reason: string): Promise<void>;
  enable(skill: Skill): Promise<void>;
}
