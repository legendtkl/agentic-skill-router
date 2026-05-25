#!/usr/bin/env node
// Parallel routing-only bench for scaling-jbounded:
//   {I-meta, J-bounded} × 24 queries × 1 corpus size (configurable).
//
// Each variant runs in its own HOME (`.tmp-home-parallel/<variant>/`) carved
// from the base `.tmp-home`. Plugin SKILL.md is swapped per HOME to the
// variant body. Within a variant, queries run sequentially. Across variants,
// up to CONCURRENCY HOMEs run in parallel.
//
// Outputs:
//   runs/<run-id>/<variant>/<query>.jsonl  — per-cell stream-json transcript
//   runs/<run-id>/summary.json             — aggregated run metadata
//
// Usage:
//   node routing-only-parallel.mjs --corpus=corpus-1000 [--run-id=cap-1000]
//                                  [--append-system-prompt]

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, rename, rm, cp, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const BASE_HOME = join(EXP_DIR, ".tmp-home");
const PARALLEL_HOMES_DIR = join(EXP_DIR, ".tmp-home-parallel");
const VARIANTS_DIR = join(EXP_DIR, "variants");
const TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 240_000;
const CONCURRENCY = Number(process.env.PARALLEL_CONCURRENCY) || 2;

const args = parseArgs(process.argv.slice(2));
const CORPUS_DIR = join(EXP_DIR, args.corpus);
const RUN_ID = args.runId ?? args.corpus.replace(/^corpus-/, "cap-");
const OUT_DIR = join(EXP_DIR, "runs", RUN_ID);

function parseArgs(argv) {
  const out = { corpus: "corpus-1000", runId: null, appendSystemPrompt: false };
  for (const a of argv) {
    if (a.startsWith("--corpus=")) out.corpus = a.slice(9);
    else if (a.startsWith("--run-id=")) out.runId = a.slice(9);
    else if (a === "--append-system-prompt") out.appendSystemPrompt = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

const ROUTER_SYSTEM_PROMPT = [
  "This session is a disabled-skill routing benchmark.",
  "",
  "For EVERY user request — regardless of subject, even if it is purely",
  "conversational, even if you believe you can answer directly, even if",
  "you intend to refuse or ask clarifying questions — your FIRST tool",
  "call MUST be the `skill-router:skill-router-skills` Skill. After",
  "invoking it, follow its workflow exactly. Do not call any other tool",
  "before it; do not answer or refuse before it.",
].join("\n");

const STOP_TAIL = `

---
ROUTING-ONLY mode: this session evaluates skill routing accuracy only.
After identifying the single best matching disabled skill, output exactly
one line of minified JSON on its own and stop:

{"matched_skill_name":"<skill-id>"}

Do NOT Read the matched skill's body, do NOT execute the user's task above,
do NOT produce any other text. This overrides any "execute the task"
guidance in the skill router's instructions.`;

const VARIANTS = [
  { id: "I-meta", mode: "router" },
  { id: "J-bounded", mode: "router" },
];

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// Toggle corpus in a SPECIFIC HOME (defensive — setup-home.mjs already left
// everything disabled, but the parallel driver should be idempotent).
async function ensureDisabled(home) {
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

async function prepareHome(variant) {
  const home = join(PARALLEL_HOMES_DIR, variant.id);
  const lockFile = join(PARALLEL_HOMES_DIR, `${variant.id}.lock`);
  if (existsSync(lockFile)) {
    const age = Date.now() - (await stat(lockFile)).mtimeMs;
    if (age < 60 * 60 * 1000) {
      throw new Error(`HOME ${home} is locked (lock age ${Math.round(age / 1000)}s). Another driver run may be active. Remove ${lockFile} if you know it's stale.`);
    }
    log(`[${variant.id}] stale lock found (${Math.round(age / 1000)}s old), proceeding`);
  }
  await rm(home, { recursive: true, force: true });
  await cp(BASE_HOME, home, { recursive: true, dereference: true });
  await writeFile(lockFile, `${process.pid}\n${new Date().toISOString()}\n`);
  const n = await ensureDisabled(home);
  log(`[${variant.id}] HOME ready, ${n} skills toggled to disabled`);
  // Patch the plugin's skill-router-skills SKILL.md to this variant's body.
  const pluginSkillMd = await findPluginSkillMd(home);
  await cp(join(VARIANTS_DIR, `${variant.id}.SKILL.md`), pluginSkillMd);
  log(`[${variant.id}] plugin SKILL.md <- variants/${variant.id}.SKILL.md`);
  await mkdir(join(home, "tmp"), { recursive: true });
  return home;
}

async function findPluginSkillMd(home) {
  const root = join(home, ".claude", "plugins", "cache", "local", "skill-router");
  const versions = await readdir(root, { withFileTypes: true });
  const versionDir = versions.find((d) => d.isDirectory());
  if (!versionDir) throw new Error(`no skill-router plugin version found under ${root}`);
  return join(root, versionDir.name, "skills", "skill-router-skills", "SKILL.md");
}

async function releaseHome(variant) {
  const lockFile = join(PARALLEL_HOMES_DIR, `${variant.id}.lock`);
  await rm(lockFile, { force: true });
}

async function runOne(variant, home, queryObj) {
  const project = join(home, "project-routing-only");
  await mkdir(project, { recursive: true });
  const env = { ...process.env, HOME: home, TMPDIR: join(home, "tmp") };
  const fullQuery = queryObj.query + STOP_TAIL;
  const claudeArgs = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
  ];
  if (args.appendSystemPrompt) {
    claudeArgs.push("--append-system-prompt", ROUTER_SYSTEM_PROMPT);
  }
  if (variant.mode === "router") {
    const pluginDir = join(home, ".claude", "plugins", "cache", "local", "skill-router");
    const versions = await readdir(pluginDir, { withFileTypes: true });
    const versionDir = versions.find((d) => d.isDirectory()).name;
    claudeArgs.push("--plugin-dir", join(pluginDir, versionDir));
  }
  const out = join(OUT_DIR, variant.id, `${queryObj.id}.jsonl`);
  await mkdir(dirname(out), { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  log(`[${variant.id}] ${queryObj.id} spawn`);
  const child = spawn("claude", claudeArgs, { env, cwd: project, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", (err) => {
    if (timedOut) return;
    timedOut = true;
    events.push({ type: "_run_error", error: `spawn failed: ${String(err).slice(0, 400)}` });
  });
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk;
    let nl;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.trim()) {
        try { events.push(JSON.parse(line)); } catch { events.push({ type: "_raw", line }); }
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
    try { events.push(JSON.parse(stdoutBuf)); } catch { events.push({ type: "_raw", line: stdoutBuf }); }
  }
  if (stderrBuf) events.push({ type: "_stderr", text: stderrBuf.slice(0, 4000) });
  if (timedOut) events.push({ type: "_run_error", error: `claude -p timed out after ${TIMEOUT_MS}ms` });
  await writeFile(out, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[${variant.id}] ${queryObj.id} done exit=${exitCode} timedOut=${timedOut} dur=${dur}s events=${events.length}`);
  return { variant: variant.id, queryId: queryObj.id, exitCode, timedOut, durationMs: Date.now() - t0 };
}

async function runVariant(variant, queries) {
  const home = await prepareHome(variant);
  const results = [];
  try {
    for (const q of queries) {
      try {
        results.push(await runOne(variant, home, q));
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        log(`[${variant.id}] ${q.id} threw: ${err.message}`);
        results.push({ variant: variant.id, queryId: q.id, error: String(err).slice(0, 500) });
      }
    }
  } finally {
    await releaseHome(variant).catch(() => {});
  }
  return results;
}

async function runWithCap(items, cap, work) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]).catch((err) => ({ __error: err }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, worker));
  return out;
}

async function main() {
  if (!existsSync(BASE_HOME)) {
    throw new Error(`BASE_HOME missing: ${BASE_HOME}. Run setup-home.mjs --corpus=${args.corpus} first.`);
  }
  const queriesAll = JSON.parse(await readFile(join(CORPUS_DIR, "queries.json"), "utf8")).queries;
  log(`harness: ${VARIANTS.length} variants × ${queriesAll.length} queries from ${args.corpus}. Concurrency=${CONCURRENCY}. Timeout=${TIMEOUT_MS}ms. Append-system-prompt=${args.appendSystemPrompt}`);

  const startedAt = new Date().toISOString();
  await mkdir(PARALLEL_HOMES_DIR, { recursive: true });
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const settled = await runWithCap(VARIANTS, CONCURRENCY, (v) => runVariant(v, queriesAll));
  const all = settled.flatMap((r) => r?.__error ? [{ __error: String(r.__error).slice(0, 500) }] : (r || []));
  const errors = settled.filter((r) => r?.__error);
  if (errors.length) log(`WARN: ${errors.length} variant(s) errored: ${errors.map((e) => String(e.__error).slice(0, 200)).join(" | ")}`);
  const finishedAt = new Date().toISOString();

  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({
    startedAt,
    finishedAt,
    runId: RUN_ID,
    corpus: args.corpus,
    appendSystemPrompt: args.appendSystemPrompt,
    parallelHomesDir: PARALLEL_HOMES_DIR,
    timeoutMs: TIMEOUT_MS,
    concurrency: CONCURRENCY,
    queries: queriesAll.map((q) => ({ id: q.id, expected: q.expected, domain: q.domain })),
    variants: VARIANTS,
    runs: all,
  }, null, 2));
  log(`summary -> ${join(OUT_DIR, "summary.json")}`);
  if (errors.length) process.exitCode = 2;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
