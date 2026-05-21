#!/usr/bin/env node
/**
 * Uninstall skill-router from Codex.
 *
 * - removes ~/.codex/plugins/cache/local/skill-router/
 * - sets [plugins."skill-router@local"].enabled = false in ~/.codex/config.toml
 * - removes ~/.codex/prompts/skill-router-skills.md
 *
 * Does NOT touch ~/.skill-router/ unless --purge is passed.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isManagedUnchanged } from "./prompt-marker.mjs";

const PLUGIN_NAME = "skill-router";
const MARKETPLACE = "local";
const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE}`;
const codexHome = process.env["CODEX_HOME"] || join(homedir(), ".codex");
const cacheDir = join(codexHome, "plugins/cache", MARKETPLACE, PLUGIN_NAME);
const configPath = join(codexHome, "config.toml");
const promptPath = join(codexHome, "prompts/skill-router-skills.md");
const stateDir = process.env["SKILL_ROUTER_STATE_DIR"] || join(homedir(), ".skill-router");
const statePath = join(stateDir, "state-codex.json");

const purge = process.argv.includes("--purge");

async function main() {
  log(`uninstalling ${PLUGIN_KEY}`);

  await warnAboutDisabledSkills();
  await removeCache();
  await disablePlugin();
  await removeSlashCommand();
  if (purge) await purgeState();

  log("");
  log("✓ uninstalled.");
  log("Restart Codex for the change to take full effect.");
  if (!purge) log(`State preserved at ${stateDir}/. Pass --purge to remove it.`);
}

async function warnAboutDisabledSkills() {
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return;
  }
  if (!state || typeof state !== "object" || !Array.isArray(state.disabledSkills)) return;
  const validRecords = state.disabledSkills.filter((r) => r && typeof r === "object" && typeof r.id === "string" && r.id.length > 0);
  if (validRecords.length > 0) {
    log(`! ${validRecords.length} skill(s) are still disabled by skill-router.`);
    log(`  Their SKILL.md files remain renamed even after uninstall.`);
    log(`  To restore them BEFORE uninstalling, run /skill-router:skills enable <id...> or use the bundled CLI.`);
    log("");
  }
}

async function removeCache() {
  await rm(cacheDir, { recursive: true, force: true });
  log(`  removed ${cacheDir}`);
}

async function disablePlugin() {
  let config;
  try {
    config = await readFile(configPath, "utf8");
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */(err).code === "ENOENT") return;
    throw err;
  }
  await atomicWrite(configPath, setPluginEnabled(config, PLUGIN_KEY, false));
  log(`  disabled in config.toml`);
}

async function removeSlashCommand() {
  let existing;
  try {
    existing = await readFile(promptPath, "utf8");
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */(err).code === "ENOENT") {
      log(`  /skill-router:skills prompt already absent`);
      return;
    }
    throw err;
  }

  if (!isManagedUnchanged(existing)) {
    process.stderr.write(
      `! ${promptPath} has local edits; keeping your version.\n` +
      `  Remove the file manually if you no longer need the /skill-router:skills slash command.\n`,
    );
    log(`  skipped /skill-router:skills prompt (user-modified)`);
    return;
  }

  await rm(promptPath, { force: true });
  log(`  removed /skill-router:skills prompt`);
}

async function purgeState() {
  await rm(stateDir, { recursive: true, force: true });
  log(`  purged ${stateDir}`);
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

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

function log(msg) {
  process.stdout.write(msg + "\n");
}

main().catch((err) => {
  console.error("uninstall failed:", err.message);
  process.exit(1);
});
