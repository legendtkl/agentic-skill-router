import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const execFileAsync = promisify(execFile);
const NPM_CACHE = join(tmpdir(), `skill-router-installers-npm-cache-${process.pid}`);

const PLUGIN_KEY = "skill-router@local";
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
    SKILL_ROUTER_STATE_DIR: join(root, ".skill-router"),
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

test("[claude] install creates plugin cache, manifest, bin wrapper, and registers in settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-claude-"));
  try {
    const claudeHome = join(root, ".claude");
    const installPath = join(claudeHome, "plugins", "cache", "local", "skill-router", PKG_VERSION);

    await execFileAsync(process.execPath, ["scripts/install.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    // Plugin cache files
    assert.ok(await pathExists(join(installPath, ".claude-plugin", "plugin.json")), "plugin manifest copied");
    assert.ok(await pathExists(join(installPath, "bin", "skill-router")), "bin wrapper copied");
    assert.ok(await pathExists(join(installPath, "lib", "skill-router.mjs")), "lib bundle copied");
    assert.ok(
      await pathExists(join(installPath, "skills", "skill-router-skills", "SKILL.md")),
      "router skill copied",
    );

    // Bin wrapper is executable
    const binStat = await stat(join(installPath, "bin", "skill-router"));
    assert.ok((binStat.mode & 0o111) !== 0, "bin wrapper is executable");

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
    const stateDir = join(root, ".skill-router");
    const installPath = join(claudeHome, "plugins", "cache", "local", "skill-router", PKG_VERSION);

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
      await pathExists(join(claudeHome, "plugins", "cache", "local", "skill-router")),
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
    const stateDir = join(root, ".skill-router");

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
    const installPath = join(codexHome, "plugins", "cache", "local", "skill-router", PKG_VERSION);

    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });

    // Plugin cache files
    assert.ok(await pathExists(join(installPath, ".codex-plugin", "plugin.json")), "plugin manifest copied");
    assert.ok(await pathExists(join(installPath, "bin", "skill-router")), "bin wrapper copied");
    assert.ok(await pathExists(join(installPath, "lib", "skill-router.mjs")), "lib bundle copied");
    assert.ok(
      await pathExists(join(installPath, "skills", "skill-router-skills", "SKILL.md")),
      "router skill copied",
    );

    const binStat = await stat(join(installPath, "bin", "skill-router"));
    assert.ok((binStat.mode & 0o111) !== 0, "bin wrapper is executable");

    const manifest = (await readJson(join(installPath, ".codex-plugin", "plugin.json"))) as { skills: string };
    assert.equal(manifest.skills, "./skills/");

    // Slash prompt installed
    assert.ok(
      await pathExists(join(codexHome, "prompts", "skill-router-skills.md")),
      "/skill-router:skills prompt installed",
    );

    // config.toml enables the plugin
    const config = await readFile(join(codexHome, "config.toml"), "utf8");
    assert.match(config, /\[plugins\."skill-router@local"\]\nenabled = true/);
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
    const ourHeaderMatches = config.match(/\[plugins\."skill-router@local"\]/g) ?? [];
    assert.equal(ourHeaderMatches.length, 1, "single [plugins.\"skill-router@local\"] section after re-install");

    // Exactly one enabled line inside our plugin's stanza.
    const ourSection = config
      .split(/\r?\n/)
      .reduce<string[]>((acc, line, idx, arr) => {
        if (line.trim() === '[plugins."skill-router@local"]') {
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
    const stateDir = join(root, ".skill-router");
    const installPath = join(codexHome, "plugins", "cache", "local", "skill-router", PKG_VERSION);

    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });
    assert.ok(await pathExists(installPath));
    assert.ok(await pathExists(join(codexHome, "prompts", "skill-router-skills.md")));

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
      await pathExists(join(codexHome, "plugins", "cache", "local", "skill-router")),
      false,
      "plugin cache dir removed",
    );

    // Slash prompt removed.
    assert.equal(
      await pathExists(join(codexHome, "prompts", "skill-router-skills.md")),
      false,
      "/skill-router:skills prompt removed",
    );

    // config.toml retains stanza but flipped to enabled = false.
    const config = await readFile(join(codexHome, "config.toml"), "utf8");
    assert.match(config, /\[plugins\."skill-router@local"\]\nenabled = false/);

    // State preserved (no --purge).
    assert.ok(await pathExists(join(stateDir, "state-codex.json")), "state preserved without --purge");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[codex] uninstall --purge removes state directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-codex-purge-"));
  try {
    const stateDir = join(root, ".skill-router");

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
    assert.equal(await pathExists(join(codexHome, "prompts", "skill-router-skills.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[claude] uninstall is a no-op when no install exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-installer-claude-noinstall-"));
  try {
    await execFileAsync(process.execPath, ["scripts/uninstall.mjs"], {
      cwd: REPO_ROOT,
      env: sandboxEnv(root),
      maxBuffer: MAX_BUFFER,
    });
    // No assertion beyond non-zero exit; absence of crash is the contract.
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
