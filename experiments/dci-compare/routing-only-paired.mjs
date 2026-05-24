#!/usr/bin/env node
// Paired routing-only bench: 9 variants × 24 queries × 2 conditions
// (with/without `<HOME>/.claude/CLAUDE.md`) = 432 cells, run in the same
// execution window so the A/B is not confounded by time/cache drift.
//
// Each (variant, condition) gets its own isolated HOME under
// `.tmp-home-paired/<variant>.<condition>/`. Within a HOME the 24 queries
// run sequentially; HOMEs run in parallel with a concurrency cap.
//
// Output goes to `runs/routing-only-9x24-claudemd/` and does NOT touch
// the historical baseline at `runs/routing-only-9x24/`.

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
const TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 240_000;
const CONCURRENCY = Number(process.env.PAIRED_CONCURRENCY) || 4;

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

const CONDITIONS = [
  { id: "with-claudemd", withClaudeMd: true },
  { id: "without-claudemd", withClaudeMd: false },
];

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function md5(s) {
  return createHash("md5").update(s).digest("hex").slice(0, 12);
}

async function setCorpusState(home, target) {
  const root = join(home, ".claude", "skills");
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  let renames = 0;
  for (const id of dirs) {
    const en = join(root, id, "SKILL.md");
    const dis = join(root, id, "SKILL.md.skill-router-disabled");
    if (target === "enabled" && existsSync(dis) && !existsSync(en)) {
      await rename(dis, en); renames++;
    } else if (target === "disabled" && existsSync(en) && !existsSync(dis)) {
      await rename(en, dis); renames++;
    }
  }
  return renames;
}

async function prepareHome(variant, condition) {
  const homeId = `${variant.id}.${condition.id}`;
  const home = join(PAIRED_HOMES_DIR, homeId);
  const lockFile = join(PAIRED_HOMES_DIR, `${homeId}.lock`);
  if (existsSync(lockFile)) {
    const age = Date.now() - (await stat(lockFile)).mtimeMs;
    if (age < 60 * 60 * 1000) {
      throw new Error(`HOME ${home} locked (age ${Math.round(age / 1000)}s)`);
    }
    log(`[${homeId}] stale lock (${Math.round(age / 1000)}s), proceeding`);
  }
  await rm(home, { recursive: true, force: true });
  await cp(BASE_HOME, home, { recursive: true });
  await writeFile(lockFile, `${process.pid}\n${new Date().toISOString()}\n`);
  const target = variant.mode === "native" ? "enabled" : "disabled";
  const n = await setCorpusState(home, target);
  if (variant.mode === "router") {
    const dst = join(home, ".claude", "plugins", "cache", "local",
      "skill-router", "0.1.0", "skills", "skill-router-skills", "SKILL.md");
    await copyFile(join(VARIANTS_DIR, `${variant.id}.SKILL.md`), dst);
  }
  await mkdir(join(home, "tmp"), { recursive: true });
  await mkdir(join(home, ".claude"), { recursive: true });
  const claudeMdPath = join(home, ".claude", "CLAUDE.md");
  if (condition.withClaudeMd) {
    await writeFile(claudeMdPath, CLAUDE_MD_TEXT);
  } else {
    if (existsSync(claudeMdPath)) await unlink(claudeMdPath);
  }
  log(`[${homeId}] ready: corpus=${target} (${n} renames), claudeMd=${condition.withClaudeMd}`);
  return home;
}

async function preflight(home, variant, condition) {
  if (variant.mode === "router") {
    const plugin = join(home, ".claude", "plugins", "cache", "local",
      "skill-router", "0.1.0", "skills", "skill-router-skills", "SKILL.md");
    const a = md5(await readFile(plugin, "utf8"));
    const b = md5(await readFile(join(VARIANTS_DIR, `${variant.id}.SKILL.md`), "utf8"));
    if (a !== b) throw new Error(`Preflight: plugin SKILL.md md5 ${a} != ${b}`);
  }
  const present = existsSync(join(home, ".claude", "CLAUDE.md"));
  if (present !== !!condition.withClaudeMd) {
    throw new Error(`Preflight: CLAUDE.md present=${present} expected=${!!condition.withClaudeMd}`);
  }
}

async function releaseHome(variant, condition) {
  const lockFile = join(PAIRED_HOMES_DIR, `${variant.id}.${condition.id}.lock`);
  await rm(lockFile, { force: true });
}

async function runOne(variant, condition, home, queryObj) {
  const project = join(home, "project");
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
    const pluginDir = join(home, ".claude", "plugins", "cache", "local",
      "skill-router", "0.1.0");
    args.push("--plugin-dir", pluginDir);
  }
  const label = `${variant.id}.${condition.id}.${queryObj.id}`;
  const outDir = join(OUT_DIR, `${variant.id}.${condition.id}`);
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
  return { variant: variant.id, condition: condition.id, queryId: queryObj.id, exitCode, timedOut, durationMs: Date.now() - t0 };
}

async function runArm(variant, condition, queries) {
  const home = await prepareHome(variant, condition);
  const results = [];
  try {
    for (const q of queries) {
      try {
        await preflight(home, variant, condition);
        results.push(await runOne(variant, condition, home, q));
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        log(`[${variant.id}.${condition.id}.${q.id}] error: ${err.message}`);
        results.push({
          variant: variant.id, condition: condition.id, queryId: q.id,
          error: String(err).slice(0, 500),
        });
      }
    }
  } finally {
    await releaseHome(variant, condition).catch(() => {});
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
      out[i] = await work(items[i]).catch((err) => ({ __error: String(err).slice(0, 500) }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, worker));
  return out;
}

async function main() {
  const queries = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  const arms = [];
  for (const v of VARIANTS) {
    for (const c of CONDITIONS) {
      arms.push({ variant: v, condition: c });
    }
  }
  log(`harness: ${VARIANTS.length} variants × ${CONDITIONS.length} conditions × ${queries.length} queries = ${VARIANTS.length * CONDITIONS.length * queries.length} cells. Concurrency=${CONCURRENCY}.`);

  const startedAt = new Date().toISOString();
  await mkdir(PAIRED_HOMES_DIR, { recursive: true });
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const settled = await runWithCap(arms, CONCURRENCY,
    ({ variant, condition }) => runArm(variant, condition, queries));
  const errored = settled.filter((r) => r?.__error);
  if (errored.length) log(`WARN: ${errored.length} arm(s) errored`);
  const allRuns = settled.flatMap((r) => r?.__error ? [{ __error: r.__error }] : (r || []));
  const finishedAt = new Date().toISOString();

  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({
    startedAt,
    finishedAt,
    pairedHomesDir: PAIRED_HOMES_DIR,
    timeoutMs: TIMEOUT_MS,
    concurrency: CONCURRENCY,
    claudeMdText: CLAUDE_MD_TEXT,
    stopTail: STOP_TAIL,
    variants: VARIANTS,
    conditions: CONDITIONS,
    queries: queries.map((q) => ({ id: q.id, expected: q.expected, domain: q.domain })),
    runs: allRuns,
  }, null, 2));
  log(`summary -> ${join(OUT_DIR, "summary.json")}`);
  if (errored.length) process.exitCode = 2;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
