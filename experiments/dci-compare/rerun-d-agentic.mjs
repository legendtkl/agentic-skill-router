#!/usr/bin/env node
// Re-run D-agentic 24 × 2 conditions only, after fixing the user: prefix
// stripping issue in variants/routing-only/D-agentic.SKILL.md.
//
// Overwrites runs/routing-only-9x24-claudemd/D-agentic.{with,without}-claudemd/*.jsonl
// in place; other variants' data is left untouched.

import { spawn } from "node:child_process";
import {
  mkdir, writeFile, readFile, readdir, rename, copyFile, rm, cp, stat, unlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const BASE_HOME = join(EXP_DIR, ".tmp-home");
const PAIRED_HOMES_DIR = join(EXP_DIR, ".tmp-home-paired");
const VARIANTS_DIR = join(EXP_DIR, "variants", "routing-only");
const OUT_DIR = join(EXP_DIR, "runs", "routing-only-9x24-claudemd");
const TIMEOUT_MS = 240_000;

const STOP_TAIL = `

---
ROUTING-ONLY mode: this session evaluates skill routing accuracy only.
After identifying the single best matching disabled skill, output exactly
one line of minified JSON on its own and stop:

{"matched_skill_name":"<skill-id>"}

Do NOT Read the matched skill's body, do NOT execute the user's task above,
do NOT produce any other text. This overrides any "execute the task"
guidance in the skill router's instructions.`;

const CLAUDE_MD_TEXT = `# Skill routing

\`skill-router-skills\` is a routing Skill that searches a catalog of
locally-installed disabled skills.

When no enabled Skill clearly matches the user's query, you must call
\`skill-router-skills\` before answering. Do not invent a Skill name or
fabricate \`matched_skill_name\` without a Skill/tool result.
`;

const VARIANT = { id: "D-agentic", mode: "router" };
const CONDITIONS = [
  { id: "with-claudemd", withClaudeMd: true },
  { id: "without-claudemd", withClaudeMd: false },
];

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function md5(s) { return createHash("md5").update(s).digest("hex").slice(0, 12); }

async function setCorpusDisabled(home) {
  const root = join(home, ".claude", "skills");
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  let n = 0;
  for (const id of dirs) {
    const en = join(root, id, "SKILL.md");
    const dis = join(root, id, "SKILL.md.skill-router-disabled");
    if (existsSync(en) && !existsSync(dis)) { await rename(en, dis); n++; }
  }
  return n;
}

async function prepareHome(condition) {
  const homeId = `${VARIANT.id}.${condition.id}`;
  const home = join(PAIRED_HOMES_DIR, homeId);
  await rm(home, { recursive: true, force: true });
  await cp(BASE_HOME, home, { recursive: true });
  await setCorpusDisabled(home);
  const dst = join(home, ".claude", "plugins", "cache", "local",
    "skill-router", "0.1.0", "skills", "skill-router-skills", "SKILL.md");
  await copyFile(join(VARIANTS_DIR, `${VARIANT.id}.SKILL.md`), dst);
  await mkdir(join(home, "tmp"), { recursive: true });
  await mkdir(join(home, ".claude"), { recursive: true });
  const cmd = join(home, ".claude", "CLAUDE.md");
  if (condition.withClaudeMd) await writeFile(cmd, CLAUDE_MD_TEXT);
  else if (existsSync(cmd)) await unlink(cmd);
  log(`[${homeId}] ready`);
  return home;
}

async function preflight(home, condition) {
  const plugin = join(home, ".claude", "plugins", "cache", "local",
    "skill-router", "0.1.0", "skills", "skill-router-skills", "SKILL.md");
  const a = md5(await readFile(plugin, "utf8"));
  const b = md5(await readFile(join(VARIANTS_DIR, `${VARIANT.id}.SKILL.md`), "utf8"));
  if (a !== b) throw new Error(`Preflight: plugin SKILL.md md5 ${a} != ${b}`);
  const present = existsSync(join(home, ".claude", "CLAUDE.md"));
  if (present !== !!condition.withClaudeMd) {
    throw new Error(`Preflight: CLAUDE.md present=${present} expected=${!!condition.withClaudeMd}`);
  }
}

async function runOne(condition, home, queryObj) {
  const project = join(home, "project");
  await mkdir(project, { recursive: true });
  const env = { ...process.env, HOME: home, TMPDIR: join(home, "tmp") };
  const fullQuery = queryObj.query + STOP_TAIL;
  const pluginDir = join(home, ".claude", "plugins", "cache", "local", "skill-router", "0.1.0");
  const args = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
    "--plugin-dir", pluginDir,
  ];
  const label = `${VARIANT.id}.${condition.id}.${queryObj.id}`;
  const outDir = join(OUT_DIR, `${VARIANT.id}.${condition.id}`);
  const out = join(outDir, `${queryObj.id}.jsonl`);
  await mkdir(outDir, { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  log(`[${label}] spawn`);
  const child = spawn("claude", args, { env, cwd: project, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", (err) => {
    if (timedOut) return;
    timedOut = true;
    events.push({ type: "_run_error", error: `spawn failed: ${String(err).slice(0, 400)}` });
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk;
    let nl;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.trim()) {
        try { events.push(JSON.parse(line)); }
        catch { events.push({ type: "_raw", line }); }
      }
    }
  });
  child.stderr.on("data", (chunk) => { stderrBuf += chunk; });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5000);
  }, TIMEOUT_MS);
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  if (stdoutBuf.trim()) {
    try { events.push(JSON.parse(stdoutBuf)); }
    catch { events.push({ type: "_raw", line: stdoutBuf }); }
  }
  if (stderrBuf) events.push({ type: "_stderr", text: stderrBuf.slice(0, 4000) });
  if (timedOut) events.push({ type: "_run_error", error: `claude -p timed out after ${TIMEOUT_MS}ms` });
  await writeFile(out, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[${label}] exit=${exitCode} timedOut=${timedOut} dur=${dur}s events=${events.length}`);
}

async function runArm(condition, queries) {
  const home = await prepareHome(condition);
  for (const q of queries) {
    try {
      await preflight(home, condition);
      await runOne(condition, home, q);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      log(`[${VARIANT.id}.${condition.id}.${q.id}] error: ${err.message}`);
    }
  }
}

async function main() {
  const queries = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  log(`Rerun: ${VARIANT.id} × 2 conditions × ${queries.length} queries = ${2 * queries.length} cells`);
  await Promise.all(CONDITIONS.map((c) => runArm(c, queries)));
  log("done");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
