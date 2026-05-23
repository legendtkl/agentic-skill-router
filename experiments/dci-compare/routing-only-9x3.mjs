#!/usr/bin/env node
// 9 variants × 3 queries routing-only benchmark. Variants are aligned to a
// common production posture:
//   * shared strong description (only triggers; no production/stop hints)
//   * variant body retains only its routing workflow (stop block removed)
//   * stop semantics live in the query-tail STOP_TAIL
//   * STOP_TAIL only requires {"matched_skill_name":"<id>"} — no path field
//     so native zero-shot won't be forced into a full-filesystem find.
// Variants:
//   G-native           — corpus enabled, no plugin
//   A-router B-cc C-lite D-agentic E-digest H-bounded I-meta J-bounded
//                      — corpus disabled, --plugin-dir, plugin SKILL.md
//                        swapped to variants/<id>.SKILL.md per cell
// No --append-system-prompt. No --max-turns. timeout=240s.

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, rename, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const HOME = join(EXP_DIR, ".tmp-home");
const SKILLS_ROOT = join(HOME, ".claude", "skills");
const PLUGIN_DIR = join(HOME, ".claude", "plugins", "cache", "local", "skill-router", "0.1.0");
const PLUGIN_SKILL_MD = join(PLUGIN_DIR, "skills", "skill-router-skills", "SKILL.md");
const VARIANTS_DIR = join(EXP_DIR, "variants", "routing-only");
const OUT_DIR = join(EXP_DIR, "runs", "routing-only-9x3");
const TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 240_000;

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

const QUERY_IDS = ["3d-scan-calc", "dialogue-parser", "citation-check"];

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

async function patchPluginSkillMd(variantId) {
  const src = join(VARIANTS_DIR, `${variantId}.SKILL.md`);
  await copyFile(src, PLUGIN_SKILL_MD);
  console.log(`[plugin] SKILL.md <- variants/${variantId}.SKILL.md`);
}

async function runOne(variant, queryObj) {
  const project = join(HOME, "project-routing-only");
  await mkdir(project, { recursive: true });
  const env = { ...process.env, HOME };
  const fullQuery = queryObj.query + STOP_TAIL;
  const args = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
  ];
  if (variant.mode === "router") args.push("--plugin-dir", PLUGIN_DIR);
  const out = join(OUT_DIR, variant.id, `${queryObj.id}.jsonl`);
  await mkdir(dirname(out), { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  console.log(`[${variant.id}] ${queryObj.id} spawn`);
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
  console.log(`  exit=${exitCode} timedOut=${timedOut} duration=${dur}s events=${events.length}`);
  return { variant: variant.id, queryId: queryObj.id, exitCode, timedOut, durationMs: Date.now() - t0 };
}

async function main() {
  const queries = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  const selected = QUERY_IDS.map((id) => {
    const q = queries.find((x) => x.id === id);
    if (!q) throw new Error(`unknown query id: ${id}`);
    return q;
  });
  console.log(`harness: ${VARIANTS.length} variants × ${selected.length} queries = ${VARIANTS.length * selected.length} runs`);
  const startedAt = new Date().toISOString();

  // Purge any stale per-cell transcripts from prior runs.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const results = [];
  for (const variant of VARIANTS) {
    console.log(`\n=== variant ${variant.id} (${variant.mode}) ===`);
    await toggleCorpus(variant.mode === "native" ? "enabled" : "disabled");
    if (variant.mode === "router") await patchPluginSkillMd(variant.id);
    for (const q of selected) {
      results.push(await runOne(variant, q));
      // Small pause so the prior claude process is fully reaped before we
      // mutate plugin/corpus state for the next cell.
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  // restore to disabled (default state for J work)
  await toggleCorpus("disabled");

  const finishedAt = new Date().toISOString();
  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({
    startedAt,
    finishedAt,
    home: HOME,
    timeoutMs: TIMEOUT_MS,
    queries: selected.map((q) => ({ id: q.id, expected: q.expected, domain: q.domain })),
    variants: VARIANTS,
    runs: results,
  }, null, 2));
  console.log(`\nsummary -> ${join(OUT_DIR, "summary.json")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
