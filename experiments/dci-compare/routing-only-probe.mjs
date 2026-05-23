#!/usr/bin/env node
// Single-query routing-only probe. Runs the production J SKILL.md (no
// stop-at-JSON in the SKILL.md body, no --append-system-prompt) but appends
// a routing-only instruction to the query itself. We want to see whether
// that user-level stop instruction is enough to keep Claude from continuing
// into task execution.

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const HOME = join(EXP_DIR, ".tmp-home");
const PLUGIN_DIR = join(HOME, ".claude", "plugins", "cache", "local", "skill-router", "0.1.0");
const PROJECT = join(HOME, "project-routing-only");
const QUERY_ID = process.argv[2] || "3d-scan-calc";
const MODE = process.argv[3] || "j"; // "j" or "native"
const OUT_TRANSCRIPT = join(EXP_DIR, "runs", `routing-only-${MODE}`, `${QUERY_ID}.jsonl`);
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

async function main() {
  await mkdir(PROJECT, { recursive: true });
  const queries = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  const q = queries.find((x) => x.id === QUERY_ID);
  if (!q) throw new Error(`unknown query id: ${QUERY_ID}`);

  const fullQuery = q.query + STOP_TAIL;
  const env = { ...process.env, HOME };
  const args = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
    "--max-turns=10",
  ];
  if (MODE === "j") args.push("--plugin-dir", PLUGIN_DIR);
  await mkdir(dirname(OUT_TRANSCRIPT), { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  console.log(`[probe] query=${q.id} expected=${q.expected}`);
  const child = spawn("claude", args, { env, cwd: PROJECT, stdio: ["ignore", "pipe", "pipe"] });
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
  await writeFile(OUT_TRANSCRIPT, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[probe] exit=${exitCode} timedOut=${timedOut} duration=${dur}s events=${events.length}`);
  console.log(`[probe] transcript -> ${OUT_TRANSCRIPT}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
