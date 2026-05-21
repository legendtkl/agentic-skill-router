#!/usr/bin/env node
/**
 * Install skill-router as a local Codex plugin plus slash command.
 *
 * - builds the bundle before copying
 * - copies the Codex manifest plus shared bin/lib/skills to
 *   ~/.codex/plugins/cache/local/skill-router/<version>/
 * - enables [plugins."skill-router@local"] in ~/.codex/config.toml
 * - copies prompts/skill-router-skills.md -> ~/.codex/prompts/
 *
 * Idempotent: re-running upgrades the install in place.
 */
import { chmod, copyFile, cp, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isManagedUnchanged } from "./prompt-marker.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const pluginSrc = join(repoRoot, "plugins/codex");
const pluginManifest = JSON.parse(await readFile(join(pluginSrc, ".codex-plugin/plugin.json"), "utf8"));
const version = pluginManifest.version;
const sharedAssetDirs = ["bin", "lib", "skills"];

const PLUGIN_NAME = "skill-router";
const MARKETPLACE = "local";
const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE}`;
const codexHome = process.env["CODEX_HOME"] || join(homedir(), ".codex");
const cacheRoot = join(codexHome, "plugins/cache", MARKETPLACE, PLUGIN_NAME);
const installPath = join(cacheRoot, version);
const configPath = join(codexHome, "config.toml");
const promptSrc = join(pluginSrc, "prompts/skill-router-skills.md");
const promptPath = join(codexHome, "prompts/skill-router-skills.md");
const keepOld = process.argv.includes("--keep-old");

async function main() {
  log(`installing ${PLUGIN_KEY} v${version}`);
  log(`  target: ${installPath}`);

  await ensureBuild();
  await copyPlugin();
  await enablePlugin();
  await installSlashCommand();
  await cleanupOldVersions(cacheRoot, version, { keepOld });

  log("");
  log("✓ installed.");
  log("");
  log("Next: restart Codex, then run:");
  log("  /skill-router:skills");
  log("Manual CLI:");
  log(`  ${installPath}/bin/skill-router skills suggest`);
}

async function ensureBuild() {
  log("  building bundle (npm run build)...");
  const r = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: stripProxy(process.env),
  });
  if (r.status !== 0) throw new Error(`npm run build failed (exit ${r.status})`);
}

async function copyPlugin() {
  await rm(installPath, { recursive: true, force: true });
  await mkdir(dirname(installPath), { recursive: true });
  await cp(pluginSrc, installPath, { recursive: true });
  await normalizeManifestSkills(join(installPath, ".codex-plugin/plugin.json"));
  for (const dir of sharedAssetDirs) {
    await cp(join(repoRoot, dir), join(installPath, dir), { recursive: true });
  }
  await chmod(join(installPath, "bin/skill-router"), 0o755);
  log(`  copied -> ${installPath}`);
}

async function normalizeManifestSkills(path) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.skills = "./skills/";
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
}

async function enablePlugin() {
  let config = "";
  try {
    config = await readFile(configPath, "utf8");
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */(err).code !== "ENOENT") throw err;
  }
  const next = setPluginEnabled(config, PLUGIN_KEY, true);
  await atomicWrite(configPath, next);
  log(`  enabled in config.toml`);
}

async function installSlashCommand() {
  await mkdir(dirname(promptPath), { recursive: true });

  let existing;
  try {
    existing = await readFile(promptPath, "utf8");
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */(err).code !== "ENOENT") throw err;
  }

  if (existing !== undefined && !isManagedUnchanged(existing)) {
    const backupPath = `${promptPath}.user-modified.bak`;
    await copyFile(promptPath, backupPath);
    process.stderr.write(
      `! ${promptPath} has local edits; keeping your version.\n` +
      `  A backup of the current file was written to ${backupPath}.\n` +
      `  To install the latest managed slash command, remove or rename the file and re-run install.\n`,
    );
    log(`  skipped slash command /skill-router:skills (user-modified)`);
    return;
  }

  await cp(promptSrc, promptPath);
  log(`  installed slash command /skill-router:skills`);
}

function setPluginEnabled(config, pluginKey, enabled) {
  const header = `[plugins."${pluginKey}"]`;
  const lines = config.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    const base = config.trimEnd();
    return `${base}${base ? "\n\n" : ""}${header}\nenabled = ${enabled}\n`;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  const block = lines.slice(start, end);
  const enabledIdx = block.findIndex((line) => /^\s*enabled\s*=/.test(line));
  if (enabledIdx >= 0) block[enabledIdx] = `enabled = ${enabled}`;
  else block.push(`enabled = ${enabled}`);
  lines.splice(start, end - start, ...block);
  return lines.join("\n").replace(/\n*$/, "\n");
}

async function cleanupOldVersions(cacheRoot, currentVersion, { keepOld }) {
  let entries;
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */(err).code === "ENOENT") return;
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

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

function stripProxy(env) {
  const out = { ...env };
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) delete out[k];
  return out;
}

function log(msg) {
  process.stdout.write(msg + "\n");
}

main().catch((err) => {
  console.error("install failed:", err.message);
  process.exit(1);
});
