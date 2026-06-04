import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Host, HostUsageOptions } from "./base.ts";
import { projectSkillRoots } from "./project.ts";
import type { Skill, UsageDiagnostics, UsageStat } from "../types.ts";
import {
  buildStrictProjectWalkOpts,
  compareVersions,
  readCodexPluginSettings,
  readSkillFrontmatterDetailed,
  reportEscapedProjectEntries,
  walkSkillsDir,
} from "../scan.ts";
import { collectUsageStatsDetailed } from "../usage.ts";

export interface CodexHostOptions {
  codexHome?: string;
  agentsHome?: string;
  sessionsDir?: string;
  /** current project directory for .agents/skills discovery */
  cwd?: string;
  /** protected admin-level skills root, defaults to /etc/codex/skills */
  adminSkillsRoot?: string;
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

interface InstalledPluginsCacheEntry {
  cacheRootKey: string;
  installs: CodexPluginInstall[];
}

export class CodexHost implements Host {
  readonly name = "codex" as const;
  private readonly codexHome: string;
  private readonly agentsHome: string;
  private readonly sessionsDir: string;
  private readonly cwd: string;
  private readonly adminSkillsRoot: string;
  private readonly enforceProjectScopeCanonical: string | undefined;
  // Per-instance memo for installedPlugins(). The Codex host is constructed
  // once per CLI invocation, so this is effectively a per-invocation cache.
  // The web UI keeps the host alive across requests; the cacheRootKey below
  // folds in the marketplace cache root's mtime+size AND each immediate
  // marketplace child's mtime+size, so we re-detect both top-level changes
  // (new marketplace dir) and new plugins installed under an existing
  // marketplace dir (which only bumps the marketplace child's mtime, not
  // the cache root's).
  //
  // Cost: one stat for the cache root plus one per marketplace per call.
  // Typical setups have 1-3 marketplaces so this stays well under the cost
  // of the full readdir tree we used to walk on every listSkills() call.
  private installedPluginsCache: InstalledPluginsCacheEntry | null = null;

  constructor(opts: CodexHostOptions = {}) {
    this.codexHome = opts.codexHome ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
    this.agentsHome = opts.agentsHome ?? process.env["AGENTS_HOME"] ?? join(homedir(), ".agents");
    this.sessionsDir = opts.sessionsDir ?? join(this.codexHome, "sessions");
    this.cwd = opts.cwd ?? process.env["AGENTIC_SKILL_ROUTER_CWD"] ?? process.cwd();
    this.adminSkillsRoot = opts.adminSkillsRoot ?? process.env["CODEX_ADMIN_SKILLS_ROOT"] ?? "/etc/codex/skills";
    this.enforceProjectScopeCanonical = opts.enforceProjectScopeCanonical;
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
      // #133: when the web allowlist set `enforceProjectScopeCanonical`,
      // forward it so the project-scope `walkSkillsDir` drops escaping
      // entries instead of surfacing them with `outOfRoot=true`. Default
      // CLI flows leave it undefined and keep legacy behaviour.
      out.push(...await this.listRootSkills({
        root: projectRoot.root,
        idPrefix: `project:codex:${projectRoot.relativeDir}`,
        source: "project",
        canDisable: true,
        ...(this.enforceProjectScopeCanonical ? { enforceCanonical: this.enforceProjectScopeCanonical } : {}),
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

  async usageStats(opts: HostUsageOptions = {}): Promise<Map<string, UsageStat>> {
    return (await this.usageStatsDetailed(opts)).usage;
  }

  async usageStatsDetailed(
    opts: HostUsageOptions = {},
  ): Promise<{ usage: Map<string, UsageStat>; diagnostics: UsageDiagnostics }> {
    return collectUsageStatsDetailed(this.sessionsDir, {
      host: this.name,
      ...(opts.since !== undefined ? { since: opts.since } : {}),
    });
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

  private async listRootSkills(opts: {
    root: string;
    idPrefix: string;
    source: "user" | "project" | "builtin";
    canDisable: boolean;
    /**
     * When provided, opts the underlying `walkSkillsDir` into the
     * strict-mode TOCTOU narrowing path (#133). Only the project-scope
     * caller sets this — user/builtin/admin scans keep the legacy
     * behaviour because they have no allowlist canonical to enforce.
     */
    enforceCanonical?: string;
  }): Promise<Skill[]> {
    const walkOpts = await buildStrictProjectWalkOpts(opts.root, opts.enforceCanonical);
    const skills = await walkSkillsDir(opts.root, async (skillName, skillMdPath, isDisabled, conflict, outOfRoot) => {
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
    }, walkOpts);
    if (walkOpts.escaped && walkOpts.escaped.length > 0) {
      reportEscapedProjectEntries(opts.root, walkOpts.escaped);
    }
    return skills;
  }

  private async installedPlugins(): Promise<CodexPluginInstall[]> {
    const cacheRoot = join(this.codexHome, "plugins", "cache");
    const cacheRootKey = await computeMarketplaceCacheKey(cacheRoot);
    if (this.installedPluginsCache && this.installedPluginsCache.cacheRootKey === cacheRootKey) {
      return this.installedPluginsCache.installs;
    }

    const installs = await this.scanInstalledPlugins(cacheRoot);
    this.installedPluginsCache = { cacheRootKey, installs };
    return installs;
  }

  private async scanInstalledPlugins(cacheRoot: string): Promise<CodexPluginInstall[]> {
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

async function computeMarketplaceCacheKey(cacheRoot: string): Promise<string> {
  let rootStat;
  try {
    rootStat = await stat(cacheRoot);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw err;
  }
  // Fold each immediate marketplace child's mtime+size into the key. A new
  // plugin installed under an existing marketplace dir only changes that
  // marketplace dir's mtime — not the cache root's — so stat'ing the root
  // alone would miss the change. One extra stat per marketplace per call
  // (typically 1-3) is still far cheaper than re-walking the whole tree.
  let entries;
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw err;
  }
  const marketplaceParts: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const childPath = join(cacheRoot, entry.name);
    try {
      const childStat = await stat(childPath);
      marketplaceParts.push(`${entry.name}:${childStat.mtimeMs}:${childStat.size}`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  // Sort so the key is order-independent across filesystems with different
  // readdir orderings.
  marketplaceParts.sort();
  return `present:${rootStat.mtimeMs}:${rootStat.size}|${marketplaceParts.join(",")}`;
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
