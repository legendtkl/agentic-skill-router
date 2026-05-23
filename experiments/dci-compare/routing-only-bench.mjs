#!/usr/bin/env node
// 3-query × 2-mode routing-only benchmark.
//   native: corpus ENABLED, no plugin
//   j     : corpus DISABLED, skill-router plugin (production J SKILL.md)
// Both modes: NO --append-system-prompt; a stop instruction is appended to
// the query tail to force routing-only termination. Same probe used in
// routing-only-probe.mjs but extended to a configurable query list and
// aggregated summary.json.

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const HOME = join(EXP_DIR, ".tmp-home");
const SKILLS_ROOT = join(HOME, ".claude", "skills");
const PLUGIN_DIR = join(HOME, ".claude", "plugins", "cache", "local", "skill-router", "0.1.0");
const OUT_DIR = join(EXP_DIR, "runs", "routing-only-bench");
const TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 240_000;

const STOP_TAIL = `

---
ROUTING-ONLY mode: this session evaluates skill routing accuracy only.
After identifying the single best matching disabled skill, output exactly
one line of minified JSON on its own and stop:

{"matched_skill_path":"<absolute path>","matched_skill_name":"<skill-id>"}

Do NOT Read the matched skill's body, do NOT execute the user's task above,
do NOT produce any other text. This overrides any "execute the task"
guidance in the skill router's instructions.`;

const QUERY_IDS = process.argv.length > 2
  ? process.argv.slice(2)
  : ["3d-scan-calc", "dialogue-parser", "citation-check"];

const MODES = ["native", "j"];

async function toggleCorpus(target) {
  const dirs = (await readdir(SKILLS_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  let n = 0;
  for (const id of dirs) {
    const en = join(SKILLS_ROOT, id, "SKILL.md");
    const dis = join(SKILLS_ROOT, id, "SKILL.md.skill-router-disabled");
    if (target === "enabled" && existsSync(dis) && !existsSync(en)) { await rename(dis, en); n++; }
    else if (target === "disabled" && existsSync(en) && !existsSync(dis)) { await rename(en, dis); n++; }
  }
  console.log(`[corpus] -> ${target} (${n} renamed)`);
}

async function runOne(queryObj, mode) {
  const project = join(HOME, "project-routing-only");
  await mkdir(project, { recursive: true });
  const env = { ...process.env, HOME };
  const fullQuery = queryObj.query + STOP_TAIL;
  const args = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
    "--max-turns=10",
  ];
  if (mode === "j") args.push("--plugin-dir", PLUGIN_DIR);
  const out = join(OUT_DIR, mode, `${queryObj.id}.jsonl`);
  await mkdir(dirname(out), { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  console.log(`[${mode}] ${queryObj.id} spawn`);
  const child = spawn("claude", args, { env, cwd: project, stdio: ["ignore", "pipe", "pipe"] });
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
  console.log(`[${mode}] ${queryObj.id} exit=${exitCode} timedOut=${timedOut} duration=${dur}s events=${events.length}`);
  return { mode, queryId: queryObj.id, exitCode, timedOut, durationMs: Date.now() - t0 };
}

async function main() {
  const queries = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  const selected = QUERY_IDS.map((id) => {
    const q = queries.find((x) => x.id === id);
    if (!q) throw new Error(`unknown query id: ${id}`);
    return q;
  });
  console.log(`harness: ${selected.length} query × ${MODES.length} modes = ${selected.length * MODES.length} runs`);

  const results = [];
  for (const mode of MODES) {
    await toggleCorpus(mode === "native" ? "enabled" : "disabled");
    for (const q of selected) {
      results.push(await runOne(q, mode));
    }
  }
  // restore corpus to disabled (default state for J-style work)
  await toggleCorpus("disabled");

  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({
    home: HOME,
    queries: selected.map((q) => ({ id: q.id, expected: q.expected, domain: q.domain })),
    modes: MODES,
    runs: results,
  }, null, 2));
  console.log(`\nsummary -> ${join(OUT_DIR, "summary.json")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
