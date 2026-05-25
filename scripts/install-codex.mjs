#!/usr/bin/env node
/**
 * Install skill-router as a local Codex plugin plus slash command.
 *
 * - builds the bundle before copying
 * - copies the shared bin/lib runtime to ~/.skill-router/runtime/<version>/
 * - copies the Codex manifest plus skills and a host wrapper to
 *   ~/.codex/plugins/cache/local/skill-router/<version>/
 * - enables [plugins."skill-router@local"] in ~/.codex/config.toml
 * - copies prompts/skill-router-skills.md -> ~/.codex/prompts/
 *
 * Idempotent: re-running upgrades the install in place.
 */
import { copyFile, cp, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWrite } from "./lib/atomic-write.mjs";
import { PLUGIN_KEY, PLUGIN_NAME, MARKETPLACE, ensureBuild, log } from "./lib/common.mjs";
import {
  cleanupOldVersions,
  copyPluginAssets,
  copyRuntimeAssets,
  normalizeManifestSkills,
  writeHostWrapper,
} from "./lib/plugin-install.mjs";
import { setPluginEnabled } from "./lib/toml-plugin.mjs";
import { isManagedUnchanged } from "./prompt-marker.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const pluginSrc = join(repoRoot, "plugins/codex");
const pluginManifest = JSON.parse(await readFile(join(pluginSrc, ".codex-plugin/plugin.json"), "utf8"));
const version = pluginManifest.version;

const codexHome = process.env["CODEX_HOME"] || join(homedir(), ".codex");
const cacheRoot = join(codexHome, "plugins/cache", MARKETPLACE, PLUGIN_NAME);
const installPath = join(cacheRoot, version);
const runtimeCacheRoot = process.env["SKILL_ROUTER_RUNTIME_ROOT"] || join(homedir(), ".skill-router", "runtime");
const runtimePath = join(runtimeCacheRoot, version);
const runtimeBin = join(runtimePath, "bin", "skill-router");
const configPath = join(codexHome, "config.toml");
const promptSrc = join(pluginSrc, "prompts/skill-router-skills.md");
const promptPath = join(codexHome, "prompts/skill-router-skills.md");
const keepOld = process.argv.includes("--keep-old");

async function main() {
  log(`installing ${PLUGIN_KEY} v${version}`);
  log(`  target: ${installPath}`);

  ensureBuild({ repoRoot, log });
  await copyRuntimeAssets({ repoRoot, runtimePath });
  log(`  runtime -> ${runtimePath}`);
  await copyPluginAssets({ pluginSrc, repoRoot, installPath });
  await normalizeManifestSkills(join(installPath, ".codex-plugin/plugin.json"));
  await writeHostWrapper({
    wrapperPath: join(installPath, "bin", "skill-router"),
    runtimeBin,
    hostName: "codex",
    assetRoot: installPath,
  });
  log(`  copied -> ${installPath}`);
  await enablePlugin();
  await installSlashCommand();
  await cleanupOldVersions(cacheRoot, version, { keepOld, log });

  log("");
  log("✓ installed.");
  log("");
  log("Next: restart Codex, then run:");
  log("  /skill-router:skills");
  log("Manual CLI:");
  log(`  ${installPath}/bin/skill-router skills suggest`);
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

main().catch((err) => {
  console.error("install failed:", err.message);
  process.exit(1);
});
