import { rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Host } from "./base.ts";
import { projectSkillRoots } from "./project.ts";
import type { Skill, UsageStat } from "../types.ts";
import { BuiltinSkillCannotDisableError, SkillOutOfRootError } from "../types.ts";
import {
  DISABLED_SUFFIX,
  readClaudeSettings,
  readInstalledPlugins,
  readSkillFrontmatterDetailed,
  walkSkillsDir,
} from "../scan.ts";
import { collectUsageStats } from "../usage.ts";

/**
 * Skills built into the Claude Code binary itself. We can't reach their
 * SKILL.md files, so they're not disable-able. Listed here so the policy
 * module can mark them as `canDisable: false` and skip them in suggestions.
 */
export const BUILTIN_SKILLS: ReadonlyArray<{ name: string; description: string }> = [
  { name: "init", description: "Initialize a new CLAUDE.md file with codebase documentation" },
  { name: "review", description: "Review a pull request" },
  { name: "security-review", description: "Complete a security review of pending changes" },
  { name: "update-config", description: "Configure the Claude Code harness via settings.json" },
  { name: "keybindings-help", description: "Customize keyboard shortcuts in ~/.claude/keybindings.json" },
  { name: "simplify", description: "Review changed code for reuse, quality, efficiency" },
  { name: "fewer-permission-prompts", description: "Add allowlist to project .claude/settings.json" },
  { name: "loop", description: "Run a prompt or slash command on a recurring interval" },
  { name: "schedule", description: "Create, update, list, or run scheduled remote agents" },
  { name: "claude-api", description: "Build, debug, optimize Claude API / Anthropic SDK apps" },
];

export interface ClaudeCodeHostOptions {
  claudeHome?: string;
  /** transcripts root, defaults to <claudeHome>/projects */
  projectsDir?: string;
  /** current project directory for .claude/skills discovery */
  cwd?: string;
}

export class ClaudeCodeHost implements Host {
  readonly name = "claude-code" as const;
  private readonly claudeHome: string;
  private readonly projectsDir: string;
  private readonly cwd: string;

  constructor(opts: ClaudeCodeHostOptions = {}) {
    this.claudeHome = opts.claudeHome ?? join(homedir(), ".claude");
    this.projectsDir = opts.projectsDir ?? join(this.claudeHome, "projects");
    this.cwd = opts.cwd ?? process.env["SKILL_ROUTER_CWD"] ?? process.cwd();
  }

  async listSkills(): Promise<Skill[]> {
    const out: Skill[] = [];

    // 1. User-level skills (npx skills add ... -g): ~/.claude/skills/
    const userSkillsRoot = join(this.claudeHome, "skills");
    const userSkills = await walkSkillsDir(userSkillsRoot, async (skillName, skillMdPath, isDisabled, conflict, outOfRoot) => {
      const { metadata: fm, warnings } = await readSkillFrontmatterDetailed(skillMdPath);
      return {
        id: `user:${skillName}`,
        name: fm.name || skillName,
        description: fm.description,
        metadata: fm,
        source: "user",
        pluginKey: null,
        skillMdPath,
        isDisabled,
        isPluginDisabled: false,
        canDisable: !outOfRoot,
        conflict,
        outOfRoot,
        ...(warnings.length > 0 ? { frontmatterWarnings: warnings } : {}),
      };
    });
    out.push(...userSkills);

    // 2. Project-level skills from CWD up to the repository root:
    // <repo>/.claude/skills and nested <repo>/<subdir>/.claude/skills.
    for (const projectRoot of await projectSkillRoots(this.cwd, ".claude/skills")) {
      const projectSkills = await walkSkillsDir(projectRoot.root, async (skillName, skillMdPath, isDisabled, conflict, outOfRoot) => {
        const { metadata: fm, warnings } = await readSkillFrontmatterDetailed(skillMdPath);
        return {
          id: `project:claude:${projectRoot.relativeDir}:${skillName}`,
          name: fm.name || skillName,
          description: fm.description,
          metadata: fm,
          source: "user",
          pluginKey: null,
          skillMdPath,
          isDisabled,
          isPluginDisabled: false,
          canDisable: !outOfRoot,
          conflict,
          outOfRoot,
          ...(warnings.length > 0 ? { frontmatterWarnings: warnings } : {}),
        };
      });
      out.push(...projectSkills);
    }

    // 3. Plugin-level skills
    const installedPluginsPath = join(this.claudeHome, "plugins", "installed_plugins.json");
    const installed = await readInstalledPlugins(installedPluginsPath);
    const settings = await readClaudeSettings(join(this.claudeHome, "settings.json"));
    const enabledPlugins = settings.enabledPlugins ?? {};

    for (const plugin of installed) {
      const isPluginDisabled = enabledPlugins[plugin.pluginKey] === false;
      const skillsRoot = join(plugin.installPath, "skills");
      const pluginSkills = await walkSkillsDir(skillsRoot, async (skillName, skillMdPath, isDisabled, conflict, outOfRoot) => {
        const { metadata: fm, warnings } = await readSkillFrontmatterDetailed(skillMdPath);
        return {
          id: `plugin:${plugin.pluginKey}:${skillName}`,
          name: fm.name || skillName,
          description: fm.description,
          metadata: fm,
          source: "plugin",
          pluginKey: plugin.pluginKey,
          skillMdPath,
          isDisabled,
          isPluginDisabled,
          canDisable: !outOfRoot,
          conflict,
          outOfRoot,
          ...(warnings.length > 0 ? { frontmatterWarnings: warnings } : {}),
        };
      });
      out.push(...pluginSkills);
    }

    // 4. Built-in skills (cannot be disabled)
    for (const b of BUILTIN_SKILLS) {
      out.push({
        id: `builtin:${b.name}`,
        name: b.name,
        description: b.description,
        source: "builtin",
        pluginKey: null,
        skillMdPath: "",
        isDisabled: false,
        isPluginDisabled: false,
        canDisable: false,
        conflict: false,
      });
    }

    return out;
  }

  async usageStats(): Promise<Map<string, UsageStat>> {
    return collectUsageStats(this.projectsDir);
  }

  async skillRoots(): Promise<string[]> {
    const roots = [join(this.claudeHome, "skills")];
    for (const projectRoot of await projectSkillRoots(this.cwd, ".claude/skills")) {
      roots.push(projectRoot.root);
    }
    const installed = await readInstalledPlugins(join(this.claudeHome, "plugins", "installed_plugins.json"));
    for (const plugin of installed) roots.push(join(plugin.installPath, "skills"));
    return roots;
  }

  async disable(skill: Skill, _reason: string): Promise<void> {
    // Check outOfRoot before canDisable so that the more specific
    // "resolves outside the skills root" error wins for symlink escapes,
    // even though out-of-root skills now also report canDisable=false.
    if (skill.outOfRoot) throw new SkillOutOfRootError(skill.id, skill.skillMdPath);
    if (!skill.canDisable) throw new BuiltinSkillCannotDisableError(skill.id);
    if (skill.isDisabled) return; // idempotent
    const target = skill.skillMdPath + DISABLED_SUFFIX;
    await rename(skill.skillMdPath, target);
  }

  async enable(skill: Skill): Promise<void> {
    if (skill.outOfRoot) throw new SkillOutOfRootError(skill.id, skill.skillMdPath);
    if (!skill.canDisable) return; // builtins are never disabled
    if (!skill.isDisabled) return; // idempotent
    if (!skill.skillMdPath.endsWith(DISABLED_SUFFIX)) return;
    const target = skill.skillMdPath.slice(0, -DISABLED_SUFFIX.length);
    await rename(skill.skillMdPath, target);
  }
}
