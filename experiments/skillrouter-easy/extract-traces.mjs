#!/usr/bin/env node
// extract-traces.mjs — Extract per-query execution traces from JSONL transcripts
// and render them as a compact HTML report similar to the DCI comparison report.
//
// Usage: node extract-traces.mjs [--out=runs/traces-report.html]

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = join(__dirname, "runs");

function truncate(s, n = 200) {
  if (!s) return "";
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseClaudeJsonl(lines) {
  const steps = [];
  let usage = {};
  let cost = 0;
  let turns = 0;
  let wallMs = 0;

  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }

    if (d.type === "assistant") {
      turns++;
      const msg = d.message || {};
      for (const c of msg.content || []) {
        if (c.type === "tool_use") {
          steps.push({
            type: "tool",
            name: c.name,
            input: c.name === "Bash"
              ? (c.input?.command || "")
              : c.name === "Skill"
              ? (c.input?.skill || "") + "(" + truncate(c.input?.args || "", 120) + ")"
              : JSON.stringify(c.input || {}),
            output: null,
            id: c.id,
          });
        } else if (c.type === "text" && c.text?.trim()) {
          steps.push({ type: "text", text: c.text.trim() });
        }
      }
      usage = msg.usage || usage;
    } else if (d.type === "user") {
      const msg = d.message || {};
      for (const c of msg.content || []) {
        if (c?.type === "tool_result" && c.tool_use_id) {
          const step = steps.findLast(s => s.id === c.tool_use_id);
          if (step) {
            let content = c.content;
            if (Array.isArray(content)) {
              content = content.map(x => x?.text || "").join("");
            }
            step.output = truncate(String(content || ""), 300);
          }
        }
      }
    } else if (d.type === "result") {
      cost = d.cost_usd || 0;
      usage = d.usage || usage;
      wallMs = d.duration_ms || 0;
    }
  }

  return {
    steps,
    metrics: {
      turns,
      wallMs,
      cost,
      inputTokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
      outputTokens: usage.output_tokens || 0,
    },
  };
}

function parseCodexJsonl(lines) {
  const steps = [];
  let usage = {};
  let turns = 0;
  let wallMs = 0;

  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }

    if (d.type === "item.completed") {
      const item = d.item || {};
      if (item.type === "command_execution") {
        let cmd = item.command || "";
        // Strip the zsh -lc wrapper
        cmd = cmd.replace(/^\/usr\/bin\/zsh -lc "/, "").replace(/"$/, "");
        steps.push({
          type: "tool",
          name: "Bash",
          input: cmd,
          output: truncate(item.aggregated_output || "", 300),
        });
      } else if (item.type === "agent_message") {
        steps.push({ type: "text", text: item.text || "" });
      }
    } else if (d.type === "turn.completed") {
      turns++;
      usage = d.usage || usage;
    } else if (d.type === "_stderr") {
      const m = String(d.text || "").match(/Duration:\s*([\d.]+)s/);
      if (m) wallMs = parseFloat(m[1]) * 1000;
    }
  }

  const inputTokens = (usage.input_tokens || 0) + (usage.cached_input_tokens || 0);
  const outputTokens = usage.output_tokens || 0;
  const cost = (((usage.input_tokens || 0) - (usage.cached_input_tokens || 0)) * 5
    + (usage.cached_input_tokens || 0) * 0.5
    + outputTokens * 30) / 1e6;

  return {
    steps,
    metrics: { turns, wallMs, cost, inputTokens, outputTokens },
  };
}

async function loadAllTraces() {
  const cells = [];
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = e.name.match(/^(claude|codex)-(.+)$/);
    if (!m) continue;
    const [, host, variant] = m;
    const cellDir = join(RUNS_DIR, e.name);
    const summaryPath = join(cellDir, "summary.json");
    if (!existsSync(summaryPath)) continue;

    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    const queryTraces = {};

    for (const r of summary.results || []) {
      const jsonlPath = join(cellDir, `${r.query_id}.jsonl`);
      if (!existsSync(jsonlPath)) continue;
      const content = await readFile(jsonlPath, "utf8");
      const lines = content.split("\n").filter(Boolean);
      const parsed = host === "claude" ? parseClaudeJsonl(lines) : parseCodexJsonl(lines);
      queryTraces[r.query_id] = {
        ...parsed,
        result: r,
      };
    }

    cells.push({ host, variant, summary, queryTraces });
  }
  return cells;
}

function renderTraceSteps(trace) {
  const parts = [];
  for (const step of trace.steps) {
    if (step.type === "tool") {
      const inputHtml = escapeHtml(truncate(step.input, 250));
      const outputHtml = step.output ? escapeHtml(truncate(step.output, 250)) : "";
      parts.push(
        `<div class="step"><div><span class="name">${escapeHtml(step.name)}</span>: <span class="in">${inputHtml}</span></div>` +
        (outputHtml ? `<div class="out">${outputHtml}</div>` : "") +
        `</div>`
      );
    } else if (step.type === "text") {
      parts.push(`<div class="step"><div class="txt">${escapeHtml(truncate(step.text, 300))}</div></div>`);
    }
  }
  return parts.join("");
}

function renderHtml(cells) {
  const allQueryIds = new Set();
  const queryMeta = {};
  for (const c of cells) {
    for (const r of c.summary.results || []) {
      allQueryIds.add(r.query_id);
      if (!queryMeta[r.query_id]) {
        queryMeta[r.query_id] = { tier: r.tier, gt: r.expected_anon };
      }
    }
  }
  const queryIds = [...allQueryIds].sort();
  const cellKeys = cells.map(c => `${c.host}/${c.variant}`);

  // --- aggregate table ---
  let aggRows = "";
  for (const c of cells) {
    const s = c.summary;
    const key = `${c.host}/${c.variant}`;
    aggRows += `<tr>
      <td><b>${escapeHtml(key)}</b></td>
      <td class="num">${s.hit1}/${s.queries} (${(s.hit1_rate * 100).toFixed(1)}%)</td>
      <td class="num">${s.hit1_single}/${s.n_single}</td>
      <td class="num">${s.hit1_multi}/${s.n_multi}</td>
      <td class="num">${s.answered}/${s.queries}</td>
      <td class="num">${s.timeouts}</td>
      <td class="num">${(s.elapsedMs / 1000).toFixed(0)}s</td>
    </tr>`;
  }

  // --- per-query traces ---
  let queryHtml = "";
  for (const qid of queryIds) {
    const meta = queryMeta[qid];
    const gtStr = meta.gt.length === 1 ? meta.gt[0] : `${meta.gt.length} skills`;

    // Check hit status across cells
    const hitCount = cells.filter(c => c.queryTraces[qid]?.result?.hit1).length;
    const hitLabel = hitCount === cells.length ? "✓ all"
      : hitCount === 0 ? "✗ none"
      : `${hitCount}/${cells.length}`;
    const hitClass = hitCount === cells.length ? "hit" : hitCount === 0 ? "miss" : "partial";

    let cardsHtml = "";
    for (const c of cells) {
      const trace = c.queryTraces[qid];
      if (!trace) continue;
      const r = trace.result;
      const key = `${c.host}/${c.variant}`;
      const hostClass = c.host === "claude" ? "v-claude" : "v-codex";
      const resultIcon = r.hit1 ? `<span class="hit">✓ ${r.top1}</span>` : `<span class="miss">✗ ${r.top1 || "?"}</span>`;

      cardsHtml += `<div class="card">
        <div class="head"><span class="pill ${hostClass}">${escapeHtml(key)}</span> ${resultIcon}</div>
        <div class="metrics">
          <span>turns <b>${trace.metrics.turns}</b></span>
          <span>steps <b>${trace.steps.filter(s => s.type === "tool").length}</b></span>
        </div>
        <div class="tline">${renderTraceSteps(trace)}</div>
      </div>`;
    }

    queryHtml += `<details>
      <summary>${escapeHtml(qid)} — <code>${escapeHtml(gtStr)}</code> [${meta.tier}]
        <span class="${hitClass}" style="margin-left:8px;font-weight:600">${hitLabel}</span>
      </summary>
      <div class="grid">${cardsHtml}</div>
    </details>\n`;
  }

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>SkillRouter Easy — Per-Query Execution Traces</title>
<style>
  body { font-family: ui-sans-serif, -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1400px; margin: 0 auto; color: #111; background: #fafafa; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  h2 { margin: 28px 0 12px; font-size: 17px; border-bottom: 1px solid #e5e5e5; padding-bottom: 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #f3f4f6; font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .hit { color: #059669; }
  .miss { color: #dc2626; }
  .partial { color: #d97706; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; color: white; }
  .v-claude { background: #8b5cf6; }
  .v-codex { background: #3b82f6; }
  details { background: white; border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px 14px; margin: 8px 0; }
  details > summary { cursor: pointer; font-weight: 600; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 10px; margin-top: 8px; }
  .card { background: #fafafa; border: 1px solid #e5e5e5; border-radius: 6px; padding: 8px 10px; }
  .card .head { font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .metrics { font-size: 11px; color: #555; margin-bottom: 6px; }
  .metrics span { margin-right: 10px; }
  .tline { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; max-height: 300px; overflow-y: auto; }
  .tline .step { padding: 3px 0; border-bottom: 1px dashed #eee; }
  .tline .step:last-child { border-bottom: none; }
  .tline .name { font-weight: 600; color: #2563eb; }
  .tline .in { color: #6b7280; word-break: break-all; }
  .tline .out { color: #4b5563; margin-top: 2px; word-break: break-all; }
  .tline .txt { color: #111; background: #f0f0f0; padding: 3px 6px; border-radius: 3px; white-space: pre-wrap; word-break: break-all; }
  code { background: #f3f4f6; padding: 0 4px; border-radius: 3px; font-size: 12px; }
</style>
</head><body>

<h1>SkillRouter Easy 78K — Per-Query Execution Traces</h1>
<p style="color:#666;font-size:13px;">
  75 core queries × 6 cells (3 variants × 2 hosts). Each card shows the agent's tool-call chain for one (query, cell) pair.
  <b>Purple</b> = Claude Code (Opus 4.7), <b>Blue</b> = Codex (GPT-5.5).
  Generated from <code>runs/&lt;host&gt;-&lt;variant&gt;/&lt;query&gt;.jsonl</code>.
</p>

<h2>Aggregate</h2>
<table>
  <thead><tr><th>Cell</th><th class="num">Hit@1</th><th class="num">Single</th><th class="num">Multi</th><th class="num">Answered</th><th class="num">Timeouts</th><th class="num">Wall</th></tr></thead>
  <tbody>${aggRows}</tbody>
</table>

<h2>Per-query execution traces</h2>
${queryHtml}

</body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  let outPath = join(RUNS_DIR, "traces-report.html");
  for (const a of args) {
    if (a.startsWith("--out=")) outPath = a.slice(6);
  }

  console.error("Loading traces...");
  const cells = await loadAllTraces();
  console.error(`Loaded ${cells.length} cells`);

  const html = renderHtml(cells);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html);
  console.error(`Wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e.stack ?? e.message); process.exit(1); });
