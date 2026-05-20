#!/usr/bin/env node
/**
 * Uninstall skill-router from Claude Code.
 *
 * - removes ~/.claude/plugins/cache/local/skill-router/
 * - removes the entry from ~/.claude/plugins/installed_plugins.json
 * - sets enabledPlugins[skill-router@local] = false in settings.json (does not
 *   delete the key, so re-install can re-enable cleanly)
 *
 * Does NOT touch ~/.skill-router/ (state + config). To wipe that too, pass
 * --purge.
 *
 * Does NOT auto-enable previously-disabled skills. If the user wants those
 * SKILL.md files renamed back, they should run
 *   node <bundle> skills enable <id...>
 * BEFORE uninstalling. We print a warning if state has disabled records.
 */
import { readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PLUGIN_NAME = "skill-router";
const MARKETPLACE = "local";
const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE}`;
const claudeHome = process.env["CLAUDE_HOME"] || join(homedir(), ".claude");
const cacheDir = join(claudeHome, "plugins/cache", MARKETPLACE, PLUGIN_NAME);
const installedJsonPath = join(claudeHome, "plugins/installed_plugins.json");
const settingsPath = join(claudeHome, "settings.json");
const stateDir = process.env["SKILL_ROUTER_STATE_DIR"] || join(homedir(), ".skill-router");
const statePath = join(stateDir, "state-claude-code.json");

const purge = process.argv.includes("--purge");

async function main() {
  log(`uninstalling ${PLUGIN_KEY}`);

  await warnAboutDisabledSkills();
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

function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

async function warnAboutDisabledSkills() {
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch { return; }
  if (!isPlainObject(state) || !Array.isArray(state.disabledSkills)) return;
  const validRecords = state.disabledSkills.filter(
    (r) => isPlainObject(r) && typeof r.id === "string" && r.id.length > 0,
  );
  const malformed = state.disabledSkills.length - validRecords.length;
  if (malformed > 0) {
    log(`⚠ ${malformed} malformed disable record(s) ignored in ${statePath}.`);
  }
  if (validRecords.length > 0) {
    log(`⚠ ${validRecords.length} skill(s) are still disabled by skill-router.`);
    log(`  Their SKILL.md files remain renamed even after uninstall.`);
    log(`  To restore them BEFORE uninstalling, run:`);
    for (const r of validRecords.slice(0, 5)) {
      log(`    (use the bundled CLI) skills enable ${r.id}`);
    }
    if (validRecords.length > 5) log(`  …and ${validRecords.length - 5} more.`);
    log("");
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
    if (err && /** @type {NodeJS.ErrnoException} */(err).code === "ENOENT") return;
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
    if (err && /** @type {NodeJS.ErrnoException} */(err).code === "ENOENT") return;
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

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

function log(msg) { process.stdout.write(msg + "\n"); }

main().catch((err) => {
  console.error("uninstall failed:", err.message);
  process.exit(1);
});
