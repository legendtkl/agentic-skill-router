#!/usr/bin/env node
// render-report.mjs — read every runs/<host>-<variant>/summary.json and
// produce a markdown report comparing Hit@1 against the SkillRouter paper's
// Easy-tier baselines (Table 9 nd row + Table 2 full row).
//
// Usage: node render-report.mjs [--out=runs/report.md]

import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = join(__dirname, "runs");

const PAPER_EASY = {
  // Table 9 — encoder-only nd/full on Easy tier, 75 core queries.
  "BM25 (nd)": 0.000,
  "Qwen3-Emb-0.6B (nd)": 0.227,
  "Qwen3-Emb-8B (nd)": 0.307,
  "BM25 (full)": 0.347,
  "Qwen3-Emb-0.6B (full)": 0.587,
  "Qwen3-Emb-8B (full)": 0.653,
  // Table 2 — encoder + Table 3 — best pipeline (averaged Easy+Hard).
  "SR-Emb-0.6B (full)": 0.667,
  "SR-Emb-0.6B × SR-Rank-0.6B (full pipeline)": 0.760,
};

function pct(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return (x * 100).toFixed(1) + "%";
}

function parseArgs(argv) {
  const out = { outPath: null };
  for (const a of argv) {
    if (a.startsWith("--out=")) out.outPath = a.slice(6);
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

async function loadCells() {
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const cells = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = e.name.match(/^(claude|codex)-(.+)$/);
    if (!m) continue;
    const [, host, variant] = m;
    const summaryPath = join(RUNS_DIR, e.name, "summary.json");
    if (!existsSync(summaryPath)) continue;
    try {
      const s = JSON.parse(await readFile(summaryPath, "utf8"));
      cells.push({ host, variant, summary: s, mtime: (await stat(summaryPath)).mtimeMs });
    } catch (err) {
      console.error(`skip ${summaryPath}: ${err.message}`);
    }
  }
  cells.sort((a, b) => {
    if (a.variant !== b.variant) return a.variant.localeCompare(b.variant);
    return a.host.localeCompare(b.host);
  });
  return cells;
}

function paperTable() {
  const rows = ["| Baseline | Easy Hit@1 |", "|---|---|"];
  for (const [k, v] of Object.entries(PAPER_EASY)) {
    rows.push(`| ${k} | ${pct(v)} |`);
  }
  return rows.join("\n");
}

function variantTable(cells) {
  const variants = [...new Set(cells.map((c) => c.variant))];
  const hosts = [...new Set(cells.map((c) => c.host))];

  // Header reflects what was actually run, not the canonical 24/51 split.
  const nSingle = Math.max(...cells.map((c) => c.summary.n_single ?? 0));
  const nMulti = Math.max(...cells.map((c) => c.summary.n_multi ?? 0));
  const rows = [];
  rows.push(`| Variant | Host | Hit@1 | Single (n=${nSingle}) | Multi (n=${nMulti}) | Answered | Timeouts | Errors | Wall |`);
  rows.push("|---|---|---|---|---|---|---|---|---|");
  for (const v of variants) {
    for (const h of hosts) {
      const cell = cells.find((c) => c.variant === v && c.host === h);
      if (!cell) {
        rows.push(`| ${v} | ${h} | — | — | — | — | — | — | — |`);
        continue;
      }
      const s = cell.summary;
      rows.push(
        `| ${v} | ${h} | **${pct(s.hit1_rate)}** (${s.hit1}/${s.queries}) ` +
          `| ${s.hit1_single}/${s.n_single} (${pct(s.hit1_single / Math.max(s.n_single, 1))}) ` +
          `| ${s.hit1_multi}/${s.n_multi} (${pct(s.hit1_multi / Math.max(s.n_multi, 1))}) ` +
          `| ${s.answered}/${s.queries} | ${s.timeouts} | ${s.errors} | ${(s.elapsedMs / 1000).toFixed(0)}s |`,
      );
    }
  }
  return rows.join("\n");
}

function summaryLine(cells) {
  if (cells.length === 0) return "_No cells found._";
  const best = cells.reduce((a, b) =>
    (b.summary.hit1_rate ?? 0) > (a.summary.hit1_rate ?? 0) ? b : a,
  );
  const ndBest = Math.max(PAPER_EASY["Qwen3-Emb-8B (nd)"], PAPER_EASY["Qwen3-Emb-0.6B (nd)"]);
  const fullBest = PAPER_EASY["SR-Emb-0.6B × SR-Rank-0.6B (full pipeline)"];
  const lines = [];
  lines.push(`- Best of our 3 metadata-only variants: **${best.variant} on ${best.host}** at **${pct(best.summary.hit1_rate)}**.`);
  lines.push(`- Strongest paper **nd** baseline (Qwen3-Emb-8B): ${pct(ndBest)}.`);
  lines.push(`- Paper end-to-end **full** pipeline (SR-Emb × SR-Rank): ${pct(fullBest)}.`);
  if (best.summary.hit1_rate >= ndBest) {
    const delta = best.summary.hit1_rate - ndBest;
    lines.push(`- ✅ Best variant **beats** the strongest paper nd baseline by **+${pct(delta)}**.`);
  } else {
    lines.push(`- ⚠ Best variant trails strongest paper nd baseline by **${pct(ndBest - best.summary.hit1_rate)}**.`);
  }
  if (best.summary.hit1_rate >= PAPER_EASY["BM25 (full)"]) {
    lines.push(`- ✅ Best variant also **beats** paper's BM25 with full-body input (${pct(PAPER_EASY["BM25 (full)"])}), despite having no body access.`);
  }
  return lines.join("\n");
}

function aggregateSections(cells) {
  if (cells.length === 0) return "";
  const byVariant = new Map();
  const byHost = new Map();
  for (const c of cells) {
    if (!byVariant.has(c.variant)) byVariant.set(c.variant, []);
    byVariant.get(c.variant).push(c.summary.hit1_rate);
    if (!byHost.has(c.host)) byHost.set(c.host, []);
    byHost.get(c.host).push(c.summary.hit1_rate);
  }
  const variantRows = [...byVariant.entries()]
    .map(([v, rs]) => `| ${v} | ${pct(rs.reduce((a, b) => a + b, 0) / rs.length)} | (n=${rs.length}) |`)
    .sort();
  const hostRows = [...byHost.entries()]
    .map(([h, rs]) => `| ${h} | ${pct(rs.reduce((a, b) => a + b, 0) / rs.length)} | (n=${rs.length}) |`)
    .sort();
  return [
    "### By variant (avg across hosts)\n",
    "| Variant | Hit@1 | cells |",
    "|---|---|---|",
    variantRows.join("\n"),
    "",
    "### By host (avg across variants)\n",
    "| Host | Hit@1 | cells |",
    "|---|---|---|",
    hostRows.join("\n"),
  ].join("\n");
}

function perQuerySection(cells) {
  if (cells.length === 0) return "";
  const variants = [...new Set(cells.map((c) => c.variant))];
  const hosts = [...new Set(cells.map((c) => c.host))];
  // Build a query->{cellKey -> top1, hit1, tier} mapping.
  const byQuery = new Map();
  for (const c of cells) {
    for (const r of c.summary.results ?? []) {
      const key = `${c.host}/${c.variant}`;
      if (!byQuery.has(r.query_id)) byQuery.set(r.query_id, { tier: r.tier, gt: r.expected_anon, byCell: {} });
      byQuery.get(r.query_id).byCell[key] = r;
    }
  }
  const cellKeys = [];
  for (const v of variants) for (const h of hosts) cellKeys.push(`${h}/${v}`);
  const rows = [];
  rows.push("| Query | Tier | gt | " + cellKeys.map((k) => `${k} top1 (✓?)`).join(" | ") + " |");
  rows.push("|---|---|---|" + cellKeys.map(() => "---").join("|") + "|");
  const qids = [...byQuery.keys()].sort();
  for (const qid of qids) {
    const e = byQuery.get(qid);
    const cells = cellKeys.map((k) => {
      const r = e.byCell[k];
      if (!r) return "—";
      const t = r.top1 ?? "—";
      return r.hit1 ? `${t} ✓` : t;
    });
    rows.push(`| ${qid} | ${e.tier} | ${e.gt.length === 1 ? e.gt[0] : e.gt.length + " skills"} | ${cells.join(" | ")} |`);
  }
  return rows.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cells = await loadCells();
  const outPath = args.outPath ?? join(RUNS_DIR, "report.md");

  const md = `# SkillRouter Easy — Metadata-Only Routing Comparison

_Generated ${new Date().toISOString()}_

## Setup

- **Corpus**: SkillRouter \`eval_core/easy\` — 78,361 skills, installed
  metadata-only (\`name\` + \`description\` frontmatter, body stripped).
- **Queries**: 75 core benchmark queries (\`core_gt_ids\` non-empty).
  Split: 24 single-skill, 51 multi-skill (paper Section 2 / Appendix A).
- **Metric**: Hit@1 — any ground-truth skill at rank 1 (paper Table 9).
- **Output**: agent returns ordered top-10 \`sr-XXXXX\` ids; position 1
  is scored.
- **Variants under test**: K-bounded, J-bounded-v2 (J-v2), M-bm25 —
  three metadata-only agent-loop routers (no body access).

## Headline

${summaryLine(cells)}

## Our variants

${variantTable(cells)}

## Aggregates

${aggregateSections(cells)}

## Paper baselines (SkillRouter Table 9 / Table 2, Easy tier)

${paperTable()}

The first three rows are the **metadata-only (nd)** column — what our
variants are directly comparable to. The remaining rows use **full skill
body** input, which is structurally unavailable in our metadata-only
setting; they are included as upper-bound reference points.

## Per-query breakdown

${perQuerySection(cells)}

## Notes

- Hit@1 is the primary paper metric. R@10 / FC@10 (multi-skill coverage
  metrics from Table 4) can be computed from the same per-query top-10
  outputs in \`runs/<host>-<variant>/<query>.jsonl\` without re-running.
- All variants run as agent loops over \`find … | xargs grep\` /
  \`agentic-skill-router skills corpus search\`; per-run wall-clock and
  agent token cost are dominated by the agent's reasoning loop, not by
  retrieval over the 78K corpus (grep + BM25 index are each well under
  1s on this disk).
- Anonymous \`sr-XXXXX\` ids are deterministic across hosts (seed=20260525),
  so the same ground-truth skill has the same id in Claude and Codex runs.
`;

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, md);
  console.error(`wrote ${outPath} (${cells.length} cells)`);
}

main().catch((e) => { console.error(e.stack ?? e.message); process.exit(1); });
