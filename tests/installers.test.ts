import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const execFileAsync = promisify(execFile);
const NPM_CACHE = join(tmpdir(), `agentic-skill-router-installers-npm-cache-${process.pid}`);

const PLUGIN_KEY = "agentic-skill-router@local";
const MAX_BUFFER = 4 * 1024 * 1024;

const PKG_VERSION = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")).version as string;

/**
 * Build a sandbox env that points every host-config and state path into `root`.
 * Critically we must NEVER inherit the user's real HOME — install/uninstall scripts
 * fall back to `homedir()` when CLAUDE_HOME/CODEX_HOME are unset, so we override
 * HOME too as a belt-and-suspenders measure.
 */
function sandboxEnv(root: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    CLAUDE_HOME: join(root, ".claude"),
    CODEX_HOME: join(root, ".codex"),
    AGENTIC_SKILL_ROUTER_STATE_DIR: join(root, ".agentic-skill-router"),
    npm_config_cache: NPM_CACHE,
    ...extra,
  };
  // Strip proxy vars: the bundled scripts' build step (npm run build) hates them.
  delete env["HTTP_PROXY"];
  delete env["HTTPS_PROXY"];
  delete env["http_proxy"];
  delete env["https_proxy"];
  return env;
}

async function seedStaleVersion(cacheRoot: string, name: string): Promise<string> {
  const dir = join(cacheRoot, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "marker.txt"), `stale ${name}`);
  return dir;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeProbeSkill(skillDir: string, name: string, description: string): Promise<void> {
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
}

test("[claude] install creates plugin cache, manifest, bin wrapper, and registers in settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-claude-"));
  try {
    const claudeHome = join(root, ".claude");
    const installPath = join(claudeHome, "plugins", "cache", "local", "agentic-skill-router", PKG_VERSION);
    const runtimePath = join(root, ".agentic-skill-router", "runtime", PKG_VERSION);
    const wrapperPath = join(installPath, "bin", "agentic-skill-router");

    await execFileAsync(process.execPath, ["scripts/install.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    // Plugin cache files
    assert.ok(await pathExists(join(installPath, ".claude-plugin", "plugin.json")), "plugin manifest copied");
    assert.ok(await pathExists(join(installPath, "bin", "agentic-skill-router")), "host bin wrapper copied");
    assert.equal(await pathExists(join(installPath, "lib", "agentic-skill-router.mjs")), false, "plugin cache does not duplicate runtime lib");
    assert.ok(
      await pathExists(join(installPath, "skills", "agentic-skill-router-skills", "SKILL.md")),
      "router skill copied",
    );
    assert.ok(await pathExists(join(runtimePath, "bin", "agentic-skill-router")), "shared runtime bin copied");
    assert.ok(await pathExists(join(runtimePath, "lib", "agentic-skill-router.mjs")), "shared runtime lib copied");

    // Bin wrapper is executable
    const binStat = await stat(wrapperPath);
    assert.ok((binStat.mode & 0o111) !== 0, "bin wrapper is executable");
    const wrapper = await readFile(wrapperPath, "utf8");
    assert.match(wrapper, /AGENTIC_SKILL_ROUTER_HOST='claude-code'/);
    assert.match(wrapper, /AGENTIC_SKILL_ROUTER_ASSET_ROOT=/);

    await writeProbeSkill(
      join(claudeHome, "skills", "wrapper-probe"),
      "wrapper-probe",
      "Claude wrapper host probe",
    );
    const { stdout: listStdout } = await execFileAsync(wrapperPath, ["skills", "list", "--json"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root, { AGENTIC_SKILL_ROUTER_HOST: "codex" }),
      maxBuffer: MAX_BUFFER,
    });
    const listed = JSON.parse(listStdout) as Array<{ id: string }>;
    assert.ok(listed.some((item) => item.id === "user:wrapper-probe"), "wrapper selects Claude host");
    assert.equal(listed.some((item) => item.id === "user:codex:wrapper-probe"), false, "wrapper overrides caller host env");

    const initProject = join(root, "init-project");
    const { stdout: initStdout } = await execFileAsync(
      wrapperPath,
      ["init", "claude-code", "project", "--cwd", initProject, "--json"],
      {
        cwd: REPO_ROOT,
        env: sandboxEnv(root, { AGENTIC_SKILL_ROUTER_ASSET_ROOT: join(root, "missing-assets") }),
        maxBuffer: MAX_BUFFER,
      },
    );
    assert.equal(
      JSON.parse(initStdout).skillMdPath,
      join(initProject, ".claude", "skills", "agentic-skill-router-skills", "SKILL.md"),
      "wrapper asset root lets init copy the installed skill template",
    );

    // Manifest skills field is normalized to local skills/ dir
    const manifest = (await readJson(join(installPath, ".claude-plugin", "plugin.json"))) as { skills: string };
    assert.equal(manifest.skills, "./skills/");

    // installed_plugins.json registered the plugin
    const installed = (await readJson(join(claudeHome, "plugins", "installed_plugins.json"))) as {
      version: number;
      plugins: Record<string, Array<{ installPath: string; version: string; scope: string }>>;
    };
    assert.equal(installed.version, 2);
    const entries = installed.plugins[PLUGIN_KEY];
    assert.ok(Array.isArray(entries) && entries.length === 1, "single install entry");
    assert.equal(entries[0]?.installPath, installPath);
    assert.equal(entries[0]?.version, PKG_VERSION);
    assert.equal(entries[0]?.scope, "user");

    // settings.json has plugin enabled
    const settings = (await readJson(join(claudeHome, "settings.json"))) as {
      enabledPlugins: Record<string, boolean>;
    };
    assert.equal(settings.enabledPlugins[PLUGIN_KEY], true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[claude] install is idempotent: re-running does not duplicate entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-claude-idem-"));
  try {
    const claudeHome = join(root, ".claude");

    // Pre-seed settings.json with an unrelated key to confirm it survives.
    await mkdir(claudeHome, { recursive: true });
    await writeFile(
      join(claudeHome, "settings.json"),
      JSON.stringify({ theme: "dark", enabledPlugins: { "other@local": true } }, null, 2) + "\n",
    );

    for (let i = 0; i < 2; i++) {
      await execFileAsync(process.execPath, ["scripts/install.mjs"], {
        cwd: REPO_ROOT,
        env: sandboxEnv(root),
        maxBuffer: MAX_BUFFER,
      });
    }

    const installed = (await readJson(join(claudeHome, "plugins", "installed_plugins.json"))) as {
      plugins: Record<string, unknown[]>;
    };
    const entries = installed.plugins[PLUGIN_KEY];
    assert.ok(Array.isArray(entries) && entries.length === 1, "no duplicate install entries after re-run");

    const settings = (await readJson(join(claudeHome, "settings.json"))) as {
      theme?: string;
      enabledPlugins: Record<string, boolean>;
    };
    assert.equal(settings.theme, "dark", "preserves unrelated settings keys");
    assert.equal(settings.enabledPlugins["other@local"], true, "preserves unrelated plugin enable state");
    assert.equal(settings.enabledPlugins[PLUGIN_KEY], true, "our plugin still enabled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[claude] uninstall removes cache, unregisters, and disables in settings without deleting state", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-claude-uninstall-"));
  try {
    const claudeHome = join(root, ".claude");
    const stateDir = join(root, ".agentic-skill-router");
    const installPath = join(claudeHome, "plugins", "cache", "local", "agentic-skill-router", PKG_VERSION);

    await execFileAsync(process.execPath, ["scripts/install.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });
    assert.ok(await pathExists(installPath), "precondition: install succeeded");

    // Seed state to verify it is preserved (no --purge).
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      join(stateDir, "state-claude-code.json"),
      JSON.stringify({ disabledSkills: [{ id: "user:foo", originalPath: "/x", disabledAt: "now" }] }, null, 2),
    );

    await execFileAsync(process.execPath, ["scripts/uninstall.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    // Cache dir removed (whole plugin family root, not just version).
    assert.equal(
      await pathExists(join(claudeHome, "plugins", "cache", "local", "agentic-skill-router")),
      false,
      "plugin cache dir removed",
    );

    // installed_plugins.json no longer has our key.
    const installed = (await readJson(join(claudeHome, "plugins", "installed_plugins.json"))) as {
      plugins: Record<string, unknown>;
    };
    assert.equal(PLUGIN_KEY in installed.plugins, false, "unregistered from installed_plugins.json");

    // settings.json keeps the key but flips it to false.
    const settings = (await readJson(join(claudeHome, "settings.json"))) as {
      enabledPlugins: Record<string, boolean>;
    };
    assert.equal(settings.enabledPlugins[PLUGIN_KEY], false, "enabled flag set to false (kept for re-install)");

    // State preserved (no --purge).
    assert.ok(await pathExists(join(stateDir, "state-claude-code.json")), "state preserved without --purge");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[claude] uninstall --purge removes state directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-claude-purge-"));
  try {
    const stateDir = join(root, ".agentic-skill-router");

    await execFileAsync(process.execPath, ["scripts/install.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "state-claude-code.json"), "{}\n");

    await execFileAsync(process.execPath, ["scripts/uninstall.mjs", "--purge"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    assert.equal(await pathExists(stateDir), false, "state dir purged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[codex] install creates plugin cache, slash prompt, and enables in config.toml", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-codex-"));
  try {
    const codexHome = join(root, ".codex");
    const installPath = join(codexHome, "plugins", "cache", "local", "agentic-skill-router", PKG_VERSION);
    const runtimePath = join(root, ".agentic-skill-router", "runtime", PKG_VERSION);
    const wrapperPath = join(installPath, "bin", "agentic-skill-router");

    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    // Plugin cache files
    assert.ok(await pathExists(join(installPath, ".codex-plugin", "plugin.json")), "plugin manifest copied");
    assert.ok(await pathExists(join(installPath, "bin", "agentic-skill-router")), "host bin wrapper copied");
    assert.equal(await pathExists(join(installPath, "lib", "agentic-skill-router.mjs")), false, "plugin cache does not duplicate runtime lib");
    assert.ok(
      await pathExists(join(installPath, "skills", "agentic-skill-router-skills", "SKILL.md")),
      "router skill copied",
    );
    assert.ok(await pathExists(join(runtimePath, "bin", "agentic-skill-router")), "shared runtime bin copied");
    assert.ok(await pathExists(join(runtimePath, "lib", "agentic-skill-router.mjs")), "shared runtime lib copied");

    const binStat = await stat(wrapperPath);
    assert.ok((binStat.mode & 0o111) !== 0, "bin wrapper is executable");
    const wrapper = await readFile(wrapperPath, "utf8");
    assert.match(wrapper, /AGENTIC_SKILL_ROUTER_HOST='codex'/);
    assert.match(wrapper, /AGENTIC_SKILL_ROUTER_ASSET_ROOT=/);

    await writeProbeSkill(
      join(root, ".agents", "skills", "wrapper-probe"),
      "wrapper-probe",
      "Codex wrapper host probe",
    );
    const { stdout: listStdout } = await execFileAsync(wrapperPath, ["skills", "list", "--json"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root, { AGENTIC_SKILL_ROUTER_HOST: "claude-code" }),
      maxBuffer: MAX_BUFFER,
    });
    const listed = JSON.parse(listStdout) as Array<{ id: string }>;
    assert.ok(listed.some((item) => item.id === "user:agents:wrapper-probe"), "wrapper selects Codex host");
    assert.equal(listed.some((item) => item.id === "user:wrapper-probe"), false, "wrapper overrides caller host env");

    const initProject = join(root, "init-project");
    const { stdout: initStdout } = await execFileAsync(
      wrapperPath,
      ["init", "codex", "project", "--cwd", initProject, "--json"],
      {
        cwd: REPO_ROOT,
        env: sandboxEnv(root, { AGENTIC_SKILL_ROUTER_ASSET_ROOT: join(root, "missing-assets") }),
        maxBuffer: MAX_BUFFER,
      },
    );
    assert.equal(
      JSON.parse(initStdout).skillMdPath,
      join(initProject, ".agents", "skills", "agentic-skill-router-skills", "SKILL.md"),
      "wrapper asset root lets init copy the installed skill template",
    );

    const manifest = (await readJson(join(installPath, ".codex-plugin", "plugin.json"))) as { skills: string };
    assert.equal(manifest.skills, "./skills/");

    // Slash prompt installed
    assert.ok(
      await pathExists(join(codexHome, "prompts", "agentic-skill-router-skills.md")),
      "/agentic-skill-router:skills prompt installed",
    );

    // config.toml enables the plugin
    const config = await readFile(join(codexHome, "config.toml"), "utf8");
    assert.match(config, /\[plugins\."agentic-skill-router@local"\]\nenabled = true/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[codex] install is idempotent: re-running keeps a single enabled stanza and preserves unrelated config", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-codex-idem-"));
  try {
    const codexHome = join(root, ".codex");

    // Pre-seed config.toml with an unrelated section to verify it is preserved.
    await mkdir(codexHome, { recursive: true });
    await writeFile(
      join(codexHome, "config.toml"),
      [
        "model = \"gpt-5\"",
        "",
        "[plugins.\"other@local\"]",
        "enabled = true",
        "",
      ].join("\n"),
    );

    for (let i = 0; i < 2; i++) {
      await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
        cwd: REPO_ROOT,
        env: sandboxEnv(root),
        maxBuffer: MAX_BUFFER,
      });
    }

    const config = await readFile(join(codexHome, "config.toml"), "utf8");

    // Exactly one stanza for our plugin (no duplicate sections).
    const ourHeaderMatches = config.match(/\[plugins\."agentic-skill-router@local"\]/g) ?? [];
    assert.equal(ourHeaderMatches.length, 1, "single [plugins.\"agentic-skill-router@local\"] section after re-install");

    // Exactly one enabled line inside our plugin's stanza.
    const ourSection = config
      .split(/\r?\n/)
      .reduce<string[]>((acc, line, idx, arr) => {
        if (line.trim() === '[plugins."agentic-skill-router@local"]') {
          let end = arr.length;
          for (let j = idx + 1; j < arr.length; j++) {
            if (/^\s*\[/.test(arr[j] ?? "")) {
              end = j;
              break;
            }
          }
          acc.push(...arr.slice(idx, end));
        }
        return acc;
      }, []);
    const enabledLines = ourSection.filter((line) => /^\s*enabled\s*=/.test(line));
    assert.equal(enabledLines.length, 1, "single enabled = line in our stanza");
    assert.match(enabledLines[0] ?? "", /enabled = true/);

    // Unrelated content survives.
    assert.match(config, /model = "gpt-5"/);
    assert.match(config, /\[plugins\."other@local"\]\nenabled = true/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[codex] uninstall removes cache and slash prompt, flips config.toml enabled=false, preserves state", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-codex-uninstall-"));
  try {
    const codexHome = join(root, ".codex");
    const stateDir = join(root, ".agentic-skill-router");
    const installPath = join(codexHome, "plugins", "cache", "local", "agentic-skill-router", PKG_VERSION);

    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });
    assert.ok(await pathExists(installPath));
    assert.ok(await pathExists(join(codexHome, "prompts", "agentic-skill-router-skills.md")));

    // Seed state to verify uninstall preserves it.
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "state-codex.json"), JSON.stringify({ disabledSkills: [] }, null, 2));

    await execFileAsync(process.execPath, ["scripts/uninstall-codex.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    // Plugin cache family root removed.
    assert.equal(
      await pathExists(join(codexHome, "plugins", "cache", "local", "agentic-skill-router")),
      false,
      "plugin cache dir removed",
    );

    // Slash prompt removed.
    assert.equal(
      await pathExists(join(codexHome, "prompts", "agentic-skill-router-skills.md")),
      false,
      "/agentic-skill-router:skills prompt removed",
    );

    // config.toml retains stanza but flipped to enabled = false.
    const config = await readFile(join(codexHome, "config.toml"), "utf8");
    assert.match(config, /\[plugins\."agentic-skill-router@local"\]\nenabled = false/);

    // State preserved (no --purge).
    assert.ok(await pathExists(join(stateDir, "state-codex.json")), "state preserved without --purge");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[codex] uninstall --purge removes state directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-codex-purge-"));
  try {
    const stateDir = join(root, ".agentic-skill-router");

    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "state-codex.json"), "{}\n");

    await execFileAsync(process.execPath, ["scripts/uninstall-codex.mjs", "--purge"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    assert.equal(await pathExists(stateDir), false, "state dir purged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[codex] uninstall is a no-op when no install exists (no config.toml created spuriously)", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-codex-noinstall-"));
  try {
    const codexHome = join(root, ".codex");

    await execFileAsync(process.execPath, ["scripts/uninstall-codex.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    // No cache, no prompt — uninstall must not crash with missing files.
    assert.equal(await pathExists(join(codexHome, "prompts", "agentic-skill-router-skills.md")), false);
    // And uninstall must not spuriously create config.toml (e.g. by writing a
    // disabled plugin stanza on an empty setup).
    assert.equal(await pathExists(join(codexHome, "config.toml")), false, "config.toml must not be created on no-op uninstall");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[claude] uninstall is a no-op when no install exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-claude-noinstall-"));
  try {
    const claudeHome = join(root, ".claude");

    await execFileAsync(process.execPath, ["scripts/uninstall.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });
    // Uninstall must not crash, and must not spuriously create config files
    // (e.g. by writing a disabled plugin stanza into settings.json or the
    // installed_plugins.json registry on an empty setup).
    assert.equal(await pathExists(join(claudeHome, "settings.json")), false, "settings.json must not be created on no-op uninstall");
    assert.equal(
      await pathExists(join(claudeHome, "plugins", "installed_plugins.json")),
      false,
      "installed_plugins.json must not be created on no-op uninstall",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const variant of [
  {
    label: "claude-code",
    script: "scripts/install.mjs",
    cacheRelative: ["plugins", "cache", "local", "agentic-skill-router"],
    sandboxRootName: "claude",
  },
  {
    label: "codex",
    script: "scripts/install-codex.mjs",
    cacheRelative: ["plugins", "cache", "local", "agentic-skill-router"],
    sandboxRootName: "codex",
  },
]) {
  // We rely on the install scripts honoring CLAUDE_HOME/CODEX_HOME under the
  // sandbox env (set by sandboxEnv). For the claude variant the cache lives
  // under `${root}/.claude`, for codex under `${root}/.codex`. The cleanup
  // tests pre-seed stale version dirs under those paths.
  const cacheParentFor = (root: string): string =>
    variant.sandboxRootName === "claude" ? join(root, ".claude") : join(root, ".codex");

  test(`install (${variant.label}) removes stale plugin cache versions by default`, async () => {
    const root = await mkdtemp(join(tmpdir(), `agentic-skill-router-cleanup-${variant.label}-`));
    try {
      const cacheRoot = join(cacheParentFor(root), ...variant.cacheRelative);
      await mkdir(cacheRoot, { recursive: true });
      const staleA = await seedStaleVersion(cacheRoot, "0.0.1");
      const staleB = await seedStaleVersion(cacheRoot, "0.0.2");

      const { stdout } = await execFileAsync(process.execPath, [variant.script], {
        cwd: REPO_ROOT,
        env: sandboxEnv(root),
        maxBuffer: MAX_BUFFER,
      });

      const currentDir = join(cacheRoot, PKG_VERSION);
      assert.equal(await pathExists(currentDir), true, "current version directory must remain");
      assert.equal(await pathExists(staleA), false, "stale version 0.0.1 must be removed");
      assert.equal(await pathExists(staleB), false, "stale version 0.0.2 must be removed");

      const remaining = (await readdir(cacheRoot)).sort();
      assert.deepEqual(remaining, [PKG_VERSION]);
      assert.match(stdout, /cleaned cache: 0\.0\.1, 0\.0\.2/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test(`install (${variant.label}) with --keep-old preserves stale versions`, async () => {
    const root = await mkdtemp(join(tmpdir(), `agentic-skill-router-cleanup-keep-${variant.label}-`));
    try {
      const cacheRoot = join(cacheParentFor(root), ...variant.cacheRelative);
      await mkdir(cacheRoot, { recursive: true });
      const staleA = await seedStaleVersion(cacheRoot, "0.0.1");
      const staleB = await seedStaleVersion(cacheRoot, "0.0.2");

      const { stdout } = await execFileAsync(process.execPath, [variant.script, "--keep-old"], {
        cwd: REPO_ROOT,
        env: sandboxEnv(root),
        maxBuffer: MAX_BUFFER,
      });

      const currentDir = join(cacheRoot, PKG_VERSION);
      assert.equal(await pathExists(currentDir), true, "current version directory must remain");
      assert.equal(await pathExists(staleA), true, "stale version 0.0.1 must be kept");
      assert.equal(await pathExists(staleB), true, "stale version 0.0.2 must be kept");
      assert.match(stdout, /kept old versions: 0\.0\.1, 0\.0\.2/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test(`install (${variant.label}) only removes the symlink for stale entries pointing outside the cache root`, async () => {
    const root = await mkdtemp(join(tmpdir(), `agentic-skill-router-cleanup-symlink-${variant.label}-`));
    try {
      const cacheRoot = join(cacheParentFor(root), ...variant.cacheRelative);
      const outsideDir = join(root, "outside");
      await mkdir(cacheRoot, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      const sentinel = join(outsideDir, "do-not-delete.txt");
      await writeFile(sentinel, "must survive cleanup");

      const symlinkPath = join(cacheRoot, "0.0.1");
      await symlink(outsideDir, symlinkPath, "dir");

      await execFileAsync(process.execPath, [variant.script], {
        cwd: REPO_ROOT,
        env: sandboxEnv(root),
        maxBuffer: MAX_BUFFER,
      });

      assert.equal(await pathExists(symlinkPath), false, "symlink stale entry must be removed");
      assert.equal(await pathExists(outsideDir), true, "outside directory must survive");
      assert.equal(await pathExists(sentinel), true, "outside file must survive");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
