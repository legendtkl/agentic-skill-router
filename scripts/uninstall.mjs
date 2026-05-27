#!/usr/bin/env node
/**
 * Uninstall agentic-skill-router from Claude Code.
 *
 * - removes ~/.claude/plugins/cache/local/agentic-skill-router/
 * - removes the entry from ~/.claude/plugins/installed_plugins.json
 * - sets enabledPlugins[agentic-skill-router@local] = false in settings.json (does not
 *   delete the key, so re-install can re-enable cleanly)
 *
 * Does NOT touch ~/.agentic-skill-router/ (state + config). To wipe that too, pass
 * --purge.
 *
 * Does NOT auto-enable previously-disabled skills. If the user wants those
 * SKILL.md files renamed back, they should run
 *   node <bundle> skills enable <id...>
 * BEFORE uninstalling. We print a warning if state has disabled records.
 */
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { atomicWrite } from "./lib/atomic-write.mjs";
import { PLUGIN_KEY, PLUGIN_NAME, MARKETPLACE, isPlainObject, log } from "./lib/common.mjs";
import { warnAboutDisabledSkills } from "./lib/plugin-install.mjs";

const claudeHome = process.env["CLAUDE_HOME"] || join(homedir(), ".claude");
const cacheDir = join(claudeHome, "plugins/cache", MARKETPLACE, PLUGIN_NAME);
const installedJsonPath = join(claudeHome, "plugins/installed_plugins.json");
const settingsPath = join(claudeHome, "settings.json");
const stateDir = process.env["AGENTIC_SKILL_ROUTER_STATE_DIR"] || join(homedir(), ".agentic-skill-router");
const statePath = join(stateDir, "state-claude-code.json");

const purge = process.argv.includes("--purge");

async function main() {
  log(`uninstalling ${PLUGIN_KEY}`);

  await warnAboutDisabledSkills({
    statePath,
    warnPrefix: "⚠",
    reportMalformed: true,
    formatRestoreHint: (records) => {
      const lines = [`  To restore them BEFORE uninstalling, run:`];
      for (const r of records.slice(0, 5)) {
        lines.push(`    (use the bundled CLI) skills enable ${r.id}`);
      }
      if (records.length > 5) {
        lines.push(`  …and ${records.length - 5} more.`);
      }
      return lines;
    },
    log,
  });
  await removeCache();
  await unregister();
  await disable();
  if (purge) await purgeState();

  log("");
  log("✓ uninstalled.");
  log("Restart Claude Code for the change to take full effect.");
  if (!purge) {
    log(`State preserved at ${stateDir}/. Pass --purge to remove it.`);
  }
}

async function removeCache() {
  await rm(cacheDir, { recursive: true, force: true });
  log(`  removed ${cacheDir}`);
}

async function unregister() {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(installedJsonPath, "utf8"));
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return;
    throw err;
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.plugins)) return;
  if (parsed.plugins[PLUGIN_KEY]) {
    delete parsed.plugins[PLUGIN_KEY];
    await atomicWrite(installedJsonPath, JSON.stringify(parsed, null, 2) + "\n");
    log(`  unregistered from installed_plugins.json`);
  }
}

async function disable() {
  let settings;
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return;
    throw err;
  }
  if (!isPlainObject(settings) || !isPlainObject(settings.enabledPlugins)) return;
  if (PLUGIN_KEY in settings.enabledPlugins) {
    settings.enabledPlugins[PLUGIN_KEY] = false;
    await atomicWrite(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    log(`  disabled in settings.json (key kept as false)`);
  }
}

async function purgeState() {
  await rm(stateDir, { recursive: true, force: true });
  log(`  purged ${stateDir}`);
}

main().catch((err) => {
  console.error("uninstall failed:", err.message);
  process.exit(1);
});
