#!/usr/bin/env node
// One-time BASE_HOME setup for scaling-jbounded.
//
// Creates `.tmp-home/` with:
//   1. Claude credentials symlinked from real HOME (for `claude -p` auth)
//   2. skill-router plugin installed (via `npm run install:plugin`)
//   3. All skills from <corpus>/skills/ copied into ~/.claude/skills/
//   4. All user skills disabled (renamed SKILL.md -> SKILL.md.skill-router-disabled)
//
// Usage:
//   node setup-home.mjs --corpus=corpus-1000
//
// After this, routing-only-parallel.mjs can cp .tmp-home -> .tmp-home-parallel/<variant>/
// for each variant and run cells against an isolated copy.

import { spawn } from "node:child_process";
import { mkdir, copyFile, readFile, readdir, rm, cp, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const EXP_DIR = __dirname;
const HOME_CACHE = join(EXP_DIR, ".tmp-home");

const args = parseArgs(process.argv.slice(2));
const CORPUS_DIR = join(EXP_DIR, args.corpus);

function parseArgs(argv) {
  const out = { corpus: "corpus-1000" };
  for (const a of argv) {
    if (a.startsWith("--corpus=")) out.corpus = a.slice(9);
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

function buildEnv(home) {
  const proxy = process.env.CLAUDE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  return {
    ...process.env,
    HOME: home,
    ...(proxy ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy } : {}),
    NO_PROXY: process.env.NO_PROXY || "localhost,127.0.0.1",
    CLAUDE_HOME: undefined,
    SKILL_ROUTER_HOST: undefined,
  };
}

function runCmd(cmd, argv, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${argv.join(" ")} exit=${code}\nstderr: ${stderr.slice(0, 2000)}`));
    });
    child.on("error", reject);
  });
}

async function setupFreshHome() {
  if (existsSync(HOME_CACHE)) {
    log(`removing stale HOME ${HOME_CACHE}`);
    await rm(HOME_CACHE, { recursive: true, force: true });
  }
  await mkdir(join(HOME_CACHE, ".claude"), { recursive: true });
  const credSrc = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credSrc)) throw new Error(`missing ${credSrc}; claude -p needs auth`);
  await symlink(credSrc, join(HOME_CACHE, ".claude", ".credentials.json"));
  log(`linked credentials -> ${credSrc}`);
}

async function installPlugin(env) {
  log(`npm run install:plugin (HOME=${env.HOME})`);
  await mkdir(join(env.HOME, "project", ".skill-router"), { recursive: true });
  await mkdir(join(env.HOME, "project", ".git"), { recursive: true });
  await runCmd("npm", ["run", "install:plugin"], env, REPO_ROOT);
}

async function installSkillCorpus(env) {
  const skillsRoot = join(env.HOME, ".claude", "skills");
  await mkdir(skillsRoot, { recursive: true });
  const corpusSkills = join(CORPUS_DIR, "skills");
  if (!existsSync(corpusSkills)) {
    throw new Error(`corpus skills dir not found: ${corpusSkills}. Run crop.mjs first.`);
  }
  const dirs = (await readdir(corpusSkills, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const id of dirs) {
    await cp(join(corpusSkills, id), join(skillsRoot, id), { recursive: true });
  }
  log(`installed ${dirs.length} skills from ${args.corpus}/skills/`);
  return dirs.length;
}

async function installedRouterBin(home) {
  const manifest = JSON.parse(await readFile(join(REPO_ROOT, "plugins", "claude-code", ".claude-plugin", "plugin.json"), "utf8"));
  return join(home, ".claude", "plugins", "cache", "local", "skill-router", manifest.version, "bin", "skill-router");
}

async function disableAllUserSkills(env) {
  const routerBin = await installedRouterBin(env.HOME);
  const { stdout } = await runCmd(routerBin, ["skills", "list", "--json"], env);
  const all = JSON.parse(stdout);
  const userSkills = all.filter((s) => s.pluginKey === null && s.id.startsWith("user:") && s.id.split(":").length === 2);
  log(`disabling ${userSkills.length} user skills via router CLI`);
  const ids = userSkills.map((s) => s.id);
  const CHUNK = 30;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    await runCmd(routerBin, ["skills", "disable", ...chunk, "--yes", "--reason=scaling-jbounded", "--json"], env);
  }
}

const main = async () => {
  if (!existsSync(CORPUS_DIR)) {
    throw new Error(`corpus dir not found: ${CORPUS_DIR}. Run crop.mjs --cap=1000 first.`);
  }
  await setupFreshHome();
  const env = buildEnv(HOME_CACHE);
  await installPlugin(env);
  await installSkillCorpus(env);
  await disableAllUserSkills(env);
  log(`BASE_HOME ready: ${HOME_CACHE}`);
};

main().catch((e) => { console.error(e); process.exitCode = 1; });
