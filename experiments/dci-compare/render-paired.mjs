#!/usr/bin/env node
// Render side-by-side comparison of routing-only-paired runs (with-claudemd
// vs without-claudemd). Outputs:
//   - stdout: markdown summary tables
//   - runs/routing-only-9x24-claudemd/report.html: HTML report
//   - runs/routing-only-9x24-claudemd/summary-metrics.json: derived metrics

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "runs", "routing-only-9x24-claudemd");
const SUMMARY_PATH = join(OUT_DIR, "summary.json");
const ROUTER_TOOL_PATTERN = /skill-router-skills|skill[_-]router[_-]skills/i;

// Opus 4.7 list-price fallback (USD per 1M tokens), only used when
// `result.total_cost_usd` is missing.
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
  let usage = null;
  let timedOut = false;
  for (const ev of events) {
    if (ev.type === "_run_error" && /timed out/.test(ev.error || "")) timedOut = true;
    if (ev.type === "system" && ev.subtype === "init") {
      if (ev.model) model = ev.model;
    }
    if (ev.type === "assistant" && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === "tool_use" && block.name && ROUTER_TOOL_PATTERN.test(block.name)) {
          routerToolCalls++;
        }
        if (block.type === "tool_use" && block.input?.skill &&
            ROUTER_TOOL_PATTERN.test(String(block.input.skill))) {
          routerToolCalls++;
        }
        if (block.type === "text" && block.text) finalText = block.text;
      }
      if (ev.message?.usage) usage = ev.message.usage;
    }
    if (ev.type === "result" && ev.subtype === "success") {
      totalCost = ev.total_cost_usd ?? totalCost;
      numTurns = ev.num_turns ?? numTurns;
      durationMs = ev.duration_ms ?? durationMs;
      if (ev.usage) usage = ev.usage;
    }
  }
  if (usage) {
    const inT = (usage.input_tokens || 0);
    const outT = (usage.output_tokens || 0);
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    ctxEnd = inT + cacheRead + cacheWrite;
    if (totalCost == null) {
      const p = pickPrice(model);
      totalCost = (
        inT * p.input / 1e6 +
        outT * p.output / 1e6 +
        cacheRead * p.cacheRead / 1e6 +
        cacheWrite * p.cacheWrite / 1e6
      );
      costFallback = true;
    }
  }
  const m = finalText.match(/\{[^{}]*"matched_skill_name"\s*:\s*"([^"]+)"[^{}]*\}/);
  const matched = m ? m[1] : null;
  return { routerToolCalls, matched, totalCost, costFallback, model, numTurns, durationMs, ctxEnd, timedOut };
}

function fmtPct(n, d) {
  if (!d) return "n/a";
  return `${n}/${d} (${((100 * n) / d).toFixed(0)}%)`;
}

async function main() {
  if (!existsSync(SUMMARY_PATH)) {
    console.error(`missing ${SUMMARY_PATH}`);
    process.exit(1);
  }
  const summary = JSON.parse(await readFile(SUMMARY_PATH, "utf8"));
  const queries = summary.queries;
  const qById = new Map(queries.map((q) => [q.id, q]));
  const runs = summary.runs.filter((r) => !r.__error && r.queryId);

  // Group by (variant, condition)
  const groups = new Map();
  await Promise.all(runs.map(async (run) => {
    const key = `${run.variant}|${run.condition}`;
    if (!groups.has(key)) groups.set(key, { variant: run.variant, condition: run.condition, cells: [] });
    const path = join(OUT_DIR, `${run.variant}.${run.condition}`, `${run.queryId}.jsonl`);
    let parsed = {};
    if (existsSync(path)) {
      try { parsed = await parseCell(path); } catch (err) { parsed = { error: String(err).slice(0, 200) }; }
    }
    const q = qById.get(run.queryId);
    const expected = q?.expected?.replace(/^user:/, "");
    const correct = parsed.matched && expected && parsed.matched === expected;
    groups.get(key).cells.push({ ...run, parsed, expected, correct });
  }));

  // Per-(variant, condition) aggregates
  const rows = [];
  for (const [, g] of [...groups.entries()].sort()) {
    const triggered = g.cells.filter((c) => (c.parsed?.routerToolCalls ?? 0) >= 1).length;
    const correct = g.cells.filter((c) => c.correct).length;
    const costs = g.cells.map((c) => c.parsed?.totalCost).filter((x) => x != null);
    const sumCost = costs.reduce((s, x) => s + x, 0);
    const turns = g.cells.map((c) => c.parsed?.numTurns).filter((x) => x != null);
    const sumTurns = turns.reduce((s, x) => s + x, 0);
    const durs = g.cells.map((c) => c.parsed?.durationMs).filter((x) => x != null);
    const sumDur = durs.reduce((s, x) => s + x, 0);
    const ctxEnds = g.cells.map((c) => c.parsed?.ctxEnd).filter((x) => x != null);
    const meanCtxEnd = ctxEnds.length ? ctxEnds.reduce((s, x) => s + x, 0) / ctxEnds.length : null;
    rows.push({
      variant: g.variant,
      condition: g.condition,
      total: g.cells.length,
      triggered,
      correct,
      sumCost,
      sumTurns,
      sumDur,
      meanCtxEnd,
    });
  }

  // ===== Print delta table =====
  console.log("\n==== Per-variant: with vs without CLAUDE.md ====\n");
  console.log("variant       | accuracy(with)   | accuracy(without) | Δ acc  | trigger(with)  | trigger(without) | cost(with) | cost(without)");
  console.log("--------------+------------------+-------------------+--------+----------------+------------------+------------+--------------");
  const variants = [...new Set(rows.map((r) => r.variant))];
  const variantDelta = [];
  for (const v of variants) {
    const wr = rows.find((r) => r.variant === v && r.condition === "with-claudemd");
    const wo = rows.find((r) => r.variant === v && r.condition === "without-claudemd");
    if (!wr || !wo) continue;
    const dAcc = wr.correct - wo.correct;
    const dTrig = wr.triggered - wo.triggered;
    const dCost = wr.sumCost - wo.sumCost;
    variantDelta.push({ variant: v, dAcc, dTrig, dCost });
    console.log(
      `${v.padEnd(13)} | ${fmtPct(wr.correct, wr.total).padEnd(16)} | ${fmtPct(wo.correct, wo.total).padEnd(17)} | ${(dAcc >= 0 ? "+" : "") + dAcc.toString().padStart(3) + "    "} | ${fmtPct(wr.triggered, wr.total).padEnd(14)} | ${fmtPct(wo.triggered, wo.total).padEnd(16)} | $${wr.sumCost.toFixed(2).padStart(8)} | $${wo.sumCost.toFixed(2).padStart(8)}`
    );
  }

  // ===== Aggregate trigger lift =====
  const withRows = rows.filter((r) => r.condition === "with-claudemd");
  const withoutRows = rows.filter((r) => r.condition === "without-claudemd");
  const sumTrigWith = withRows.reduce((s, r) => s + r.triggered, 0);
  const sumTotWith = withRows.reduce((s, r) => s + r.total, 0);
  const sumTrigWithout = withoutRows.reduce((s, r) => s + r.triggered, 0);
  const sumTotWithout = withoutRows.reduce((s, r) => s + r.total, 0);
  const sumAccWith = withRows.reduce((s, r) => s + r.correct, 0);
  const sumAccWithout = withoutRows.reduce((s, r) => s + r.correct, 0);
  const sumCostWith = withRows.reduce((s, r) => s + r.sumCost, 0);
  const sumCostWithout = withoutRows.reduce((s, r) => s + r.sumCost, 0);
  console.log("\n==== Aggregate ====\n");
  console.log(`trigger rate  with   = ${fmtPct(sumTrigWith, sumTotWith)}`);
  console.log(`trigger rate  without= ${fmtPct(sumTrigWithout, sumTotWithout)}`);
  console.log(`trigger lift          = +${(100 * (sumTrigWith / sumTotWith - sumTrigWithout / sumTotWithout)).toFixed(1)} pp`);
  console.log(`accuracy      with   = ${fmtPct(sumAccWith, sumTotWith)}`);
  console.log(`accuracy      without= ${fmtPct(sumAccWithout, sumTotWithout)}`);
  console.log(`Δ accuracy           = ${sumAccWith - sumAccWithout} cells`);
  console.log(`total cost   with    = $${sumCostWith.toFixed(2)}`);
  console.log(`total cost   without = $${sumCostWithout.toFixed(2)}`);
  console.log(`Δ cost               = $${(sumCostWith - sumCostWithout).toFixed(2)}`);

  // ===== HTML report =====
  const html = renderHtml(rows, variantDelta, summary, groups);
  await writeFile(join(OUT_DIR, "report.html"), html);
  console.log(`\nreport.html -> ${join(OUT_DIR, "report.html")}`);

  await writeFile(join(OUT_DIR, "summary-metrics.json"), JSON.stringify({
    rows,
    variantDelta,
    aggregate: {
      triggerWith: sumTrigWith, triggerWithout: sumTrigWithout, totalWith: sumTotWith, totalWithout: sumTotWithout,
      accWith: sumAccWith, accWithout: sumAccWithout,
      costWith: sumCostWith, costWithout: sumCostWithout,
    },
  }, null, 2));
}

function renderHtml(rows, deltas, summary, groups) {
  const variants = [...new Set(rows.map((r) => r.variant))];
  const rowsHtml = variants.map((v) => {
    const wr = rows.find((r) => r.variant === v && r.condition === "with-claudemd");
    const wo = rows.find((r) => r.variant === v && r.condition === "without-claudemd");
    if (!wr || !wo) return "";
    const dAcc = wr.correct - wo.correct;
    return `
      <tr>
        <td>${v}</td>
        <td>${wr.correct}/${wr.total} (${((100*wr.correct/wr.total)|0)}%)</td>
        <td>${wo.correct}/${wo.total} (${((100*wo.correct/wo.total)|0)}%)</td>
        <td class="${dAcc>0?'pos':dAcc<0?'neg':''}">${dAcc>=0?'+':''}${dAcc}</td>
        <td>${wr.triggered}/${wr.total}</td>
        <td>${wo.triggered}/${wo.total}</td>
        <td>$${wr.sumCost.toFixed(2)}</td>
        <td>$${wo.sumCost.toFixed(2)}</td>
        <td>${(wr.sumDur/1000).toFixed(0)}s</td>
        <td>${(wo.sumDur/1000).toFixed(0)}s</td>
      </tr>`;
  }).join("");

  // Per-cell grid
  const queries = summary.queries.map((q) => q.id);
  const variantCells = variants.map((v) => {
    const cellsWith = groups.get(`${v}|with-claudemd`)?.cells || [];
    const cellsWithout = groups.get(`${v}|without-claudemd`)?.cells || [];
    const cellByQuery = (cells) => Object.fromEntries(cells.map((c) => [c.queryId, c]));
    const wMap = cellByQuery(cellsWith);
    const woMap = cellByQuery(cellsWithout);
    return `
      <h3>${v}</h3>
      <table class="grid">
        <tr><th>query</th><th>with</th><th>without</th></tr>
        ${queries.map((q) => {
          const w = wMap[q];
          const o = woMap[q];
          const cls = (c) => c?.correct ? 'ok' : 'fail';
          const txt = (c) => c?.parsed?.matched ? `${c.parsed.matched}${c.parsed.routerToolCalls>=1?' (T)':' (-)'}` : '-';
          return `<tr><td class="qid">${q}</td><td class="${cls(w)}">${txt(w)}</td><td class="${cls(o)}">${txt(o)}</td></tr>`;
        }).join("")}
      </table>`;
  }).join("");

  return `<!doctype html><html><head>
<title>routing-only-paired (CLAUDE.md A/B)</title>
<meta charset="utf-8">
<style>
  body { font: 13px/1.5 system-ui, sans-serif; padding: 20px; max-width: 1400px; margin: 0 auto; color: #333; }
  h1, h2, h3 { color: #222; }
  table { border-collapse: collapse; margin: 16px 0; }
  td, th { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
  th { background: #f0f0f0; }
  .summary td:first-child { font-weight: bold; }
  .pos { color: #1a7f37; font-weight: bold; }
  .neg { color: #cf222e; font-weight: bold; }
  .ok { background: #e6f4e6; }
  .fail { background: #fcebea; color: #888; }
  .qid { color: #555; font-family: monospace; font-size: 12px; }
  .grid { font-size: 12px; }
  .grid td:nth-child(2), .grid td:nth-child(3) { font-family: monospace; }
</style>
</head><body>
<h1>routing-only-paired (CLAUDE.md A/B)</h1>
<p>${summary.startedAt} → ${summary.finishedAt}</p>

<h2>Per-variant summary</h2>
<table class="summary">
  <tr><th rowspan="2">variant</th><th colspan="3">accuracy</th><th colspan="2">trigger</th><th colspan="2">cost</th><th colspan="2">duration</th></tr>
  <tr><th>with</th><th>without</th><th>Δ</th><th>with</th><th>without</th><th>with</th><th>without</th><th>with</th><th>without</th></tr>
  ${rowsHtml}
</table>

<h2>Per-cell detail</h2>
${variantCells}

</body></html>`;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
