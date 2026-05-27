#!/usr/bin/env node
/**
 * Uninstall agentic-skill-router from Codex.
 *
 * - removes ~/.codex/plugins/cache/local/agentic-skill-router/
 * - sets [plugins."agentic-skill-router@local"].enabled = false in ~/.codex/config.toml
 * - removes ~/.codex/prompts/agentic-skill-router-skills.md
 *
 * Does NOT touch ~/.agentic-skill-router/ unless --purge is passed.
 */
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { atomicWrite } from "./lib/atomic-write.mjs";
import { PLUGIN_KEY, PLUGIN_NAME, MARKETPLACE, log } from "./lib/common.mjs";
import { warnAboutDisabledSkills } from "./lib/plugin-install.mjs";
import { setPluginEnabled } from "./lib/toml-plugin.mjs";
import { isManagedUnchanged } from "./prompt-marker.mjs";

const codexHome = process.env["CODEX_HOME"] || join(homedir(), ".codex");
const cacheDir = join(codexHome, "plugins/cache", MARKETPLACE, PLUGIN_NAME);
const configPath = join(codexHome, "config.toml");
const promptPath = join(codexHome, "prompts/agentic-skill-router-skills.md");
const stateDir = process.env["AGENTIC_SKILL_ROUTER_STATE_DIR"] || join(homedir(), ".agentic-skill-router");
const statePath = join(stateDir, "state-codex.json");

const purge = process.argv.includes("--purge");

async function main() {
  log(`uninstalling ${PLUGIN_KEY}`);

  await warnAboutDisabledSkills({
    statePath,
    warnPrefix: "!",
    formatRestoreHint: () => [
      `  To restore them BEFORE uninstalling, run /agentic-skill-router:skills enable <id...> or use the bundled CLI.`,
    ],
    log,
  });
  await removeCache();
  await disablePlugin();
  await removeSlashCommand();
  if (purge) await purgeState();

  log("");
  log("✓ uninstalled.");
  log("Restart Codex for the change to take full effect.");
  if (!purge) log(`State preserved at ${stateDir}/. Pass --purge to remove it.`);
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
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return;
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
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
      log(`  /agentic-skill-router:skills prompt already absent`);
      return;
    }
    throw err;
  }

  if (!isManagedUnchanged(existing)) {
    process.stderr.write(
      `! ${promptPath} has local edits; keeping your version.\n` +
        `  Remove the file manually if you no longer need the /agentic-skill-router:skills slash command.\n`,
    );
    log(`  skipped /agentic-skill-router:skills prompt (user-modified)`);
    return;
  }

  await rm(promptPath, { force: true });
  log(`  removed /agentic-skill-router:skills prompt`);
}

async function purgeState() {
  await rm(stateDir, { recursive: true, force: true });
  log(`  purged ${stateDir}`);
}

main().catch((err) => {
  console.error("uninstall failed:", err.message);
  process.exit(1);
});
