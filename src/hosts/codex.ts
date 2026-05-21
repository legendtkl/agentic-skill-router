import { readdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Host } from "./base.ts";
import { projectSkillRoots } from "./project.ts";
import type { Skill, UsageStat } from "../types.ts";
import { BuiltinSkillCannotDisableError, SkillOutOfRootError } from "../types.ts";
import {
  compareVersions,
  DISABLED_SUFFIX,
  readCodexPluginSettings,
  readSkillFrontmatterDetailed,
  walkSkillsDir,
} from "../scan.ts";
import { collectUsageStats } from "../usage.ts";

export interface CodexHostOptions {
  codexHome?: string;
  agentsHome?: string;
  sessionsDir?: string;
  /** current project directory for .agents/skills discovery */
  cwd?: string;
  /** protected admin-level skills root, defaults to /etc/codex/skills */
  adminSkillsRoot?: string;
}

interface CodexPluginInstall {
  pluginKey: string;
  installPath: string;
  skillsRoot: string;
  version: string;
}

interface CodexPluginManifest {
  name?: unknown;
  version?: unknown;
  skills?: unknown;
}

export class CodexHost implements Host {
  readonly name = "codex" as const;
  private readonly codexHome: string;
  private readonly agentsHome: string;
  private readonly sessionsDir: string;
  private readonly cwd: string;
  private readonly adminSkillsRoot: string;

  constructor(opts: CodexHostOptions = {}) {
    this.codexHome = opts.codexHome ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
    this.agentsHome = opts.agentsHome ?? process.env["AGENTS_HOME"] ?? join(homedir(), ".agents");
    this.sessionsDir = opts.sessionsDir ?? join(this.codexHome, "sessions");
    this.cwd = opts.cwd ?? process.env["SKILL_ROUTER_CWD"] ?? process.cwd();
    this.adminSkillsRoot = opts.adminSkillsRoot ?? process.env["CODEX_ADMIN_SKILLS_ROOT"] ?? "/etc/codex/skills";
  }

  async listSkills(): Promise<Skill[]> {
    const out: Skill[] = [];

    out.push(...await this.listRootSkills({
      root: join(this.codexHome, "skills"),
      idPrefix: "user:codex",
      source: "user",
      canDisable: true,
    }));
    out.push(...await this.listRootSkills({
      root: join(this.agentsHome, "skills"),
      idPrefix: "user:agents",
      source: "user",
      canDisable: true,
    }));
    out.push(...await this.listRootSkills({
      root: join(this.codexHome, "skills", ".system"),
      idPrefix: "builtin:codex-system",
      source: "builtin",
      canDisable: false,
    }));
    out.push(...await this.listRootSkills({
      root: this.adminSkillsRoot,
      idPrefix: "builtin:codex-admin",
      source: "builtin",
      canDisable: false,
    }));

    for (const projectRoot of await projectSkillRoots(this.cwd, ".agents/skills")) {
      out.push(...await this.listRootSkills({
        root: projectRoot.root,
        idPrefix: `project:codex:${projectRoot.relativeDir}`,
        source: "user",
        canDisable: true,
      }));
    }

    const enabledPlugins = (await readCodexPluginSettings(join(this.codexHome, "config.toml"))).enabledPlugins ?? {};
    for (const plugin of await this.installedPlugins()) {
      const isPluginDisabled = enabledPlugins[plugin.pluginKey] === false;
      const pluginSkills = await walkSkillsDir(plugin.skillsRoot, async (skillName, skillMdPath, isDisabled, conflict, outOfRoot) => {
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

    return out;
  }

  async usageStats(): Promise<Map<string, UsageStat>> {
    return collectUsageStats(this.sessionsDir);
  }

  async skillRoots(): Promise<string[]> {
    const roots = [
      join(this.codexHome, "skills"),
      join(this.agentsHome, "skills"),
      join(this.codexHome, "skills", ".system"),
      this.adminSkillsRoot,
    ];
    for (const projectRoot of await projectSkillRoots(this.cwd, ".agents/skills")) roots.push(projectRoot.root);
    for (const plugin of await this.installedPlugins()) roots.push(plugin.skillsRoot);
    return roots;
  }

  async disable(skill: Skill, _reason: string): Promise<void> {
    // Check outOfRoot before canDisable so that the more specific
    // "resolves outside the skills root" error wins for symlink escapes,
    // even though out-of-root skills now also report canDisable=false.
    if (skill.outOfRoot) throw new SkillOutOfRootError(skill.id, skill.skillMdPath);
    if (!skill.canDisable) throw new BuiltinSkillCannotDisableError(skill.id);
    if (skill.isDisabled) return;
    await rename(skill.skillMdPath, skill.skillMdPath + DISABLED_SUFFIX);
  }

  async enable(skill: Skill): Promise<void> {
    if (skill.outOfRoot) throw new SkillOutOfRootError(skill.id, skill.skillMdPath);
    if (!skill.canDisable) return;
    if (!skill.isDisabled) return;
    if (!skill.skillMdPath.endsWith(DISABLED_SUFFIX)) return;
    await rename(skill.skillMdPath, skill.skillMdPath.slice(0, -DISABLED_SUFFIX.length));
  }

  private async listRootSkills(opts: {
    root: string;
    idPrefix: string;
    source: "user" | "builtin";
    canDisable: boolean;
  }): Promise<Skill[]> {
    return walkSkillsDir(opts.root, async (skillName, skillMdPath, isDisabled, conflict, outOfRoot) => {
      const { metadata: fm, warnings } = await readSkillFrontmatterDetailed(skillMdPath);
      return {
        id: `${opts.idPrefix}:${skillName}`,
        name: fm.name || skillName,
        description: fm.description,
        metadata: fm,
        source: opts.source,
        pluginKey: null,
        skillMdPath,
        isDisabled,
        isPluginDisabled: false,
        canDisable: opts.canDisable && !outOfRoot,
        conflict,
        outOfRoot,
        ...(warnings.length > 0 ? { frontmatterWarnings: warnings } : {}),
      };
    });
  }

  private async installedPlugins(): Promise<CodexPluginInstall[]> {
    const cacheRoot = join(this.codexHome, "plugins", "cache");
    let marketplaces;
    try {
      marketplaces = await readdir(cacheRoot, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const byPluginKey = new Map<string, CodexPluginInstall>();
    for (const marketplace of marketplaces) {
      if (!marketplace.isDirectory() || marketplace.name.startsWith(".")) continue;
      const marketplacePath = join(cacheRoot, marketplace.name);
      let plugins;
      try {
        plugins = await readdir(marketplacePath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const pluginDir of plugins) {
        if (!pluginDir.isDirectory() || pluginDir.name.startsWith(".")) continue;
        const pluginPath = join(marketplacePath, pluginDir.name);
        let versions;
        try {
          versions = await readdir(pluginPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const versionDir of versions) {
          if (!versionDir.isDirectory() || versionDir.name.startsWith(".")) continue;
          const installPath = join(pluginPath, versionDir.name);
          const manifestPath = join(installPath, ".codex-plugin", "plugin.json");
          const manifest = await readCodexPluginManifest(manifestPath);
          if (!manifest) continue;
          const pluginName = typeof manifest.name === "string" && manifest.name !== ""
            ? manifest.name
            : pluginDir.name;
          const version = typeof manifest.version === "string" && manifest.version !== ""
            ? manifest.version
            : versionDir.name;
          const skillsRel = typeof manifest.skills === "string" && manifest.skills !== ""
            ? manifest.skills
            : "./skills";
          const install = {
            pluginKey: `${pluginName}@${marketplace.name}`,
            installPath,
            skillsRoot: resolve(dirname(manifestPath), "..", skillsRel),
            version,
          };
          const existing = byPluginKey.get(install.pluginKey);
          if (!existing || isNewerCodexPluginInstall(install, existing)) {
            byPluginKey.set(install.pluginKey, install);
          }
        }
      }
    }
    return [...byPluginKey.values()];
  }
}

function isNewerCodexPluginInstall(candidate: CodexPluginInstall, current: CodexPluginInstall): boolean {
  const byVersion = compareVersions(candidate.version, current.version);
  if (byVersion !== 0) return byVersion > 0;
  return candidate.installPath > current.installPath;
}

async function readCodexPluginManifest(path: string): Promise<CodexPluginManifest | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as CodexPluginManifest;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    process.stderr.write(`warning: ${path} is not valid JSON; skipping plugin enumeration\n`);
    return null;
  }
}
