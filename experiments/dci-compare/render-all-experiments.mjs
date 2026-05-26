#!/usr/bin/env node
// render-all-experiments.mjs — Single comprehensive HTML report covering ALL
// experiments in REPORT-claudemd-optimized.md. Sections are organized by
// (host, dataset-size) to make Claude Code vs Codex and 150-skill vs 78K-skill
// comparisons obvious at a glance.
//
// Usage: node render-all-experiments.mjs [--out=runs/report-all-experiments.html]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

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
function secs(ms) {
  if (!ms) return "—";
  return Math.round(ms / 1000) + "s";
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------- data loaders ----------

async function loadJson(p) {
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf8"));
}

async function loadClaudePaired() {
  // §6 Claude Code paired 9 variants × 24 queries × 2 conditions
  const p = join(ROOT, "experiments/dci-compare/runs/routing-only-9x24-claudemd/summary-metrics.json");
  const metrics = await loadJson(p);
  if (!metrics) return null;
  // Also need per-run details for per-query matrix
  const detail = await loadJson(join(ROOT, "experiments/dci-compare/runs/routing-only-9x24-claudemd/summary.json"));
  return { metrics, detail };
}

async function loadCodexSmall() {
  // §7 Codex 150-skill aggregate from variantStats
  const p = join(ROOT, "experiments/dci-compare/runs/codex-routing-only-9x24/summary.json");
  const d = await loadJson(p);
  if (!d) return null;
  return d;
}

async function loadCodexExtensions() {
  // §7.4 Codex follow-on variants (D-meta, K, K-lite high+fix, L, L-1K, M)
  const variants = [
    { id: "D-agentic (metadata-only)", corpus: 150, dir: "codex-routing-only-d-agentic-metadata-24-20260524" },
    { id: "K-bounded", corpus: 150, dir: "codex-routing-only-k-24-20260524" },
    { id: "K-lite (high)", corpus: 150, dir: "codex-routing-only-k-lite-24-high-20260524" },
    { id: "K-lite (fixed)", corpus: 150, dir: "codex-routing-only-k-lite-fix-24-20260524" },
    { id: "L-agentic", corpus: 150, dir: "codex-routing-only-l-agentic-24-20260525-v2" },
    { id: "L-agentic (1K)", corpus: 1000, dir: "codex-routing-only-l-agentic-1k-24-20260525" },
    { id: "M-bm25", corpus: 150, dir: "codex-routing-only-m-bm25-index-fix-24-20260525" },
  ];
  const rows = [];
  for (const v of variants) {
    const d = await loadJson(join(ROOT, "experiments/dci-compare/runs", v.dir, "summary.json"));
    if (!d) continue;
    const s = (d.variantStats || [])[0];
    if (!s) continue;
    rows.push({ ...v, stats: s });
  }
  return rows;
}

async function loadScalingHard() {
  // §8 J-bounded scaling: 150, 79K Hard (Claude Code)
  const cells = [
    { label: "J-v2 × 150 (Claude Code)", host: "claude", path: "experiments/scaling-jbounded/runs/sweep24-v2-150-cmd/cells.json" },
    { label: "J-v2 × 79K Hard (Claude Code)", host: "claude", path: "experiments/scaling-jbounded/runs/sweep24-v2-full-cmd/cells.json" },
  ];
  const rows = [];
  for (const c of cells) {
    const d = await loadJson(join(ROOT, c.path));
    if (!d) continue;
    rows.push({ ...c, agg: d.aggregate, cells: d.cells });
  }
  return rows;
}

async function loadCodexHard() {
  // §8.5 Codex paper-core single Hard runs (M-bm25, J-v2) and current-24 Hard
  const variants = [
    { id: "M-bm25", queryset: "paper-core single", corpus: 79141, dir: "codex-routing-only-paper-single-hard-m-bm25-24-20260525" },
    { id: "J-bounded-v2", queryset: "paper-core single", corpus: 79141, dir: "codex-routing-only-paper-single-hard-j-v2-24-20260525" },
    { id: "M-bm25", queryset: "current 24 subset", corpus: 79141, dir: "codex-routing-only-m-bm25-skillrouter-hard-24-20260525" },
  ];
  const rows = [];
  for (const v of variants) {
    const d = await loadJson(join(ROOT, "experiments/dci-compare/runs", v.dir, "summary.json"));
    if (!d) continue;
    const s = (d.variantStats || [])[0];
    if (!s) continue;
    rows.push({ ...v, stats: s });
  }
  return rows;
}

async function loadEasy78K() {
  // §9 SkillRouter Easy 78K × 75 core × 6 cells
  const cellNames = ["claude-J-bounded-v2", "claude-K-bounded", "claude-M-bm25", "codex-J-bounded-v2", "codex-K-bounded", "codex-M-bm25"];
  const rows = [];
  for (const name of cellNames) {
    const s = await loadJson(join(ROOT, "experiments/skillrouter-easy/runs", name, "summary.json"));
    if (!s) continue;
    const [host, ...rest] = name.split("-");
    rows.push({ host, variant: rest.join("-"), summary: s });
  }
  return rows;
}

// ---------- renderers ----------

const PAPER_BASELINES = {
  "BM25 (nd, Easy)": 0.000,
  "Qwen3-Emb-0.6B (nd, Easy)": 0.227,
  "Qwen3-Emb-8B (nd, Easy)": 0.307,
  "BM25 (full body, Easy)": 0.347,
  "Qwen3-Emb-0.6B (full, Easy)": 0.587,
  "Qwen3-Emb-8B (full, Easy)": 0.653,
  "SR-Emb-0.6B (full, Easy)": 0.667,
  "SR-Emb × SR-Rank (full, A-Hit@1 avg)": 0.760,
};

function renderHeader() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>Disabled-Skill Routing — All Experiments</title>
<style>
  :root {
    --claude: #8b5cf6;
    --codex: #3b82f6;
    --paper: #64748b;
    --emerald: #059669;
    --amber: #d97706;
    --rose: #e11d48;
  }
  body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1400px; margin: 0 auto; color: #111; background: #fafafa; }
  h1 { margin: 0 0 6px; font-size: 24px; }
  h2 { margin: 32px 0 12px; font-size: 19px; padding-bottom: 6px; border-bottom: 2px solid #d1d5db; }
  h3 { margin: 18px 0 8px; font-size: 15px; color: #1f2937; }
  h4 { margin: 12px 0 6px; font-size: 13px; color: #4b5563; font-weight: 600; }
  p.intro { color: #4b5563; font-size: 13px; line-height: 1.55; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin: 8px 0; }
  th, td { padding: 6px 9px; text-align: left; border-bottom: 1px solid #eef2f7; }
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
  .pill-best { background: #059669; }
  .pill-gray { background: #94a3b8; }
  .badge { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 10.5px; font-weight: 600; background: #e5e7eb; color: #1f2937; margin-left: 4px; }
  .takeaway { background: #f0f9ff; border-left: 3px solid #0284c7; padding: 8px 12px; margin: 8px 0; font-size: 13px; color: #0c4a6e; border-radius: 0 4px 4px 0; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 8px 0; }
  .panel { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
  .panel h3 { margin-top: 0; }
  details { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; margin: 6px 0; }
  details > summary { cursor: pointer; font-weight: 600; font-size: 13px; }
  code { background: #f1f5f9; padding: 0 4px; border-radius: 3px; font-size: 12px; }
  .toc { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 16px; margin: 10px 0 20px; font-size: 13px; }
  .toc a { color: #2563eb; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }
  .toc li { margin: 3px 0; }
  .matrix-row td { font-size: 11.5px; padding: 4px 6px; }
  .matrix-row .gt { color: #6b7280; font-style: italic; }
  .footnote { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .bar-wrap { width: 80px; height: 10px; background: #e5e7eb; border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 6px; }
  .bar-fill { height: 100%; background: var(--claude); }
  .bar-fill.codex { background: var(--codex); }
  .bar-fill.paper { background: var(--paper); }
</style>
</head><body>
<h1>Disabled-Skill Routing — All Experiments</h1>
<p class="intro">
  Consolidated visualization of every experiment in
  <code>REPORT-claudemd-optimized.md</code>. Sections are organized by
  <b>dataset size</b> (150-skill → 1K synthetic → 79K Hard → 78K Easy 75-core)
  and then split by <b>host</b> (Claude Code <span class="pill pill-claude">claude</span>
  vs Codex <span class="pill pill-codex">codex</span>) to make
  apples-to-apples comparisons obvious. Paper baselines from the SkillRouter
  paper (arXiv:2603.22455) are shown as gray <span class="pill pill-paper">paper</span>
  pills where relevant.
</p>
`;
}

function renderToc() {
  return `<div class="toc">
  <b>Sections:</b>
  <ul>
    <li><a href="#small-claude">1. 150-skill × Claude Code</a> — 9 variants paired (with/without CLAUDE.md)</li>
    <li><a href="#small-codex">2. 150-skill × Codex</a> — initial 9 variants + 7 follow-on iterations</li>
    <li><a href="#medium-codex">3. 1K synthetic × Codex</a> — L-agentic scale check</li>
    <li><a href="#hard-claude">4. 79K Hard × Claude Code</a> — J-bounded-v2 large-pool stress</li>
    <li><a href="#hard-codex">5. 79K Hard × Codex</a> — paper-core single + current-24 subset</li>
    <li><a href="#easy-claude">6.1 78K Easy × 75 core × Claude Code</a> — K / J-v2 / M-bm25 (§9)</li>
    <li><a href="#easy-codex">6.2 78K Easy × 75 core × Codex</a> — K / J-v2 / M-bm25 (§9)</li>
    <li><a href="#easy-compare">7. 78K Easy — cross-cell comparison &amp; paper baselines</a></li>
    <li><a href="#easy-traces">8. 78K Easy — per-query execution traces</a> (link to separate file)</li>
  </ul>
</div>`;
}

// ---------- Section 1: Claude paired 150-skill ----------

function renderClaudePaired(data) {
  if (!data) return "";
  const rows = data.metrics.rows; // [{variant, condition, total, triggered, correct, sumCost, sumTurns, sumDur, meanCtxEnd}]
  const variants = [...new Set(rows.map(r => r.variant))];
  // Build by variant comparing with/without conditions
  const byVariant = new Map();
  for (const r of rows) {
    if (!byVariant.has(r.variant)) byVariant.set(r.variant, {});
    byVariant.get(r.variant)[r.condition] = r;
  }
  let tableRows = "";
  for (const v of variants) {
    const w = byVariant.get(v)["with-claudemd"] || {};
    const wo = byVariant.get(v)["without-claudemd"] || {};
    const accW = w.correct / w.total;
    const accWo = wo.correct / wo.total;
    const lift = Number.isFinite(accW - accWo) ? (accW - accWo) * 100 : null;
    const liftCls = lift > 5 ? "hit" : lift < -5 ? "miss" : "gray";
    tableRows += `<tr>
      <td><b>${escapeHtml(v)}</b></td>
      <td class="num">${w.correct}/${w.total} <span class="gray">(${pct(accW)})</span></td>
      <td class="num">${wo.correct}/${wo.total} <span class="gray">(${pct(accWo)})</span></td>
      <td class="num ${liftCls}">${lift != null ? (lift > 0 ? "+" : "") + lift.toFixed(1) + "pp" : "—"}</td>
      <td class="num">${w.triggered}/${w.total}</td>
      <td class="num">${wo.triggered}/${wo.total}</td>
      <td class="num">${dollars(w.sumCost)}</td>
      <td class="num">${secs(w.sumDur)}</td>
      <td class="num">${w.sumTurns}</td>
      <td class="num">${num(w.meanCtxEnd / 1000, 1)}k</td>
    </tr>`;
  }
  return `<h2 id="small-claude">1. 150-skill × Claude Code <span class="pill pill-claude">claude</span></h2>
<p class="intro">
  Paired experiment: each (variant, condition) gets an isolated HOME and runs all 24 SkillsBench
  single-skill queries. <b>with-CLAUDE.md</b> injects a 5-line user-message context block telling
  the agent to call <code>skill-router-skills</code> when no enabled skill matches.
  Trigger lift and accuracy lift are the primary CLAUDE.md signal.
</p>
<div class="takeaway">
  <b>Headline:</b> CLAUDE.md injection lifts accuracy +18pp on average across 7 comparable router
  variants (excl. D-agentic rerun). B-cc / C-lite reach 23/24 (95.8%). J-bounded is the lowest-cost
  router in the 22/24 group ($3.07, 30.7K avg ctx). A-router is the only router below G-native.
</div>
<table>
  <thead>
    <tr>
      <th>Variant</th>
      <th class="num">Acc (with)</th>
      <th class="num">Acc (without)</th>
      <th class="num">Δ acc</th>
      <th class="num">Trigger (with)</th>
      <th class="num">Trigger (without)</th>
      <th class="num">Cost (with)</th>
      <th class="num">Wall (with)</th>
      <th class="num">Turns (with)</th>
      <th class="num">Avg ctx<sub>end</sub></th>
    </tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>
<div class="footnote">Acc / Trigger denominators are 24. Δ acc = with − without (pp). Wall + cost are summed across 24 queries.</div>
`;
}

// ---------- Section 2: Codex small-pool ----------

function renderCodexSmall(d9, ext) {
  if (!d9) return "";
  const stats = d9.variantStats || [];
  // Codex cost estimate per Markdown report §5
  const costFor = s => {
    const fresh = (s.totalTokensIn || 0) - (s.cachedInputTokens || 0); // we don't have cached split; approximate from totals
    // From the markdown report values, cost was already computed — but here we recompute approximately
    // Use the formula in §5: fresh*5 + cached*0.5 + out*30 per 1M. We don't have cached split here,
    // so just give totalTokensIn at fresh rate as a conservative upper bound, then adjust w/ cached if present.
    const tin = s.totalTokensIn || 0;
    const tout = s.totalTokensOut || 0;
    // Better: use known cell costs from the markdown report instead
    return null;
  };
  const KNOWN_COSTS_9 = {
    "G-native": 1.816, "A-router": 4.485, "B-cc": 4.853, "C-lite": 3.594,
    "D-agentic": 2.870, "E-digest": 2.946, "H-bounded": 4.348, "I-meta": 3.310, "J-bounded": 2.415,
  };
  let rows1 = "";
  for (const s of stats) {
    const acc = s.correct / s.n;
    const accCls = acc >= 0.95 ? "hit" : acc >= 0.85 ? "mid" : "miss";
    rows1 += `<tr>
      <td><b>${escapeHtml(s.variant)}</b></td>
      <td class="num ${accCls}">${s.correct}/${s.n} <span class="gray">(${pct(acc)})</span></td>
      <td class="num">${s.routerTriggered != null ? `${s.routerTriggered}/${s.n}` : "n/a"}</td>
      <td class="num">${secs(s.totalDurMs)}</td>
      <td class="num">${num((s.totalTokensIn || 0) / 1000, 1)}k</td>
      <td class="num">${num(s.totalTokensOut || 0)}</td>
      <td class="num">${num(s.totalReasoning || 0)}</td>
      <td class="num">${dollars(KNOWN_COSTS_9[s.variant])}</td>
    </tr>`;
  }
  // Extension rows
  const KNOWN_COSTS_EXT = {
    "D-agentic (metadata-only)": 3.595,
    "K-bounded": 3.553,
    "K-lite (high)": 3.516,
    "K-lite (fixed)": 3.321,
    "L-agentic": 2.768,
    "L-agentic (1K)": 3.442,
    "M-bm25": 2.982,
  };
  let rows2 = "";
  for (const e of (ext || [])) {
    const s = e.stats;
    const acc = s.correct / s.n;
    const accCls = acc >= 0.95 ? "hit" : acc >= 0.85 ? "mid" : "miss";
    rows2 += `<tr>
      <td><b>${escapeHtml(e.id)}</b> <span class="badge">${e.corpus}-skill</span></td>
      <td class="num ${accCls}">${s.correct}/${s.n} <span class="gray">(${pct(acc)})</span></td>
      <td class="num">${s.routerTriggered != null ? `${s.routerTriggered}/${s.n}` : "n/a"}</td>
      <td class="num">${secs(s.totalDurMs)}</td>
      <td class="num">${num((s.totalTokensIn || 0) / 1000, 1)}k</td>
      <td class="num">${num(s.totalTokensOut || 0)}</td>
      <td class="num">${num(s.totalReasoning || 0)}</td>
      <td class="num">${dollars(KNOWN_COSTS_EXT[e.id])}</td>
    </tr>`;
  }
  // Per-query matrix from d9.runs
  const runs = d9.runs || [];
  const variants9 = [...new Set(runs.map(r => r.variant))];
  const queries9 = [...new Set(runs.map(r => r.queryId))].sort();
  const byKey = new Map();
  for (const r of runs) byKey.set(`${r.variant}::${r.queryId}`, r);
  let matrixHead = `<tr><th>Query</th><th>Expected</th>` + variants9.map(v => `<th class="num">${escapeHtml(v)}</th>`).join("") + `</tr>`;
  let matrixBody = "";
  for (const q of queries9) {
    const expected = byKey.get(`${variants9[0]}::${q}`)?.expected || "—";
    let cells = "";
    for (const v of variants9) {
      const r = byKey.get(`${v}::${q}`);
      if (!r) { cells += `<td class="num gray">—</td>`; continue; }
      const hit = r.matched === r.expected;
      const cls = hit ? "hit" : "miss";
      const sym = hit ? "✓" : "✗";
      const txt = hit ? r.matched : (r.matched || "no-match");
      cells += `<td class="num ${cls}">${sym} ${escapeHtml(txt)}</td>`;
    }
    matrixBody += `<tr class="matrix-row"><td><code>${escapeHtml(q)}</code></td><td><code>${escapeHtml(expected)}</code></td>${cells}</tr>`;
  }

  return `<h2 id="small-codex">2. 150-skill × Codex <span class="pill pill-codex">codex</span></h2>
<p class="intro">
  Same 24-query / 150-skill corpus as §1 above, run on <code>codex exec</code> (model gpt-5.5,
  reasoning effort high). Codex native G-native scores 24/24 vs Claude native 15/24 — the largest
  host-driven gap in the report. After A-J, follow-on iterations (D-metadata, K, K-lite, L, M)
  are appended below.
</p>
<div class="takeaway">
  <b>Headline:</b> Codex G-native + D-agentic both 24/24. C-lite / E-digest / H-bounded reach 23/24.
  All Codex follow-on iterations (K, K-lite fixed, L, M) also reach 24/24 on 150-skill — the small
  corpus cannot rank them further. L-agentic scales to 1K with only 1 miss (pptx-reference-formatting).
</div>
<h3>2.1 Initial 9 variants (A–J)</h3>
<table>
  <thead>
    <tr>
      <th>Variant</th>
      <th class="num">Accuracy</th>
      <th class="num">Trigger</th>
      <th class="num">Wall</th>
      <th class="num">In tokens</th>
      <th class="num">Out tokens</th>
      <th class="num">Reasoning tokens</th>
      <th class="num">Cost est.</th>
    </tr>
  </thead>
  <tbody>${rows1}</tbody>
</table>
<h3>2.2 Follow-on iterations (D-metadata, K, K-lite, L, L-1K, M)</h3>
<table>
  <thead>
    <tr>
      <th>Variant</th>
      <th class="num">Accuracy</th>
      <th class="num">Trigger</th>
      <th class="num">Wall</th>
      <th class="num">In tokens</th>
      <th class="num">Out tokens</th>
      <th class="num">Reasoning tokens</th>
      <th class="num">Cost est.</th>
    </tr>
  </thead>
  <tbody>${rows2}</tbody>
</table>
<div class="footnote">Cost est. uses gpt-5.5 standard list price (2026-05-24) per §5 of the markdown report; treat as Codex-internal magnitude comparison, not financial truth.</div>

<details>
  <summary>2.3 Per-query matrix (initial 9 variants × 24 queries)</summary>
  <table style="font-size:11.5px">
    <thead>${matrixHead}</thead>
    <tbody>${matrixBody}</tbody>
  </table>
</details>
`;
}

// ---------- Section 3: 1K synthetic (Codex L) ----------

function renderMediumCodex(ext) {
  if (!ext) return "";
  const onek = ext.find(e => e.id === "L-agentic (1K)");
  const baseline150 = ext.find(e => e.id === "L-agentic");
  if (!onek || !baseline150) return "";
  return `<h2 id="medium-codex">3. 1K synthetic × Codex <span class="pill pill-codex">codex</span></h2>
<p class="intro">
  L-agentic (CLI-driven <code>corpus search/inspect</code> + structured candidates) is the only
  variant scaled past 150. The 1K corpus = 150-skill comparison set + 850 synthetic noise skills
  drawn from the easy pool. This validates that the L abstraction's index + pagination handles
  ~7× the candidate pool without prompt blowup.
</p>
<table>
  <thead><tr><th>Corpus</th><th class="num">Accuracy</th><th class="num">Trigger</th><th class="num">Wall</th><th class="num">In tokens</th><th class="num">Out tokens</th><th class="num">Δ acc vs 150</th></tr></thead>
  <tbody>
    <tr>
      <td><b>L-agentic × 150-skill</b></td>
      <td class="num hit">${baseline150.stats.correct}/${baseline150.stats.n} <span class="gray">(${pct(baseline150.stats.correct / baseline150.stats.n)})</span></td>
      <td class="num">${baseline150.stats.routerTriggered != null ? `${baseline150.stats.routerTriggered}/${baseline150.stats.n}` : "n/a"}</td>
      <td class="num">${secs(baseline150.stats.totalDurMs)}</td>
      <td class="num">${num(baseline150.stats.totalTokensIn / 1000, 1)}k</td>
      <td class="num">${num(baseline150.stats.totalTokensOut)}</td>
      <td class="num gray">baseline</td>
    </tr>
    <tr>
      <td><b>L-agentic × 1K synthetic</b></td>
      <td class="num mid">${onek.stats.correct}/${onek.stats.n} <span class="gray">(${pct(onek.stats.correct / onek.stats.n)})</span></td>
      <td class="num">${onek.stats.routerTriggered != null ? `${onek.stats.routerTriggered}/${onek.stats.n}` : "n/a"}</td>
      <td class="num">${secs(onek.stats.totalDurMs)}</td>
      <td class="num">${num(onek.stats.totalTokensIn / 1000, 1)}k</td>
      <td class="num">${num(onek.stats.totalTokensOut)}</td>
      <td class="num miss">−4.2pp</td>
    </tr>
  </tbody>
</table>
<div class="footnote">1K miss: <code>pptx-reference-formatting</code> → <code>skill-103</code>. Avg ctx<sub>end</sub> only grows from 17.5K → 17.9K, confirming CLI pagination prevents prompt blowup.</div>
`;
}

// ---------- Section 4: 79K Hard (Claude J-v2 scaling) ----------

function renderHardClaude(scaling) {
  if (!scaling || !scaling.length) return "";
  let rows = "";
  for (const c of scaling) {
    const agg = c.agg || {};
    const acc = agg.accuracy;
    const accCls = acc >= 0.9 ? "hit" : acc >= 0.5 ? "mid" : "miss";
    rows += `<tr>
      <td><b>${escapeHtml(c.label)}</b></td>
      <td class="num ${accCls}">${Math.round((acc || 0) * agg.n)}/${agg.n} <span class="gray">(${pct(acc)})</span></td>
      <td class="num">${pct(agg.triggerRate)}</td>
      <td class="num">${secs(agg.sumDuration)}</td>
      <td class="num">${dollars(agg.sumCost)}</td>
      <td class="num">${num(agg.avgEndCtx / 1000, 1)}k</td>
      <td class="num">${agg.sumTurns}</td>
      <td class="num">${agg.timeouts}</td>
    </tr>`;
  }
  return `<h2 id="hard-claude">4. 79K Hard × Claude Code <span class="pill pill-claude">claude</span></h2>
<p class="intro">
  J-bounded-v2 scaling from 150 to 79,141 Hard pool (SkillRouter <code>eval-core/hard</code>).
  v2 fixes v1's shell glob ARG_MAX overflow (~13K paths cap) and removes head-20 truncation.
  Same 24 SkillsBench queries; bounded payload, cost only +35%, accuracy drops from 22/24 to 12/24.
</p>
<div class="takeaway">
  <b>Headline:</b> J-bounded-v2 is mechanically stable at 79K (bounded ctx, no timeouts) but
  accuracy collapses from 91.7% → 50.0% because description-only signal is insufficient against
  the Hard pool's 780 LLM-distilled distractors. Metadata-only cannot serve as the sole decision
  source at this scale — body-on-tie / full-text rerank is required.
</div>
<table>
  <thead>
    <tr>
      <th>Cell</th>
      <th class="num">Accuracy</th>
      <th class="num">Trigger</th>
      <th class="num">Wall</th>
      <th class="num">Cost</th>
      <th class="num">Avg ctx<sub>end</sub></th>
      <th class="num">Turns</th>
      <th class="num">Timeouts</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
`;
}

// ---------- Section 5: 79K Hard × Codex ----------

function renderHardCodex(rows) {
  if (!rows || !rows.length) return "";
  const KNOWN_COSTS = {
    "M-bm25_paper-core single": 6.822,
    "J-bounded-v2_paper-core single": 12.436,
    "M-bm25_current 24 subset": 6.347,
  };
  let tbody = "";
  for (const r of rows) {
    const s = r.stats;
    const acc = s.correct / s.n;
    const accCls = acc >= 0.65 ? "hit" : acc >= 0.4 ? "mid" : "miss";
    const note = r.id === "J-bounded-v2" ? ` <span class="gray">(strict; alias-norm 14/24)</span>` : "";
    tbody += `<tr>
      <td><b>${escapeHtml(r.id)}</b> <span class="badge">${escapeHtml(r.queryset)}</span></td>
      <td class="num ${accCls}">${s.correct}/${s.n} <span class="gray">(${pct(acc)})</span>${note}</td>
      <td class="num">${s.routerTriggered != null ? `${s.routerTriggered}/${s.n}` : "n/a"}</td>
      <td class="num">${secs(s.totalDurMs)}</td>
      <td class="num">${num(s.totalTokensIn / 1000, 1)}k</td>
      <td class="num">${num(s.totalTokensOut)}</td>
      <td class="num">${num(s.totalReasoning || 0)}</td>
      <td class="num">${dollars(KNOWN_COSTS[r.id + "_" + r.queryset])}</td>
    </tr>`;
  }
  return `<h2 id="hard-codex">5. 79K Hard × Codex <span class="pill pill-codex">codex</span></h2>
<p class="intro">
  Codex M-bm25 and J-bounded-v2 against the full 79,141-skill Hard pool on two query sets:
  <b>paper-core single</b> (24 single-skill queries from SkillRouter <code>relevance.json</code>)
  and the original <b>current 24 subset</b> (overlapping but not identical). J-v2 has 3 outputs in
  raw <code>name:</code> form rather than opaque <code>sr-*</code> ids; strict scoring counts those
  as misses (11/24), alias-normalized would give 14/24.
</p>
<div class="takeaway">
  <b>Headline:</b> M-bm25 reaches 58.3% on paper-core single Hard, materially beating BM25-nd (0%)
  and Qwen3-Emb-8B-nd (20.0%) on Hard but well below full-body SR pipeline (~73%). Both Codex Hard
  runs cost ~$6-12 and run 16-50 min — significantly more expensive than 150-skill runs.
</div>
<table>
  <thead>
    <tr>
      <th>Variant / Query set</th>
      <th class="num">Accuracy</th>
      <th class="num">Trigger</th>
      <th class="num">Wall</th>
      <th class="num">In tokens</th>
      <th class="num">Out tokens</th>
      <th class="num">Reasoning tokens</th>
      <th class="num">Cost est.</th>
    </tr>
  </thead>
  <tbody>${tbody}</tbody>
</table>
`;
}

// ---------- Section 6 + 7: 78K Easy × 75 core (§9) ----------

function renderEasyHost(host, easyRows) {
  const rows = easyRows.filter(r => r.host === host);
  let tbody = "";
  for (const r of rows) {
    const s = r.summary;
    const acc = s.hit1_rate;
    const accCls = acc >= 0.37 ? "hit" : acc >= 0.28 ? "mid" : "miss";
    const singlePct = pct(s.hit1_single / Math.max(s.n_single, 1));
    const multiPct = pct(s.hit1_multi / Math.max(s.n_multi, 1));
    tbody += `<tr>
      <td><b>${escapeHtml(r.variant)}</b></td>
      <td class="num ${accCls}"><b>${pct(acc)}</b> <span class="gray">(${s.hit1}/${s.queries})</span></td>
      <td class="num">${s.hit1_single}/${s.n_single} <span class="gray">(${singlePct})</span></td>
      <td class="num">${s.hit1_multi}/${s.n_multi} <span class="gray">(${multiPct})</span></td>
      <td class="num">${s.answered}/${s.queries}</td>
      <td class="num">${s.timeouts}</td>
      <td class="num">${s.errors}</td>
      <td class="num">${secs(s.elapsedMs)}</td>
    </tr>`;
  }
  const idSuffix = host === "claude" ? "easy-claude" : "easy-codex";
  const pillClass = host === "claude" ? "pill-claude" : "pill-codex";
  const hostLabel = host === "claude" ? "Claude Code" : "Codex";
  const sectionNum = host === "claude" ? "6.1" : "6.2";
  return `<h2 id="${idSuffix}">${sectionNum}. 78K Easy × 75 core × ${hostLabel} <span class="pill ${pillClass}">${host}</span></h2>
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

function renderEasyCompare(easyRows) {
  // Cross-cell comparison with paper baselines
  const all = easyRows.map(r => ({ key: `${r.host}/${r.variant}`, host: r.host, rate: r.summary.hit1_rate, hit: r.summary.hit1, n: r.summary.queries }));
  all.sort((a, b) => b.rate - a.rate);
  const maxRate = Math.max(...all.map(a => a.rate), ...Object.values(PAPER_BASELINES));

  let ourRows = "";
  for (const a of all) {
    const w = ((a.rate / maxRate) * 100).toFixed(1);
    const cls = a.host === "claude" ? "" : "codex";
    ourRows += `<tr>
      <td><span class="pill pill-${a.host}">${escapeHtml(a.key)}</span></td>
      <td class="num"><b>${pct(a.rate)}</b> <span class="gray">(${a.hit}/${a.n})</span></td>
      <td><div class="bar-wrap"><div class="bar-fill ${cls}" style="width:${w}%"></div></div></td>
    </tr>`;
  }
  let paperRows = "";
  for (const [name, rate] of Object.entries(PAPER_BASELINES)) {
    const w = ((rate / maxRate) * 100).toFixed(1);
    paperRows += `<tr>
      <td><span class="pill pill-paper">paper</span> ${escapeHtml(name)}</td>
      <td class="num">${pct(rate)}</td>
      <td><div class="bar-wrap"><div class="bar-fill paper" style="width:${w}%"></div></div></td>
    </tr>`;
  }

  // Aggregate by variant / host
  const byVariant = new Map();
  const byHost = new Map();
  for (const r of easyRows) {
    const v = r.variant, h = r.host;
    if (!byVariant.has(v)) byVariant.set(v, []);
    byVariant.get(v).push(r.summary.hit1_rate);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(r.summary.hit1_rate);
  }
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  let vRows = [...byVariant.entries()].sort((a, b) => avg(b[1]) - avg(a[1]))
    .map(([v, rs]) => `<tr><td><b>${escapeHtml(v)}</b></td><td class="num">${pct(avg(rs))} <span class="gray">(${rs.length} cells)</span></td></tr>`).join("");
  let hRows = [...byHost.entries()].sort((a, b) => avg(b[1]) - avg(a[1]))
    .map(([h, rs]) => `<tr><td><span class="pill pill-${h}">${h}</span></td><td class="num">${pct(avg(rs))} <span class="gray">(${rs.length} cells)</span></td></tr>`).join("");

  // Per-query matrix for all 6 cells × 75 queries
  const cellKeys = easyRows.map(r => `${r.host}/${r.variant}`);
  const allQids = new Set();
  const byQ = new Map();
  for (const r of easyRows) {
    const key = `${r.host}/${r.variant}`;
    for (const res of r.summary.results || []) {
      allQids.add(res.query_id);
      if (!byQ.has(res.query_id)) byQ.set(res.query_id, { tier: res.tier, gt: res.expected_anon, cells: {} });
      byQ.get(res.query_id).cells[key] = res;
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
      cells += `<td class="num ${cls}">${sym} ${escapeHtml(r.top1 || "?")}</td>`;
    }
    const gtStr = e.gt.length === 1 ? e.gt[0] : `${e.gt.length} skills`;
    matrixBody += `<tr class="matrix-row"><td><code>${escapeHtml(qid)}</code> <span class="${hitCls}" style="font-weight:600">${hitLbl}</span></td><td>${e.tier}</td><td class="gt"><code>${escapeHtml(gtStr)}</code></td>${cells}</tr>`;
  }

  return `<h2 id="easy-compare">7. 78K Easy — cross-cell comparison &amp; paper baselines</h2>
<div class="takeaway">
  <b>Headline:</b> Best cell <b>codex/J-bounded-v2 at 40.0%</b> exceeds the strongest paper nd
  baseline (Qwen3-Emb-8B 30.7%) by +9.3pp, and also beats BM25 with full body (34.7%) despite
  having no body access. 6/6 cells beat BM25 nd, 4/6 beat Qwen3-Emb-0.6B nd, 3/6 beat
  Qwen3-Emb-8B nd. The remaining 25–36pp gap to full-body SR-pipeline (74–76%) is structural.
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
<div class="footnote">Paper baselines from SkillRouter Table 9 (Easy tier, nd = name + description only;
  full = full body). nd rows are directly comparable to our 6 metadata-only cells; full rows are
  upper-bound reference (we have no body access by construction).</div>

<details>
  <summary>Per-query matrix (75 queries × 6 cells)</summary>
  <p class="footnote">Each cell shows the agent's top-1 pick. <span class="hit">✓</span> = at least one ground-truth skill at rank 1 (paper any-gt Hit@1 definition). The leading badge after the query id summarizes hits across the 6 cells: <span class="hit">✓6</span> = full consensus hit, <span class="miss">✗0</span> = all miss, <span class="mid">N/6</span> = partial.</p>
  <table style="font-size:11px">
    <thead>${matrixHead}</thead>
    <tbody>${matrixBody}</tbody>
  </table>
</details>
`;
}

function renderEasyTraces() {
  return `<h2 id="easy-traces">8. 78K Easy — per-query execution traces</h2>
<p class="intro">
  Full per-query tool-call chains for all 75 queries × 6 cells (450 cards) are rendered in a
  separate file:
</p>
<ul>
  <li><a href="../skillrouter-easy/runs/traces-report.html"><b>traces-report.html</b></a> — browsable HTML (1.7 MB, 75 collapsible queries × 6 cards each)</li>
  <li><a href="../skillrouter-easy/runs/traces-compact.json"><b>traces-compact.json</b></a> — structured per-query trace data (1.3 MB)</li>
  <li><a href="../skillrouter-easy/runs/full-run.log"><b>full-run.log</b></a> — execution log (50 KB)</li>
</ul>
<p class="intro">
  Each card shows the agent's tool-call chain (Bash / Skill / etc.) with truncated input/output
  snippets — the same layout as the reference DCI report's "Per-query execution traces" section.
</p>
`;
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  let outPath = join(__dirname, "runs/report-all-experiments.html");
  for (const a of args) {
    if (a.startsWith("--out=")) outPath = a.slice(6);
  }

  console.error("Loading data...");
  const [claudePaired, codexSmall, codexExt, scalingHard, codexHard, easy] = await Promise.all([
    loadClaudePaired(),
    loadCodexSmall(),
    loadCodexExtensions(),
    loadScalingHard(),
    loadCodexHard(),
    loadEasy78K(),
  ]);

  console.error(`Loaded: claudePaired=${claudePaired ? "ok" : "MISSING"}, codexSmall=${codexSmall ? "ok" : "MISSING"}, codexExt=${codexExt?.length || 0}, scalingHard=${scalingHard?.length || 0}, codexHard=${codexHard?.length || 0}, easy=${easy?.length || 0}`);

  const html = [
    renderHeader(),
    renderToc(),
    renderClaudePaired(claudePaired),
    renderCodexSmall(codexSmall, codexExt),
    renderMediumCodex(codexExt),
    renderHardClaude(scalingHard),
    renderHardCodex(codexHard),
    renderEasyHost("claude", easy),
    renderEasyHost("codex", easy),
    renderEasyCompare(easy),
    renderEasyTraces(),
    "</body></html>",
  ].join("\n");

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html);
  console.error(`Wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e.stack ?? e.message); process.exit(1); });
