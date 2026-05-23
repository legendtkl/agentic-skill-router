#!/usr/bin/env node
// Render HTML report for routing-only-9x24 bench (9 variants × 24 queries).
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "runs", "routing-only-9x24");
const REPORT = join(OUT_DIR, "report.html");

const VARIANT_LABELS = {
  "G-native": "G — native (Claude Code skill auto-select, corpus enabled, no plugin)",
  "A-router": "A — self-implemented retriever (skill-router auto)",
  "B-cc": "B — DCI-Agent-CC, free shell",
  "C-lite": "C — DCI-Agent-Lite, bash-only + bounded pipelines",
  "D-agentic": "D — AgenticRAG, 4-step search/find/open/summarize",
  "E-digest": "E — compact corpus digest, 2-call wrapper",
  "H-bounded": "H — DCI-Agent-CC, scoped glob + bounded output",
  "I-meta": "I — DCI metadata-only, full catalog dump",
  "J-bounded": "J — keyword-filtered metadata-only",
};
const VARIANT_COLOR = {
  "G-native": "#64748b", "A-router": "#3b82f6", "B-cc": "#10b981",
  "C-lite": "#f59e0b", "D-agentic": "#ef4444", "E-digest": "#8b5cf6",
  "H-bounded": "#db2777", "I-meta": "#65a30d", "J-bounded": "#14b8a6",
};

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtK(n) { return n == null ? "—" : (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(Math.round(n))); }
function fmtCost(c) { return c == null ? "—" : "$" + c.toFixed(4); }
function fmtMs(ms) { return ms == null ? "—" : (ms / 1000).toFixed(1) + "s"; }
function fmtPct(p) { return p == null ? "—" : Math.round(p * 100) + "%"; }

// Model id -> price per 1M tokens. Used only when result.total_cost_usd is
// absent (timeout). Numbers come from Anthropic's published Opus 4.x list
// prices (1M-context tier is currently same input price as base Opus 4.x).
const MODEL_PRICING = {
  "claude-opus-4-7[1m]":  { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  "claude-opus-4-7":      { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  "claude-sonnet-4-6":    { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  "claude-sonnet-4-5":    { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  "default":              { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
};

function analyze(text, expected) {
  const events = text.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { type: "_raw", line: l }; } });
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const model = init?.model || "default";
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  const result = events.find((e) => e.type === "result");
  const runErr = events.find((e) => e.type === "_run_error");
  const chain = [];
  const turnCtx = [];
  let finalText = "";
  let jsonEmitTurn = null;
  let skillFired = false;
  let routerSkillName = null;
  for (const e of events) {
    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      const u = e.message.usage || {};
      const turnIdx = turnCtx.length + 1;
      turnCtx.push((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
      for (const b of e.message.content) {
        if (b.type === "tool_use") {
          const arg = b.input?.skill || b.input?.skill_name || b.input?.file_path || b.input?.command || "";
          chain.push({ turn: turnIdx, name: b.name, arg: String(arg).slice(0, 200) });
          if (b.name === "Skill") {
            skillFired = true;
            routerSkillName = b.input?.skill || b.input?.skill_name || routerSkillName;
          }
        } else if (b.type === "text") {
          if (b.text && b.text.match(/"matched_skill_name"/)) {
            jsonEmitTurn = jsonEmitTurn || turnIdx;
          }
          finalText = b.text;
        }
      }
    }
  }
  let matched = null;
  // Strict: only accept the last well-formed routing JSON line in the final
  // text (skip text that contains the literal `<skill-id>` placeholder).
  for (const m of (finalText || "").matchAll(/"matched_skill_name"\s*:\s*"([^"]+)"/g)) {
    if (m[1] && !m[1].includes("<")) matched = m[1];
  }
  // Strict equality only — no substring/includes fallback.
  const correct = matched != null && matched === expected;
  // Estimate cost if result.total_cost_usd is missing (timeout). Use
  // model-specific pricing.
  let cost = result?.total_cost_usd ?? null;
  if (cost == null) {
    const u = events.reduce((a, e) => {
      if (e.type === "assistant" && e.message?.usage) {
        const x = e.message.usage;
        a.input += x.input_tokens || 0;
        a.output += x.output_tokens || 0;
        a.cacheRead += x.cache_read_input_tokens || 0;
        a.cacheCreate += x.cache_creation_input_tokens || 0;
      }
      return a;
    }, { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
    cost = (u.input * pricing.input + u.output * pricing.output + u.cacheRead * pricing.cacheRead + u.cacheCreate * pricing.cacheCreate) / 1e6;
  }
  return {
    model,
    skillsCount: init?.skills?.length || 0,
    numTurns: result?.num_turns ?? turnCtx.length,
    durationMs: result?.duration_ms || null,
    cost,
    costEstimated: result?.total_cost_usd == null,
    output: result?.usage?.output_tokens || 0,
    cacheRead: result?.usage?.cache_read_input_tokens || 0,
    cacheCreate: result?.usage?.cache_creation_input_tokens || 0,
    input: result?.usage?.input_tokens || 0,
    startCtx: turnCtx[0] || 0,
    endCtx: turnCtx.at(-1) || 0,
    chain,
    matched,
    correct,
    skillFired,
    routerSkillName,
    jsonEmitTurn,
    finalText,
    timedOut: !!runErr,
  };
}

async function main() {
  const summary = JSON.parse(await readFile(join(OUT_DIR, "summary.json"), "utf8"));
  const queries = summary.queries;
  const variants = summary.variants.map((v) => v.id);
  const data = {};
  for (const v of variants) {
    data[v] = {};
    for (const q of queries) {
      const f = join(OUT_DIR, v, `${q.id}.jsonl`);
      if (!existsSync(f)) continue;
      const expectedShort = q.expected.replace(/^user:/, "");
      data[v][q.id] = analyze(await readFile(f, "utf8"), expectedShort);
    }
  }

  // Variant aggregate rows
  const aggRows = variants.map((v) => {
    const xs = queries.map((q) => data[v]?.[q.id]).filter(Boolean);
    if (!xs.length) return null;
    const sum = (k) => xs.reduce((s, x) => s + (x[k] || 0), 0);
    const acc = xs.filter((x) => x.correct).length;
    const triggered = xs.filter((x) => x.skillFired).length;
    return {
      v,
      n: xs.length,
      acc,
      sumCost: sum("cost"),
      sumTurns: sum("numTurns"),
      sumDuration: sum("durationMs"),
      avgStartCtx: sum("startCtx") / xs.length,
      avgEndCtx: sum("endCtx") / xs.length,
      trigger: v === "G-native" ? null : triggered / xs.length,
      anyEstimated: xs.some((x) => x.costEstimated),
      timeouts: xs.filter((x) => x.timedOut).length,
    };
  }).filter(Boolean);

  const aggTable = `
  <table class="agg">
    <thead><tr>
      <th>variant</th><th>accuracy</th><th>trigger rate</th><th>∑ turns</th>
      <th>∑ duration</th><th>∑ cost</th><th>avg ctx start</th><th>avg ctx end</th>
      <th>timeouts</th>
    </tr></thead>
    <tbody>${aggRows.map((r) => `
      <tr style="border-left:4px solid ${VARIANT_COLOR[r.v] || '#888'}">
        <td><b>${esc(r.v)}</b><br><span class="muted">${esc(VARIANT_LABELS[r.v] || "")}</span></td>
        <td>${r.acc}/${r.n}</td>
        <td>${fmtPct(r.trigger)}</td>
        <td>${r.sumTurns}</td>
        <td>${fmtMs(r.sumDuration)}</td>
        <td>${fmtCost(r.sumCost)}${r.anyEstimated ? '<sup>*</sup>' : ''}</td>
        <td>${fmtK(r.avgStartCtx)}</td>
        <td>${fmtK(r.avgEndCtx)}</td>
        <td>${r.timeouts > 0 ? `<span class="warn">${r.timeouts}</span>` : '0'}</td>
      </tr>`).join("")}
    </tbody>
  </table>
  <p class="muted footnote">* cost partially estimated from token usage (timeout, no result event)</p>`;

  // Per-query tables
  const querySections = queries.map((q) => {
    const rows = variants.map((v) => {
      const a = data[v]?.[q.id];
      if (!a) return `<tr><td><b>${esc(v)}</b></td><td colspan="11" class="muted">(no transcript)</td></tr>`;
      return `<tr style="border-left:4px solid ${VARIANT_COLOR[v] || '#888'}">
        <td><b>${esc(v)}</b></td>
        <td>${a.numTurns}</td>
        <td>${fmtMs(a.durationMs)}</td>
        <td>${fmtCost(a.cost)}${a.costEstimated ? '<sup>*</sup>' : ''}</td>
        <td>${fmtK(a.startCtx)}</td>
        <td>${fmtK(a.endCtx)}</td>
        <td>${fmtK(a.cacheRead)}</td>
        <td>${fmtK(a.cacheCreate)}</td>
        <td>${fmtK(a.output)}</td>
        <td>${a.skillsCount}</td>
        <td class="${v === 'G-native' ? 'muted' : (a.skillFired ? 'ok' : 'fail')}">${v === 'G-native' ? 'n/a (zero-shot)' : (a.skillFired ? '✓' : '✗')}</td>
        <td class="${a.correct ? 'ok' : 'fail'}">${esc(a.matched || '—')} ${a.correct ? '✓' : '✗'}</td>
      </tr>`;
    });
    return `
    <h3>${esc(q.id)} <span class="muted">— gt user:${esc(q.expected.replace(/^user:/,""))}, domain=${esc(q.domain || "")}</span></h3>
    <table class="percell">
      <thead><tr>
        <th>variant</th><th>turns</th><th>dur</th><th>cost</th>
        <th>ctx start</th><th>ctx end</th><th>cache read</th><th>cache create</th>
        <th>output</th><th>init skills</th><th>Skill fired</th><th>matched</th>
      </tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
  }).join("");

  // Chain folds
  const chainSection = queries.map((q) => {
    const blks = variants.map((v) => {
      const a = data[v]?.[q.id];
      if (!a) return "";
      const items = a.chain.length
        ? a.chain.map((c) => `<li><code>t${c.turn} ${esc(c.name)}</code> <code class="arg">${esc(c.arg)}</code></li>`).join("")
        : '<li class="muted">(no tool calls — zero-shot direct emit)</li>';
      return `
        <div class="chainblk" style="border-left:3px solid ${VARIANT_COLOR[v] || '#888'}">
          <h4><b>${esc(v)}</b> <span class="muted">${a.numTurns}t / ${fmtMs(a.durationMs)} / ${fmtCost(a.cost)}</span></h4>
          <ol>${items}</ol>
          <div class="final"><span class="lbl">final text:</span> <code>${esc((a.finalText || "").slice(0, 260))}</code></div>
        </div>`;
    }).join("");
    return `
    <details><summary><b>${esc(q.id)}</b> — tool chains across 9 variants</summary>
      <div class="chains">${blks}</div>
    </details>`;
  }).join("");

  const html = `<!doctype html><meta charset="utf-8" />
<title>routing-only 9×24</title>
<style>
  body { font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 1200px; margin: 28px auto; padding: 0 18px; color: #1f2937; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 17px; margin-top: 32px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
  h3 { font-size: 14px; margin: 22px 0 8px; }
  h4 { font-size: 13px; margin: 0 0 6px; }
  .muted { color: #6b7280; font-size: 90%; font-weight: normal; }
  .footnote { font-size: 11px; margin-top: 4px; }
  .warn { color: #b45309; font-weight: bold; }
  .ok { color: #059669; }
  .fail { color: #dc2626; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 12px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 600; }
  table.agg td { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  table.agg td:first-child { font-family: inherit; }
  table.percell td { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  table.percell td:first-child { font-family: inherit; }
  details { margin-top: 18px; }
  details summary { cursor: pointer; padding: 6px 0; font-size: 13px; }
  .chains { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: 8px; }
  .chainblk { padding: 8px 12px; background: #f9fafb; border-radius: 4px; }
  .chainblk ol { font-size: 11px; padding-left: 22px; margin: 0; }
  .chainblk code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; }
  .chainblk code.arg { color: #6b7280; word-break: break-all; }
  .final { margin-top: 8px; font-size: 11px; }
  .final code { word-break: break-all; }
  .final .lbl { color: #6b7280; }
  .setup { background: #fefce8; border: 1px solid #fde047; padding: 12px 16px; border-radius: 4px; font-size: 13px; margin-top: 18px; }
  .setup table { font-size: 12px; }
  .setup table td:first-child { color: #6b7280; width: 25%; }
</style>
<h1>Routing-only: 9 variants × 24 queries</h1>
<p class="muted">Aligned setup: shared strong description (only triggers), variant body production-ized (stop block removed), STOP_TAIL in query controls termination and requires only <code>matched_skill_name</code>. NO <code>--append-system-prompt</code>, NO <code>--max-turns</code>. Corpus: 150 SkillRouter-cropped skills.</p>

<h2>Variant aggregate</h2>
${aggTable}

<h2>Per-query breakdown</h2>
${querySections}

<h2>Tool chains</h2>
${chainSection}

<h2>Setup</h2>
<div class="setup">
<table>
  <tr><td>model</td><td><code>${esc(Object.values(data).flatMap(Object.values).find((x) => x?.model)?.model || "unknown")}</code></td></tr>
  <tr><td>started / finished</td><td><code>${esc(summary.startedAt || "?")}</code> → <code>${esc(summary.finishedAt || "?")}</code></td></tr>
  <tr><td>random baseline</td><td>uniform pick over 150 corpus skills = <b>${(1/150*100).toFixed(2)}%</b> accuracy expected, ~0.0 turns to emit JSON. Use this as a lower bound when reading the variant accuracy column.</td></tr>
  <tr><td>HOME</td><td><code>${esc(summary.home)}</code></td></tr>
  <tr><td>corpus</td><td>150 disabled skills (SkillRouter arXiv:2603.22455 eval-core crop, opaque skill-NNN ids)</td></tr>
  <tr><td>router variants</td><td>corpus DISABLED + <code>--plugin-dir</code> + plugin SKILL.md swapped to <code>variants/&lt;variant&gt;.SKILL.md</code> per cell</td></tr>
  <tr><td>G-native</td><td>corpus ENABLED + no plugin (Claude Code's native skill auto-select)</td></tr>
  <tr><td>SKILL.md alignment</td><td>shared strong description, body stripped of routing-benchmark stop block; only routing workflow kept</td></tr>
  <tr><td>stop semantics</td><td>STOP_TAIL appended to query — emits <code>{"matched_skill_name":"&lt;id&gt;"}</code> and stops</td></tr>
  <tr><td>claude args</td><td><code>-p &lt;query+STOP_TAIL&gt; --output-format=stream-json --verbose --permission-mode=bypassPermissions</code></td></tr>
  <tr><td>timeout</td><td>240s per cell</td></tr>
  <tr><td>cost estimate</td><td>fallback when result.total_cost_usd missing: <code>(input × $3 + output × $15 + cache_read × $0.30 + cache_create × $3.75) / 1M</code> (sonnet-4.5 list price)</td></tr>
</table>
</div>
`;
  await writeFile(REPORT, html);
  console.log(`wrote ${REPORT}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
