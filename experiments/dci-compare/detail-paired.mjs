#!/usr/bin/env node
// Detailed side-by-side analysis for the paired CLAUDE.md A/B run.
// Prints multiple tables to stdout:
//   1. Per-variant aggregates (accuracy, trigger, turns, duration, cost, ctx_end)
//   2. Per-variant flip analysis (gained / lost / unchanged on each query)
//   3. Trigger-noise cells (without trigger=0 but matched != gt) — shows what
//      CLAUDE.md actually rescued
//   4. Per-query heatmap across all variants

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "runs", "routing-only-9x24-claudemd");
const ROUTER_TOOL_PATTERN = /skill-router-skills|skill[_-]router[_-]skills/i;

const PRICE_TABLE = {
  "claude-opus-4-7": { input: 15, output: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
};

function pickPrice(model) {
  const key = Object.keys(PRICE_TABLE).find((k) => model?.startsWith?.(k));
  return PRICE_TABLE[key] || PRICE_TABLE["claude-opus-4-7"];
}

async function parseCell(path) {
  const text = await readFile(path, "utf8");
  let routerToolCalls = 0;
  let finalText = "";
  let totalCost = null;
  let model = null;
  let numTurns = null;
  let durationMs = null;
  let lastAssistantUsage = null;     // for ctx_end (window size at end)
  let cumulativeUsage = null;        // for cost fallback (token spend)
  let timedOut = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
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
  // ctx_end = the input window size the model saw on the FINAL turn.
  // result.usage is cumulative across all turns (token spend), NOT context size.
  let ctxEnd = null;
  if (lastAssistantUsage) {
    const inT = lastAssistantUsage.input_tokens || 0;
    const cacheRead = lastAssistantUsage.cache_read_input_tokens || 0;
    const cacheWrite = lastAssistantUsage.cache_creation_input_tokens || 0;
    ctxEnd = inT + cacheRead + cacheWrite;
  }
  // Cost fallback uses cumulative input+output bytes.
  if (totalCost == null && cumulativeUsage) {
    const p = pickPrice(model);
    const inT = cumulativeUsage.input_tokens || 0;
    const cacheRead = cumulativeUsage.cache_read_input_tokens || 0;
    const cacheWrite = cumulativeUsage.cache_creation_input_tokens || 0;
    const outT = cumulativeUsage.output_tokens || 0;
    totalCost = (
      inT * p.input / 1e6 +
      outT * p.output / 1e6 +
      cacheRead * p.cacheRead / 1e6 +
      cacheWrite * p.cacheWrite / 1e6
    );
  }
  const m = finalText.match(/\{[^{}]*"matched_skill_name"\s*:\s*"([^"]+)"[^{}]*\}/);
  return {
    routerToolCalls, matched: m ? m[1] : null,
    totalCost, model, numTurns, durationMs, ctxEnd, timedOut,
  };
}

function pad(s, n, right = false) {
  s = String(s);
  return right ? s.padStart(n) : s.padEnd(n);
}

function fmtPct(n, d) {
  if (!d) return "n/a";
  return `${n}/${d} (${((100 * n) / d).toFixed(0)}%)`;
}

function fmt$(n) { return n == null ? "n/a" : `$${n.toFixed(2)}`; }
function fmtSec(ms) { return ms == null ? "n/a" : `${(ms / 1000).toFixed(0)}s`; }
function fmtK(n) { return n == null ? "n/a" : `${(n / 1000).toFixed(1)}K`; }

async function main() {
  const summary = JSON.parse(await readFile(join(OUT_DIR, "summary.json"), "utf8"));
  const queries = summary.queries;
  const qById = new Map(queries.map((q) => [q.id, q]));

  // Parse every cell
  const cells = await Promise.all(
    summary.runs.filter((r) => !r.__error && r.queryId).map(async (r) => {
      const path = join(OUT_DIR, `${r.variant}.${r.condition}`, `${r.queryId}.jsonl`);
      const parsed = existsSync(path) ? await parseCell(path) : {};
      const expected = qById.get(r.queryId)?.expected?.replace(/^user:/, "");
      const correct = parsed.matched && expected && parsed.matched === expected;
      return { ...r, ...parsed, expected, correct };
    })
  );

  // Index by (variant, condition, queryId)
  const index = new Map();
  for (const c of cells) {
    index.set(`${c.variant}|${c.condition}|${c.queryId}`, c);
  }

  const variants = [...new Set(cells.map((c) => c.variant))];

  // ===== Table 1: Per-variant aggregates =====
  console.log("\n==== Table 1: Per-variant aggregates (24 cells each) ====\n");
  const cols = ["variant", "cond", "acc", "trigger", "Σturns", "Σdur", "Σcost", "ctx̄"];
  const widths = [11, 4, 12, 12, 7, 7, 7, 8];
  console.log(cols.map((c, i) => pad(c, widths[i])).join(" | "));
  console.log(widths.map((w) => "-".repeat(w)).join("-+-"));
  for (const v of variants) {
    for (const cond of ["with-claudemd", "without-claudemd"]) {
      const cellsHere = cells.filter((c) => c.variant === v && c.condition === cond);
      const acc = cellsHere.filter((c) => c.correct).length;
      const trig = cellsHere.filter((c) => (c.routerToolCalls || 0) >= 1).length;
      const turns = cellsHere.reduce((s, c) => s + (c.numTurns || 0), 0);
      const dur = cellsHere.reduce((s, c) => s + (c.durationMs || 0), 0);
      const cost = cellsHere.reduce((s, c) => s + (c.totalCost || 0), 0);
      const ctxList = cellsHere.map((c) => c.ctxEnd).filter((x) => x != null);
      const ctxAvg = ctxList.length ? ctxList.reduce((s, x) => s + x, 0) / ctxList.length : null;
      const condShort = cond === "with-claudemd" ? "WITH" : "w/o";
      console.log([
        pad(v, widths[0]), pad(condShort, widths[1]),
        pad(fmtPct(acc, cellsHere.length), widths[2]),
        pad(fmtPct(trig, cellsHere.length), widths[3]),
        pad(turns, widths[4], true),
        pad(fmtSec(dur), widths[5], true),
        pad(fmt$(cost), widths[6], true),
        pad(fmtK(ctxAvg), widths[7], true),
      ].join(" | "));
    }
    console.log(widths.map((w) => "-".repeat(w)).join("-+-"));
  }

  // ===== Table 2: Per-variant deltas =====
  console.log("\n==== Table 2: Per-variant deltas (with − without) ====\n");
  const dCols = ["variant", "Δacc", "Δtrig", "Δturns", "Δdur", "Δcost", "Δctx̄"];
  const dWidths = [11, 7, 7, 7, 8, 8, 8];
  console.log(dCols.map((c, i) => pad(c, dWidths[i])).join(" | "));
  console.log(dWidths.map((w) => "-".repeat(w)).join("-+-"));
  for (const v of variants) {
    const w = cells.filter((c) => c.variant === v && c.condition === "with-claudemd");
    const o = cells.filter((c) => c.variant === v && c.condition === "without-claudemd");
    const accD = w.filter((c) => c.correct).length - o.filter((c) => c.correct).length;
    const trigD = w.filter((c) => (c.routerToolCalls || 0) >= 1).length -
                  o.filter((c) => (c.routerToolCalls || 0) >= 1).length;
    const turnsD = w.reduce((s, c) => s + (c.numTurns || 0), 0) -
                   o.reduce((s, c) => s + (c.numTurns || 0), 0);
    const durD = w.reduce((s, c) => s + (c.durationMs || 0), 0) -
                 o.reduce((s, c) => s + (c.durationMs || 0), 0);
    const costD = w.reduce((s, c) => s + (c.totalCost || 0), 0) -
                  o.reduce((s, c) => s + (c.totalCost || 0), 0);
    const ctxWAvg = (() => {
      const xs = w.map((c) => c.ctxEnd).filter((x) => x != null);
      return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
    })();
    const ctxOAvg = (() => {
      const xs = o.map((c) => c.ctxEnd).filter((x) => x != null);
      return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
    })();
    const ctxD = ctxWAvg - ctxOAvg;
    const sign = (n) => (n >= 0 ? "+" : "");
    console.log([
      pad(v, dWidths[0]),
      pad(`${sign(accD)}${accD}`, dWidths[1], true),
      pad(`${sign(trigD)}${trigD}`, dWidths[2], true),
      pad(`${sign(turnsD)}${turnsD}`, dWidths[3], true),
      pad(`${sign(durD/1000)}${(durD/1000).toFixed(0)}s`, dWidths[4], true),
      pad(`${sign(costD)}$${costD.toFixed(2)}`, dWidths[5], true),
      pad(`${sign(ctxD/1000)}${(ctxD/1000).toFixed(1)}K`, dWidths[6], true),
    ].join(" | "));
  }

  // ===== Table 3: Flip analysis =====
  console.log("\n==== Table 3: Flip analysis per variant ====\n");
  console.log("variant       | gained(wrong→right) | lost(right→wrong) | same-right | same-wrong");
  console.log("--------------+---------------------+-------------------+------------+-----------");
  for (const v of variants) {
    const queryIds = queries.map((q) => q.id);
    let g = 0, l = 0, sr = 0, sw = 0;
    for (const qid of queryIds) {
      const w = index.get(`${v}|with-claudemd|${qid}`);
      const o = index.get(`${v}|without-claudemd|${qid}`);
      if (!w || !o) continue;
      if (w.correct && !o.correct) g++;
      else if (!w.correct && o.correct) l++;
      else if (w.correct && o.correct) sr++;
      else sw++;
    }
    console.log(`${pad(v, 13)} | ${pad(g, 19, true)} | ${pad(l, 17, true)} | ${pad(sr, 10, true)} | ${pad(sw, 10, true)}`);
  }

  // ===== Table 4: Trigger-noise rescue =====
  console.log("\n==== Table 4: Trigger-noise rescues (without trigger=0 & wrong → with: correct) ====\n");
  console.log("variant       | query                              | without_matched      | with_matched         | gt");
  console.log("--------------+------------------------------------+----------------------+----------------------+-----------");
  for (const v of variants) {
    const queryIds = queries.map((q) => q.id);
    for (const qid of queryIds) {
      const w = index.get(`${v}|with-claudemd|${qid}`);
      const o = index.get(`${v}|without-claudemd|${qid}`);
      if (!w || !o) continue;
      const oNoTrigger = (o.routerToolCalls || 0) === 0;
      const rescued = oNoTrigger && !o.correct && w.correct;
      if (rescued) {
        console.log(`${pad(v, 13)} | ${pad(qid, 34)} | ${pad(o.matched || "none", 20)} | ${pad(w.matched || "none", 20)} | ${o.expected}`);
      }
    }
  }

  // ===== Table 5: Per-query accuracy across variants =====
  console.log("\n==== Table 5: Per-query accuracy (with-CLAUDE.md), router variants only ====\n");
  const routerVariants = variants.filter((v) => v !== "G-native");
  console.log(`query                              | ${routerVariants.map((v) => pad(v.slice(0, 4), 4)).join(" ")} | with/8 | w/o/8`);
  console.log(`-----------------------------------+-${routerVariants.map(() => "----").join("-")}-+--------+-------`);
  for (const q of queries) {
    const wRow = routerVariants.map((v) => {
      const c = index.get(`${v}|with-claudemd|${q.id}`);
      return c?.correct ? "✓" : "·";
    });
    const wCount = wRow.filter((x) => x === "✓").length;
    const oCount = routerVariants.filter((v) => index.get(`${v}|without-claudemd|${q.id}`)?.correct).length;
    const exp = q.expected.replace(/^user:/, "");
    const flag = wCount > oCount ? " ↑" : wCount < oCount ? " ↓" : "";
    console.log(`${pad(q.id + " (" + exp + ")", 35)} | ${wRow.map((x) => pad(x, 4)).join(" ")} | ${pad(wCount, 6, true)} | ${pad(oCount, 5, true)}${flag}`);
  }

  // ===== Table 6: Aggregate summary =====
  console.log("\n==== Table 6: Aggregate (216 router cells, excluding G-native) ====\n");
  const routerCells = cells.filter((c) => c.variant !== "G-native");
  const aggW = routerCells.filter((c) => c.condition === "with-claudemd");
  const aggO = routerCells.filter((c) => c.condition === "without-claudemd");
  function agg(arr) {
    const acc = arr.filter((c) => c.correct).length;
    const trig = arr.filter((c) => (c.routerToolCalls || 0) >= 1).length;
    const turns = arr.reduce((s, c) => s + (c.numTurns || 0), 0);
    const dur = arr.reduce((s, c) => s + (c.durationMs || 0), 0);
    const cost = arr.reduce((s, c) => s + (c.totalCost || 0), 0);
    const ctxList = arr.map((c) => c.ctxEnd).filter((x) => x != null);
    const ctxAvg = ctxList.length ? ctxList.reduce((s, x) => s + x, 0) / ctxList.length : 0;
    return { n: arr.length, acc, trig, turns, dur, cost, ctxAvg };
  }
  const a = agg(aggW), b = agg(aggO);
  console.log(`condition       | accuracy        | trigger         | Σturns | Σduration | Σcost   | ctx̄`);
  console.log(`----------------+-----------------+-----------------+--------+-----------+---------+--------`);
  console.log(`WITH CLAUDE.md  | ${fmtPct(a.acc, a.n).padEnd(15)} | ${fmtPct(a.trig, a.n).padEnd(15)} | ${pad(a.turns, 6, true)} | ${pad(fmtSec(a.dur), 9, true)} | ${pad(fmt$(a.cost), 7, true)} | ${fmtK(a.ctxAvg)}`);
  console.log(`without         | ${fmtPct(b.acc, b.n).padEnd(15)} | ${fmtPct(b.trig, b.n).padEnd(15)} | ${pad(b.turns, 6, true)} | ${pad(fmtSec(b.dur), 9, true)} | ${pad(fmt$(b.cost), 7, true)} | ${fmtK(b.ctxAvg)}`);
  console.log(`Δ               | +${a.acc-b.acc} cells (+${((a.acc/a.n-b.acc/b.n)*100).toFixed(1)}pp) | +${a.trig-b.trig} (+${((a.trig/a.n-b.trig/b.n)*100).toFixed(1)}pp) | +${a.turns-b.turns} | +${((a.dur-b.dur)/1000).toFixed(0)}s | +$${(a.cost-b.cost).toFixed(2)} | +${((a.ctxAvg-b.ctxAvg)/1000).toFixed(1)}K`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
