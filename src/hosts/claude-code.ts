import { homedir } from "node:os";
import { join } from "node:path";
import type { Host, HostUsageOptions } from "./base.ts";
import { projectSkillRoots } from "./project.ts";
import type { Skill, UsageDiagnostics, UsageStat } from "../types.ts";
import {
  buildStrictProjectWalkOpts,
  readClaudeSettings,
  readInstalledPlugins,
  readSkillFrontmatterDetailed,
  reportEscapedProjectEntries,
  walkSkillsDir,
} from "../scan.ts";
import { collectUsageStatsDetailed } from "../usage.ts";

/**
 * Skills built into the Claude Code binary itself. We can't reach their
 * SKILL.md files, so they're not disable-able. Listed here so the policy
 * module can mark them as `canDisable: false` and skip them in suggestions.
 *
 * Drift policy
 * ------------
 * Claude Code does not expose a queryable inventory of its built-in skills,
 * so this list is a hand-maintained snapshot. {@link BUILTIN_SKILLS_VERSION}
 * and {@link BUILTIN_SKILLS_VERIFIED_AT} document when it was last checked
 * and surface in `skills list --json` via the per-skill `builtinListSource`
 * field. When Claude Code adds or removes builtins, update both constants
 * together — see `scripts/update-claude-builtin-skills.mjs` for the
 * maintainer checklist, and the "Claude Code builtin skill list policy"
 * section of the README.
 *
 * Last verified: 2026-05-26 against Claude Code 2.x.
 */
export const BUILTIN_SKILLS_VERSION = "claude-code@2.x";
export const BUILTIN_SKILLS_VERIFIED_AT = "2026-05-26";

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
  /**
   * When set, project-scope skill scans run in strict-mode TOCTOU narrowing
   * (#133): the project skills root is realpath-ed and any per-skill entry
   * whose realpath escapes that canonical is dropped from results (instead
   * of surfacing with `outOfRoot=true`). The value is the canonical project
   * path captured at validation time by the web allowlist
   * (`src/commands/web.ts`). Unset means default CLI behaviour.
   */
  enforceProjectScopeCanonical?: string;
}

export class ClaudeCodeHost implements Host {
  readonly name = "claude-code" as const;
  private readonly claudeHome: string;
  private readonly projectsDir: string;
  private readonly cwd: string;
  private readonly enforceProjectScopeCanonical: string | undefined;

  constructor(opts: ClaudeCodeHostOptions = {}) {
    this.claudeHome = opts.claudeHome ?? join(homedir(), ".claude");
    this.projectsDir = opts.projectsDir ?? join(this.claudeHome, "projects");
    this.cwd = opts.cwd ?? process.env["AGENTIC_SKILL_ROUTER_CWD"] ?? process.cwd();
    this.enforceProjectScopeCanonical = opts.enforceProjectScopeCanonical;
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
    //
    // When the web allowlist set `enforceProjectScopeCanonical`, every
    // project skill root we visit gets the strict-mode `walkSkillsDir`
    // contract (#133): we realpath the skills-root container itself, hand
    // that canonical to the walker, and supply an `escaped` sink so any
    // per-skill entry whose realpath escapes the canonical is DROPPED
    // instead of surfaced with `outOfRoot=true`. Default CLI flows leave
    // `enforceProjectScopeCanonical` unset and retain legacy behaviour.
    for (const projectRoot of await projectSkillRoots(this.cwd, ".claude/skills")) {
      const walkOpts = await buildStrictProjectWalkOpts(projectRoot.root, this.enforceProjectScopeCanonical);
      const projectSkills = await walkSkillsDir(projectRoot.root, async (skillName, skillMdPath, isDisabled, conflict, outOfRoot) => {
        const { metadata: fm, warnings } = await readSkillFrontmatterDetailed(skillMdPath);
        return {
          id: `project:claude:${projectRoot.relativeDir}:${skillName}`,
          name: fm.name || skillName,
          description: fm.description,
          metadata: fm,
          source: "project",
          pluginKey: null,
          skillMdPath,
          isDisabled,
          isPluginDisabled: false,
          canDisable: !outOfRoot,
          conflict,
          outOfRoot,
          ...(warnings.length > 0 ? { frontmatterWarnings: warnings } : {}),
        };
      }, walkOpts);
      if (walkOpts.escaped && walkOpts.escaped.length > 0) {
        reportEscapedProjectEntries(projectRoot.root, walkOpts.escaped);
      }
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
        builtinListSource: {
          kind: "static-snapshot",
          version: BUILTIN_SKILLS_VERSION,
          verifiedAt: BUILTIN_SKILLS_VERIFIED_AT,
        },
      });
    }

    return out;
  }

  async usageStats(opts: HostUsageOptions = {}): Promise<Map<string, UsageStat>> {
    return (await this.usageStatsDetailed(opts)).usage;
  }

  async usageStatsDetailed(
    opts: HostUsageOptions = {},
  ): Promise<{ usage: Map<string, UsageStat>; diagnostics: UsageDiagnostics }> {
    return collectUsageStatsDetailed(this.projectsDir, {
      host: this.name,
      ...(opts.since !== undefined ? { since: opts.since } : {}),
    });
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

}
