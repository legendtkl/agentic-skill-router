#!/usr/bin/env node
// Render summary metrics for runs produced by routing-only-newvariants.mjs.
// Reuses the parsing/cost logic from render-paired.mjs (Opus 4.x prices,
// ctx_end from the LAST assistant turn, not cumulative).

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = process.argv[2] ? resolve(process.argv[2]) : null;
if (!RUN_DIR) {
  console.error("usage: render-newvariants.mjs <runs/claude-routing-only-newvariants-...>");
  process.exit(1);
}
const SUMMARY_PATH = join(RUN_DIR, "summary.json");
const ROUTER_TOOL_PATTERN = /skill-router-skills|skill[_-]router[_-]skills/i;

const PRICE_TABLE = {
  "claude-opus-4-7": { input: 15, output: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.10, cacheWrite: 1.25 },
};

function pickPrice(model) {
  if (!model) return PRICE_TABLE["claude-opus-4-7"];
  const key = Object.keys(PRICE_TABLE).find((k) => model.startsWith(k));
  return PRICE_TABLE[key] || PRICE_TABLE["claude-opus-4-7"];
}

async function parseCell(path) {
  const text = await readFile(path, "utf8");
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch {}
  }
  let routerToolCalls = 0;
  let finalText = "";
  let totalCost = null;
  let costFallback = false;
  let model = null;
  let numTurns = null;
  let durationMs = null;
  let ctxEnd = null;
  let lastAssistantUsage = null;
  let cumulativeUsage = null;
  let timedOut = false;
  let hallucinated = false;
  for (const ev of events) {
    if (ev.type === "_run_error" && /timed out/.test(ev.error || "")) timedOut = true;
    if (ev.type === "system" && ev.subtype === "init" && ev.model) model = ev.model;
    if (ev.type === "assistant" && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === "tool_use") {
          const name = block.name || "";
          const inputSkill = block.input?.skill ? String(block.input.skill) : "";
          if (ROUTER_TOOL_PATTERN.test(name) || ROUTER_TOOL_PATTERN.test(inputSkill)) {
            routerToolCalls++;
          }
        }
        if (block.type === "text" && block.text) finalText = block.text;
      }
      if (ev.message?.usage) lastAssistantUsage = ev.message.usage;
    }
    if (ev.type === "result" && ev.subtype === "success") {
      totalCost = ev.total_cost_usd ?? totalCost;
      numTurns = ev.num_turns ?? numTurns;
      durationMs = ev.duration_ms ?? durationMs;
      if (ev.usage) cumulativeUsage = ev.usage;
    }
  }
  if (lastAssistantUsage) {
    const inT = lastAssistantUsage.input_tokens || 0;
    const cacheRead = lastAssistantUsage.cache_read_input_tokens || 0;
    const cacheWrite = lastAssistantUsage.cache_creation_input_tokens || 0;
    ctxEnd = inT + cacheRead + cacheWrite;
  }
  if (totalCost == null && cumulativeUsage) {
    const p = pickPrice(model);
    totalCost = (
      (cumulativeUsage.input_tokens || 0) * p.input / 1e6 +
      (cumulativeUsage.output_tokens || 0) * p.output / 1e6 +
      (cumulativeUsage.cache_read_input_tokens || 0) * p.cacheRead / 1e6 +
      (cumulativeUsage.cache_creation_input_tokens || 0) * p.cacheWrite / 1e6
    );
    costFallback = true;
  }
  const m = finalText.match(/\{[^{}]*"matched_skill_name"\s*:\s*"([^"]+)"[^{}]*\}/);
  const matched = m ? m[1] : null;
  if (matched && !/^skill-\d{3}$/.test(matched) && !/^noise-\d+$/.test(matched)) {
    hallucinated = true;
  }
  return { routerToolCalls, matched, totalCost, costFallback, model, numTurns, durationMs, ctxEnd, timedOut, hallucinated };
}

function fmtPct(n, d) {
  if (!d) return "n/a";
  return `${n}/${d} (${((100 * n) / d).toFixed(1)}%)`;
}

function fmtDur(ms) {
  if (ms == null) return "?";
  return `${(ms / 1000).toFixed(0)}s`;
}

async function main() {
  if (!existsSync(SUMMARY_PATH)) {
    console.error(`missing ${SUMMARY_PATH}`);
    process.exit(1);
  }
  const summary = JSON.parse(await readFile(SUMMARY_PATH, "utf8"));
  const queries = summary.queries;
  const qById = new Map(queries.map((q) => [q.id, q]));
  const runs = summary.runs.filter((r) => r.queryId && !r.error);

  const groups = new Map();
  await Promise.all(runs.map(async (run) => {
    const key = run.variant;
    if (!groups.has(key)) groups.set(key, { variant: run.variant, cells: [] });
    const path = join(RUN_DIR, run.variant, `${run.queryId}.jsonl`);
    let parsed = {};
    if (existsSync(path)) {
      try { parsed = await parseCell(path); } catch (err) { parsed = { error: String(err).slice(0, 200) }; }
    }
    const q = qById.get(run.queryId);
    const expected = q?.expected?.replace(/^user:/, "");
    const correct = parsed.matched && expected && parsed.matched === expected;
    groups.get(key).cells.push({ ...run, parsed, expected, correct });
  }));

  const rows = [];
  for (const [, g] of [...groups.entries()].sort()) {
    const cells = g.cells;
    const triggered = cells.filter((c) => (c.parsed?.routerToolCalls ?? 0) >= 1).length;
    const correct = cells.filter((c) => c.correct).length;
    const hallucinated = cells.filter((c) => c.parsed?.hallucinated).length;
    const costs = cells.map((c) => c.parsed?.totalCost).filter((x) => x != null);
    const sumCost = costs.reduce((s, x) => s + x, 0);
    const turns = cells.map((c) => c.parsed?.numTurns).filter((x) => x != null);
    const sumTurns = turns.reduce((s, x) => s + x, 0);
    const durs = cells.map((c) => c.parsed?.durationMs).filter((x) => x != null);
    const sumDur = durs.reduce((s, x) => s + x, 0);
    const ctxEnds = cells.map((c) => c.parsed?.ctxEnd).filter((x) => x != null);
    const meanCtxEnd = ctxEnds.length ? ctxEnds.reduce((s, x) => s + x, 0) / ctxEnds.length : null;
    rows.push({
      variant: g.variant,
      total: cells.length,
      triggered,
      correct,
      hallucinated,
      sumCost,
      sumTurns,
      sumDur,
      meanCtxEnd,
      misses: cells.filter((c) => !c.correct).map((c) => ({
        queryId: c.queryId,
        expected: c.expected,
        matched: c.parsed?.matched ?? null,
        timedOut: c.parsed?.timedOut,
        triggered: (c.parsed?.routerToolCalls ?? 0) >= 1,
      })),
    });
  }

  console.log(`\n== Claude Code newvariants (${RUN_DIR.split("/").pop()}) ==\n`);
  console.log("variant       | accuracy        | trigger          | hallu | cost     | duration | turns | avg ctx_end");
  console.log("--------------+-----------------+------------------+-------+----------+----------+-------+-------------");
  for (const r of rows) {
    console.log(
      `${r.variant.padEnd(13)} | ${fmtPct(r.correct, r.total).padEnd(15)} | ${fmtPct(r.triggered, r.total).padEnd(16)} | ${(r.hallucinated + "/" + r.total).padEnd(5)} | $${r.sumCost.toFixed(2).padStart(7)} | ${fmtDur(r.sumDur).padStart(7)} | ${String(r.sumTurns).padStart(5)} | ${(r.meanCtxEnd ? (r.meanCtxEnd / 1000).toFixed(1) + "K" : "?").padStart(10)}`
    );
  }
  console.log("");

  for (const r of rows) {
    if (r.misses.length) {
      console.log(`\n${r.variant} misses (${r.misses.length}):`);
      for (const m of r.misses) {
        const tag = m.timedOut ? "[TIMEOUT]" : (m.triggered ? "" : "[no-trigger]");
        console.log(`  ${m.queryId} expected=${m.expected ?? "?"} matched=${m.matched ?? "<none>"} ${tag}`);
      }
    }
  }

  await writeFile(join(RUN_DIR, "summary-metrics.json"), JSON.stringify({ rows }, null, 2));
  console.log(`\nmetrics -> ${join(RUN_DIR, "summary-metrics.json")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
