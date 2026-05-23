#!/usr/bin/env node
// Parallel routing-only bench: 9 variants × 21 remaining queries
// (queries.json minus the 3 already covered by routing-only-9x3).
//
// Environment isolation: each variant gets its own HOME directory
// (`.tmp-home-parallel/<variant>/`) carved from the base `.tmp-home`. The
// corpus state and plugin SKILL.md are set ONCE per HOME, so 9 variants
// can run concurrently without stepping on each other's filesystem state.
// Within a single variant the 21 queries are run sequentially to avoid
// the same variant racing itself against Anthropic rate limits.
//
// Outputs are written to `runs/routing-only-9x24/<variant>/<query>.jsonl`.
// Existing 3-query transcripts from `runs/routing-only-9x3/<variant>/` are
// copied into the same directory so the renderer can show all 24 queries.

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, rename, copyFile, rm, cp, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const BASE_HOME = join(EXP_DIR, ".tmp-home");
const PARALLEL_HOMES_DIR = join(EXP_DIR, ".tmp-home-parallel");
const VARIANTS_DIR = join(EXP_DIR, "variants", "routing-only");
const PREV_OUT_DIR = join(EXP_DIR, "runs", "routing-only-9x3");
const OUT_DIR = join(EXP_DIR, "runs", "routing-only-9x24");
const TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 240_000;
const CONCURRENCY = Number(process.env.PARALLEL_CONCURRENCY) || 4;
const ALREADY_DONE = new Set(["3d-scan-calc", "dialogue-parser", "citation-check"]);

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
  { id: "G-native", mode: "native" },
  { id: "A-router", mode: "router" },
  { id: "B-cc", mode: "router" },
  { id: "C-lite", mode: "router" },
  { id: "D-agentic", mode: "router" },
  { id: "E-digest", mode: "router" },
  { id: "H-bounded", mode: "router" },
  { id: "I-meta", mode: "router" },
  { id: "J-bounded", mode: "router" },
];

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// Toggle corpus inside a SPECIFIC HOME.
async function setCorpusState(home, target) {
  const root = join(home, ".claude", "skills");
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  let n = 0;
  for (const id of dirs) {
    const en = join(root, id, "SKILL.md");
    const dis = join(root, id, "SKILL.md.skill-router-disabled");
    if (target === "enabled" && existsSync(dis) && !existsSync(en)) { await rename(dis, en); n++; }
    else if (target === "disabled" && existsSync(en) && !existsSync(dis)) { await rename(en, dis); n++; }
  }
  return n;
}

async function prepareHome(variant) {
  const home = join(PARALLEL_HOMES_DIR, variant.id);
  const lockFile = join(PARALLEL_HOMES_DIR, `${variant.id}.lock`);
  // Refuse to wipe a HOME if another driver run is still holding the lock.
  if (existsSync(lockFile)) {
    const age = Date.now() - (await stat(lockFile)).mtimeMs;
    if (age < 60 * 60 * 1000) {
      throw new Error(`HOME ${home} is locked (lock age ${Math.round(age / 1000)}s). Another driver run may be active. Remove ${lockFile} if you know it's stale.`);
    }
    log(`[${variant.id}] stale lock found (${Math.round(age / 1000)}s old), proceeding`);
  }
  await rm(home, { recursive: true, force: true });
  await cp(BASE_HOME, home, { recursive: true });
  await writeFile(lockFile, `${process.pid}\n${new Date().toISOString()}\n`);
  const target = variant.mode === "native" ? "enabled" : "disabled";
  const n = await setCorpusState(home, target);
  log(`[${variant.id}] HOME ready, corpus=${target} (${n} renames)`);
  if (variant.mode === "router") {
    const dst = join(home, ".claude", "plugins", "cache", "local",
                     "skill-router", "0.1.0", "skills", "skill-router-skills", "SKILL.md");
    await copyFile(join(VARIANTS_DIR, `${variant.id}.SKILL.md`), dst);
    log(`[${variant.id}] plugin SKILL.md <- variants/routing-only/${variant.id}.SKILL.md`);
  }
  // Per-HOME tmpdir so Claude Code's `/tmp/claude-*` sessions don't collide
  // across variants.
  await mkdir(join(home, "tmp"), { recursive: true });
  return home;
}

async function releaseHome(variant) {
  const lockFile = join(PARALLEL_HOMES_DIR, `${variant.id}.lock`);
  await rm(lockFile, { force: true });
}

async function copyAlreadyDoneTranscripts(variant) {
  await mkdir(join(OUT_DIR, variant.id), { recursive: true });
  for (const qid of ALREADY_DONE) {
    const src = join(PREV_OUT_DIR, variant.id, `${qid}.jsonl`);
    const dst = join(OUT_DIR, variant.id, `${qid}.jsonl`);
    if (existsSync(src) && !existsSync(dst)) {
      await copyFile(src, dst);
    }
  }
}

async function runOne(variant, home, queryObj) {
  const project = join(home, "project-routing-only");
  await mkdir(project, { recursive: true });
  const env = { ...process.env, HOME: home, TMPDIR: join(home, "tmp") };
  const fullQuery = queryObj.query + STOP_TAIL;
  const args = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
  ];
  if (variant.mode === "router") {
    const pluginDir = join(home, ".claude", "plugins", "cache", "local", "skill-router", "0.1.0");
    args.push("--plugin-dir", pluginDir);
  }
  const out = join(OUT_DIR, variant.id, `${queryObj.id}.jsonl`);
  await mkdir(dirname(out), { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  log(`[${variant.id}] ${queryObj.id} spawn`);
  const child = spawn("claude", args, { env, cwd: project, stdio: ["ignore", "pipe", "pipe"] });
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
  await copyAlreadyDoneTranscripts(variant);
  const results = [];
  try {
    for (const q of queries) {
      if (existsSync(join(OUT_DIR, variant.id, `${q.id}.jsonl`)) && ALREADY_DONE.has(q.id)) {
        // Already covered by 9x3 copy — skip.
        continue;
      }
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

// Bounded-concurrency runner. Keeps at most `cap` runVariant promises in
// flight at a time, so we don't slam 9 concurrent Claude sessions.
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
  const queriesAll = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  const remaining = queriesAll.filter((q) => !ALREADY_DONE.has(q.id));
  log(`harness: ${VARIANTS.length} variants × ${remaining.length} new queries (+ ${ALREADY_DONE.size} pre-existing). Concurrency=${CONCURRENCY}. Timeout=${TIMEOUT_MS}ms per cell.`);

  // Verify the 9x3 source transcripts we plan to copy in actually exist —
  // fail loudly rather than silently skip and produce an incomplete dataset.
  const missing = [];
  for (const v of VARIANTS) {
    for (const qid of ALREADY_DONE) {
      const src = join(PREV_OUT_DIR, v.id, `${qid}.jsonl`);
      if (!existsSync(src)) missing.push(`${v.id}/${qid}`);
    }
  }
  if (missing.length) {
    log(`WARN: ${missing.length} pre-existing 9x3 transcripts missing; renderer will see fewer than 24 queries for those cells: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`);
  }

  const startedAt = new Date().toISOString();
  await mkdir(PARALLEL_HOMES_DIR, { recursive: true });
  // Purge previous 9x24 output so renderer can't see stale cells from prior runs.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const settled = await runWithCap(VARIANTS, CONCURRENCY, (v) => runVariant(v, remaining));
  const all = settled.flatMap((r) => r?.__error ? [{ __error: String(r.__error).slice(0, 500) }] : (r || []));
  const errors = settled.filter((r) => r?.__error);
  if (errors.length) log(`WARN: ${errors.length} variant(s) errored: ${errors.map((e) => String(e.__error).slice(0, 200)).join(" | ")}`);
  const finishedAt = new Date().toISOString();

  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({
    startedAt,
    finishedAt,
    parallelHomesDir: PARALLEL_HOMES_DIR,
    timeoutMs: TIMEOUT_MS,
    concurrency: CONCURRENCY,
    queries: queriesAll.map((q) => ({ id: q.id, expected: q.expected, domain: q.domain })),
    variants: VARIANTS,
    runs: all,
    note: `9 variants ran with concurrency cap ${CONCURRENCY} against isolated HOMEs; each variant's queries ran sequentially. Pre-existing 3-query transcripts from runs/routing-only-9x3 were copied in.`,
  }, null, 2));
  log(`summary -> ${join(OUT_DIR, "summary.json")}`);
  if (errors.length) process.exitCode = 2;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
