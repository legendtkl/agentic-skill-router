#!/usr/bin/env node
/**
 * Install skill-router as a local Claude Code plugin.
 *
 * - builds the bundle before copying
 * - copies plugins/claude-code → ~/.claude/plugins/cache/local/skill-router/<version>/
 * - registers the install in ~/.claude/plugins/installed_plugins.json
 * - enables it in ~/.claude/settings.json (enabledPlugins)
 *
 * All JSON files are written atomically (tmp + rename). Pre-existing state is
 * preserved — we only add/update our own keys.
 *
 * Idempotent: re-running upgrades the install in place.
 */
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const pluginSrc = join(repoRoot, "plugins/claude-code");
const pluginManifest = JSON.parse(await readFile(join(pluginSrc, ".claude-plugin/plugin.json"), "utf8"));
const version = pluginManifest.version;

const PLUGIN_NAME = "skill-router";
const MARKETPLACE = "local";
const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE}`;
const claudeHome = process.env["CLAUDE_HOME"] || join(homedir(), ".claude");
const installPath = join(claudeHome, "plugins/cache", MARKETPLACE, PLUGIN_NAME, version);
const installedJsonPath = join(claudeHome, "plugins/installed_plugins.json");
const settingsPath = join(claudeHome, "settings.json");

async function main() {
  log(`installing ${PLUGIN_KEY} v${version}`);
  log(`  target: ${installPath}`);

  await ensureBuild();
  await copyPlugin();
  await registerPlugin();
  await enablePlugin();

  log("");
  log("✓ installed.");
  log("");
  log("Next: restart Claude Code, then in a new session ask the model to slim your skills.");
  log("Manual CLI:");
  log(`  ${installPath}/bin/skill-router skills suggest`);
}

async function ensureBuild() {
  log("  building bundle (npm run build)...");
  const r = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot, stdio: "inherit",
    env: stripProxy(process.env),
  });
  if (r.status !== 0) throw new Error(`npm run build failed (exit ${r.status})`);
}

async function copyPlugin() {
  // Wipe target version dir first to make this idempotent across upgrades
  await rm(installPath, { recursive: true, force: true });
  await mkdir(dirname(installPath), { recursive: true });
  await cp(pluginSrc, installPath, { recursive: true });
  await chmod(join(installPath, "bin/skill-router"), 0o755);
  log(`  copied → ${installPath}`);
}

function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

async function registerPlugin() {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(installedJsonPath, "utf8"));
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */(err).code === "ENOENT") {
      parsed = { version: 2, plugins: {} };
    } else throw err;
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `${installedJsonPath} root is not a JSON object (got ${Array.isArray(parsed) ? "array" : typeof parsed}). ` +
      `Refusing to overwrite. Inspect or rename the file before retrying.`,
    );
  }
  if (!isPlainObject(parsed.plugins)) parsed.plugins = {};
  parsed.plugins[PLUGIN_KEY] = [
    {
      scope: "user",
      installPath,
      version,
      installedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    },
  ];
  await atomicWrite(installedJsonPath, JSON.stringify(parsed, null, 2) + "\n");
  log(`  registered in installed_plugins.json`);
}

async function enablePlugin() {
  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */(err).code !== "ENOENT") throw err;
  }
  if (!isPlainObject(settings)) {
    throw new Error(
      `${settingsPath} root is not a JSON object (got ${Array.isArray(settings) ? "array" : typeof settings}). ` +
      `Refusing to overwrite.`,
    );
  }
  if (!isPlainObject(settings.enabledPlugins)) settings.enabledPlugins = {};
  settings.enabledPlugins[PLUGIN_KEY] = true;
  await atomicWrite(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  log(`  enabled in settings.json`);
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

function log(msg) { process.stdout.write(msg + "\n"); }

main().catch((err) => {
  console.error("install failed:", err.message);
  process.exit(1);
});
