/**
 * Host-neutral helpers for the install/uninstall scripts. These cover the
 * parts that look identical between the Claude Code and Codex paths:
 *
 *   - copy shared bin/lib runtime assets into ~/.skill-router/runtime/<version>
 *   - copy plugin entry assets (manifest dir + skills) into a versioned cache
 *     directory and add a host-specific bin wrapper
 *   - normalize the manifest's "skills" path so the installed copy points at
 *     the sibling skills/ directory
 *   - clean up stale sibling versions in the cache root (with a containment
 *     guard so symlinks pointing outside the cache root are unlinked but
 *     never followed)
 *   - read the per-host state file and surface a warning about skills that
 *     are still disabled by skill-router at uninstall time
 *
 * Pure helpers only; no host-specific knowledge of TOML, JSON shapes, or
 * settings keys lives here.
 */
import { chmod, cp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";

import { isPlainObject, log as defaultLog } from "./common.mjs";

/**
 * The shared top-level directories copied into the versioned runtime cache.
 */
export const RUNTIME_ASSET_DIRS = ["bin", "lib"];
export const HOST_ENTRY_ASSET_DIRS = ["skills"];

/**
 * Copy the host plugin manifest tree plus the shared asset dirs into
 * `installPath`. Wipes the target directory first so reinstalls are
 * idempotent. Marks the bundled bin wrapper executable.
 *
 * @param {object} options
 * @param {string} options.pluginSrc Source directory containing the host
 *   plugin manifest (e.g. `plugins/claude-code` or `plugins/codex`).
 * @param {string} options.repoRoot Project root that contains the shared
 *   asset directories (`bin/`, `lib/`, `skills/`).
 * @param {string} options.installPath Versioned cache directory to install
 *   into.
 * @param {string[]} [options.sharedAssetDirs] Top-level directories to copy
 *   from `repoRoot` into `installPath`. Defaults to `HOST_ENTRY_ASSET_DIRS`.
 */
export async function copyPluginAssets({
  pluginSrc,
  repoRoot,
  installPath,
  sharedAssetDirs = HOST_ENTRY_ASSET_DIRS,
}) {
  await rm(installPath, { recursive: true, force: true });
  await mkdir(dirname(installPath), { recursive: true });
  await cp(pluginSrc, installPath, { recursive: true });
  for (const dir of sharedAssetDirs) {
    await cp(join(repoRoot, dir), join(installPath, dir), { recursive: true });
  }
}

/**
 * Copy the shared CLI runtime once into ~/.skill-router/runtime/<version>/.
 * Host plugin installs then create tiny wrappers that set SKILL_ROUTER_HOST
 * before delegating to this runtime.
 *
 * @param {object} options
 * @param {string} options.repoRoot Project root that contains bin/ and lib/.
 * @param {string} options.runtimePath Versioned shared runtime directory.
 * @param {string[]} [options.runtimeAssetDirs] Top-level runtime directories
 *   copied from the repo root. Defaults to bin/ and lib/.
 */
export async function copyRuntimeAssets({
  repoRoot,
  runtimePath,
  runtimeAssetDirs = RUNTIME_ASSET_DIRS,
}) {
  await rm(runtimePath, { recursive: true, force: true });
  await mkdir(dirname(runtimePath), { recursive: true });
  for (const dir of runtimeAssetDirs) {
    await cp(join(repoRoot, dir), join(runtimePath, dir), { recursive: true });
  }
  await chmod(join(runtimePath, "bin/skill-router"), 0o755);
}

/**
 * Create a host-specific wrapper inside the installed plugin bundle.
 *
 * The wrapper is intentionally small: the plugin bundle remains discoverable
 * by the host, while all executable logic lives in the shared runtime. The
 * host name is injected via SKILL_ROUTER_HOST so the runtime does not need to
 * infer the caller from its own filesystem location.
 *
 * @param {object} options
 * @param {string} options.wrapperPath Absolute path to write.
 * @param {string} options.runtimeBin Absolute path to the shared runtime bin.
 * @param {"claude-code" | "codex"} options.hostName Host selected by wrapper.
 * @param {string} [options.assetRoot] Host entry asset root for init/template lookup.
 */
export async function writeHostWrapper({ wrapperPath, runtimeBin, hostName, assetRoot }) {
  await mkdir(dirname(wrapperPath), { recursive: true });
  const script = [
    "#!/usr/bin/env sh",
    "set -eu",
    `export SKILL_ROUTER_HOST=${shellQuote(hostName)}`,
    ...(assetRoot ? [`export SKILL_ROUTER_ASSET_ROOT=${shellQuote(assetRoot)}`] : []),
    `exec ${shellQuote(runtimeBin)} "$@"`,
    "",
  ].join("\n");
  await writeFile(wrapperPath, script);
  await chmod(wrapperPath, 0o755);
}

/**
 * Rewrite the installed plugin manifest so its `skills` field points at the
 * sibling `./skills/` directory we just copied. We do this so the installed
 * manifest is self-contained even if the repo manifest points elsewhere.
 *
 * @param {string} manifestPath Absolute path to the installed plugin
 *   manifest (e.g. `<installPath>/.claude-plugin/plugin.json`).
 */
export async function normalizeManifestSkills(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.skills = "./skills/";
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Remove sibling version directories that are not the current install.
 *
 * Containment guard: we realpath the *cache root* (not each sibling entry)
 * so a sibling that happens to be a symlink pointing outside the cache root
 * removes only the symlink itself, not its target tree (`fs.rm` does not
 * follow symlinks).
 *
 * @param {string} cacheRoot Directory containing per-version subdirectories.
 * @param {string} currentVersion The version directory that must be kept.
 * @param {object} [options]
 * @param {boolean} [options.keepOld] When true, log the stale versions and
 *   skip the removal.
 * @param {(message: string) => void} [options.log] Logger used for status
 *   lines.
 */
export async function cleanupOldVersions(cacheRoot, currentVersion, { keepOld = false, log = defaultLog } = {}) {
  let entries;
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return;
    throw err;
  }
  const siblings = entries
    .map((entry) => entry.name)
    .filter((name) => name !== currentVersion);
  if (siblings.length === 0) {
    log("  no old versions to clean");
    return;
  }
  if (keepOld) {
    log(`  kept old versions: ${siblings.sort().join(", ")}`);
    return;
  }

  // Containment guard: anchor every delete under the canonical cache root.
  // We realpath the *cache root* (not the sibling entry) so a sibling that
  // happens to be a symlink pointing outside the cache root removes only the
  // symlink itself, not its target tree (`fs.rm` does not follow symlinks).
  const canonicalCacheRoot = await realpath(cacheRoot);
  const safeParent = canonicalCacheRoot.endsWith(sep) ? canonicalCacheRoot : canonicalCacheRoot + sep;
  const removed = [];
  for (const name of siblings) {
    if (name === "" || name === "." || name === "..") continue;
    if (name.includes(sep) || name.includes("/")) continue;
    const target = join(canonicalCacheRoot, name);
    if (!(target + sep).startsWith(safeParent) || target === canonicalCacheRoot) {
      log(`  skipped (outside cache root): ${target}`);
      continue;
    }
    await rm(target, { recursive: true, force: true });
    removed.push(name);
  }
  if (removed.length === 0) log("  no old versions to clean");
  else log(`  cleaned cache: ${removed.sort().join(", ")}`);
}

/**
 * Read the host's state file and emit a warning if skill-router still has
 * skills disabled. The wording (warning prefix and the "how to re-enable"
 * hint) differs between hosts so callers customize them via options.
 *
 * @param {object} options
 * @param {string} options.statePath Absolute path to the per-host state
 *   file (`state-claude-code.json` or `state-codex.json`).
 * @param {string} options.warnPrefix Leading character/glyph the host prints
 *   before warning lines (e.g. "⚠" or "!").
 * @param {(records: Array<{ id: string }>) => string[]} options.formatRestoreHint
 *   Builds the lines shown after the headline that tell the user how to
 *   re-enable the disabled skills before they uninstall.
 * @param {boolean} [options.reportMalformed] When true, surface a count of
 *   malformed records found in `state.disabledSkills`.
 * @param {(message: string) => void} [options.log] Logger used for status
 *   lines.
 */
export async function warnAboutDisabledSkills({
  statePath,
  warnPrefix,
  formatRestoreHint,
  reportMalformed = false,
  log = defaultLog,
}) {
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return;
  }
  if (!isPlainObject(state) || !Array.isArray(state.disabledSkills)) return;
  const validRecords = state.disabledSkills.filter(
    (r) => isPlainObject(r) && typeof r.id === "string" && r.id.length > 0,
  );
  if (reportMalformed) {
    const malformed = state.disabledSkills.length - validRecords.length;
    if (malformed > 0) {
      log(`${warnPrefix} ${malformed} malformed disable record(s) ignored in ${statePath}.`);
    }
  }
  if (validRecords.length > 0) {
    log(`${warnPrefix} ${validRecords.length} skill(s) are still disabled by skill-router.`);
    log(`  Their SKILL.md files remain renamed even after uninstall.`);
    for (const line of formatRestoreHint(validRecords)) log(line);
    log("");
  }
}
