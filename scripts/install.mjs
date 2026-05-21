#!/usr/bin/env node
/**
 * Install skill-router as a local Claude Code plugin.
 *
 * - builds the bundle before copying
 * - copies the Claude Code manifest plus shared bin/lib/skills to
 *   ~/.claude/plugins/cache/local/skill-router/<version>/
 * - registers the install in ~/.claude/plugins/installed_plugins.json
 * - enables it in ~/.claude/settings.json (enabledPlugins)
 *
 * All JSON files are written atomically (tmp + rename). Pre-existing state is
 * preserved — we only add/update our own keys.
 *
 * Idempotent: re-running upgrades the install in place.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWrite } from "./lib/atomic-write.mjs";
import { PLUGIN_KEY, PLUGIN_NAME, MARKETPLACE, ensureBuild, isPlainObject, log } from "./lib/common.mjs";
import {
  cleanupOldVersions,
  copyPluginAssets,
  normalizeManifestSkills,
} from "./lib/plugin-install.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const pluginSrc = join(repoRoot, "plugins/claude-code");
const pluginManifest = JSON.parse(await readFile(join(pluginSrc, ".claude-plugin/plugin.json"), "utf8"));
const version = pluginManifest.version;

const claudeHome = process.env["CLAUDE_HOME"] || join(homedir(), ".claude");
const cacheRoot = join(claudeHome, "plugins/cache", MARKETPLACE, PLUGIN_NAME);
const installPath = join(cacheRoot, version);
const installedJsonPath = join(claudeHome, "plugins/installed_plugins.json");
const settingsPath = join(claudeHome, "settings.json");
const keepOld = process.argv.includes("--keep-old");

async function main() {
  log(`installing ${PLUGIN_KEY} v${version}`);
  log(`  target: ${installPath}`);

  ensureBuild({ repoRoot, log });
  await copyPluginAssets({ pluginSrc, repoRoot, installPath });
  await normalizeManifestSkills(join(installPath, ".claude-plugin/plugin.json"));
  log(`  copied → ${installPath}`);
  await registerPlugin();
  await enablePlugin();
  await cleanupOldVersions(cacheRoot, version, { keepOld, log });

  log("");
  log("✓ installed.");
  log("");
  log("Next: restart Claude Code, then in a new session ask the model to slim your skills.");
  log("Manual CLI:");
  log(`  ${installPath}/bin/skill-router skills suggest`);
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

main().catch((err) => {
  console.error("install failed:", err.message);
  process.exit(1);
});
