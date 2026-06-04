#!/usr/bin/env node
// Single-cell routing probe over a scaled SkillRouter corpus.
//
// One cell = one (variant, scale, query) tuple.
//   - variant = which SKILL.md body to patch into the plugin
//   - scale   = how many unique skills are installed under ~/.claude/skills
//   - query   = one task_id from the SkillRouter eval_core tasks.jsonl
//
// HOME naming is keyed by scale only — a single HOME at `.tmp-home-<label>/`
// holds the corpus for that scale, and the variant body is hot-swapped into
// the plugin's `skill-router-skills` SKILL.md between cells. So the install
// (the slow step) happens once per scale.
//
// At scales below the full pool we force-include the query's gt + degraded
// skills, so accuracy is comparable across scales (the answer is always in
// the corpus).
//
// Usage:
//   node probe.mjs [--variant=J-bounded]
//                  [--scale=0]             (0 = full ~80K)
//                  [--query-id=3d-scan-calc]
//                  [--home=.tmp-home-<label>]
//                  [--src=~/.cache/skill-router/datasets/SkillRouter-Eval-Core/eval_core]
//                  [--skip-install]        (reuse HOME, swap variant, run)

import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { mkdir, writeFile, readFile, readdir, rm, copyFile, symlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { skillRouterEvalCorePath } from "../skillrouter-dataset.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const EXP_DIR = __dirname;
const VARIANTS_DIR = join(EXP_DIR, "variants");
const TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 600_000;

const args = parseArgs(process.argv.slice(2));
const SRC = args.src;

function scaleLabel(n) {
  if (n === 0) return "full";
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}k`;
  return String(n);
}

const SCALE_LABEL = scaleLabel(args.scale);
const HOME = args.home
  ? (args.home.startsWith("/") ? args.home : join(EXP_DIR, args.home))
  : join(EXP_DIR, `.tmp-home-${SCALE_LABEL}`);
const OUT_DIR = join(EXP_DIR, "runs", `sweep-${args.queryId}`);

function parseArgs(argv) {
  const out = {
    variant: "J-bounded",
    scale: 0,
    queryId: "3d-scan-calc",
    home: "",
    src: skillRouterEvalCorePath(),
    skipInstall: false,
  };
  for (const a of argv) {
    if (a.startsWith("--variant=")) out.variant = a.slice(10);
    else if (a.startsWith("--scale=")) out.scale = Number(a.slice(8));
    else if (a.startsWith("--query-id=")) out.queryId = a.slice(11);
    else if (a.startsWith("--home=")) out.home = a.slice(7);
    else if (a.startsWith("--src=")) out.src = skillRouterEvalCorePath(a.slice(6));
    else if (a === "--skip-install") out.skipInstall = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

function safeId(id) { return id.replace(/\//g, "__"); }

function setFrontmatterName(body, newName) {
  if (!body.startsWith("---")) return `---\nname: ${newName}\ndescription: ""\n---\n\n${body}`;
  const end = body.indexOf("\n---", 3);
  if (end < 0) return body;
  const fm = body.slice(0, end);
  const rest = body.slice(end);
  const newFm = /^name:.*$/m.test(fm)
    ? fm.replace(/^name:.*$/m, `name: ${newName}`)
    : `${fm}\nname: ${newName}`;
  return newFm + rest;
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
      else reject(new Error(`${cmd} ${argv.slice(0, 3).join(" ")}... exit=${code}\n${stderr.slice(0, 2000)}`));
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

async function* iterShard(path) {
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
}

async function listShards() {
  const out = [];
  for (const tier of ["easy", "hard"]) {
    const dir = join(SRC, tier);
    let names = [];
    try { names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl.gz")).sort(); } catch { continue; }
    for (const n of names) out.push(join(dir, n));
  }
  return out;
}

async function installCorpus(forceIncludeIds) {
  const skillsRoot = join(HOME, ".claude", "skills");
  await mkdir(skillsRoot, { recursive: true });
  const shards = await listShards();
  log(`reading ${shards.length} shards`);

  // Pass 1: collect ALL unique records into memory so we can guarantee the
  // force-include ids are present in subset installs. ~80K records × 8KB
  // ≈ 640MB; fits in v8 default heap on this box.
  const seen = new Set();
  const all = [];
  for (const shard of shards) {
    let n = 0;
    for await (const rec of iterShard(shard)) {
      if (seen.has(rec.skill_id)) continue;
      seen.add(rec.skill_id);
      all.push(rec);
      n++;
    }
    log(`  ${basename(shard)}: +${n} (cum ${all.length})`);
  }

  // relevance.json sometimes references ids that aren't in the eval_core pool
  // (e.g. `degraded/*` for some queries). Warn and drop the missing ones; only
  // FAIL if the gt skill itself is absent.
  const presentForce = forceIncludeIds.filter((id) => seen.has(id));
  const missingForce = forceIncludeIds.filter((id) => !seen.has(id));
  if (missingForce.length) {
    log(`  WARN: force-include ids not in pool, dropping: ${missingForce.join(", ")}`);
  }
  const forceSet = new Set(presentForce);
  forceIncludeIds = presentForce;

  // Subset: pick first (scale - |force|) non-force records in read order,
  // then append force-include. If scale === 0, install everything.
  let records;
  if (args.scale === 0) {
    records = all;
  } else {
    const target = args.scale;
    if (target < forceIncludeIds.length) {
      throw new Error(`--scale=${target} smaller than |force-include|=${forceIncludeIds.length}`);
    }
    const slots = target - forceIncludeIds.length;
    const non = all.filter((r) => !forceSet.has(r.skill_id)).slice(0, slots);
    const forced = forceIncludeIds.map((id) => all.find((r) => r.skill_id === id));
    records = [...non, ...forced];
  }
  log(`writing ${records.length} skills to ${skillsRoot} (forced ${forceIncludeIds.length} included)`);

  let next = 0, done = 0;
  const CONCURRENCY = 32;
  const writeOne = async (rec) => {
    const sid = safeId(rec.skill_id);
    const dir = join(skillsRoot, sid);
    await mkdir(dir, { recursive: true });
    let body = rec.body ?? "";
    if (!body.trimStart().startsWith("---")) {
      const desc = Array.isArray(rec.description) ? rec.description.join(", ") : (rec.description ?? "");
      body = `---\nname: ${sid}\ndescription: ${JSON.stringify(desc)}\n---\n\n${body}`;
    } else {
      body = setFrontmatterName(body, sid);
    }
    await writeFile(join(dir, "SKILL.md.skill-router-disabled"), body);
  };
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= records.length) return;
      try { await writeOne(records[i]); } catch (err) { console.error(`write ${records[i].skill_id} failed: ${err.message}`); }
      done++;
      if (done % 10000 === 0) log(`  wrote ${done} / ${records.length}`);
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`corpus install done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${records.length} skills)`);
  return records.length;
}

async function findPluginDir() {
  const root = join(HOME, ".claude", "plugins", "cache", "local", "skill-router");
  const versions = await readdir(root, { withFileTypes: true });
  const versionDir = versions.find((d) => d.isDirectory());
  if (!versionDir) throw new Error(`no skill-router plugin version found under ${root}`);
  return join(root, versionDir.name);
}

async function patchVariant(variantId) {
  const pluginDir = await findPluginDir();
  const dst = join(pluginDir, "skills", "skill-router-skills", "SKILL.md");
  const src = join(VARIANTS_DIR, `${variantId}.SKILL.md`);
  await copyFile(src, dst);
  log(`plugin SKILL.md <- variants/${variantId}.SKILL.md`);
  return pluginDir;
}

async function runQuery(variantId, queryObj, env) {
  const pluginDir = await patchVariant(variantId);
  const project = join(HOME, "project-probe");
  await mkdir(project, { recursive: true });
  const STOP_TAIL = `

---
ROUTING-ONLY mode: this session evaluates skill routing accuracy only.
After identifying the single best matching disabled skill, output exactly
one line of minified JSON on its own and stop:

{"matched_skill_name":"<skill-id>"}

Do NOT Read the matched skill's body, do NOT execute the user's task above,
do NOT produce any other text. This overrides any "execute the task"
guidance in the skill router's instructions.`;
  const fullQuery = queryObj.instruction_text + STOP_TAIL;
  const claudeArgs = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
    "--plugin-dir", pluginDir,
  ];
  const outFile = join(OUT_DIR, `${variantId}.${SCALE_LABEL}.${queryObj.task_id}.jsonl`);
  await mkdir(dirname(outFile), { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  log(`[${variantId}] spawn claude -p (timeout ${TIMEOUT_MS}ms)`);
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
  await writeFile(outFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  log(`[${variantId}] done exit=${exitCode} timedOut=${timedOut} dur=${((Date.now() - t0) / 1000).toFixed(1)}s events=${events.length}`);
  return { exitCode, timedOut, events, outFile };
}

function summarize(events, expectedShortId) {
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = events.find((e) => e.type === "result");
  let finalText = "", bashCalls = 0, skillFired = false;
  const turnCtx = [];
  const bashResults = [];
  for (const e of events) {
    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      const u = e.message.usage || {};
      turnCtx.push((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
      for (const b of e.message.content) {
        if (b.type === "tool_use") {
          if (b.name === "Skill") skillFired = true;
          if (b.name === "Bash") bashCalls++;
        } else if (b.type === "text") {
          finalText = b.text;
        }
      }
    }
    if (e.type === "user" && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b.type === "tool_result") {
          const text = typeof b.content === "string"
            ? b.content
            : (Array.isArray(b.content) ? (b.content.find((c) => c.type === "text")?.text || "") : "");
          if (text) bashResults.push({ text, lines: text.split("\n").length, len: text.length });
        }
      }
    }
  }
  let matched = null;
  for (const m of (finalText || "").matchAll(/"matched_skill_name"\s*:\s*"([^"]+)"/g)) {
    if (m[1] && !m[1].includes("<")) matched = m[1];
  }
  return {
    model: init?.model || null,
    skillsExposed: init?.skills?.length || null,
    numTurns: result?.num_turns ?? turnCtx.length,
    durationMs: result?.duration_ms || null,
    cost: result?.total_cost_usd ?? null,
    startCtx: turnCtx[0] || 0,
    endCtx: turnCtx.at(-1) || 0,
    bashCalls,
    skillFired,
    matched,
    expected: expectedShortId,
    correct: matched != null && matched === expectedShortId,
    bashResults: bashResults.map((r, i) => ({ idx: i, lines: r.lines, len: r.len, preview: r.text.slice(0, 600) })),
    finalText: finalText.slice(0, 800),
  };
}

const main = async () => {
  // Load task + relevance, derive expected gt and force-include set
  const tasksLines = (await readFile(join(SRC, "tasks.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean);
  const queryObj = tasksLines.map((l) => JSON.parse(l)).find((t) => t.task_id === args.queryId);
  if (!queryObj) throw new Error(`task_id ${args.queryId} not in tasks.jsonl`);
  const relevance = JSON.parse(await readFile(join(SRC, "relevance.json"), "utf8"));
  const rel = relevance[args.queryId];
  if (!rel?.gt_skill_ids?.length) throw new Error(`no gt_skill_ids for ${args.queryId}`);
  const gt = rel.gt_skill_ids[0];
  // Force-include = gt + every other id mentioned in `relevance` (degraded / distractor / etc).
  // This guarantees the answer + its targeted near-confounders are present at every scale.
  const forceIncludeIds = Object.keys(rel.relevance || { [gt]: 3 });
  const expectedShort = safeId(gt);
  log(`query=${args.queryId}  variant=${args.variant}  scale=${args.scale} (${SCALE_LABEL})`);
  log(`  gt=${gt}  expected_dir=${expectedShort}`);
  log(`  force-include: ${forceIncludeIds.length} ids`);

  if (!args.skipInstall) {
    await setupHome();
    const env = buildEnv();
    await installPlugin(env);
    const n = await installCorpus(forceIncludeIds);
    log(`HOME ready: ${HOME} (${n} skills)`);
  } else {
    log(`--skip-install: reusing existing ${HOME}`);
  }

  const env = buildEnv();
  await mkdir(OUT_DIR, { recursive: true });
  const j = await runQuery(args.variant, queryObj, env);
  const summary = summarize(j.events, expectedShort);
  const summaryPath = join(OUT_DIR, `summary.${args.variant}.${SCALE_LABEL}.${args.queryId}.json`);
  await writeFile(summaryPath, JSON.stringify({
    queryId: args.queryId,
    gt,
    expectedShort,
    forceIncludeIds,
    variant: args.variant,
    scale: args.scale,
    scaleLabel: SCALE_LABEL,
    timestamp: new Date().toISOString(),
    summary,
  }, null, 2));
  log(`summary -> ${summaryPath}`);

  console.log(`\n=== ${args.variant} @ scale=${SCALE_LABEL} ===`);
  console.log(`  model       : ${summary.model}`);
  console.log(`  skills load : ${summary.skillsExposed}`);
  console.log(`  turns       : ${summary.numTurns}`);
  console.log(`  duration    : ${summary.durationMs ? (summary.durationMs / 1000).toFixed(1) + 's' : 'n/a'}`);
  console.log(`  cost        : ${summary.cost != null ? '$' + summary.cost.toFixed(4) : 'n/a'}`);
  console.log(`  ctx end     : ${summary.endCtx}`);
  console.log(`  bash calls  : ${summary.bashCalls}`);
  console.log(`  skill fired : ${summary.skillFired}`);
  console.log(`  matched     : ${summary.matched}`);
  console.log(`  expected    : ${summary.expected}`);
  console.log(`  correct     : ${summary.correct ? "YES" : "no"}`);
  console.log(`  bash results: ${summary.bashResults.length}`);
  for (const r of summary.bashResults.slice(0, 3)) {
    console.log(`    [${r.idx}] ${r.lines} lines, ${r.len}B`);
  }
  console.log(`  final text  : ${summary.finalText || '(empty)'}\n`);
};

main().catch((e) => { console.error(e); process.exit(1); });
