#!/usr/bin/env node
// render-all-experiments.mjs — Single, self-contained HTML report covering ALL
// experiments in REPORT-claudemd-optimized.md. Everything is inlined: no
// external links, no separate trace files. Sections are organized by
// (host, dataset-size) to make Claude Code vs Codex comparisons obvious.
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
function secs(ms) {
  if (!ms) return "—";
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

// ---------- data loaders ----------

async function loadJson(p) {
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf8"));
}

async function loadText(p) {
  if (!existsSync(p)) return null;
  return await readFile(p, "utf8");
}

async function loadClaudePaired() {
  const metrics = await loadJson(join(ROOT, "experiments/dci-compare/runs/routing-only-9x24-claudemd/summary-metrics.json"));
  if (!metrics) return null;
  // Per-query matched data is in the rendered HTML (no JSONL transcripts saved)
  const html = await loadText(join(ROOT, "experiments/dci-compare/runs/routing-only-9x24-claudemd/report.html"));
  const perQuery = {}; // {variant: [{qid, with: {hit, matched}, without: {hit, matched}}, ...]}
  if (html) {
    const sections = html.split(/<h3>([A-Za-z-]+)<\/h3>/);
    for (let i = 1; i < sections.length; i += 2) {
      const variant = sections[i];
      const content = sections[i + 1];
      const rows = [...content.matchAll(/<tr><td class="qid">([^<]+)<\/td><td class="(ok|fail)">([^<]+)<\/td><td class="(ok|fail)">([^<]+)<\/td><\/tr>/g)];
      perQuery[variant] = rows.map(m => ({
        qid: m[1],
        with: { hit: m[2] === "ok", matched: m[3].replace(/\s*\([T-]\)\s*$/, "") },
        without: { hit: m[4] === "ok", matched: m[5].replace(/\s*\([T-]\)\s*$/, "") },
      }));
    }
  }
  return { metrics, perQuery };
}

async function loadCodexSmall() {
  const p = join(ROOT, "experiments/dci-compare/runs/codex-routing-only-9x24/summary.json");
  return await loadJson(p);
}

async function loadCodexExtensions() {
  const variants = [
    { id: "D-agentic (metadata-only)", corpus: 150, dir: "codex-routing-only-d-agentic-metadata-24-20260524", knownCost: 3.595 },
    { id: "K-bounded", corpus: 150, dir: "codex-routing-only-k-24-20260524", knownCost: 3.553 },
    { id: "K-lite (high)", corpus: 150, dir: "codex-routing-only-k-lite-24-high-20260524", knownCost: 3.516 },
    { id: "K-lite (fixed)", corpus: 150, dir: "codex-routing-only-k-lite-fix-24-20260524", knownCost: 3.321 },
    { id: "L-agentic", corpus: 150, dir: "codex-routing-only-l-agentic-24-20260525-v2", knownCost: 2.768 },
    { id: "L-agentic (1K)", corpus: 1000, dir: "codex-routing-only-l-agentic-1k-24-20260525", knownCost: 3.442 },
    { id: "M-bm25", corpus: 150, dir: "codex-routing-only-m-bm25-index-fix-24-20260525", knownCost: 2.982 },
  ];
  const rows = [];
  for (const v of variants) {
    const d = await loadJson(join(ROOT, "experiments/dci-compare/runs", v.dir, "summary.json"));
    if (!d) continue;
    const s = (d.variantStats || [])[0];
    if (!s) continue;
    rows.push({ ...v, stats: s, runs: d.runs || [] });
  }
  return rows;
}

async function loadScalingHard() {
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
  const variants = [
    { id: "M-bm25", queryset: "paper-core single", corpus: 79141, dir: "codex-routing-only-paper-single-hard-m-bm25-24-20260525", knownCost: 6.822 },
    { id: "J-bounded-v2", queryset: "paper-core single", corpus: 79141, dir: "codex-routing-only-paper-single-hard-j-v2-24-20260525", knownCost: 12.436 },
    { id: "M-bm25", queryset: "current 24 subset", corpus: 79141, dir: "codex-routing-only-m-bm25-skillrouter-hard-24-20260525", knownCost: 6.347 },
  ];
  const rows = [];
  for (const v of variants) {
    const d = await loadJson(join(ROOT, "experiments/dci-compare/runs", v.dir, "summary.json"));
    if (!d) continue;
    const s = (d.variantStats || [])[0];
    if (!s) continue;
    rows.push({ ...v, stats: s, runs: d.runs || [] });
  }
  return rows;
}

async function loadEasy78K() {
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

async function loadEasy78KTraces() {
  // traces-compact.json: { "claude-J-bounded-v2": { "<query>": {hit1, top1, top_k, gt, tier, steps: [...]}, ... }, ... }
  return await loadJson(join(ROOT, "experiments/skillrouter-easy/runs/traces-compact.json"));
}

async function loadAllVariants() {
  const result = { dciCompare: { claude: {}, codex: {} }, skillrouterEasy: { claude: {}, codex: {} } };
  // dci-compare variants (Claude path = routing-only/, Codex path = routing-only-codex/)
  const claudeVariantsDir = join(ROOT, "experiments/dci-compare/variants/routing-only");
  const codexVariantsDir = join(ROOT, "experiments/dci-compare/variants/routing-only-codex");
  for (const dir of [{ host: "claude", path: claudeVariantsDir }, { host: "codex", path: codexVariantsDir }]) {
    if (!existsSync(dir.path)) continue;
    const files = await readdir(dir.path);
    for (const f of files) {
      if (!f.endsWith(".SKILL.md")) continue;
      const id = f.replace(/\.SKILL\.md$/, "");
      result.dciCompare[dir.host][id] = await loadText(join(dir.path, f));
    }
  }
  // skillrouter-easy variants
  for (const host of ["claude", "codex"]) {
    const dir = join(ROOT, "experiments/skillrouter-easy/variants", host);
    if (!existsSync(dir)) continue;
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".SKILL.md")) continue;
      const id = f.replace(/\.SKILL\.md$/, "");
      result.skillrouterEasy[host][id] = await loadText(join(dir, f));
    }
  }
  return result;
}

// ---------- constants ----------

const PAPER_BASELINES_EASY = {
  "BM25 (nd, Easy)": 0.000,
  "Qwen3-Emb-0.6B (nd, Easy)": 0.227,
  "Qwen3-Emb-8B (nd, Easy)": 0.307,
  "BM25 (full body, Easy)": 0.347,
  "Qwen3-Emb-0.6B (full, Easy)": 0.587,
  "Qwen3-Emb-8B (full, Easy)": 0.653,
  "SR-Emb-0.6B (full, Easy)": 0.667,
  "SR-Emb × SR-Rank (full, A-Hit@1 avg)": 0.760,
};

const PAPER_BASELINES_HARD = {
  "BM25 (nd, Hard)": 0.000,
  "Qwen3-Emb-0.6B (nd, Hard)": 0.147,
  "Qwen3-Emb-8B (nd, Hard)": 0.200,
  "Qwen3-Emb-0.6B × GPT-5.4-mini (nd, Hard)": 0.293,
};

const KNOWN_COSTS_CODEX_9 = {
  "G-native": 1.816, "A-router": 4.485, "B-cc": 4.853, "C-lite": 3.594,
  "D-agentic": 2.870, "E-digest": 2.946, "H-bounded": 4.348, "I-meta": 3.310, "J-bounded": 2.415,
};

// ---------- styles + header ----------

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
    --slate: #475569;
  }
  body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1500px; margin: 0 auto; color: #111; background: #fafafa; }
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
  .note { background: #fffbeb; border-left: 3px solid #f59e0b; padding: 8px 12px; margin: 8px 0; font-size: 13px; color: #78350f; border-radius: 0 4px 4px 0; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 8px 0; }
  .panel { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
  .panel h3 { margin-top: 0; }
  details { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; margin: 6px 0; }
  details > summary { cursor: pointer; font-weight: 600; font-size: 13px; }
  code { background: #f1f5f9; padding: 0 4px; border-radius: 3px; font-size: 12px; }
  pre.code { background: #1e293b; color: #e2e8f0; padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: 11.5px; line-height: 1.5; max-height: 600px; }
  pre.code code { background: none; color: inherit; padding: 0; font-size: inherit; }
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
  .coverage-table td { text-align: center; }
  .coverage-yes { background: #d1fae5; color: #065f46; font-weight: 600; }
  .coverage-no { background: #fee2e2; color: #991b1b; }
  /* trace card layout */
  .trace-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 10px; margin-top: 8px; }
  .trace-card { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
  .trace-card .head { font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .tline { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; max-height: 280px; overflow-y: auto; }
  .tline .step { padding: 3px 0; border-bottom: 1px dashed #eee; }
  .tline .step:last-child { border-bottom: none; }
  .tline .name { font-weight: 600; color: #2563eb; }
  .tline .in { color: #6b7280; word-break: break-all; }
  .tline .out { color: #4b5563; margin-top: 2px; word-break: break-all; }
  .tline .txt { color: #111; background: #f0f0f0; padding: 3px 6px; border-radius: 3px; white-space: pre-wrap; word-break: break-all; }
</style>
</head><body>
<h1>Disabled-Skill Routing — All Experiments</h1>
<p class="intro">
  Single self-contained HTML covering every experiment in
  <code>REPORT-claudemd-optimized.md</code>. All sections, per-query matrices,
  execution traces, and variant SKILL.md implementations are inlined — no
  external file references. Organized by <b>dataset size</b> (150 → 1K → 79K Hard
  → 78K Easy 75-core), and within each size split by <b>host</b>
  (<span class="pill pill-claude">claude</span> vs <span class="pill pill-codex">codex</span>).
  Paper baselines (SkillRouter arXiv:2603.22455) shown as
  <span class="pill pill-paper">paper</span> rows where comparable.
</p>
`;
}

function renderToc() {
  return `<div class="toc">
  <b>Sections:</b>
  <ul>
    <li><a href="#coverage">0. Experiment coverage matrix</a> — what was run on which host</li>
    <li><a href="#small-claude">1. 150-skill × Claude Code</a> — 9 variants paired (with/without CLAUDE.md), per-query matrix included</li>
    <li><a href="#small-codex">2. 150-skill × Codex</a> — initial 9 + 7 follow-on iterations</li>
    <li><a href="#medium-codex">3. 1K synthetic × Codex</a> — L-agentic scale check (Codex only)</li>
    <li><a href="#hard-claude">4. 79K Hard × Claude Code</a> — J-bounded-v2 large-pool stress</li>
    <li><a href="#hard-codex">5. 79K Hard × Codex</a> — paper-core single + current-24 subset</li>
    <li><a href="#easy-claude">6.1 78K Easy × 75 core × Claude Code</a> — K / J-v2 / M-bm25 (§9)</li>
    <li><a href="#easy-codex">6.2 78K Easy × 75 core × Codex</a> — K / J-v2 / M-bm25 (§9)</li>
    <li><a href="#easy-compare">7. 78K Easy — cross-cell comparison &amp; paper baselines</a></li>
    <li><a href="#easy-traces">8. 78K Easy — per-query execution traces</a> (all 75 queries × 6 cells, inlined)</li>
    <li><a href="#variants">9. Variant implementations</a> — full SKILL.md for every variant used</li>
  </ul>
</div>`;
}

// ---------- Section 0: Coverage matrix ----------

function renderCoverage() {
  // Rows = variants, columns = (host, dataset)
  const rows = [
    { variant: "A-router", claude150: "✓", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "B-cc", claude150: "✓", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "C-lite", claude150: "✓", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "D-agentic", claude150: "✓", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "E-digest", claude150: "✓", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "G-native", claude150: "✓", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "H-bounded", claude150: "✓", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "I-meta", claude150: "✓", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "J-bounded (v1)", claude150: "✓", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "J-bounded-v2", claude150: "✓", claudeMedium: "—", claudeHard: "✓", claudeEasy: "✓", codex150: "—", codexMedium: "—", codexHard: "✓", codexEasy: "✓" },
    { variant: "K-bounded", claude150: "—", claudeMedium: "—", claudeHard: "—", claudeEasy: "✓", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "✓" },
    { variant: "K-lite (high)", claude150: "—", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "K-lite (fixed)", claude150: "—", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "—", codexHard: "—", codexEasy: "—" },
    { variant: "L-agentic", claude150: "—", claudeMedium: "—", claudeHard: "—", claudeEasy: "—", codex150: "✓", codexMedium: "✓", codexHard: "—", codexEasy: "—" },
    { variant: "M-bm25", claude150: "—", claudeMedium: "—", claudeHard: "—", claudeEasy: "✓", codex150: "✓", codexMedium: "—", codexHard: "✓✓", codexEasy: "✓" },
  ];
  const cell = (v) => {
    const cls = v.startsWith("✓") ? "coverage-yes" : "coverage-no";
    return `<td class="${cls}">${v}</td>`;
  };
  let tbody = "";
  for (const r of rows) {
    tbody += `<tr>
      <td><b>${escapeHtml(r.variant)}</b></td>
      ${cell(r.claude150)}${cell(r.claudeMedium)}${cell(r.claudeHard)}${cell(r.claudeEasy)}
      ${cell(r.codex150)}${cell(r.codexMedium)}${cell(r.codexHard)}${cell(r.codexEasy)}
    </tr>`;
  }
  return `<h2 id="coverage">0. Experiment coverage matrix</h2>
<p class="intro">
  Which (variant × host × dataset-size) combinations were actually executed.
  <b>✓</b> = single run available, <b>✓✓</b> = multiple variations or query sets run.
  This makes the "Claude has fewer follow-on variants than Codex" asymmetry explicit:
  K/K-lite/L were only run on Codex at 150-skill; 1K synthetic was Codex-only;
  Claude got K/J-v2/M only at 78K Easy in §9.
</p>
<table class="coverage-table">
  <thead>
    <tr>
      <th rowspan="2">Variant</th>
      <th colspan="4"><span class="pill pill-claude">Claude Code</span></th>
      <th colspan="4"><span class="pill pill-codex">Codex</span></th>
    </tr>
    <tr>
      <th>150</th><th>1K</th><th>79K Hard</th><th>78K Easy</th>
      <th>150</th><th>1K</th><th>79K Hard</th><th>78K Easy</th>
    </tr>
  </thead>
  <tbody>${tbody}</tbody>
</table>
<div class="note">
  <b>Asymmetry note:</b> The Codex experiments include 7 follow-on iterations (D-metadata, K, K-lite high+fixed, L, L-1K, M) that were never run on Claude Code at 150-skill scale.
  Claude Code coverage at large scale comes only from §9 (78K Easy × K/J-v2/M-bm25) and §8 (79K Hard × J-v2).
  Backfilling these gaps would require ~15 hours of additional Claude runtime per variant and is listed as
  follow-up work in <code>REPORT-claudemd-optimized.md</code> §12.
</div>
`;
}

// ---------- Section 1: Claude paired ----------

function renderClaudePaired(data) {
  if (!data) return "";
  const rows = data.metrics.rows;
  const variants = [...new Set(rows.map(r => r.variant))];
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

  // Per-query matrix
  const variantsInOrder = Object.keys(data.perQuery);
  const queries = data.perQuery[variantsInOrder[0]]?.map(r => r.qid) || [];
  let matrixHeadW = `<tr><th>Query</th>` + variantsInOrder.map(v => `<th class="num">${escapeHtml(v)}</th>`).join("") + `</tr>`;
  let matrixBodyW = "";
  for (let qi = 0; qi < queries.length; qi++) {
    const qid = queries[qi];
    let cells = "";
    for (const v of variantsInOrder) {
      const row = data.perQuery[v][qi];
      if (!row || !row.with) { cells += `<td class="num gray">—</td>`; continue; }
      const cls = row.with.hit ? "hit" : "miss";
      const sym = row.with.hit ? "✓" : "✗";
      cells += `<td class="num ${cls}">${sym} ${escapeHtml(row.with.matched)}</td>`;
    }
    matrixBodyW += `<tr class="matrix-row"><td><code>${escapeHtml(qid)}</code></td>${cells}</tr>`;
  }
  let matrixBodyWo = "";
  for (let qi = 0; qi < queries.length; qi++) {
    const qid = queries[qi];
    let cells = "";
    for (const v of variantsInOrder) {
      const row = data.perQuery[v][qi];
      if (!row || !row.without) { cells += `<td class="num gray">—</td>`; continue; }
      const cls = row.without.hit ? "hit" : "miss";
      const sym = row.without.hit ? "✓" : "✗";
      cells += `<td class="num ${cls}">${sym} ${escapeHtml(row.without.matched)}</td>`;
    }
    matrixBodyWo += `<tr class="matrix-row"><td><code>${escapeHtml(qid)}</code></td>${cells}</tr>`;
  }

  return `<h2 id="small-claude">1. 150-skill × Claude Code <span class="pill pill-claude">claude</span></h2>
<p class="intro">
  Paired experiment: each (variant, condition) gets an isolated HOME and runs all 24 SkillsBench
  single-skill queries. <b>with-CLAUDE.md</b> injects a 5-line user-message context block telling
  the agent to call <code>skill-router-skills</code> when no enabled skill matches.
</p>
<div class="takeaway">
  <b>Headline:</b> CLAUDE.md injection lifts accuracy +18pp on average across 7 comparable router
  variants. B-cc / C-lite reach 23/24 (95.8%). J-bounded is the lowest-cost router in the 22/24
  group ($3.07, 30.7K avg ctx). A-router is the only router below G-native (62.5%).
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
<div class="footnote">Acc / Trigger denominators are 24. Δ acc = with − without (pp). Wall + cost summed across 24 queries.</div>

<details open>
  <summary>1.1 Per-query matrix — with CLAUDE.md (24 queries × ${variantsInOrder.length} variants)</summary>
  <table style="font-size:11.5px">
    <thead>${matrixHeadW}</thead>
    <tbody>${matrixBodyW}</tbody>
  </table>
</details>

<details>
  <summary>1.2 Per-query matrix — without CLAUDE.md (24 queries × ${variantsInOrder.length} variants)</summary>
  <table style="font-size:11.5px">
    <thead>${matrixHeadW}</thead>
    <tbody>${matrixBodyWo}</tbody>
  </table>
</details>

<div class="note">
  <b>No per-query tool traces available for §1.</b> The Claude paired experiment only persisted
  aggregate metrics and matched-skill outcomes; raw JSONL transcripts were not saved per-query.
  See §8 (Easy 78K) for the only experiment with full tool-call traces.
</div>
`;
}

// ---------- Section 2: Codex small + extensions ----------

function renderCodexSmall(d9, ext) {
  if (!d9) return "";
  const stats = d9.variantStats || [];
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
      <td class="num">${dollars(KNOWN_COSTS_CODEX_9[s.variant])}</td>
    </tr>`;
  }
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
      <td class="num">${dollars(e.knownCost)}</td>
    </tr>`;
  }

  // Per-query matrix (initial 9 + ext 150-skill variants share same 24 queries)
  const runs = d9.runs || [];
  const variants9 = [...new Set(runs.map(r => r.variant))];
  const queries9 = [...new Set(runs.map(r => r.queryId))].sort();
  const byKey = new Map();
  for (const r of runs) byKey.set(`${r.variant}::${r.queryId}`, r);
  // Also include ext at 150-skill
  for (const e of (ext || [])) {
    if (e.corpus !== 150) continue;
    for (const r of e.runs) byKey.set(`${e.id}::${r.queryId}`, r);
  }
  const extVariants150 = (ext || []).filter(e => e.corpus === 150).map(e => e.id);
  const allVariants = [...variants9, ...extVariants150];

  let matrixHead = `<tr><th>Query</th><th>Expected</th>` + allVariants.map(v => `<th class="num">${escapeHtml(v)}</th>`).join("") + `</tr>`;
  let matrixBody = "";
  for (const q of queries9) {
    const expected = byKey.get(`${allVariants[0]}::${q}`)?.expected || "—";
    let cells = "";
    for (const v of allVariants) {
      const r = byKey.get(`${v}::${q}`);
      if (!r) { cells += `<td class="num gray">—</td>`; continue; }
      const hit = r.matched === r.expected;
      const cls = hit ? "hit" : "miss";
      const sym = hit ? "✓" : "✗";
      cells += `<td class="num ${cls}">${sym} ${escapeHtml(r.matched || "no-match")}</td>`;
    }
    matrixBody += `<tr class="matrix-row"><td><code>${escapeHtml(q)}</code></td><td><code>${escapeHtml(expected)}</code></td>${cells}</tr>`;
  }

  return `<h2 id="small-codex">2. 150-skill × Codex <span class="pill pill-codex">codex</span></h2>
<p class="intro">
  Same 24-query / 150-skill corpus as §1, run on <code>codex exec</code> (model gpt-5.5,
  reasoning effort high). Codex native G-native scores 24/24 vs Claude native 15/24 — largest
  host-driven gap in the report.
</p>
<div class="takeaway">
  <b>Headline:</b> Codex G-native + D-agentic both 24/24. C-lite / E-digest / H-bounded reach 23/24.
  All follow-on iterations (K, K-lite fixed, L, M) also reach 24/24 — the 150 corpus cannot rank
  them further. L-agentic scales to 1K with only 1 miss.
</div>
<h3>2.1 Initial 9 variants (A–J) at 150-skill</h3>
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
<div class="footnote">Cost est. uses gpt-5.5 standard list price (2026-05-24) per §5 of the markdown report.</div>

<details>
  <summary>2.3 Per-query matrix (${allVariants.length} variants × 24 queries, all at 150-skill)</summary>
  <table style="font-size:11px">
    <thead>${matrixHead}</thead>
    <tbody>${matrixBody}</tbody>
  </table>
</details>
`;
}

// ---------- Section 3: 1K (Codex L) ----------

function renderMediumCodex(ext) {
  if (!ext) return "";
  const onek = ext.find(e => e.id === "L-agentic (1K)");
  const baseline150 = ext.find(e => e.id === "L-agentic");
  if (!onek || !baseline150) return "";
  // Per-query
  const queries = [...new Set([...baseline150.runs, ...onek.runs].map(r => r.queryId))].sort();
  let body = "";
  for (const q of queries) {
    const r150 = baseline150.runs.find(r => r.queryId === q);
    const r1k = onek.runs.find(r => r.queryId === q);
    const expected = r150?.expected || r1k?.expected || "—";
    const fmtCell = r => {
      if (!r) return `<td class="num gray">—</td>`;
      const hit = r.matched === r.expected;
      return `<td class="num ${hit ? "hit" : "miss"}">${hit ? "✓" : "✗"} ${escapeHtml(r.matched || "no-match")}</td>`;
    };
    body += `<tr class="matrix-row"><td><code>${escapeHtml(q)}</code></td><td><code>${escapeHtml(expected)}</code></td>${fmtCell(r150)}${fmtCell(r1k)}</tr>`;
  }
  return `<h2 id="medium-codex">3. 1K synthetic × Codex <span class="pill pill-codex">codex</span></h2>
<p class="intro">
  L-agentic (CLI-driven <code>corpus search/inspect</code> + structured candidates) is the only
  variant scaled past 150. The 1K corpus = 150-skill comparison set + 850 synthetic noise skills.
  This validates that L's CLI abstraction handles ~7× the candidate pool without prompt blowup.
</p>
<div class="note"><b>No Claude Code equivalent.</b> L-agentic was never ported to Claude or run at 1K scale on Claude.</div>
<table>
  <thead><tr><th>Corpus</th><th class="num">Accuracy</th><th class="num">Trigger</th><th class="num">Wall</th><th class="num">In tokens</th><th class="num">Out tokens</th><th class="num">Reasoning</th><th class="num">Cost est.</th></tr></thead>
  <tbody>
    <tr>
      <td><b>L-agentic × 150-skill</b></td>
      <td class="num hit">${baseline150.stats.correct}/${baseline150.stats.n} (${pct(baseline150.stats.correct / baseline150.stats.n)})</td>
      <td class="num">${baseline150.stats.routerTriggered != null ? `${baseline150.stats.routerTriggered}/${baseline150.stats.n}` : "n/a"}</td>
      <td class="num">${secs(baseline150.stats.totalDurMs)}</td>
      <td class="num">${num(baseline150.stats.totalTokensIn / 1000, 1)}k</td>
      <td class="num">${num(baseline150.stats.totalTokensOut)}</td>
      <td class="num">${num(baseline150.stats.totalReasoning || 0)}</td>
      <td class="num">${dollars(baseline150.knownCost)}</td>
    </tr>
    <tr>
      <td><b>L-agentic × 1K synthetic</b></td>
      <td class="num mid">${onek.stats.correct}/${onek.stats.n} (${pct(onek.stats.correct / onek.stats.n)})</td>
      <td class="num">${onek.stats.routerTriggered != null ? `${onek.stats.routerTriggered}/${onek.stats.n}` : "n/a"}</td>
      <td class="num">${secs(onek.stats.totalDurMs)}</td>
      <td class="num">${num(onek.stats.totalTokensIn / 1000, 1)}k</td>
      <td class="num">${num(onek.stats.totalTokensOut)}</td>
      <td class="num">${num(onek.stats.totalReasoning || 0)}</td>
      <td class="num">${dollars(onek.knownCost)}</td>
    </tr>
  </tbody>
</table>
<div class="footnote">1K miss: <code>pptx-reference-formatting</code> → <code>skill-103</code>. Avg ctx<sub>end</sub> only grows 17.5K → 17.9K, confirming CLI pagination prevents prompt blowup.</div>

<details>
  <summary>3.1 Per-query matrix (L-agentic 150 vs 1K, 24 queries)</summary>
  <table style="font-size:11.5px">
    <thead><tr><th>Query</th><th>Expected</th><th class="num">L-agentic × 150</th><th class="num">L-agentic × 1K</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
</details>
`;
}

// ---------- Section 4: Claude 79K Hard scaling ----------

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

  // Per-query for each cell
  let detailsHtml = "";
  for (const c of scaling) {
    const queries = Object.keys(c.cells || {}).sort();
    if (!queries.length) continue;
    let body = "";
    for (const q of queries) {
      const cell = c.cells[q];
      const cls = cell.correct ? "hit" : "miss";
      const sym = cell.correct ? "✓" : "✗";
      body += `<tr class="matrix-row">
        <td><code>${escapeHtml(q)}</code></td>
        <td class="num ${cls}">${sym} ${escapeHtml(cell.matched || "no-match")}</td>
        <td class="num">${cell.numTurns ?? "—"}</td>
        <td class="num">${secs(cell.durationMs)}</td>
        <td class="num">${dollars(cell.cost)}</td>
        <td class="num">${num((cell.endCtx || 0) / 1000, 1)}k</td>
        <td class="num">${cell.bashCalls ?? "—"}</td>
      </tr>`;
    }
    detailsHtml += `<details>
      <summary>${escapeHtml(c.label)} — per-query (${queries.length})</summary>
      <table style="font-size:11.5px">
        <thead><tr><th>Query</th><th class="num">Matched</th><th class="num">Turns</th><th class="num">Duration</th><th class="num">Cost</th><th class="num">End ctx</th><th class="num">Bash calls</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </details>`;
  }

  return `<h2 id="hard-claude">4. 79K Hard × Claude Code <span class="pill pill-claude">claude</span></h2>
<p class="intro">
  J-bounded-v2 scaling from 150 to 79,141 Hard pool. v2 fixes v1's shell glob ARG_MAX overflow
  and removes head-20 truncation. Same 24 SkillsBench queries; bounded payload, cost only +35%,
  accuracy drops from 22/24 to 12/24.
</p>
<div class="takeaway">
  <b>Headline:</b> J-bounded-v2 is mechanically stable at 79K (bounded ctx, no timeouts) but
  accuracy collapses from 91.7% → 50.0%. Metadata-only cannot serve as the sole decision source
  at this scale — body-on-tie / full-text rerank is required.
</div>
<table>
  <thead><tr><th>Cell</th><th class="num">Accuracy</th><th class="num">Trigger</th><th class="num">Wall</th><th class="num">Cost</th><th class="num">Avg ctx<sub>end</sub></th><th class="num">Turns</th><th class="num">Timeouts</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${detailsHtml}
`;
}

// ---------- Section 5: Codex 79K Hard ----------

function renderHardCodex(rows) {
  if (!rows || !rows.length) return "";
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
      <td class="num">${dollars(r.knownCost)}</td>
    </tr>`;
  }
  // Per-query for each cell
  let detailsHtml = "";
  for (const r of rows) {
    const runs = r.runs || [];
    if (!runs.length) continue;
    let body = "";
    for (const run of runs) {
      const hit = run.matched === run.expected;
      const cls = hit ? "hit" : "miss";
      body += `<tr class="matrix-row">
        <td><code>${escapeHtml(run.queryId)}</code></td>
        <td><code>${escapeHtml(run.expected || "—")}</code></td>
        <td class="num ${cls}">${hit ? "✓" : "✗"} ${escapeHtml(run.matched || "no-match")}</td>
        <td class="num">${secs(run.durationMs)}</td>
        <td class="num">${num((run.usage?.input_tokens || 0) / 1000, 1)}k</td>
        <td class="num">${run.usage?.output_tokens ?? "—"}</td>
      </tr>`;
    }
    detailsHtml += `<details>
      <summary>${escapeHtml(r.id)} × ${escapeHtml(r.queryset)} — per-query (${runs.length})</summary>
      <table style="font-size:11.5px">
        <thead><tr><th>Query</th><th>Expected</th><th class="num">Matched</th><th class="num">Duration</th><th class="num">In tokens</th><th class="num">Out tokens</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </details>`;
  }
  return `<h2 id="hard-codex">5. 79K Hard × Codex <span class="pill pill-codex">codex</span></h2>
<p class="intro">
  Codex M-bm25 and J-bounded-v2 against the full 79,141-skill Hard pool on two query sets:
  paper-core single (24 single-skill queries from SkillRouter <code>relevance.json</code>) and
  the original current-24 subset. J-v2 has 3 outputs in raw <code>name:</code> form rather than
  opaque <code>sr-*</code> ids; strict counts as misses, alias-normalized → 14/24.
</p>
<div class="takeaway">
  <b>Headline:</b> M-bm25 reaches 58.3% on paper-core single Hard, beating BM25-nd (0%) and
  Qwen3-Emb-8B-nd (20.0%), but below full-body SR pipeline (~73%). Hard runs cost $6-12 and
  16-50 min — much more expensive than 150-skill runs.
</div>
<table>
  <thead><tr><th>Variant / Query set</th><th class="num">Accuracy</th><th class="num">Trigger</th><th class="num">Wall</th><th class="num">In tokens</th><th class="num">Out tokens</th><th class="num">Reasoning</th><th class="num">Cost est.</th></tr></thead>
  <tbody>${tbody}</tbody>
</table>
${detailsHtml}
`;
}

// ---------- Section 6: Easy 78K per host ----------

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

// ---------- Section 7: Easy cross-cell + paper ----------

function renderEasyCompare(easyRows) {
  const all = easyRows.map(r => ({ key: `${r.host}/${r.variant}`, host: r.host, rate: r.summary.hit1_rate, hit: r.summary.hit1, n: r.summary.queries }));
  all.sort((a, b) => b.rate - a.rate);
  const maxRate = Math.max(...all.map(a => a.rate), ...Object.values(PAPER_BASELINES_EASY));

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
  for (const [name, rate] of Object.entries(PAPER_BASELINES_EASY)) {
    const w = ((rate / maxRate) * 100).toFixed(1);
    paperRows += `<tr>
      <td><span class="pill pill-paper">paper</span> ${escapeHtml(name)}</td>
      <td class="num">${pct(rate)}</td>
      <td><div class="bar-wrap"><div class="bar-fill paper" style="width:${w}%"></div></div></td>
    </tr>`;
  }

  const byVariant = new Map(), byHost = new Map();
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

  // Per-query matrix
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
  baseline (Qwen3-Emb-8B 30.7%) by +9.3pp, and beats BM25 with full body (34.7%). 6/6 cells beat
  BM25 nd, 4/6 beat Qwen3-Emb-0.6B nd, 3/6 beat Qwen3-Emb-8B nd. Remaining 25-36pp gap to
  full-body SR-pipeline (74-76%) is structural (no body access).
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
  <summary>7.1 Per-query matrix (75 queries × 6 cells)</summary>
  <p class="footnote">Leading badge: <span class="hit">✓6</span> = all 6 cells hit, <span class="miss">✗0</span> = all miss, <span class="mid">N/6</span> = partial.</p>
  <table style="font-size:11px">
    <thead>${matrixHead}</thead>
    <tbody>${matrixBody}</tbody>
  </table>
</details>
`;
}

// ---------- Section 8: Easy 78K traces (inlined) ----------

function renderTraceSteps(steps) {
  if (!steps || !steps.length) return `<div class="gray" style="font-size:10.5px">(no tool calls recorded)</div>`;
  return steps.map(s => {
    if (s.output_text != null) {
      return `<div class="step"><div class="txt">${escapeHtml(truncate(s.output_text, 280))}</div></div>`;
    }
    const inHtml = escapeHtml(truncate(s.input || "", 220));
    const outHtml = s.result ? escapeHtml(truncate(s.result, 220)) : "";
    return `<div class="step">
      <div><span class="name">${escapeHtml(s.tool || "?")}</span>: <span class="in">${inHtml}</span></div>
      ${outHtml ? `<div class="out">${outHtml}</div>` : ""}
    </div>`;
  }).join("");
}

function renderEasyTraces(easyRows, traces) {
  if (!traces) return `<h2 id="easy-traces">8. 78K Easy — per-query execution traces</h2>
<div class="note">traces-compact.json not found. Run <code>node experiments/skillrouter-easy/extract-traces.mjs</code> first.</div>`;

  // Per-query: 6 cards (one per cell)
  const cellKeys = easyRows.map(r => `${r.host}/${r.variant}`);
  const allQids = new Set();
  const queryMeta = {};
  for (const r of easyRows) {
    for (const res of r.summary.results || []) {
      allQids.add(res.query_id);
      if (!queryMeta[res.query_id]) queryMeta[res.query_id] = { tier: res.tier, gt: res.expected_anon };
    }
  }
  const qids = [...allQids].sort();

  let body = "";
  for (const qid of qids) {
    const meta = queryMeta[qid];
    const gtStr = meta.gt.length === 1 ? meta.gt[0] : `${meta.gt.length} skills`;
    const hitCount = cellKeys.filter(k => {
      const cellName = k.replace("/", "-");
      return traces[cellName]?.[qid]?.hit1;
    }).length;
    const hitLbl = hitCount === 6 ? "✓6" : hitCount === 0 ? "✗0" : `${hitCount}/6`;
    const hitCls = hitCount === 6 ? "hit" : hitCount === 0 ? "miss" : "mid";

    let cards = "";
    for (const k of cellKeys) {
      const [host] = k.split("/");
      const cellName = k.replace("/", "-");
      const trace = traces[cellName]?.[qid];
      if (!trace) {
        cards += `<div class="trace-card"><div class="head"><span class="pill pill-${host}">${escapeHtml(k)}</span> <span class="gray">no trace</span></div></div>`;
        continue;
      }
      const stepCount = (trace.steps || []).filter(s => s.tool).length;
      const cls = trace.hit1 ? "hit" : "miss";
      const sym = trace.hit1 ? "✓" : "✗";
      cards += `<div class="trace-card">
        <div class="head">
          <span class="pill pill-${host}">${escapeHtml(k)}</span>
          <span class="${cls}">${sym} ${escapeHtml(trace.top1 || "?")}</span>
        </div>
        <div style="font-size:11px;color:#6b7280;margin-bottom:4px">tool calls: ${stepCount}</div>
        <div class="tline">${renderTraceSteps(trace.steps)}</div>
      </div>`;
    }
    body += `<details>
      <summary><code>${escapeHtml(qid)}</code> — <code>${escapeHtml(gtStr)}</code> [${meta.tier}] <span class="${hitCls}" style="margin-left:6px">${hitLbl}</span></summary>
      <div class="trace-grid">${cards}</div>
    </details>\n`;
  }

  return `<h2 id="easy-traces">8. 78K Easy — per-query execution traces</h2>
<p class="intro">
  Full tool-call chain for all 75 queries × 6 cells (450 cards). Each card shows the agent's
  tool sequence (Bash / Skill) with truncated input/output snippets. Click a query to expand.
</p>
<div class="note">
  Only §9 (Easy 78K) has per-query execution traces — the earlier 150-skill / 79K Hard
  experiments persisted only aggregate metrics, not raw transcripts. Traces below are extracted
  from <code>runs/&lt;host&gt;-&lt;variant&gt;/&lt;query&gt;.jsonl</code> stream-json transcripts.
</div>
${body}`;
}

// ---------- Section 9: Variant implementations ----------

function renderVariants(variants) {
  if (!variants) return "";
  let body = "";

  // dci-compare 150-skill variants (12 each for Claude / Codex)
  body += `<h3>9.1 dci-compare variants (used in §1, §2, §3)</h3>`;
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

  // skillrouter-easy variants (3 each for Claude / Codex)
  body += `<h3>9.2 skillrouter-easy variants (used in §6-§8)</h3>`;
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

  return `<h2 id="variants">9. Variant implementations</h2>
<p class="intro">
  Full <code>SKILL.md</code> for every variant used across the experiments.
  Variants are patched into the installed <code>agentic-skill-router-skills</code> slot per cell.
  Frontmatter is shared across variants; the body workflow is what differs.
</p>
${body}`;
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  let outPath = join(__dirname, "runs/report-all-experiments.html");
  for (const a of args) {
    if (a.startsWith("--out=")) outPath = a.slice(6);
  }

  console.error("Loading data...");
  const [claudePaired, codexSmall, codexExt, scalingHard, codexHard, easy, easyTraces, variants] = await Promise.all([
    loadClaudePaired(),
    loadCodexSmall(),
    loadCodexExtensions(),
    loadScalingHard(),
    loadCodexHard(),
    loadEasy78K(),
    loadEasy78KTraces(),
    loadAllVariants(),
  ]);

  console.error(`Loaded: claudePaired=${claudePaired ? "ok" : "MISSING"}, codexSmall=${codexSmall ? "ok" : "MISSING"}, codexExt=${codexExt?.length || 0}, scalingHard=${scalingHard?.length || 0}, codexHard=${codexHard?.length || 0}, easy=${easy?.length || 0}, easyTraces=${easyTraces ? Object.keys(easyTraces).length : 0} cells, variants={dci:${Object.keys(variants?.dciCompare?.claude || {}).length + Object.keys(variants?.dciCompare?.codex || {}).length}, easy:${Object.keys(variants?.skillrouterEasy?.claude || {}).length + Object.keys(variants?.skillrouterEasy?.codex || {}).length}}`);

  const html = [
    renderHeader(),
    renderToc(),
    renderCoverage(),
    renderClaudePaired(claudePaired),
    renderCodexSmall(codexSmall, codexExt),
    renderMediumCodex(codexExt),
    renderHardClaude(scalingHard),
    renderHardCodex(codexHard),
    renderEasyHost("claude", easy),
    renderEasyHost("codex", easy),
    renderEasyCompare(easy),
    renderEasyTraces(easy, easyTraces),
    renderVariants(variants),
    "</body></html>",
  ].join("\n");

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html);
  console.error(`Wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e.stack ?? e.message); process.exit(1); });
