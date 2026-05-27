#!/usr/bin/env node
// render-all-experiments.mjs — Single self-contained HTML covering every
// experiment in REPORT-claudemd-optimized.md. Uses all-traces.json
// (produced by extract-all-traces.mjs) as the primary data source so that
// per-query metrics (turns/cost/ctx_end/duration) and execution traces are
// available for *every* run, not just §9.
//
// Usage: node render-all-experiments.mjs [--out=runs/report-all-experiments.html]

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// ---------- format helpers ----------

function pct(x, denom = 1) {
  if (x == null || !Number.isFinite(x / denom)) return "—";
  return ((x / denom) * 100).toFixed(1) + "%";
}
function num(x, digits = 0) {
  if (x == null || !Number.isFinite(x)) return "—";
  if (x >= 1e6) return (x / 1e6).toFixed(2) + "M";
  if (x >= 1e3) return (x / 1e3).toFixed(1) + "k";
  return digits ? x.toFixed(digits) : Math.round(x).toString();
}
function dollars(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return "$" + x.toFixed(2);
}
function dollarsSmall(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return "$" + x.toFixed(3);
}
function secs(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return Math.round(ms / 1000) + "s";
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function truncate(s, n = 220) {
  if (!s) return "";
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Aggregate metrics across all queries of a (experiment, variant)
function aggregateMetrics(variantData) {
  let n = 0, hits = 0, sumTurns = 0, sumCost = 0, sumDur = 0;
  let sumCtxEnd = 0, sumInput = 0, sumOutput = 0, sumReasoning = 0, sumCacheRead = 0, sumCacheCreate = 0;
  let ctxCount = 0, costCount = 0, turnsCount = 0, durCount = 0;
  for (const q of Object.values(variantData)) {
    n++;
    if (q.hit) hits++;
    const m = q.metrics || {};
    if (m.turns != null) { sumTurns += m.turns; turnsCount++; }
    if (m.costUsd != null) { sumCost += m.costUsd; costCount++; }
    if (m.durationMs != null) { sumDur += m.durationMs; durCount++; }
    if (m.ctxEnd != null) { sumCtxEnd += m.ctxEnd; ctxCount++; }
    if (m.inputTokens != null) sumInput += m.inputTokens;
    if (m.outputTokens != null) sumOutput += m.outputTokens;
    if (m.reasoningTokens != null) sumReasoning += m.reasoningTokens;
    if (m.cacheRead != null) sumCacheRead += m.cacheRead;
    if (m.cacheCreate != null) sumCacheCreate += m.cacheCreate;
  }
  return {
    n, hits, accuracy: n ? hits / n : 0,
    sumTurns, sumCost, sumDur, sumInput, sumOutput, sumReasoning, sumCacheRead, sumCacheCreate,
    avgCtxEnd: ctxCount ? sumCtxEnd / ctxCount : 0,
    avgTurns: turnsCount ? sumTurns / turnsCount : 0,
  };
}

function accCls(acc) {
  if (acc >= 0.9) return "hit";
  if (acc >= 0.7) return "mid";
  return "miss";
}

// ---------- variant SKILL.md loader ----------

async function loadAllVariants() {
  const result = { dciCompare: { claude: {}, codex: {} }, skillrouterEasy: { claude: {}, codex: {} } };
  const dirs = [
    { kind: "dciCompare", host: "claude", path: join(ROOT, "experiments/dci-compare/variants/routing-only") },
    { kind: "dciCompare", host: "codex", path: join(ROOT, "experiments/dci-compare/variants/routing-only-codex") },
    { kind: "skillrouterEasy", host: "claude", path: join(ROOT, "experiments/skillrouter-easy/variants/claude") },
    { kind: "skillrouterEasy", host: "codex", path: join(ROOT, "experiments/skillrouter-easy/variants/codex") },
  ];
  for (const d of dirs) {
    if (!existsSync(d.path)) continue;
    const files = await readdir(d.path);
    for (const f of files) {
      if (!f.endsWith(".SKILL.md")) continue;
      const id = f.replace(/\.SKILL\.md$/, "");
      result[d.kind][d.host][id] = await readFile(join(d.path, f), "utf8");
    }
  }
  return result;
}

// Scaling-J / Easy summary loaders for sections without rich JSONL traces
async function loadScalingHard() {
  const cells = [
    { label: "J-v2 × 150 (Claude Code)", path: "experiments/scaling-jbounded/runs/sweep24-v2-150-cmd/cells.json" },
    { label: "J-v2 × 79K Hard (Claude Code)", path: "experiments/scaling-jbounded/runs/sweep24-v2-full-cmd/cells.json" },
  ];
  const rows = [];
  for (const c of cells) {
    const p = join(ROOT, c.path);
    if (!existsSync(p)) continue;
    const d = JSON.parse(await readFile(p, "utf8"));
    rows.push({ ...c, agg: d.aggregate, cells: d.cells });
  }
  return rows;
}

async function loadRerunDir(name) {
  const dir = join(ROOT, "experiments/dci-compare/runs", name);
  const cellsPath = join(dir, "cells.json");
  const aggPath = join(dir, "aggregates.json");
  if (!existsSync(cellsPath) || !existsSync(aggPath)) return null;
  return {
    name,
    cells: JSON.parse(await readFile(cellsPath, "utf8")),
    aggregates: JSON.parse(await readFile(aggPath, "utf8")),
  };
}

// New 16-variant fresh rerun (replaces §1+§2 historical data).
// Claude Code still comes from the full rerun; Codex is overlaid with the
// corrected new-CLI rerun so the HTML reflects the latest validated Codex run.
async function loadRerun150() {
  const base = await loadRerunDir("rerun-150-full-2026-05-26");
  const codex = await loadRerunDir("rerun-codex-newcli-full-2026-05-26");
  if (!base && !codex) return null;
  if (!base) return { ...codex, sources: { codex: codex.name } };
  if (!codex) return { ...base, sources: { claude: base.name, codex: base.name } };

  const cells = [
    ...base.cells.filter(c => c.host !== "codex"),
    ...codex.cells.filter(c => c.host === "codex"),
  ];
  const aggregates = {};
  for (const [key, value] of Object.entries(base.aggregates)) {
    if (!key.startsWith("codex-")) aggregates[key] = value;
  }
  for (const [key, value] of Object.entries(codex.aggregates)) {
    if (key.startsWith("codex-")) aggregates[key] = value;
  }
  return {
    name: `${base.name} + ${codex.name}`,
    cells,
    aggregates,
    sources: { claude: base.name, codex: codex.name },
  };
}

async function loadEasy78KSummaries() {
  // For per-tier (single/multi) split which all-traces.json doesn't preserve
  const cellNames = ["claude-J-bounded-v2", "claude-K-bounded", "claude-M-bm25", "codex-J-bounded-v2", "codex-K-bounded", "codex-M-bm25"];
  const result = {};
  for (const name of cellNames) {
    const p = join(ROOT, "experiments/skillrouter-easy/runs", name, "summary.json");
    if (!existsSync(p)) continue;
    result[name] = JSON.parse(await readFile(p, "utf8"));
  }
  return result;
}

// ---------- constants ----------

const PAPER_EASY = {
  "BM25 (nd, Easy)": 0.000,
  "Qwen3-Emb-0.6B (nd, Easy)": 0.227,
  "Qwen3-Emb-8B (nd, Easy)": 0.307,
  "BM25 (full body, Easy)": 0.347,
  "Qwen3-Emb-0.6B (full, Easy)": 0.587,
  "Qwen3-Emb-8B (full, Easy)": 0.653,
  "SR-Emb-0.6B (full, Easy)": 0.667,
  "SR-Emb × SR-Rank (full, A-Hit@1 avg)": 0.760,
};

// ---------- styles + header ----------

function renderHeader() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>Agentic Skill Router - All Experiments about retriever</title>
<style>
  :root {
    --claude: #8b5cf6;
    --codex: #3b82f6;
    --paper: #64748b;
    --emerald: #059669;
    --amber: #d97706;
    --rose: #e11d48;
  }
  body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1600px; margin: 0 auto; color: #111; background: #fafafa; }
  h1 { margin: 0 0 6px; font-size: 24px; }
  h2 { margin: 32px 0 12px; font-size: 19px; padding-bottom: 6px; border-bottom: 2px solid #d1d5db; }
  h3 { margin: 18px 0 8px; font-size: 15px; color: #1f2937; }
  h4 { margin: 12px 0 6px; font-size: 13px; color: #4b5563; font-weight: 600; }
  p.intro { color: #4b5563; font-size: 13px; line-height: 1.55; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin: 8px 0; }
  th, td { padding: 6px 9px; text-align: left; border-bottom: 1px solid #eef2f7; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .hit { color: var(--emerald); font-weight: 600; }
  .miss { color: var(--rose); }
  .mid { color: var(--amber); }
  .gray { color: #6b7280; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; color: white; white-space: nowrap; }
  .pill-claude { background: var(--claude); }
  .pill-codex { background: var(--codex); }
  .pill-paper { background: var(--paper); }
  .badge { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 10.5px; font-weight: 600; background: #e5e7eb; color: #1f2937; margin-left: 4px; }
  .takeaway { background: #f0f9ff; border-left: 3px solid #0284c7; padding: 8px 12px; margin: 8px 0; font-size: 13px; color: #0c4a6e; border-radius: 0 4px 4px 0; }
  .note { background: #fffbeb; border-left: 3px solid #f59e0b; padding: 8px 12px; margin: 8px 0; font-size: 13px; color: #78350f; border-radius: 0 4px 4px 0; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 8px 0; }
  .panel { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
  .panel h3 { margin-top: 0; }
  details { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; margin: 6px 0; }
  details > summary { cursor: pointer; font-weight: 600; font-size: 13px; }
  details details { background: #f9fafb; }
  code { background: #f1f5f9; padding: 0 4px; border-radius: 3px; font-size: 12px; }
  pre.code { background: #1e293b; color: #e2e8f0; padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: 11.5px; line-height: 1.5; max-height: 600px; }
  pre.code code { background: none; color: inherit; padding: 0; font-size: inherit; }
  .toc { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 16px; margin: 10px 0 20px; font-size: 13px; }
  .toc a { color: #2563eb; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }
  .toc li { margin: 3px 0; }
  .matrix-row td { font-size: 11.5px; padding: 4px 6px; }
  .matrix-row .gt { color: #6b7280; font-style: italic; }
  .matrix-row .meta { color: #94a3b8; font-size: 10px; display: block; }
  .footnote { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .bar-wrap { width: 100px; height: 10px; background: #e5e7eb; border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 6px; }
  .bar-fill { height: 100%; background: var(--claude); }
  .bar-fill.codex { background: var(--codex); }
  .bar-fill.paper { background: var(--paper); }
  .trace-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 10px; margin-top: 8px; }
  .trace-card { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
  .trace-card .head { font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .trace-card .meta-row { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
  .trace-card .meta-row span { margin-right: 8px; }
  .tline { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; max-height: 280px; overflow-y: auto; }
  .tline .step { padding: 3px 0; border-bottom: 1px dashed #eee; }
  .tline .step:last-child { border-bottom: none; }
  .tline .name { font-weight: 600; color: #2563eb; }
  .tline .in { color: #6b7280; word-break: break-all; }
  .tline .out { color: #4b5563; margin-top: 2px; word-break: break-all; }
  .tline .txt { color: #111; background: #f0f0f0; padding: 3px 6px; border-radius: 3px; white-space: pre-wrap; word-break: break-all; }
</style>
</head><body>
<h1>Agentic Skill Router - All Experiments about retriever</h1>
<p class="intro">
  Single self-contained HTML for the current routing comparison. Aggregate tables, per-query
  matrices, execution traces, and variant SKILL.md implementations are inlined — no external
  file references. Organized by the main evaluation stages:
  <b>24 queries / 150 skills</b>, a <b>1K synthetic Codex scale check</b>, and
  <b>78K Easy / 75 core skills</b>, split by <b>host</b>
  (<span class="pill pill-claude">claude</span> = Opus 4.7 high reasoning,
  <span class="pill pill-codex">codex</span> = GPT-5.5 high reasoning).
  Paper baselines (SkillRouter arXiv:2603.22455) shown as
  <span class="pill pill-paper">paper</span> rows where comparable.
</p>
`;
}

function renderToc() {
  return `<div class="toc">
  <b>Sections:</b>
  <ul>
    <li><a href="#background">Background</a> — agentic retrieval papers and benchmark source</li>
    <li><a href="#overview">0. Overview</a> — purpose, strategy families, metrics, and datasets</li>
    <li><a href="#claude-150">1. Claude Code with 24 queries/150 skills</a></li>
    <li><a href="#rerun-claude-with">1.1 with-CLAUDE.md</a></li>
    <li><a href="#rerun-claude-without">1.2 without-CLAUDE.md</a></li>
    <li><a href="#rerun-codex">2. CodeX with 24 queries/150 skills</a> — includes the latest L-agentic 1K synthetic row</li>
    <li><a href="#easy-78k">3. 78K Easy with 75 core skills</a></li>
    <li><a href="#easy-claude">3.1 Claude Code</a></li>
    <li><a href="#easy-codex">3.2 CodeX</a></li>
    <li><a href="#easy-compare">3.3 Cross-cell &amp; paper baselines</a></li>
    <li><a href="#variants">4. Variant implementations</a> — full SKILL.md for every variant</li>
  </ul>
</div>`;
}

// ---------- Background + §0 overview ----------

function renderBackground() {
  return `<h2 id="background">Background</h2>
<p class="intro">
  Recent retrieval-for-agent papers point in the same direction: stronger agents benefit when the
  retrieval interface becomes more tool-like, inspectable, and iterative instead of a single opaque
  top-k call. These experiments apply that idea to skill routing: give the agent a bounded CLI
  retriever over skill metadata / corpora, then measure whether it can recover the right hidden skill
  with less prompt bloat.
</p>
<table>
  <thead><tr><th>Paper</th><th>Main relevance to this report</th></tr></thead>
  <tbody>
    <tr>
      <td><a href="https://arxiv.org/abs/2605.05242">Beyond Semantic Similarity: Rethinking Retrieval for Agentic Search via Direct Corpus Interaction</a></td>
      <td>Frames retrieval as an interface-design problem: agents can directly interact with corpora through tools such as search, reads, and scripts, which supports multi-step hypothesis refinement beyond fixed semantic top-k retrieval.</td>
    </tr>
    <tr>
      <td><a href="https://arxiv.org/abs/2605.15184">Is Grep All You Need? How Agent Harnesses Reshape Agentic Search</a></td>
      <td>Shows that retrieval quality is coupled to the agent harness and tool-output style; lexical retrieval can be competitive, but the surrounding CLI / tool loop changes outcomes.</td>
    </tr>
    <tr>
      <td><a href="https://arxiv.org/abs/2605.05538">AgenticRAG: Agentic Retrieval for Enterprise Knowledge Bases</a></td>
      <td>Motivates wrapping existing search infrastructure with agent tools such as search, find, open, and summarize so models can navigate evidence iteratively.</td>
    </tr>
    <tr>
      <td><a href="https://arxiv.org/abs/2605.10848">Rethinking Agentic Search with Pi-Serini: Is Lexical Retrieval Sufficient?</a></td>
      <td>Tests BM25-style retrieval inside a deeper agent loop, highlighting retrieval depth, browsing, and document reading as practical controls for agentic search.</td>
    </tr>
    <tr>
      <td><a href="https://arxiv.org/abs/2603.22455">SkillRouter: Skill Routing for LLM Agents at Scale</a></td>
      <td>Provides the benchmark framing and data source used here: large-scale skill routing, where the agent must select relevant skills without loading every skill body into the prompt.</td>
    </tr>
  </tbody>
</table>
<div class="note">
  <b>Connection:</b> the papers above converge on a simple operational claim: agents improve when
  retrieval is exposed as controllable tools. This report tests that claim in the narrower setting
  of disabled-skill routing for Claude Code and CodeX.
</div>`;
}

function renderOverview() {
  return `<h2 id="overview">0. Overview</h2>
<div class="grid-2">
  <div class="panel">
    <h3>Experiment Goal</h3>
    <ul>
      <li>Evaluate whether an agent can recover the correct disabled skill from a user task.</li>
      <li>Compare native model selection against router-assisted strategies.</li>
      <li>Measure both quality and operating cost: accuracy, trigger behavior, turns, context growth, tool calls, and estimated spend.</li>
      <li>Test whether a CLI-style retriever keeps the prompt small while scaling from 150 skills to a synthetic 1K corpus.</li>
    </ul>
  </div>
  <div class="panel">
    <h3>Strategy Implementations</h3>
    <table>
      <thead><tr><th>Category</th><th>Variants</th><th>Implementation idea</th></tr></thead>
      <tbody>
        <tr>
          <td><b>Native baseline</b></td>
          <td><code>G-native</code></td>
          <td>No explicit router. The host model chooses directly from its normal skill context.</td>
        </tr>
        <tr>
          <td><b>Bash-based retrieval</b></td>
          <td><code>B-cc</code>, <code>C-lite</code>, <code>H-bounded</code>, <code>I-meta</code>, <code>J-bounded</code>, <code>J-bounded-v2</code>, <code>K-bounded</code>, <code>K-lite</code></td>
          <td>The agent uses shell primitives such as <code>find</code>, <code>grep</code>, <code>sed</code>, and bounded frontmatter reads over disabled <code>SKILL.md</code> files. Later variants tighten output budgets, metadata-only rules, and tie-break logic.</td>
        </tr>
        <tr>
          <td><b>Tool-wrapped agentic retrieval</b></td>
          <td><code>A-router</code>, <code>D-agentic</code>, <code>D-agentic-metadata</code>, <code>E-digest</code>, <code>L-agentic</code></td>
          <td>Retrieval mechanics are exposed through stable CLI/tool primitives instead of ad hoc shell browsing: one-shot <code>skills route</code>, DCI <code>search/inspect</code>, compact <code>skill-corpus</code> catalog/show, or explicit <code>corpus search</code> / <code>corpus inspect</code> loops.</td>
        </tr>
        <tr>
          <td><b>Large-scale BM25 retrieval</b></td>
          <td><code>M-bm25</code></td>
          <td>Uses BM25-ranked corpus search as the scalable lexical retriever, especially for the 78K Easy setting where full prompt loading is impossible.</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
<div class="grid-2">
  <div class="panel">
    <h3>Metric Meaning</h3>
    <ul>
      <li><b>Accuracy:</b> exact expected-skill match over the query set.</li>
      <li><b>Trigger:</b> whether the router workflow was actually invoked; native rows use n/a.</li>
      <li><b>Turns:</b> number of agent interaction turns needed for the selection.</li>
      <li><b>ctxStart / ctxEnd / growth:</b> context footprint before and after routing.</li>
      <li><b>Cost / duration:</b> estimated model cost and summed per-query runtime.</li>
      <li><b>Tool calls / Bash errors / cache hit:</b> operational signals for CLI reliability and caching behavior.</li>
    </ul>
  </div>
  <div class="panel">
    <h3>Dataset Setup</h3>
    <ul>
      <li><b>24 queries / 150 skills:</b> controlled comparison used for Claude Code and CodeX strategy ranking.</li>
      <li><b>1K synthetic:</b> the same 150-skill corpus plus 850 synthetic noise skills; used only for CodeX L-agentic scalability.</li>
      <li><b>78K Easy / 75 core:</b> larger benchmark slice used to compare K-bounded, J-bounded-v2, and M-bm25 against paper baselines.</li>
      <li><b>Source benchmark:</b> derived from the SkillRouter paper's large-scale skill-routing framing and SkillsBench-style data.</li>
    </ul>
  </div>
</div>`;
}

// ---------- trace rendering ----------

function renderTraceSteps(steps) {
  if (!steps || !steps.length) return `<div class="gray" style="font-size:10.5px">(no tool calls recorded)</div>`;
  return steps.map(s => {
    if (s.text != null) {
      return `<div class="step"><div class="txt">${escapeHtml(truncate(s.text, 250))}</div></div>`;
    }
    const inHtml = escapeHtml(truncate(s.input || "", 220));
    const outHtml = s.result ? escapeHtml(truncate(s.result, 220)) : "";
    return `<div class="step">
      <div><span class="name">${escapeHtml(s.tool || "?")}</span>: <span class="in">${inHtml}</span></div>
      ${outHtml ? `<div class="out">${outHtml}</div>` : ""}
    </div>`;
  }).join("");
}

// Render per-query traces for a single experiment (or set of variants sharing queries)
function renderPerQueryTraces(experimentBlocks, summaryId) {
  // experimentBlocks = [{label, host, variants: {variantId: {queryId: {hit, matched, expected, metrics, steps, topK}}}}, ...]
  // We want one details per query, with cards from all (block, variant) pairs.
  const allQueries = new Set();
  for (const blk of experimentBlocks) {
    for (const vData of Object.values(blk.variants || {})) {
      for (const qid of Object.keys(vData)) allQueries.add(qid);
    }
  }
  const queries = [...allQueries].sort();
  let body = "";
  for (const qid of queries) {
    // Collect expected from first block that has data
    let expected = null;
    let topK = null;
    for (const blk of experimentBlocks) {
      for (const vData of Object.values(blk.variants || {})) {
        if (vData[qid]?.expected != null) { expected = vData[qid].expected; topK = vData[qid].topK; break; }
      }
      if (expected != null) break;
    }
    const gtStr = Array.isArray(expected) ? (expected.length === 1 ? expected[0] : `${expected.length} skills`) : (expected || "—");

    // Count hits across all cells
    let hitCount = 0, totalCount = 0;
    for (const blk of experimentBlocks) {
      for (const vData of Object.values(blk.variants || {})) {
        if (vData[qid]) {
          totalCount++;
          if (vData[qid].hit) hitCount++;
        }
      }
    }
    const hitLbl = hitCount === totalCount && totalCount > 0 ? `✓${totalCount}` : hitCount === 0 ? `✗${totalCount}` : `${hitCount}/${totalCount}`;
    const hitCls = hitCount === totalCount && totalCount > 0 ? "hit" : hitCount === 0 ? "miss" : "mid";

    let cards = "";
    for (const blk of experimentBlocks) {
      for (const [variantId, vData] of Object.entries(blk.variants || {})) {
        const q = vData[qid];
        if (!q) continue;
        const cellKey = `${blk.label} / ${variantId}`;
        const cls = q.hit ? "hit" : "miss";
        const sym = q.hit ? "✓" : "✗";
        const m = q.metrics || {};
        const metaParts = [];
        if (m.turns != null) metaParts.push(`turns ${m.turns}`);
        if (m.durationMs != null) metaParts.push(`${(m.durationMs / 1000).toFixed(1)}s`);
        if (m.ctxEnd != null) metaParts.push(`ctx ${num(m.ctxEnd / 1000, 1)}k`);
        if (m.costUsd != null) metaParts.push(`${dollarsSmall(m.costUsd)}`);
        if (m.outputTokens != null) metaParts.push(`out ${num(m.outputTokens)}`);
        if (m.reasoningTokens) metaParts.push(`rsn ${num(m.reasoningTokens)}`);
        const hostPill = blk.host === "claude" ? "pill-claude" : "pill-codex";
        cards += `<div class="trace-card">
          <div class="head">
            <span class="pill ${hostPill}">${escapeHtml(cellKey)}</span>
            <span class="${cls}">${sym} ${escapeHtml(q.matched || "no-match")}</span>
          </div>
          <div class="meta-row">${metaParts.map(p => `<span>${escapeHtml(p)}</span>`).join("")}</div>
          <div class="tline">${renderTraceSteps(q.steps)}</div>
        </div>`;
      }
    }
    body += `<details>
      <summary><code>${escapeHtml(qid)}</code> — <code>${escapeHtml(gtStr)}</code> <span class="${hitCls}" style="margin-left:6px">${hitLbl}</span></summary>
      <div class="trace-grid">${cards}</div>
    </details>\n`;
  }
  return body;
}

// ---------- §1 Claude paired ----------

function renderClaudePaired(traces) {
  const withBlk = traces["claude-150-with-claudemd"];
  const withoutBlk = traces["claude-150-without-claudemd"];
  if (!withBlk || !withoutBlk) return "";
  const variants = Object.keys(withBlk.variants);

  // Aggregate table
  let aggRows = "";
  for (const v of variants) {
    const w = aggregateMetrics(withBlk.variants[v]);
    const wo = aggregateMetrics(withoutBlk.variants[v]);
    const lift = (w.accuracy - wo.accuracy) * 100;
    const liftCls = lift > 5 ? "hit" : lift < -5 ? "miss" : "gray";
    aggRows += `<tr>
      <td><b>${escapeHtml(v)}</b></td>
      <td class="num">${w.hits}/${w.n} <span class="gray">(${pct(w.accuracy)})</span></td>
      <td class="num">${wo.hits}/${wo.n} <span class="gray">(${pct(wo.accuracy)})</span></td>
      <td class="num ${liftCls}">${lift > 0 ? "+" : ""}${lift.toFixed(1)}pp</td>
      <td class="num">${dollars(w.sumCost)}</td>
      <td class="num">${secs(w.sumDur)}</td>
      <td class="num">${w.sumTurns}</td>
      <td class="num">${num(w.avgCtxEnd / 1000, 1)}k</td>
      <td class="num">${num(w.sumInput / 1000, 1)}k</td>
      <td class="num">${num(w.sumOutput)}</td>
    </tr>`;
  }

  // Per-query matrix (with arm)
  const queries = Object.keys(withBlk.variants[variants[0]]).sort();
  const renderMatrix = (blk) => {
    let head = `<tr><th>Query</th><th>Expected</th>` + variants.map(v => `<th class="num">${escapeHtml(v)}</th>`).join("") + `</tr>`;
    let body = "";
    for (const qid of queries) {
      const exp = blk.variants[variants[0]][qid]?.expected ?? "—";
      let cells = "";
      for (const v of variants) {
        const q = blk.variants[v]?.[qid];
        if (!q) { cells += `<td class="num gray">—</td>`; continue; }
        const cls = q.hit ? "hit" : "miss";
        const sym = q.hit ? "✓" : "✗";
        const m = q.metrics || {};
        const metaParts = [];
        if (m.turns != null) metaParts.push(`t${m.turns}`);
        if (m.durationMs != null) metaParts.push(`${(m.durationMs/1000).toFixed(0)}s`);
        if (m.ctxEnd != null) metaParts.push(`${num(m.ctxEnd / 1000, 0)}k`);
        if (m.costUsd != null) metaParts.push(`${dollarsSmall(m.costUsd)}`);
        cells += `<td class="num ${cls}">${sym} ${escapeHtml(q.matched || "no-match")}<span class="meta">${metaParts.join(" · ")}</span></td>`;
      }
      body += `<tr class="matrix-row"><td><code>${escapeHtml(qid)}</code></td><td><code>${escapeHtml(exp)}</code></td>${cells}</tr>`;
    }
    return `<table style="font-size:11px"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  };

  return `<h2 id="small-claude">1. 150-skill × Claude Code <span class="pill pill-claude">claude</span></h2>
<p class="intro">
  Paired experiment: each (variant, condition) gets an isolated HOME and runs all 24 SkillsBench
  single-skill queries. <b>with-CLAUDE.md</b> injects a 5-line user-message context block telling
  the agent to call <code>skill-router-skills</code> when no enabled skill matches.
</p>
<div class="takeaway">
  <b>Headline:</b> CLAUDE.md injection lifts accuracy +18pp on average. B-cc / C-lite reach 23/24.
  J-bounded is the lowest-cost router in the 22/24 group ($3.07, 30.7K avg ctx).
  A-router is the only router below G-native.
</div>
<table>
  <thead>
    <tr>
      <th>Variant</th>
      <th class="num">Acc (with)</th>
      <th class="num">Acc (without)</th>
      <th class="num">Δ acc</th>
      <th class="num">Cost (with)</th>
      <th class="num">Wall (with)</th>
      <th class="num">Total turns (with)</th>
      <th class="num">Avg ctx<sub>end</sub></th>
      <th class="num">In tokens</th>
      <th class="num">Out tokens</th>
    </tr>
  </thead>
  <tbody>${aggRows}</tbody>
</table>
<div class="footnote">Acc denominators are 24. Cost/wall/turns/tokens summed across 24 queries (with-arm). Avg ctx<sub>end</sub> = mean of per-query final context (input + cache_read + cache_create).</div>

<details open>
  <summary>1.1 Per-query matrix — with CLAUDE.md (24 queries × 9 variants, each cell shows matched + turns/duration/ctx/cost)</summary>
  ${renderMatrix(withBlk)}
</details>

<details>
  <summary>1.2 Per-query matrix — without CLAUDE.md</summary>
  ${renderMatrix(withoutBlk)}
</details>

<details>
  <summary>1.3 Per-query execution traces — with CLAUDE.md (all 216 traces inlined)</summary>
  ${renderPerQueryTraces([{ label: "claude/with-CLAUDE.md", host: "claude", variants: withBlk.variants }])}
</details>

<details>
  <summary>1.4 Per-query execution traces — without CLAUDE.md (all 216 traces inlined)</summary>
  ${renderPerQueryTraces([{ label: "claude/without-CLAUDE.md", host: "claude", variants: withoutBlk.variants }])}
</details>
`;
}

// ---------- §2 Codex 150 (merged 9 + 7 follow-on) ----------

const CODEX_150_KEYS_IN_ORDER = [
  // initial 9 first, then follow-ons
  { exp: "codex-150-initial", variants: ["G-native","A-router","B-cc","C-lite","D-agentic","E-digest","H-bounded","I-meta","J-bounded"] },
  { exp: "codex-150-d-metadata", variants: ["D-agentic"], displayName: "D-agentic (metadata-only)" },
  { exp: "codex-150-k-bounded", variants: ["K-bounded"] },
  { exp: "codex-150-k-lite-high", variants: ["K-lite"], displayName: "K-lite (high)" },
  { exp: "codex-150-k-lite-fix", variants: ["K-lite"], displayName: "K-lite (fixed)" },
  { exp: "codex-150-l-agentic", variants: ["L-agentic"] },
  { exp: "codex-150-m-bm25", variants: ["M-bm25"] },
];

function renderCodex150(traces) {
  // Aggregate table (merged)
  let aggRows = "";
  const cellsForMatrix = []; // [{displayName, queries: {qid: {matched, hit, metrics}}}]
  for (const entry of CODEX_150_KEYS_IN_ORDER) {
    const blk = traces[entry.exp];
    if (!blk) continue;
    for (const v of entry.variants) {
      const vdata = blk.variants[v];
      if (!vdata) continue;
      const agg = aggregateMetrics(vdata);
      const dn = entry.displayName || v;
      const badge = entry.exp !== "codex-150-initial" ? ` <span class="badge">follow-on</span>` : "";
      aggRows += `<tr>
        <td><b>${escapeHtml(dn)}</b>${badge}</td>
        <td class="num ${accCls(agg.accuracy)}">${agg.hits}/${agg.n} <span class="gray">(${pct(agg.accuracy)})</span></td>
        <td class="num">${dollars(agg.sumCost)}</td>
        <td class="num">${secs(agg.sumDur)}</td>
        <td class="num">${agg.sumTurns}</td>
        <td class="num">${num(agg.avgCtxEnd / 1000, 1)}k</td>
        <td class="num">${num(agg.sumInput / 1000, 1)}k</td>
        <td class="num">${num(agg.sumOutput)}</td>
        <td class="num">${num(agg.sumReasoning)}</td>
      </tr>`;
      cellsForMatrix.push({ displayName: dn, queries: vdata });
    }
  }

  // Per-query matrix (merged)
  const queries = [...new Set(cellsForMatrix.flatMap(c => Object.keys(c.queries)))].sort();
  let matrixHead = `<tr><th>Query</th><th>Expected</th>` + cellsForMatrix.map(c => `<th class="num">${escapeHtml(c.displayName)}</th>`).join("") + `</tr>`;
  let matrixBody = "";
  for (const qid of queries) {
    let exp = "—";
    for (const c of cellsForMatrix) { if (c.queries[qid]?.expected) { exp = c.queries[qid].expected; break; } }
    let cells = "";
    for (const c of cellsForMatrix) {
      const q = c.queries[qid];
      if (!q) { cells += `<td class="num gray">—</td>`; continue; }
      const cls = q.hit ? "hit" : "miss";
      const sym = q.hit ? "✓" : "✗";
      const m = q.metrics || {};
      const metaParts = [];
      if (m.durationMs != null) metaParts.push(`${(m.durationMs/1000).toFixed(0)}s`);
      if (m.ctxEnd != null) metaParts.push(`${num(m.ctxEnd / 1000, 0)}k`);
      if (m.costUsd != null) metaParts.push(`${dollarsSmall(m.costUsd)}`);
      if (m.reasoningTokens != null && m.reasoningTokens > 0) metaParts.push(`rsn ${num(m.reasoningTokens)}`);
      cells += `<td class="num ${cls}">${sym} ${escapeHtml(q.matched || "no-match")}<span class="meta">${metaParts.join(" · ")}</span></td>`;
    }
    matrixBody += `<tr class="matrix-row"><td><code>${escapeHtml(qid)}</code></td><td><code>${escapeHtml(exp)}</code></td>${cells}</tr>`;
  }

  // Per-query traces — combine all blocks
  const traceBlocks = [];
  for (const entry of CODEX_150_KEYS_IN_ORDER) {
    const blk = traces[entry.exp];
    if (!blk) continue;
    const renamedVariants = {};
    for (const v of entry.variants) {
      if (!blk.variants[v]) continue;
      const dn = entry.displayName || v;
      renamedVariants[dn] = blk.variants[v];
    }
    traceBlocks.push({ label: "codex", host: "codex", variants: renamedVariants });
  }

  return `<h2 id="small-codex">2. 150-skill × Codex <span class="pill pill-codex">codex</span></h2>
<p class="intro">
  Same 24-query / 150-skill corpus as §1, run on <code>codex exec</code> (model gpt-5.5,
  reasoning effort high). Codex native G-native scores 24/24 vs Claude native 15/24 — largest
  host-driven gap in the report. Initial 9 variants (A-J) and 7 follow-on iterations
  (D-agentic metadata-only / K-bounded / K-lite high+fixed / L-agentic / M-bm25) merged into a
  single ranked table below.
</p>
<div class="takeaway">
  <b>Headline:</b> Codex G-native + D-agentic both 24/24. C-lite / E-digest / H-bounded reach 23/24.
  All follow-on iterations (K, K-lite fixed, L, M) also reach 24/24 — the 150 corpus cannot rank
  them further. L-agentic scales to 1K with only 1 miss.
</div>
<table>
  <thead>
    <tr>
      <th>Variant</th>
      <th class="num">Accuracy</th>
      <th class="num">Cost est.</th>
      <th class="num">Wall</th>
      <th class="num">Total turns</th>
      <th class="num">Avg ctx<sub>end</sub></th>
      <th class="num">In tokens</th>
      <th class="num">Out tokens</th>
      <th class="num">Reasoning tokens</th>
    </tr>
  </thead>
  <tbody>${aggRows}</tbody>
</table>
<div class="footnote">Cost est. uses gpt-5.5 standard list price (fresh $5, cached $0.5, output $30 per 1M). Wall = sum across 24 queries derived from per-query duration in transcripts (may be lower than wall-clock total when runs were parallel).</div>

<details open>
  <summary>2.1 Per-query matrix (${cellsForMatrix.length} variants × 24 queries, each cell shows matched + duration/ctx/cost/reasoning)</summary>
  <table style="font-size:11px">
    <thead>${matrixHead}</thead>
    <tbody>${matrixBody}</tbody>
  </table>
</details>

<details>
  <summary>2.2 Per-query execution traces — all ${cellsForMatrix.length * 24} traces inlined</summary>
  ${renderPerQueryTraces(traceBlocks)}
</details>
`;
}

// ---------- §4 Claude 79K Hard (cells.json only, no JSONL) ----------

function renderHardClaude(scaling) {
  if (!scaling || !scaling.length) return "";
  let rows = "";
  for (const c of scaling) {
    const agg = c.agg || {};
    rows += `<tr>
      <td><b>${escapeHtml(c.label)}</b></td>
      <td class="num ${accCls(agg.accuracy)}">${Math.round((agg.accuracy || 0) * agg.n)}/${agg.n} <span class="gray">(${pct(agg.accuracy)})</span></td>
      <td class="num">${pct(agg.triggerRate)}</td>
      <td class="num">${dollars(agg.sumCost)}</td>
      <td class="num">${secs(agg.sumDuration)}</td>
      <td class="num">${agg.sumTurns}</td>
      <td class="num">${num(agg.avgEndCtx / 1000, 1)}k</td>
      <td class="num">${agg.timeouts}</td>
    </tr>`;
  }

  // Per-query for each cell
  let detailsHtml = "";
  for (const c of scaling) {
    const qids = Object.keys(c.cells || {}).sort();
    if (!qids.length) continue;
    let body = "";
    for (const q of qids) {
      const cell = c.cells[q];
      const cls = cell.correct ? "hit" : "miss";
      const sym = cell.correct ? "✓" : "✗";
      body += `<tr class="matrix-row">
        <td><code>${escapeHtml(q)}</code></td>
        <td class="num ${cls}">${sym} ${escapeHtml(cell.matched || "no-match")}</td>
        <td class="num">${cell.numTurns ?? "—"}</td>
        <td class="num">${secs(cell.durationMs)}</td>
        <td class="num">${dollarsSmall(cell.cost)}</td>
        <td class="num">${num((cell.endCtx || 0) / 1000, 1)}k</td>
        <td class="num">${cell.bashCalls ?? "—"}</td>
      </tr>`;
    }
    detailsHtml += `<details>
      <summary>${escapeHtml(c.label)} — per-query metrics (${qids.length})</summary>
      <table style="font-size:11.5px">
        <thead><tr><th>Query</th><th class="num">Matched</th><th class="num">Turns</th><th class="num">Duration</th><th class="num">Cost</th><th class="num">End ctx</th><th class="num">Bash calls</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </details>`;
  }

  return `<h2 id="hard-claude">3. 79K Hard × Claude Code <span class="pill pill-claude">claude</span></h2>
<p class="intro">
  J-bounded-v2 scaling from 150 to 79,141 Hard pool. v2 fixes v1's shell glob ARG_MAX overflow
  and removes head-20 truncation. Bounded payload, cost only +35%, accuracy drops from 22/24 to 12/24.
</p>
<div class="takeaway">
  <b>Headline:</b> Mechanically stable at 79K (bounded ctx, no timeouts) but accuracy collapses
  91.7% → 50.0%. Metadata-only cannot serve as the sole decision source at this scale.
</div>
<div class="note">
  <b>No tool-call traces for §4.</b> The J-bounded scaling runner only persisted per-query
  aggregate metrics in <code>cells.json</code>, not raw JSONL transcripts. <code>bashCalls</code>
  is the closest proxy for tool-call depth.
</div>
<table>
  <thead><tr><th>Cell</th><th class="num">Accuracy</th><th class="num">Trigger</th><th class="num">Cost</th><th class="num">Wall</th><th class="num">Total turns</th><th class="num">Avg ctx<sub>end</sub></th><th class="num">Timeouts</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${detailsHtml}
`;
}

// ---------- §5 Codex 79K Hard ----------

function renderHardCodex(traces) {
  const entries = [
    { exp: "codex-hard-m-bm25-current24", variant: "M-bm25", queryset: "current 24 subset" },
    { exp: "codex-hard-m-bm25-paper", variant: "M-bm25", queryset: "paper-core single" },
    { exp: "codex-hard-jv2-paper", variant: "J-bounded-v2", queryset: "paper-core single" },
  ];
  let rows = "";
  const traceBlocks = [];
  for (const e of entries) {
    const blk = traces[e.exp];
    if (!blk) continue;
    const vdata = blk.variants[e.variant];
    if (!vdata) continue;
    const agg = aggregateMetrics(vdata);
    const note = e.variant === "J-bounded-v2" ? ` <span class="gray">(strict; alias-norm 14/24)</span>` : "";
    rows += `<tr>
      <td><b>${escapeHtml(e.variant)}</b> <span class="badge">${escapeHtml(e.queryset)}</span></td>
      <td class="num ${accCls(agg.accuracy * 1.5)}">${agg.hits}/${agg.n} <span class="gray">(${pct(agg.accuracy)})</span>${note}</td>
      <td class="num">${dollars(agg.sumCost)}</td>
      <td class="num">${secs(agg.sumDur)}</td>
      <td class="num">${agg.sumTurns}</td>
      <td class="num">${num(agg.avgCtxEnd / 1000, 1)}k</td>
      <td class="num">${num(agg.sumInput / 1000, 1)}k</td>
      <td class="num">${num(agg.sumOutput)}</td>
      <td class="num">${num(agg.sumReasoning)}</td>
    </tr>`;
    traceBlocks.push({ label: `codex/${e.queryset}`, host: "codex", variants: { [e.variant]: vdata } });
  }
  return `<h2 id="hard-codex">4. 79K Hard × Codex <span class="pill pill-codex">codex</span></h2>
<p class="intro">
  Codex M-bm25 and J-bounded-v2 against the full 79,141-skill Hard pool on two query sets.
  J-v2 has 3 outputs in raw <code>name:</code> form rather than opaque <code>sr-*</code> ids;
  strict counts as misses (11/24), alias-normalized → 14/24.
</p>
<div class="takeaway">
  <b>Headline:</b> M-bm25 reaches 58.3% on paper-core single Hard, beating BM25-nd (0%) and
  Qwen3-Emb-8B-nd (20.0%), but below full-body SR pipeline (~73%). Hard runs cost $6-12 and
  16-50 min — much more expensive than 150-skill runs.
</div>
<table>
  <thead><tr><th>Variant / Query set</th><th class="num">Accuracy</th><th class="num">Cost est.</th><th class="num">Wall</th><th class="num">Total turns</th><th class="num">Avg ctx<sub>end</sub></th><th class="num">In tokens</th><th class="num">Out tokens</th><th class="num">Reasoning</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<details>
  <summary>5.1 Per-query execution traces — 72 traces inlined</summary>
  ${renderPerQueryTraces(traceBlocks)}
</details>
`;
}

// ---------- §6 Easy 78K per host ----------

function renderEasyHost(host, summaries, sectionNum) {
  const matching = Object.entries(summaries).filter(([k]) => k.startsWith(host + "-"));
  let tbody = "";
  for (const [name, s] of matching) {
    const variant = name.split("-").slice(1).join("-");
    const acc = s.hit1_rate;
    const cls = accCls(acc * 2);
    tbody += `<tr>
      <td><b>${escapeHtml(variant)}</b></td>
      <td class="num ${cls}"><b>${pct(acc)}</b> <span class="gray">(${s.hit1}/${s.queries})</span></td>
      <td class="num">${s.hit1_single}/${s.n_single} <span class="gray">(${pct(s.hit1_single / Math.max(s.n_single, 1))})</span></td>
      <td class="num">${s.hit1_multi}/${s.n_multi} <span class="gray">(${pct(s.hit1_multi / Math.max(s.n_multi, 1))})</span></td>
      <td class="num">${s.answered}/${s.queries}</td>
      <td class="num">${s.timeouts}</td>
      <td class="num">${s.errors}</td>
      <td class="num">${secs(s.elapsedMs)}</td>
    </tr>`;
  }
  const idSuffix = host === "claude" ? "easy-claude" : "easy-codex";
  const pillClass = host === "claude" ? "pill-claude" : "pill-codex";
  const hostLabel = host === "claude" ? "Claude Code" : "CodeX";
  return `<h3 id="${idSuffix}">${sectionNum} ${hostLabel} <span class="pill ${pillClass}">${host}</span></h3>
<table>
  <thead>
    <tr>
      <th>Variant</th>
      <th class="num">Hit@1</th>
      <th class="num">Single (n=24)</th>
      <th class="num">Multi (n=51)</th>
      <th class="num">Answered</th>
      <th class="num">Timeouts</th>
      <th class="num">Errors</th>
      <th class="num">Wall</th>
    </tr>
  </thead>
  <tbody>${tbody}</tbody>
</table>
`;
}

// ---------- §7 Easy cross-cell + paper + traces ----------

function renderEasyCompare(summaries, traces) {
  // Build cell list
  const cellRows = Object.entries(summaries).map(([name, s]) => {
    const [host, ...rest] = name.split("-");
    return { name, host, variant: rest.join("-"), rate: s.hit1_rate, hit: s.hit1, n: s.queries, summary: s };
  });
  cellRows.sort((a, b) => b.rate - a.rate);
  const maxRate = Math.max(...cellRows.map(c => c.rate), ...Object.values(PAPER_EASY));

  let ourRows = "";
  for (const c of cellRows) {
    const w = ((c.rate / maxRate) * 100).toFixed(1);
    const cls = c.host === "claude" ? "" : "codex";
    ourRows += `<tr>
      <td><span class="pill pill-${c.host}">${escapeHtml(c.host + "/" + c.variant)}</span></td>
      <td class="num"><b>${pct(c.rate)}</b> <span class="gray">(${c.hit}/${c.n})</span></td>
      <td><div class="bar-wrap"><div class="bar-fill ${cls}" style="width:${w}%"></div></div></td>
    </tr>`;
  }
  let paperRows = "";
  for (const [name, rate] of Object.entries(PAPER_EASY)) {
    const w = ((rate / maxRate) * 100).toFixed(1);
    paperRows += `<tr>
      <td><span class="pill pill-paper">paper</span> ${escapeHtml(name)}</td>
      <td class="num">${pct(rate)}</td>
      <td><div class="bar-wrap"><div class="bar-fill paper" style="width:${w}%"></div></div></td>
    </tr>`;
  }

  const byVariant = new Map(), byHost = new Map();
  for (const c of cellRows) {
    if (!byVariant.has(c.variant)) byVariant.set(c.variant, []);
    byVariant.get(c.variant).push(c.rate);
    if (!byHost.has(c.host)) byHost.set(c.host, []);
    byHost.get(c.host).push(c.rate);
  }
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  let vRows = [...byVariant.entries()].sort((a, b) => avg(b[1]) - avg(a[1]))
    .map(([v, rs]) => `<tr><td><b>${escapeHtml(v)}</b></td><td class="num">${pct(avg(rs))} <span class="gray">(${rs.length} cells)</span></td></tr>`).join("");
  let hRows = [...byHost.entries()].sort((a, b) => avg(b[1]) - avg(a[1]))
    .map(([h, rs]) => `<tr><td><span class="pill pill-${h}">${h}</span></td><td class="num">${pct(avg(rs))} <span class="gray">(${rs.length} cells)</span></td></tr>`).join("");

  // Per-query matrix
  const cellKeys = cellRows.map(c => `${c.host}/${c.variant}`);
  const allQids = new Set();
  const byQ = new Map();
  for (const c of cellRows) {
    const k = `${c.host}/${c.variant}`;
    for (const res of c.summary.results || []) {
      allQids.add(res.query_id);
      if (!byQ.has(res.query_id)) byQ.set(res.query_id, { tier: res.tier, gt: res.expected_anon, cells: {} });
      byQ.get(res.query_id).cells[k] = res;
    }
  }
  const qids = [...allQids].sort();
  let matrixHead = `<tr><th>Query</th><th>Tier</th><th>GT</th>` + cellKeys.map(k => {
    const [host] = k.split("/");
    return `<th class="num"><span class="pill pill-${host}">${escapeHtml(k)}</span></th>`;
  }).join("") + `</tr>`;
  let matrixBody = "";
  for (const qid of qids) {
    const e = byQ.get(qid);
    const hitCount = cellKeys.filter(k => e.cells[k]?.hit1).length;
    const hitLbl = hitCount === 6 ? "✓6" : hitCount === 0 ? "✗0" : `${hitCount}/6`;
    const hitCls = hitCount === 6 ? "hit" : hitCount === 0 ? "miss" : "mid";
    let cells = "";
    for (const k of cellKeys) {
      const r = e.cells[k];
      if (!r) { cells += `<td class="num gray">—</td>`; continue; }
      const cls = r.hit1 ? "hit" : "miss";
      const sym = r.hit1 ? "✓" : "✗";
      // Pull per-query metrics from trace data
      const cellName = k.replace("/", "-");
      const traceBlk = traces[`easy78k-${cellName}`];
      const variant = k.split("/").slice(1).join("/");
      const traceQ = traceBlk?.variants?.[variant]?.[qid];
      const m = traceQ?.metrics || {};
      const metaParts = [];
      if (m.turns != null) metaParts.push(`t${m.turns}`);
      if (m.durationMs != null) metaParts.push(`${(m.durationMs/1000).toFixed(0)}s`);
      if (m.ctxEnd != null) metaParts.push(`${num(m.ctxEnd / 1000, 0)}k`);
      cells += `<td class="num ${cls}">${sym} ${escapeHtml(r.top1 || "?")}<span class="meta">${metaParts.join(" · ")}</span></td>`;
    }
    const gtStr = e.gt.length === 1 ? e.gt[0] : `${e.gt.length} skills`;
    matrixBody += `<tr class="matrix-row"><td><code>${escapeHtml(qid)}</code> <span class="${hitCls}" style="font-weight:600">${hitLbl}</span></td><td>${e.tier}</td><td class="gt"><code>${escapeHtml(gtStr)}</code></td>${cells}</tr>`;
  }

  // Per-query traces for §9 — build trace blocks per cell
  const traceBlocks = [];
  for (const k of cellKeys) {
    const cellName = k.replace("/", "-");
    const traceBlk = traces[`easy78k-${cellName}`];
    if (!traceBlk) continue;
    const [host] = k.split("/");
    traceBlocks.push({ label: k, host, variants: traceBlk.variants });
  }

  return `<h3 id="easy-compare">3.3 Cross-cell &amp; paper baselines</h3>
<div class="takeaway">
  <b>Headline:</b> Best cell <b>codex/J-bounded-v2 at 40.0%</b> exceeds the strongest paper nd
  baseline (Qwen3-Emb-8B 30.7%) by +9.3pp, and beats BM25 with full body (34.7%). 6/6 cells beat
  BM25 nd, 4/6 beat Qwen3-Emb-0.6B nd, 3/6 beat Qwen3-Emb-8B nd.
</div>
<div class="grid-2">
  <div class="panel">
    <h3>By variant (avg across hosts)</h3>
    <table><thead><tr><th>Variant</th><th class="num">Avg Hit@1</th></tr></thead><tbody>${vRows}</tbody></table>
  </div>
  <div class="panel">
    <h3>By host (avg across variants)</h3>
    <table><thead><tr><th>Host</th><th class="num">Avg Hit@1</th></tr></thead><tbody>${hRows}</tbody></table>
  </div>
</div>
<h3>All 6 cells + paper baselines, ranked by Hit@1</h3>
<table>
  <thead><tr><th>Source</th><th class="num">Hit@1</th><th>Bar (relative to max)</th></tr></thead>
  <tbody>${ourRows}${paperRows}</tbody>
</table>

<details open>
  <summary>3.3.1 Per-query matrix (75 queries × 6 cells, each cell shows top1 + turns/duration/ctx)</summary>
  <p class="footnote">Leading badge: <span class="hit">✓6</span> = all 6 cells hit, <span class="miss">✗0</span> = all miss, <span class="mid">N/6</span> = partial.</p>
  <table style="font-size:11px">
    <thead>${matrixHead}</thead>
    <tbody>${matrixBody}</tbody>
  </table>
</details>

<details>
  <summary>3.3.2 Per-query execution traces — 450 traces inlined</summary>
  ${renderPerQueryTraces(traceBlocks)}
</details>
`;
}

function renderEasySection(summaries, traces) {
  return `<h2 id="easy-78k">3. 78K Easy with 75 core skills</h2>
<p class="intro">
  This section groups the larger Easy split into one comparison block. It evaluates three router
  variants (K-bounded, J-bounded-v2, M-bm25) on both hosts over 75 core Easy queries drawn from
  the 78K-skill pool, then compares the six cells against published paper baselines.
</p>
${renderEasyHost("claude", summaries, "3.1")}
${renderEasyHost("codex", summaries, "3.2")}
${renderEasyCompare(summaries, traces)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// FRESH RERUN sections (replace §1 + §2 historical data)
// 16 variants × 24 queries × 2 conditions for Claude + 16 × 24 for Codex.
// All metrics come from the new rerun via aggregate-rerun.mjs.
// ─────────────────────────────────────────────────────────────────────────

const VARIANT_ORDER = [
  "G-native", "A-router", "B-cc", "C-lite", "D-agentic", "D-agentic-metadata",
  "E-digest", "H-bounded", "I-meta", "J-bounded", "J-bounded-v2",
  "K-bounded", "K-lite", "K-lite-replicate", "L-agentic", "M-bm25",
];

function fmtPct(x) { return x == null ? "—" : (x * 100).toFixed(1) + "%"; }
function fmtCost(x) { return x == null ? "—" : "$" + x.toFixed(2); }
function fmtCostS(x) { return x == null ? "—" : "$" + x.toFixed(3); }
function fmtSec(ms) { return ms == null ? "—" : (ms / 1000).toFixed(0) + "s"; }
function fmtK(x) { return x == null ? "—" : (x / 1000).toFixed(1) + "k"; }
function fmtNum(x, dp = 0) { return x == null ? "—" : x.toFixed(dp); }

function renderRerunAggregateRow(label, a, options = {}) {
  if (!a) return "";
  const accCl = a.accuracy >= 0.9 ? "hit" : a.accuracy >= 0.7 ? "mid" : "miss";
  const trigStr = options.triggerText ?? `${a.triggers}/${a.n}`;
  const badge = options.badge ? ` <span class="badge">${escapeHtml(options.badge)}</span>` : "";
  return `<tr>
      <td><b>${escapeHtml(label)}</b>${badge}</td>
      <td class="num ${accCl}">${a.hits}/${a.n} <span class="gray">(${fmtPct(a.accuracy)})</span></td>
      <td class="num">${trigStr}</td>
      <td class="num">${a.totalTurns}</td>
      <td class="num">${fmtNum(a.avgTurns, 1)}</td>
      <td class="num">${fmtK(a.avgCtxStart)}</td>
      <td class="num">${fmtK(a.avgCtxEnd)}</td>
      <td class="num">${fmtK(a.avgCtxGrowth)}</td>
      <td class="num">${fmtCost(a.sumCost)}</td>
      <td class="num">${fmtSec(a.sumDuration)}</td>
      <td class="num">${a.totalToolCalls}</td>
      <td class="num">${a.totalBashErrors}</td>
      <td class="num">${fmtPct(a.avgCacheHitRatio)}</td>
      <td class="num">${fmtNum(a.avgOutputTextLen)}</td>
    </tr>`;
}

function renderRerunAggregateTable(aggregates, host, condition, options = {}) {
  // One row per variant for (host, condition). Shows 8 core + extras.
  let rows = "";
  for (const v of VARIANT_ORDER) {
    const key = `${host}-${v}-${condition}`;
    const a = aggregates[key];
    if (!a) continue;
    const trigStr = v === "G-native" ? "n/a" : `${a.triggers}/${a.n}`;
    rows += renderRerunAggregateRow(v, a, { triggerText: trigStr });
    if (options.afterVariantRows?.[v]) rows += options.afterVariantRows[v];
  }
  return `<table>
    <thead><tr>
      <th>Variant</th>
      <th class="num">Accuracy</th>
      <th class="num">Trigger</th>
      <th class="num">Total turns</th>
      <th class="num">Avg turns</th>
      <th class="num">Avg ctxStart</th>
      <th class="num">Avg ctxEnd</th>
      <th class="num">Avg ctxGrowth</th>
      <th class="num">Sum cost</th>
      <th class="num">Sum dur</th>
      <th class="num">Tool calls</th>
      <th class="num">Bash errors</th>
      <th class="num">Cache hit</th>
      <th class="num">Avg out chars</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderFailureBreakdown(aggregates, host, condition) {
  // Failure type buckets per variant
  let rows = "";
  for (const v of VARIANT_ORDER) {
    const key = `${host}-${v}-${condition}`;
    const a = aggregates[key];
    if (!a || !a.failures) continue;
    const f = a.failures;
    rows += `<tr>
      <td><b>${escapeHtml(v)}</b></td>
      <td class="num hit">${f.hit || 0}</td>
      <td class="num">${f.distractor || 0}</td>
      <td class="num">${f.hallucinated || 0}</td>
      <td class="num">${f.no_match || 0}</td>
      <td class="num">${f.format_error || 0}</td>
    </tr>`;
  }
  return `<table>
    <thead><tr>
      <th>Variant</th>
      <th class="num">Hit</th>
      <th class="num">Distractor</th>
      <th class="num">Hallucinated</th>
      <th class="num">No match</th>
      <th class="num">Format error</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderToolHistTable(cells, host, condition) {
  // Per-variant toolHist (Bash / Skill / Read / Grep / …) summed across queries
  const byVariant = new Map();
  const allTools = new Set();
  for (const c of cells) {
    if (c.host !== host || c.condition !== condition) continue;
    const v = c.variant;
    if (!byVariant.has(v)) byVariant.set(v, {});
    const agg = byVariant.get(v);
    for (const [t, n] of Object.entries(c.metrics?.toolHist || {})) {
      agg[t] = (agg[t] || 0) + n;
      allTools.add(t);
    }
  }
  const tools = [...allTools].sort();
  let head = `<tr><th>Variant</th>` + tools.map(t => `<th class="num">${escapeHtml(t)}</th>`).join("") + `<th class="num">Total</th></tr>`;
  let body = "";
  for (const v of VARIANT_ORDER) {
    if (!byVariant.has(v)) continue;
    const agg = byVariant.get(v);
    let total = 0;
    let cellsHtml = "";
    for (const t of tools) {
      const n = agg[t] || 0;
      total += n;
      cellsHtml += `<td class="num">${n || ""}</td>`;
    }
    body += `<tr><td><b>${escapeHtml(v)}</b></td>${cellsHtml}<td class="num"><b>${total}</b></td></tr>`;
  }
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderRerunPerQueryMatrix(cells, host, condition) {
  // Variants in cols, queries in rows. Each cell = matched + (turns/dur/ctx) snippet.
  const filtered = cells.filter(c => c.host === host && c.condition === condition);
  const queries = [...new Set(filtered.map(c => c.queryId))].sort();
  const variants = VARIANT_ORDER.filter(v => filtered.some(c => c.variant === v));
  const byKey = new Map();
  for (const c of filtered) byKey.set(`${c.variant}::${c.queryId}`, c);
  let head = `<tr><th>Query</th><th>Expected</th>` + variants.map(v => `<th class="num">${escapeHtml(v)}</th>`).join("") + `</tr>`;
  let body = "";
  for (const qid of queries) {
    const expected = filtered.find(c => c.queryId === qid)?.expected || "—";
    let cellsHtml = "";
    for (const v of variants) {
      const c = byKey.get(`${v}::${qid}`);
      if (!c) { cellsHtml += `<td class="num gray">—</td>`; continue; }
      const cls = c.hit ? "hit" : "miss";
      const sym = c.hit ? "✓" : "✗";
      const m = c.metrics || {};
      const meta = [
        m.numTurns != null ? `t${m.numTurns}` : null,
        m.durationMs != null ? `${(m.durationMs / 1000).toFixed(0)}s` : null,
        m.ctxEnd != null ? fmtK(m.ctxEnd) : null,
        m.costUsd != null ? fmtCostS(m.costUsd) : null,
      ].filter(Boolean).join(" · ");
      cellsHtml += `<td class="num ${cls}">${sym} ${escapeHtml(c.matched || "no-match")}<span class="meta">${meta}</span></td>`;
    }
    body += `<tr class="matrix-row"><td><code>${escapeHtml(qid)}</code></td><td><code>${escapeHtml(expected)}</code></td>${cellsHtml}</tr>`;
  }
  return `<table style="font-size:11px"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderRerunTraces(cells, host, condition) {
  // Per-query collapsible cards. Each card = 1 variant's trace for that (host, cond, query).
  const filtered = cells.filter(c => c.host === host && c.condition === condition);
  const queries = [...new Set(filtered.map(c => c.queryId))].sort();
  const variants = VARIANT_ORDER.filter(v => filtered.some(c => c.variant === v));
  let body = "";
  const renderSteps = (steps) => {
    if (!steps || !steps.length) return `<div class="gray" style="font-size:10.5px">(no tool calls)</div>`;
    return steps.map(s => {
      if (s.tool) {
        return `<div class="step"><div><span class="name">${escapeHtml(s.tool)}</span>: <span class="in">${escapeHtml(truncate(s.input || "", 250))}</span></div></div>`;
      } else if (s.text) {
        return `<div class="step"><div class="txt">${escapeHtml(truncate(s.text, 240))}</div></div>`;
      }
      return "";
    }).join("");
  };
  for (const qid of queries) {
    const items = variants.map(v => filtered.find(c => c.variant === v && c.queryId === qid)).filter(Boolean);
    const expected = items[0]?.expected || "—";
    const hitCount = items.filter(c => c.hit).length;
    const hitLbl = hitCount === items.length ? `✓${items.length}` : hitCount === 0 ? `✗${items.length}` : `${hitCount}/${items.length}`;
    const hitCls = hitCount === items.length ? "hit" : hitCount === 0 ? "miss" : "mid";
    let cards = "";
    for (const c of items) {
      const m = c.metrics || {};
      const cls = c.hit ? "hit" : "miss";
      const sym = c.hit ? "✓" : "✗";
      const meta = [
        m.numTurns != null ? `turns ${m.numTurns}` : null,
        m.durationMs != null ? `${(m.durationMs / 1000).toFixed(1)}s` : null,
        m.ctxStart != null && m.ctxEnd != null ? `ctx ${fmtK(m.ctxStart)}→${fmtK(m.ctxEnd)} (+${fmtK(m.ctxGrowth)})` : null,
        m.costUsd != null ? fmtCostS(m.costUsd) : null,
        m.toolCallCount != null ? `${m.toolCallCount} tools` : null,
        m.cacheHitRatio != null ? `cache ${(m.cacheHitRatio * 100).toFixed(0)}%` : null,
      ].filter(Boolean).join(" · ");
      const pillCls = c.host === "claude" ? "pill-claude" : "pill-codex";
      cards += `<div class="trace-card">
        <div class="head">
          <span class="pill ${pillCls}">${escapeHtml(c.variant)}</span>
          <span class="${cls}">${sym} ${escapeHtml(c.matched || "no-match")}</span>
        </div>
        <div class="meta-row">${escapeHtml(meta)}</div>
        <div class="tline">${renderSteps(c.metrics?.steps || [])}</div>
      </div>`;
    }
    body += `<details>
      <summary><code>${escapeHtml(qid)}</code> — <code>${escapeHtml(expected)}</code> <span class="${hitCls}" style="margin-left:6px">${hitLbl}</span></summary>
      <div class="trace-grid">${cards}</div>
    </details>\n`;
  }
  return body;
}

function renderRerun(rerun, rerun1k, claudeRerun1k) {
  if (!rerun) return `<h2 id="rerun">1. Fresh 16-variant rerun (150-skill)</h2>
<div class="note">Run still in progress or no data yet. Output: <code>experiments/dci-compare/runs/rerun-150-full-2026-05-26/</code></div>`;

  const { cells, aggregates } = rerun;
  const claudeSource = rerun.sources?.claude || "rerun-150-full-2026-05-26";
  const codexSource = rerun.sources?.codex || "rerun-150-full-2026-05-26";
  const oneKSource = rerun1k?.name || "rerun-codex-newcli-l-agentic-1k-2026-05-26";
  const oneKAggregate = rerun1k?.aggregates?.["codex-L-agentic-with-claudemd"] || null;
  const oneKRow = renderRerunAggregateRow("L-agentic on 1K synthetic", oneKAggregate, {
    badge: "1K synthetic",
    triggerText: oneKAggregate ? `${oneKAggregate.triggers}/${oneKAggregate.n}` : "—",
  });
  // Claude 1K rows (L-agentic + M-bm25)
  const claude1kSource = claudeRerun1k?.name || "rerun-claude-1k-lm-2026-05-26";
  const claude1kRowByVariant = {};
  for (const v of ["L-agentic", "M-bm25"]) {
    const a = claudeRerun1k?.aggregates?.[`claude-${v}-with-claudemd`] || null;
    claude1kRowByVariant[v] = renderRerunAggregateRow(`${v} on 1K synthetic`, a, {
      badge: "1K synthetic",
      triggerText: a ? `${a.triggers}/${a.n}` : "—",
    });
  }
  // Count cells per (host, condition)
  const counts = {};
  for (const c of cells) {
    const k = `${c.host}-${c.condition}`;
    counts[k] = (counts[k] || 0) + 1;
  }

  return `<h2 id="claude-150">1. Claude Code with 24 queries/150 skills <span class="pill pill-claude">claude</span></h2>
<p class="intro">
  Fresh 2026-05-26 rerun with isolated HOMEs per cell. Model:
  <code>claude-opus-4-7 --effort high</code>. The same 16 strategies are run across
  24 single-skill queries from the 150-skill comparison corpus, with metrics extracted from
  per-query stream-json transcripts.
</p>
<p class="intro">
  The split below isolates prompt-injection effects: <b>with-CLAUDE.md</b> adds the project-level
  routing instruction that tells Claude Code to call <code>skill-router-skills</code> when no enabled
  skill matches; <b>without-CLAUDE.md</b> removes that instruction to measure the strategy body alone.
  Source: <code>runs/${escapeHtml(claudeSource)}/</code>.
</p>

<h3 id="rerun-claude-with">1.1 with-CLAUDE.md</h3>
<p class="intro">
  Claude Code with the project routing hint enabled. ${counts["claude-with-claudemd"] || 0}/${16*24} cells.
  The L-agentic / M-bm25 rows are followed by a <span class="badge">1K synthetic</span> companion
  row (same SKILL.md, but the agent searches a 1000-skill corpus instead of 150) drawn from
  <code>runs/${escapeHtml(claude1kSource)}/</code>. This isolates how the CLI-driven retrieval
  primitive scales when the metadata catalog grows ~7×.
</p>
${renderRerunAggregateTable(aggregates, "claude", "with-claudemd", {
  afterVariantRows: claude1kRowByVariant,
})}
<details>
  <summary>Per-query matrix (each cell shows matched + turns / duration / ctxEnd / cost)</summary>
  ${renderRerunPerQueryMatrix(cells, "claude", "with-claudemd")}
</details>
<details>
  <summary>Per-query execution traces (16 variants × 24 queries, inlined)</summary>
  ${renderRerunTraces(cells, "claude", "with-claudemd")}
</details>

<h3 id="rerun-claude-without">1.2 without-CLAUDE.md</h3>
<p class="intro">
  Same model, queries, and strategy files, but without the CLAUDE.md trigger-prompt injection.
  ${counts["claude-without-claudemd"] || 0}/${16*24} cells.
</p>
${renderRerunAggregateTable(aggregates, "claude", "without-claudemd")}
<details>
  <summary>Per-query matrix</summary>
  ${renderRerunPerQueryMatrix(cells, "claude", "without-claudemd")}
</details>
<details>
  <summary>Per-query execution traces</summary>
  ${renderRerunTraces(cells, "claude", "without-claudemd")}
</details>

<h2 id="rerun-codex">2. CodeX with 24 queries/150 skills <span class="pill pill-codex">codex</span></h2>
<p class="intro">
  Corrected new-CLI rerun. Model: <code>gpt-5.5</code> reasoning_effort=high; every task uses a
  fresh CodeX home/project. CodeX has no with/without CLAUDE.md split, so each strategy runs once
  per variant × query. Source: <code>runs/${escapeHtml(codexSource)}/</code>.
  ${counts["codex-with-claudemd"] || 0}/${16*24} 150-skill cells.
</p>
<p class="intro">
  The <b>L-agentic on 1K synthetic</b> row is the latest scale check from
  <code>runs/${escapeHtml(oneKSource)}/</code>. It uses the same 150-skill comparison corpus plus
  850 synthetic noise skills, so it is included here as an L-agentic scalability indicator rather
  than as another 150-skill strategy row.
</p>
${renderRerunAggregateTable(aggregates, "codex", "with-claudemd", { afterVariantRows: { "L-agentic": oneKRow } })}
<details>
  <summary>2.1 Per-query matrix (150-skill rows only)</summary>
  ${renderRerunPerQueryMatrix(cells, "codex", "with-claudemd")}
</details>
<details>
  <summary>2.2 Per-query execution traces (150-skill rows only)</summary>
  ${renderRerunTraces(cells, "codex", "with-claudemd")}
</details>
`;
}

// ---------- §8 Variant implementations ----------

function renderVariants(variants) {
  if (!variants) return "";
  let body = "";
  body += `<h3>4.1 dci-compare variants (used in §1 and §2)</h3>`;
  const dciIds = [...new Set([
    ...Object.keys(variants.dciCompare.claude || {}),
    ...Object.keys(variants.dciCompare.codex || {}),
  ])].sort();
  for (const id of dciIds) {
    const claudeText = variants.dciCompare.claude[id];
    const codexText = variants.dciCompare.codex[id];
    body += `<details>
      <summary><code>${escapeHtml(id)}</code> ${claudeText ? '<span class="pill pill-claude">claude</span>' : ''} ${codexText ? '<span class="pill pill-codex">codex</span>' : ''}</summary>
      ${claudeText ? `<h4>variants/routing-only/${escapeHtml(id)}.SKILL.md <span class="pill pill-claude">claude</span></h4><pre class="code"><code>${escapeHtml(claudeText)}</code></pre>` : ''}
      ${codexText ? `<h4>variants/routing-only-codex/${escapeHtml(id)}.SKILL.md <span class="pill pill-codex">codex</span></h4><pre class="code"><code>${escapeHtml(codexText)}</code></pre>` : ''}
    </details>`;
  }
  body += `<h3>4.2 skillrouter-easy variants (used in §3)</h3>`;
  const easyIds = [...new Set([
    ...Object.keys(variants.skillrouterEasy.claude || {}),
    ...Object.keys(variants.skillrouterEasy.codex || {}),
  ])].sort();
  for (const id of easyIds) {
    const claudeText = variants.skillrouterEasy.claude[id];
    const codexText = variants.skillrouterEasy.codex[id];
    body += `<details>
      <summary><code>${escapeHtml(id)}</code> <span class="pill pill-claude">claude</span> <span class="pill pill-codex">codex</span></summary>
      ${claudeText ? `<h4>variants/claude/${escapeHtml(id)}.SKILL.md</h4><pre class="code"><code>${escapeHtml(claudeText)}</code></pre>` : ''}
      ${codexText ? `<h4>variants/codex/${escapeHtml(id)}.SKILL.md</h4><pre class="code"><code>${escapeHtml(codexText)}</code></pre>` : ''}
    </details>`;
  }
  return `<h2 id="variants">4. Variant implementations</h2>
<p class="intro">
  Full <code>SKILL.md</code> for every variant. Frontmatter is shared; only the body workflow differs.
</p>
${body}`;
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  let outPath = join(__dirname, "runs/report-all-experiments.html");
  for (const a of args) if (a.startsWith("--out=")) outPath = a.slice(6);

  console.error("Loading all-traces.json (historical data)...");
  const tracesPath = join(__dirname, "runs/all-traces.json");
  if (!existsSync(tracesPath)) {
    console.error(`MISSING: ${tracesPath}. Run extract-all-traces.mjs first.`);
    process.exit(1);
  }
  const traces = JSON.parse(await readFile(tracesPath, "utf8"));
  const [easySummaries, variants, rerun, rerun1k, claudeRerun1k] = await Promise.all([
    loadEasy78KSummaries(),
    loadAllVariants(),
    loadRerun150(),
    loadRerunDir("rerun-codex-newcli-l-agentic-1k-2026-05-26"),
    loadRerunDir("rerun-claude-1k-lm-2026-05-26"),
  ]);
  console.error(`Loaded: traces=${Object.keys(traces).length} experiments, easySummaries=${Object.keys(easySummaries).length} cells, variants=${Object.keys(variants.dciCompare.claude).length + Object.keys(variants.dciCompare.codex).length + Object.keys(variants.skillrouterEasy.claude).length + Object.keys(variants.skillrouterEasy.codex).length}`);

  const html = [
    renderHeader(),
    renderToc(),
    renderBackground(),
    renderOverview(),
    renderRerun(rerun, rerun1k, claudeRerun1k),      // §1+§2: fresh 16-variant rerun + Codex 1K aggregate row + Claude 1K
    renderEasySection(easySummaries, traces),
    renderVariants(variants),
    "</body></html>",
  ].join("\n").replace(/[ \t]+$/gm, "");

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html);
  console.error(`Wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB, ${(html.length / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(e => { console.error(e.stack ?? e.message); process.exit(1); });
