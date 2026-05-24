#!/usr/bin/env node
// Aggregate sweep cells into a single markdown report.
//
// Reads runs/sweep-<query>/summary.<variant>.<scale>.<query>.json (one per cell),
// produces runs/sweep-<query>/report.md.
//
// Usage:
//   node render-sweep.mjs [--query-id=3d-scan-calc]

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const RUN_DIR = join(__dirname, "runs", `sweep-${args.queryId}`);

function parseArgs(argv) {
  const out = { queryId: "3d-scan-calc" };
  for (const a of argv) {
    if (a.startsWith("--query-id=")) out.queryId = a.slice(11);
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

function fmtK(n) { return n == null ? "—" : (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(Math.round(n))); }
function fmtMs(ms) { return ms == null ? "—" : (ms / 1000).toFixed(1) + "s"; }
function fmtCost(c) { return c == null ? "—" : "$" + c.toFixed(3); }

const SCALE_ORDER = ["1k", "5k", "20k", "full"];

const main = async () => {
  const files = (await readdir(RUN_DIR)).filter((f) => f.startsWith("summary.") && f.endsWith(".json"));
  const cells = [];
  for (const f of files) {
    const j = JSON.parse(await readFile(join(RUN_DIR, f), "utf8"));
    cells.push(j);
  }
  // Index by (variant, scaleLabel)
  const variants = [...new Set(cells.map((c) => c.variant))];
  const scaleLabels = [...new Set(cells.map((c) => c.scaleLabel))]
    .sort((a, b) => SCALE_ORDER.indexOf(a) - SCALE_ORDER.indexOf(b));

  let md = `# scaling-jbounded sweep — ${args.queryId}\n\n`;
  if (cells.length === 0) {
    md += `_no cells found in ${RUN_DIR}_\n`;
    await writeFile(join(RUN_DIR, "report.md"), md);
    console.log(`wrote ${join(RUN_DIR, "report.md")} (empty)`);
    return;
  }
  const sample = cells[0];
  md += `- query: \`${sample.queryId}\`\n`;
  md += `- gt: \`${sample.gt}\` (dir: \`${sample.expectedShort}\`)\n`;
  md += `- force-included: ${sample.forceIncludeIds?.length ?? 0} ids\n`;
  md += `- variants: ${variants.join(", ")}\n`;
  md += `- scales: ${scaleLabels.join(", ")}\n\n`;

  md += `## Accuracy & cost matrix\n\n`;
  md += `| variant \\ scale | ${scaleLabels.map((s) => s).join(" | ")} |\n`;
  md += `| --- | ${scaleLabels.map(() => "---").join(" | ")} |\n`;
  for (const v of variants) {
    md += `| **${v}** acc/turns/cost/dur/ctx | `;
    md += scaleLabels.map((sl) => {
      const c = cells.find((x) => x.variant === v && x.scaleLabel === sl);
      if (!c) return "—";
      const s = c.summary;
      const ok = s.correct ? "✓" : "✗";
      return `${ok} / ${s.numTurns}T / ${fmtCost(s.cost)} / ${fmtMs(s.durationMs)} / ${fmtK(s.endCtx)}`;
    }).join(" | ");
    md += " |\n";
  }
  md += `\n`;

  md += `## Per-cell detail\n\n`;
  md += `| variant | scale | matched | ✓ | turns | bash | dur | cost | ctx_end | trigger |\n`;
  md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
  const sorted = [...cells].sort((a, b) => {
    const vc = a.variant.localeCompare(b.variant);
    if (vc !== 0) return vc;
    return SCALE_ORDER.indexOf(a.scaleLabel) - SCALE_ORDER.indexOf(b.scaleLabel);
  });
  for (const c of sorted) {
    const s = c.summary;
    md += `| ${c.variant} | ${c.scaleLabel} | ${s.matched ?? "—"} | ${s.correct ? "✓" : "✗"} | ${s.numTurns} | ${s.bashCalls} | ${fmtMs(s.durationMs)} | ${fmtCost(s.cost)} | ${fmtK(s.endCtx)} | ${s.skillFired ? "✓" : "✗"} |\n`;
  }
  md += `\n`;

  md += `## Bash result sizes (first 3 per cell)\n\n`;
  for (const c of sorted) {
    md += `### ${c.variant} @ ${c.scaleLabel}\n\n`;
    const s = c.summary;
    if (!s.bashResults?.length) {
      md += `_no bash results_\n\n`;
      continue;
    }
    md += `| idx | lines | bytes | preview |\n| --- | --- | --- | --- |\n`;
    for (const r of s.bashResults.slice(0, 5)) {
      const preview = (r.preview || "").replace(/\|/g, "\\|").replace(/\n/g, " ↵ ").slice(0, 200);
      md += `| ${r.idx} | ${r.lines} | ${r.len} | ${preview} |\n`;
    }
    md += `\n`;
  }

  await writeFile(join(RUN_DIR, "report.md"), md);
  console.log(`wrote ${join(RUN_DIR, "report.md")}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
