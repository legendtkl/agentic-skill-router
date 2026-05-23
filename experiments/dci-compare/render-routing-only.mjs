#!/usr/bin/env node
// Minimal HTML report for routing-only-bench: one big comparison table and
// per-query tool_use chains.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "runs", "routing-only-bench");
const REPORT = join(OUT_DIR, "report.html");

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n); }
function fmtCost(c) { return c == null ? "—" : "$" + c.toFixed(4); }
function fmtMs(ms) { return (ms / 1000).toFixed(1) + "s"; }

function analyze(text, expected) {
  const events = text.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { type: "_raw", line: l }; } });
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = events.find((e) => e.type === "result");
  const chain = [];
  const turnCtx = [];
  let finalText = "";
  for (const e of events) {
    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      const u = e.message.usage || {};
      turnCtx.push((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
      for (const b of e.message.content) {
        if (b.type === "tool_use") {
          const arg = b.input?.skill || b.input?.skill_name || b.input?.file_path || b.input?.command || "";
          chain.push({ name: b.name, arg: String(arg).slice(0, 160) });
        } else if (b.type === "text") {
          finalText = b.text;
        }
      }
    }
  }
  let matched = null;
  const m = finalText.match(/"matched_skill_name"\s*:\s*"([^"]+)"/);
  if (m) matched = m[1];
  const correct = matched && (matched === expected || matched.endsWith(":" + expected));
  return {
    skillsCount: init?.skills?.length || 0,
    numTurns: result?.num_turns ?? turnCtx.length,
    durationMs: result?.duration_ms || 0,
    cost: result?.total_cost_usd ?? null,
    output: result?.usage?.output_tokens || 0,
    cacheRead: result?.usage?.cache_read_input_tokens || 0,
    cacheCreate: result?.usage?.cache_creation_input_tokens || 0,
    startCtx: turnCtx[0] || 0,
    endCtx: turnCtx.at(-1) || 0,
    chain,
    matched,
    correct,
    finalText,
  };
}

async function main() {
  const summary = JSON.parse(await readFile(join(OUT_DIR, "summary.json"), "utf8"));
  const queries = summary.queries;
  const data = {};
  for (const q of queries) {
    data[q.id] = {};
    for (const m of summary.modes) {
      const f = join(OUT_DIR, m, `${q.id}.jsonl`);
      if (!existsSync(f)) continue;
      const expectedShort = q.expected.replace(/^user:/, "");
      data[q.id][m] = analyze(await readFile(f, "utf8"), expectedShort);
    }
  }

  const rows = [];
  for (const q of queries) {
    const n = data[q.id]?.native;
    const j = data[q.id]?.j;
    const cell = (a) => a ? `
      <div class="cell">
        <div class="line"><span class="lbl">turns</span><span>${a.numTurns}</span></div>
        <div class="line"><span class="lbl">duration</span><span>${fmtMs(a.durationMs)}</span></div>
        <div class="line"><span class="lbl">cost</span><span>${fmtCost(a.cost)}</span></div>
        <div class="line"><span class="lbl">ctx start</span><span>${fmtK(a.startCtx)}</span></div>
        <div class="line"><span class="lbl">ctx end</span><span>${fmtK(a.endCtx)}</span></div>
        <div class="line"><span class="lbl">cache read</span><span>${fmtK(a.cacheRead)}</span></div>
        <div class="line"><span class="lbl">cache create</span><span>${fmtK(a.cacheCreate)}</span></div>
        <div class="line"><span class="lbl">output</span><span>${fmtK(a.output)}</span></div>
        <div class="line"><span class="lbl">init skills</span><span>${a.skillsCount}</span></div>
        <div class="line"><span class="lbl">matched</span><span class="${a.correct ? 'ok' : 'fail'}">${esc(a.matched || "—")} ${a.correct ? "✓" : "✗"}</span></div>
      </div>` : `<div class="cell muted">(no transcript)</div>`;
    rows.push(`
    <tr>
      <td class="qcell"><b>${esc(q.id)}</b><br><span class="muted">gt: ${esc(q.expected)}<br>domain: ${esc(q.domain || "")}</span></td>
      <td>${cell(n)}</td>
      <td>${cell(j)}</td>
    </tr>`);
  }

  // aggregate
  const agg = (mode) => {
    const xs = queries.map((q) => data[q.id]?.[mode]).filter(Boolean);
    if (!xs.length) return "";
    const sum = (k) => xs.reduce((s, x) => s + (x[k] || 0), 0);
    const acc = xs.filter((x) => x.correct).length;
    return `
      <div class="cell">
        <div class="line"><span class="lbl">accuracy</span><span>${acc}/${xs.length}</span></div>
        <div class="line"><span class="lbl">∑ turns</span><span>${sum("numTurns")}</span></div>
        <div class="line"><span class="lbl">∑ duration</span><span>${fmtMs(sum("durationMs"))}</span></div>
        <div class="line"><span class="lbl">∑ cost</span><span>${fmtCost(sum("cost"))}</span></div>
        <div class="line"><span class="lbl">avg ctx end</span><span>${fmtK(sum("endCtx") / xs.length)}</span></div>
      </div>`;
  };
  rows.push(`<tr class="agg"><td class="qcell"><b>aggregate</b></td><td>${agg("native")}</td><td>${agg("j")}</td></tr>`);

  // chains
  const chains = queries.map((q) => {
    const blk = (mode) => {
      const a = data[q.id]?.[mode];
      if (!a) return "";
      const items = a.chain.map((c) => `<li><code>${esc(c.name)}</code> <code class="arg">${esc(c.arg)}</code></li>`).join("");
      return `
        <div class="chainblk">
          <h4>${mode}</h4>
          <ol>${items}</ol>
          <div class="final"><span class="lbl">final text:</span> <code>${esc((a.finalText || "").slice(0, 220))}</code></div>
        </div>`;
    };
    return `
    <details><summary>${esc(q.id)} — tool chains</summary>
      <div class="chains">${blk("native")}${blk("j")}</div>
    </details>`;
  }).join("");

  const html = `<!doctype html><meta charset="utf-8" />
<title>routing-only: native vs J (${queries.length} queries)</title>
<style>
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 1000px; margin: 32px auto; padding: 0 16px; color: #1f2937; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .muted { color: #6b7280; font-size: 90%; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th, td { padding: 8px 10px; vertical-align: top; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; }
  tr.agg td { background: #fefce8; }
  .qcell { width: 22%; font-size: 13px; }
  .cell { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
  .cell.muted { padding: 4px; }
  .line { display: flex; justify-content: space-between; gap: 12px; padding: 1px 0; }
  .line .lbl { color: #6b7280; }
  .ok { color: #059669; }
  .fail { color: #dc2626; }
  details { margin-top: 18px; }
  details summary { cursor: pointer; font-weight: 600; font-size: 13px; padding: 6px 0; }
  .chains { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; }
  .chainblk h4 { font-size: 12px; margin: 0 0 4px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
  .chainblk ol { font-size: 12px; padding-left: 20px; margin: 0; }
  .chainblk code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; }
  .chainblk code.arg { color: #6b7280; word-break: break-all; }
  .final { margin-top: 8px; font-size: 11px; }
  .final code { word-break: break-all; }
</style>
<h1>Routing-only: native vs J-bounded</h1>
<p class="muted">${queries.length} queries × 2 modes. Production J SKILL.md (no stop in body) + routing-only stop instruction appended to query tail. NO <code>--append-system-prompt</code>. Corpus: 150 SkillRouter-cropped skills.</p>

<table>
  <thead><tr><th>query</th><th>native (corpus enabled, no plugin)</th><th>J (corpus disabled, plugin loaded)</th></tr></thead>
  <tbody>${rows.join("")}</tbody>
</table>

<h2 style="margin-top:32px; font-size:16px">Tool chains</h2>
${chains}
`;
  await writeFile(REPORT, html);
  console.log(`wrote ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
