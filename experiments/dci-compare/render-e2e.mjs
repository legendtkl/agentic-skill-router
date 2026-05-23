#!/usr/bin/env node
// Render an HTML report comparing native vs J-bounded end-to-end runs.
// Reads runs/e2e-multi/{native,j-prod}/<query-id>.jsonl + summary.json and
// writes runs/e2e-multi/report.html.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const OUT_DIR = join(EXP_DIR, "runs", "e2e-multi");
const REPORT = join(OUT_DIR, "report.html");

const MODES = [
  { id: "native", label: "Native (Claude Code skill auto-select, corpus enabled, no plugin)", color: "#64748b" },
  { id: "j-prod", label: "J-bounded (skill-router plugin, corpus disabled, keyword-filtered grep + Read body)", color: "#14b8a6" },
];

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function parseEvents(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { type: "_raw", line }; }
  });
}

function analyze(events, expectedSkill) {
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = events.find((e) => e.type === "result");
  const chain = [];
  let matchedSkill = null;
  let bodyReadTurn = null;
  let turnIdx = 0;
  const turnCtx = [];
  for (const e of events) {
    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      turnIdx++;
      const u = e.message.usage || {};
      turnCtx.push({
        turn: turnIdx,
        input: u.input_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        cacheCreate: u.cache_creation_input_tokens || 0,
        total: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      });
      for (const block of e.message.content) {
        if (block.type !== "tool_use") continue;
        const name = block.name;
        const input = block.input || {};
        if (name === "Skill") {
          chain.push({ turn: turnIdx, tool: "Skill", arg: input.skill || input.skill_name || "" });
          if (typeof input.skill === "string" && input.skill.includes(expectedSkill)) matchedSkill = input.skill;
        } else if (name === "Read") {
          const fp = input.file_path || "";
          chain.push({ turn: turnIdx, tool: "Read", arg: fp });
          if (fp.includes(expectedSkill) && fp.includes("SKILL.md.skill-router-disabled")) {
            if (bodyReadTurn === null) bodyReadTurn = turnIdx;
            matchedSkill = matchedSkill || expectedSkill;
          }
        } else if (name === "Bash") {
          const cmd = (input.command || "").replace(/\s+/g, " ").slice(0, 160);
          chain.push({ turn: turnIdx, tool: "Bash", arg: cmd });
          // also capture if a Bash cat-ed the body (alt path to Read)
          if (cmd.includes(expectedSkill) && cmd.includes("SKILL.md.skill-router-disabled") && bodyReadTurn === null) {
            bodyReadTurn = turnIdx;
            matchedSkill = matchedSkill || expectedSkill;
          }
        } else if (name === "Write" || name === "Edit") {
          chain.push({ turn: turnIdx, tool: name, arg: input.file_path || "" });
        } else {
          chain.push({ turn: turnIdx, tool: name, arg: "" });
        }
      }
    }
  }
  return {
    skillsCount: init?.skills?.length || 0,
    numTurns: result?.num_turns ?? turnIdx,
    durationMs: result?.duration_ms || 0,
    totalInput: result?.usage?.input_tokens || 0,
    totalOutput: result?.usage?.output_tokens || 0,
    totalCacheRead: result?.usage?.cache_read_input_tokens || 0,
    totalCacheCreate: result?.usage?.cache_creation_input_tokens || 0,
    startCtx: turnCtx[0]?.total || 0,
    endCtx: turnCtx.at(-1)?.total || 0,
    chain,
    matchedSkill,
    matched: matchedSkill === expectedSkill || (matchedSkill || "").endsWith(":" + expectedSkill) || (matchedSkill || "").includes(expectedSkill),
    bodyReadTurn,
    turnCtx,
    errored: !!events.find((e) => e.type === "_run_error"),
  };
}

function fmtMs(ms) { return (ms / 1000).toFixed(1) + "s"; }
function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n); }

function renderChainRows(chain) {
  if (!chain.length) return '<tr><td colspan="3" class="muted">(no tool calls)</td></tr>';
  return chain.map((c) =>
    `<tr><td class="num">${c.turn}</td><td><code>${htmlEscape(c.tool)}</code></td><td class="arg"><code>${htmlEscape(c.arg)}</code></td></tr>`
  ).join("");
}

function renderTurnSpark(turnCtx, maxCtx) {
  if (!turnCtx.length) return "";
  const w = 280, h = 60, pad = 6;
  const points = turnCtx.map((t, i) => {
    const x = pad + (i * (w - 2 * pad)) / Math.max(1, turnCtx.length - 1);
    const y = h - pad - ((t.total / maxCtx) * (h - 2 * pad));
    return [x, y];
  });
  const path = points.map(([x, y], i) => (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1)).join(" ");
  const dots = points.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="currentColor" />`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" aria-hidden="true">
    <path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" />
    ${dots}
  </svg>`;
}

function renderQuerySection(q, byMode, maxCtx) {
  const cards = MODES.map((m) => {
    const a = byMode[m.id];
    if (!a) return `<div class="card" style="border-left:4px solid ${m.color}"><h3>${htmlEscape(m.label)}</h3><div class="muted">(no transcript)</div></div>`;
    return `
    <div class="card" style="border-left:4px solid ${m.color}; color:${m.color}">
      <h3>${htmlEscape(m.label)}</h3>
      <div class="metrics">
        <div><span class="lbl">turns</span><span class="val">${a.numTurns}</span></div>
        <div><span class="lbl">duration</span><span class="val">${fmtMs(a.durationMs)}</span></div>
        <div><span class="lbl">init skills</span><span class="val">${a.skillsCount}</span></div>
        <div><span class="lbl">ctx start</span><span class="val">${fmtK(a.startCtx)}</span></div>
        <div><span class="lbl">ctx end</span><span class="val">${fmtK(a.endCtx)}</span></div>
        <div><span class="lbl">cache read</span><span class="val">${fmtK(a.totalCacheRead)}</span></div>
        <div><span class="lbl">cache create</span><span class="val">${fmtK(a.totalCacheCreate)}</span></div>
        <div><span class="lbl">output</span><span class="val">${fmtK(a.totalOutput)}</span></div>
        <div><span class="lbl">matched</span><span class="val ${a.matched ? 'ok' : 'fail'}">${a.matchedSkill || "—"} ${a.matched ? "✓" : (a.matchedSkill ? "✗" : "✗ none")}</span></div>
        <div><span class="lbl">body-load turn</span><span class="val">${a.bodyReadTurn ?? (m.id === "native" ? "(framework injected)" : "—")}</span></div>
      </div>
      <div class="ctxspark" style="color:${m.color}">${renderTurnSpark(a.turnCtx, maxCtx)}</div>
      <details>
        <summary>tool_use chain (${a.chain.length})</summary>
        <table class="chain"><thead><tr><th>turn</th><th>tool</th><th>arg</th></tr></thead><tbody>${renderChainRows(a.chain)}</tbody></table>
      </details>
    </div>`;
  }).join("");

  // delta row
  const n = byMode["native"];
  const j = byMode["j-prod"];
  let delta = "";
  if (n && j) {
    const fmt = (a, b) => {
      const d = a - b;
      const pct = b ? ((d / b) * 100).toFixed(1) : "—";
      const sign = d > 0 ? "+" : "";
      const cls = d > 0 ? "pos" : "neg";
      return `<span class="${cls}">${sign}${fmtK(d)} (${sign}${pct}%)</span>`;
    };
    delta = `
    <div class="delta">
      <h4>Δ (J − native)</h4>
      <table class="kv">
        <tr><td>turns</td><td>${j.numTurns - n.numTurns}</td></tr>
        <tr><td>duration</td><td>${((j.durationMs - n.durationMs)/1000).toFixed(1)}s</td></tr>
        <tr><td>ctx start</td><td>${fmt(j.startCtx, n.startCtx)}</td></tr>
        <tr><td>ctx end</td><td>${fmt(j.endCtx, n.endCtx)}</td></tr>
        <tr><td>cache read</td><td>${fmt(j.totalCacheRead, n.totalCacheRead)}</td></tr>
        <tr><td>cache create</td><td>${fmt(j.totalCacheCreate, n.totalCacheCreate)}</td></tr>
      </table>
    </div>`;
  }

  return `
  <section class="qsec">
    <header>
      <h2>${htmlEscape(q.id)} <span class="muted">(expected user:${htmlEscape(q.expected)})</span></h2>
    </header>
    <div class="grid2">${cards}</div>
    ${delta}
  </section>`;
}

function renderSummaryTable(queries, dataByQuery) {
  const rows = queries.map((q) => {
    const n = dataByQuery[q.id]?.["native"];
    const j = dataByQuery[q.id]?.["j-prod"];
    const cell = (a) => a ? `${a.numTurns}t / ${fmtK(a.endCtx)} / ${a.matched ? "✓" : "✗"}` : "—";
    return `<tr><td><code>${htmlEscape(q.id)}</code></td><td>${cell(n)}</td><td>${cell(j)}</td></tr>`;
  });
  // aggregate
  const sum = (arr, k) => arr.reduce((s, v) => s + (v?.[k] || 0), 0);
  const avg = (arr, k) => arr.length ? sum(arr, k) / arr.length : 0;
  const ns = queries.map((q) => dataByQuery[q.id]?.["native"]).filter(Boolean);
  const js = queries.map((q) => dataByQuery[q.id]?.["j-prod"]).filter(Boolean);
  const meanCell = (arr) => arr.length ? `${(avg(arr, "numTurns")).toFixed(1)}t / ${fmtK(avg(arr, "endCtx"))} / ${arr.filter((a) => a.matched).length}/${arr.length} ✓` : "—";
  rows.push(`<tr class="agg"><td><b>mean</b></td><td><b>${meanCell(ns)}</b></td><td><b>${meanCell(js)}</b></td></tr>`);
  return rows.join("");
}

async function main() {
  const summary = JSON.parse(await readFile(join(OUT_DIR, "summary.json"), "utf8"));
  const queries = summary.queries;
  const dataByQuery = {};
  let maxCtx = 1;
  for (const q of queries) {
    dataByQuery[q.id] = {};
    for (const m of MODES) {
      const file = join(OUT_DIR, m.id, `${q.id}.jsonl`);
      if (!existsSync(file)) continue;
      const events = parseEvents(await readFile(file, "utf8"));
      const a = analyze(events, q.expected);
      dataByQuery[q.id][m.id] = a;
      for (const t of a.turnCtx) maxCtx = Math.max(maxCtx, t.total);
    }
  }

  // Cross-over extrapolation. We assume Native ctx_start is dominated by the
  // 150 skill descriptions in the system prompt; J ctx_start is the constant
  // overhead without those descriptions. The per-skill bytes in the system
  // prompt come from (ctx_start_native - ctx_start_j) / 150 on the run where
  // we know corpus size (150). We pick the largest start delta across queries
  // for a conservative estimate.
  let bestDelta = 0;
  for (const q of queries) {
    const n = dataByQuery[q.id]?.["native"];
    const j = dataByQuery[q.id]?.["j-prod"];
    if (n && j) bestDelta = Math.max(bestDelta, n.startCtx - j.startCtx);
  }
  const perSkillTokens = bestDelta / 150;
  const jExecOverhead = Math.max(0, ...queries.map((q) => {
    const n = dataByQuery[q.id]?.["native"]; const j = dataByQuery[q.id]?.["j-prod"];
    if (!n || !j) return 0;
    return (j.endCtx - j.startCtx) - (n.endCtx - n.startCtx);
  }));

  const html = `<!doctype html><meta charset="utf-8" />
<title>e2e: native vs J-bounded (3 queries)</title>
<style>
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 1100px; margin: 32px auto; padding: 0 16px; color: #1f2937; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 17px; margin-top: 36px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
  h3 { font-size: 13px; font-weight: 600; margin: 0 0 12px; line-height: 1.3; }
  h4 { font-size: 12px; font-weight: 600; margin: 18px 0 6px; color: #4b5563; text-transform: uppercase; letter-spacing: 0.04em; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
  .muted { color: #6b7280; font-weight: normal; font-size: 90%; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 12px 0; }
  .card { padding: 12px 14px; background: #f9fafb; border-radius: 6px; }
  .card h3 { color: inherit; }
  .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; font-size: 12px; color: #1f2937; }
  .metrics > div { display: flex; justify-content: space-between; }
  .metrics .lbl { color: #6b7280; }
  .metrics .val { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .metrics .ok { color: #059669; }
  .metrics .fail { color: #dc2626; }
  .ctxspark { margin: 10px 0 0; }
  .spark { display: block; width: 100%; max-width: 280px; height: 60px; }
  details { margin-top: 10px; font-size: 12px; }
  table.chain { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
  table.chain th, table.chain td { padding: 3px 6px; text-align: left; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  table.chain td.num { color: #6b7280; width: 30px; }
  table.chain td.arg code { word-break: break-all; }
  table.kv { font-size: 12px; }
  table.kv td { padding: 2px 12px 2px 0; }
  table.kv td:first-child { color: #6b7280; }
  table.summary { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  table.summary th, table.summary td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
  table.summary tr.agg { background: #f3f4f6; }
  .pos { color: #dc2626; }
  .neg { color: #059669; }
  .delta { margin-top: 6px; padding: 8px 14px; background: #f3f4f6; border-radius: 6px; }
  .extrapolation { margin-top: 16px; padding: 12px 14px; background: #fefce8; border: 1px solid #fde047; border-radius: 6px; font-size: 13px; }
  .extrapolation table { margin-top: 6px; }
</style>
<h1>End-to-end: native vs J-bounded</h1>
<p class="muted">3 queries × 2 modes. Corpus: 150 disabled skills (SkillRouter eval-core crop). No <code>--append-system-prompt</code> on either side.</p>

<h2>Summary</h2>
<table class="summary">
  <thead><tr><th>query</th><th>native: turns / ctx_end / routing</th><th>J-bounded: turns / ctx_end / routing</th></tr></thead>
  <tbody>${renderSummaryTable(queries, dataByQuery)}</tbody>
</table>

<div class="extrapolation">
  <b>Context window extrapolation.</b> Native bakes the entire enabled-skill catalog into its system prompt; J keeps system prompt constant and pays a few tool-call turns to do routing. Bytes-per-skill in the native system prompt (largest observed start-ctx delta / 150 skills) ≈ <b>${perSkillTokens.toFixed(0)} tokens</b>. J's per-run execution overhead vs native (extra grep + Read body + ack turns) ≈ <b>+${fmtK(jExecOverhead)} tokens</b>.
  <table class="kv">
    <tr><td>corpus size</td><td>est. native ctx_start</td><td>est. J ctx_start</td><td>J vs native</td></tr>
    ${[150, 300, 1000, 5000].map((n) => {
      const native = (queries.map((q) => dataByQuery[q.id]?.["native"]?.startCtx || 0).reduce((s, v) => s + v, 0) / Math.max(1, queries.length)) + (n - 150) * perSkillTokens;
      const j = queries.map((q) => dataByQuery[q.id]?.["j-prod"]?.startCtx || 0).reduce((s, v) => s + v, 0) / Math.max(1, queries.length);
      return `<tr><td>${n}</td><td>${fmtK(native)}</td><td>${fmtK(j)}</td><td class="${j < native ? 'neg' : 'pos'}">${j < native ? '−' : '+'}${fmtK(Math.abs(native - j))}</td></tr>`;
    }).join("")}
  </table>
</div>

${queries.map((q) => renderQuerySection(q, dataByQuery[q.id] || {}, maxCtx)).join("")}

<h2>Setup</h2>
<table class="kv">
  <tr><td>HOME</td><td><code>${htmlEscape(summary.home)}</code></td></tr>
  <tr><td>project</td><td><code>${htmlEscape(summary.project)}</code></td></tr>
  <tr><td>corpus</td><td>150 disabled skills (SkillRouter arXiv:2603.22455 eval-core crop, opaque skill-NNN ids)</td></tr>
  <tr><td>native mode</td><td>corpus state: enabled. no <code>--plugin-dir</code>. no <code>--append-system-prompt</code>.</td></tr>
  <tr><td>j-prod mode</td><td>corpus state: disabled. <code>--plugin-dir &lt;skill-router&gt;</code>. J SKILL.md production body (workflow = grep → pick → Read body → execute).</td></tr>
</table>
`;
  await writeFile(REPORT, html);
  console.log(`wrote ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
