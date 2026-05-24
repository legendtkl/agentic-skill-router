#!/usr/bin/env node
// One-time setup for .tmp-home-150 — uses dci-compare's 150-skill cropped
// corpus (anonymized skill-NNN ids). Drop-in equivalent to setup-home.mjs but
// reads from the cropped directory instead of from full SkillRouter shards.
//
// Flow:
//   1. fresh .tmp-home-150 with credentials + plugin install
//   2. copy each dci-compare/skillrouter-skills/skill-NNN/SKILL.md as
//      <HOME>/.claude/skills/skill-NNN/SKILL.md.skill-router-disabled
//
// Usage: node setup-home-150.mjs

import { spawn } from "node:child_process";
import { mkdir, copyFile, readdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const HOME = join(__dirname, ".tmp-home-150");
const CORPUS = join(__dirname, "..", "dci-compare", "skillrouter-skills");

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

function buildEnv() {
  const proxy = process.env.CLAUDE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  return {
    ...process.env,
    HOME,
    TMPDIR: join(HOME, "tmp"),
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
      else reject(new Error(`${cmd} ${argv.slice(0, 3).join(" ")} exit=${code}\n${stderr.slice(0, 2000)}`));
    });
    child.on("error", reject);
  });
}

async function setupHome() {
  if (existsSync(HOME)) {
    log(`removing stale HOME ${HOME}`);
    await rm(HOME, { recursive: true, force: true });
  }
  await mkdir(join(HOME, ".claude"), { recursive: true });
  await mkdir(join(HOME, "tmp"), { recursive: true });
  const credSrc = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credSrc)) throw new Error(`missing ${credSrc}; claude -p needs auth`);
  await symlink(credSrc, join(HOME, ".claude", ".credentials.json"));
  log(`linked credentials -> ${credSrc}`);
}

async function installPlugin(env) {
  log(`npm run install:plugin (HOME=${env.HOME})`);
  await mkdir(join(env.HOME, "project", ".skill-router"), { recursive: true });
  await mkdir(join(env.HOME, "project", ".git"), { recursive: true });
  await runCmd("npm", ["run", "install:plugin"], env, REPO_ROOT);
  log(`plugin installed`);
}

async function installCorpus() {
  const skillsRoot = join(HOME, ".claude", "skills");
  await mkdir(skillsRoot, { recursive: true });
  const dirs = (await readdir(CORPUS, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  log(`copying ${dirs.length} skills from dci-compare/skillrouter-skills/`);
  for (const id of dirs) {
    const srcMd = join(CORPUS, id, "SKILL.md");
    const dstDir = join(skillsRoot, id);
    await mkdir(dstDir, { recursive: true });
    // Drop in directly as disabled — no enable/disable cycle through the CLI.
    const body = await readFile(srcMd, "utf8");
    await writeFile(join(dstDir, "SKILL.md.skill-router-disabled"), body);
  }
  log(`corpus install done: ${dirs.length} skills`);
  return dirs.length;
}

const main = async () => {
  await setupHome();
  const env = buildEnv();
  await installPlugin(env);
  const n = await installCorpus();
  log(`HOME ready: ${HOME} (${n} skills)`);
};

main().catch((e) => { console.error(e); process.exit(1); });
