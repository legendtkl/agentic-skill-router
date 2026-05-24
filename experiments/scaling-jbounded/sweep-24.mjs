#!/usr/bin/env node
// Run one variant against the 24 single-skill SkillsBench queries on a
// pre-built HOME. Supports two expected-id resolution modes:
//
//   --queries-source=dci-compare  → read dci-compare/queries.json,
//     expected = q.expected (strip "user:" prefix) — anonymized skill-NNN
//   --queries-source=paper        → read SkillRouter relevance.json,
//     expected = safeId(relevance[task_id].gt_skill_ids[0]) — raw "gt__foo"
//
// Cells run in parallel (default 3 concurrent) against the same HOME.
// Plugin SKILL.md is patched once at the start.
//
// Usage:
//   node sweep-24.mjs --variant=J-bounded-v2 --home=.tmp-home-150
//                     --queries-source=dci-compare --run-id=v2-150
//   node sweep-24.mjs --variant=J-bounded-v2 --home=.tmp-home-full
//                     --queries-source=paper --run-id=v2-full
//   [--concurrency=3] [--timeout-ms=600000]

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const VARIANTS_DIR = join(EXP_DIR, "variants");
const SR_SRC = "/tmp/sr-probe/data/eval_core";
const DCI_QUERIES = join(EXP_DIR, "..", "dci-compare", "queries.json");

const args = parseArgs(process.argv.slice(2));
const HOME = args.home.startsWith("/") ? args.home : join(EXP_DIR, args.home);
const OUT_DIR = join(EXP_DIR, "runs", `sweep24-${args.runId}`);

function parseArgs(argv) {
  const out = {
    variant: "J-bounded-v2",
    home: "",
    queriesSource: "dci-compare",
    runId: "",
    concurrency: 3,
    timeoutMs: 600_000,
    withClaudeMd: false,
  };
  for (const a of argv) {
    if (a.startsWith("--variant=")) out.variant = a.slice(10);
    else if (a.startsWith("--home=")) out.home = a.slice(7);
    else if (a.startsWith("--queries-source=")) out.queriesSource = a.slice(17);
    else if (a.startsWith("--run-id=")) out.runId = a.slice(9);
    else if (a.startsWith("--concurrency=")) out.concurrency = Number(a.slice(14));
    else if (a.startsWith("--timeout-ms=")) out.timeoutMs = Number(a.slice(13));
    else if (a === "--with-claudemd") out.withClaudeMd = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!out.home) throw new Error("--home required");
  if (!out.runId) throw new Error("--run-id required");
  if (!["dci-compare", "paper"].includes(out.queriesSource)) {
    throw new Error(`--queries-source must be dci-compare or paper`);
  }
  return out;
}

// Trigger-lift prompt: identical to the text validated by dci-compare's
// paired CLAUDE.md A/B experiment (commit bbb1a08), which compressed the
// "agent fabricates matched_skill_name without calling Skill" failure mode
// from 21.4% to 2.6%. We write it to <HOME>/.claude/CLAUDE.md so Claude Code
// picks it up as a user-message context block.
const CLAUDE_MD_TEXT = `# Skill routing

\`skill-router-skills\` is a routing Skill that searches a catalog of
locally-installed disabled skills.

When no enabled Skill clearly matches the user's query, you must call
\`skill-router-skills\` before answering. Do not invent a Skill name or
fabricate \`matched_skill_name\` without a Skill/tool result.
`;

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const safeId = (id) => id.replace(/\//g, "__");

const STOP_TAIL = `

---
ROUTING-ONLY mode: this session evaluates skill routing accuracy only.
After identifying the single best matching disabled skill, output exactly
one line of minified JSON on its own and stop:

{"matched_skill_name":"<skill-id>"}

Do NOT Read the matched skill's body, do NOT execute the user's task above,
do NOT produce any other text. This overrides any "execute the task"
guidance in the skill router's instructions.`;

async function loadQueries() {
  if (args.queriesSource === "dci-compare") {
    const data = JSON.parse(await readFile(DCI_QUERIES, "utf8"));
    return data.queries.map((q) => ({
      id: q.id,
      query: q.query,
      expected: q.expected.replace(/^user:/, ""),
    }));
  }
  // paper: read SkillRouter relevance.json + tasks.jsonl, take the 24
  // single-skill subset that dci-compare's queries.json references (so the
  // task set matches exactly).
  const tasksLines = (await readFile(join(SR_SRC, "tasks.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean);
  const tasks = Object.fromEntries(tasksLines.map((l) => { const t = JSON.parse(l); return [t.task_id, t]; }));
  const relevance = JSON.parse(await readFile(join(SR_SRC, "relevance.json"), "utf8"));
  const dci = JSON.parse(await readFile(DCI_QUERIES, "utf8"));
  return dci.queries.map((q) => {
    const gt = relevance[q.id]?.gt_skill_ids?.[0];
    if (!gt) throw new Error(`no gt for ${q.id} in relevance.json`);
    const task = tasks[q.id];
    if (!task) throw new Error(`no task for ${q.id} in tasks.jsonl`);
    return {
      id: q.id,
      query: task.instruction_text,
      expected: safeId(gt),
      gt,
    };
  });
}

async function findPluginDir() {
  const root = join(HOME, ".claude", "plugins", "cache", "local", "skill-router");
  const versions = await readdir(root, { withFileTypes: true });
  const versionDir = versions.find((d) => d.isDirectory());
  if (!versionDir) throw new Error(`no skill-router plugin version under ${root}`);
  return join(root, versionDir.name);
}

async function patchVariant() {
  const pluginDir = await findPluginDir();
  const dst = join(pluginDir, "skills", "skill-router-skills", "SKILL.md");
  const src = join(VARIANTS_DIR, `${args.variant}.SKILL.md`);
  await copyFile(src, dst);
  log(`plugin SKILL.md <- variants/${args.variant}.SKILL.md`);
  return pluginDir;
}

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

async function runOne(query, pluginDir, env) {
  const project = join(HOME, "project-sweep");
  await mkdir(project, { recursive: true });
  const fullQuery = query.query + STOP_TAIL;
  const claudeArgs = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
    "--plugin-dir", pluginDir,
  ];
  const out = join(OUT_DIR, `${query.id}.jsonl`);
  await mkdir(dirname(out), { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  log(`[${query.id}] spawn`);
  const child = spawn("claude", claudeArgs, { env, cwd: project, stdio: ["ignore", "pipe", "pipe"] });
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
        try { events.push(JSON.parse(line)); } catch { events.push({ type: "_raw", line }); }
      }
    }
  });
  child.stderr.on("data", (chunk) => { stderrBuf += chunk; });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5000);
  }, args.timeoutMs);
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  if (stdoutBuf.trim()) {
    try { events.push(JSON.parse(stdoutBuf)); } catch { events.push({ type: "_raw", line: stdoutBuf }); }
  }
  if (stderrBuf) events.push({ type: "_stderr", text: stderrBuf.slice(0, 4000) });
  if (timedOut) events.push({ type: "_run_error", error: `claude -p timed out after ${args.timeoutMs}ms` });
  await writeFile(out, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[${query.id}] done exit=${exitCode} timedOut=${timedOut} dur=${dur}s events=${events.length}`);
  return { queryId: query.id, expected: query.expected, exitCode, timedOut, durationMs: Date.now() - t0 };
}

async function runWithCap(items, cap, work) {
  let next = 0;
  const out = new Array(items.length);
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]).catch((err) => ({ __error: String(err).slice(0, 400), item: items[i] }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, worker));
  return out;
}

const main = async () => {
  if (!existsSync(HOME)) throw new Error(`HOME not found: ${HOME}`);
  const queries = await loadQueries();
  log(`variant=${args.variant} home=${HOME} queries-source=${args.queriesSource}  ${queries.length} queries, concurrency=${args.concurrency}`);

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const pluginDir = await patchVariant();
  // Trigger-lift CLAUDE.md (no-op when --with-claudemd is unset; explicitly
  // removed otherwise so a previous run's file can't leak through).
  const claudeMdPath = join(HOME, ".claude", "CLAUDE.md");
  if (args.withClaudeMd) {
    await writeFile(claudeMdPath, CLAUDE_MD_TEXT);
    log(`wrote CLAUDE.md trigger lift -> ${claudeMdPath}`);
  } else {
    await rm(claudeMdPath, { force: true });
  }
  const env = buildEnv();
  const startedAt = new Date().toISOString();
  const results = await runWithCap(queries, args.concurrency, (q) => runOne(q, pluginDir, env));
  const finishedAt = new Date().toISOString();

  const summary = {
    startedAt,
    finishedAt,
    runId: args.runId,
    variant: args.variant,
    home: HOME,
    queriesSource: args.queriesSource,
    withClaudeMd: args.withClaudeMd,
    concurrency: args.concurrency,
    timeoutMs: args.timeoutMs,
    queries: queries.map((q) => ({ id: q.id, expected: q.expected, gt: q.gt ?? null })),
    runs: results,
  };
  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  log(`summary -> ${join(OUT_DIR, "summary.json")}`);
  const failures = results.filter((r) => r?.__error || r?.timedOut);
  if (failures.length) log(`WARN: ${failures.length}/${queries.length} cells failed or timed out`);
};

main().catch((e) => { console.error(e); process.exit(1); });
