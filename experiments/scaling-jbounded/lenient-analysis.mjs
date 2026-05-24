#!/usr/bin/env node
// Lenient analysis for 79K sweep cells.
//
// Strict accuracy = matched skill id exactly equals gt skill id. That penalizes
// cases where the matched skill is functionally equivalent to gt (e.g. both
// are spreadsheet tools, both are pdf processors). At 80K those near-misses
// are common because SkillRouter's eval-core pool contains many semantically
// overlapping skills.
//
// This analyzer reports two extra views:
//
//   1. Anchor overlap. For each cell we extract a "primary technical anchor"
//      from both the gt description and the matched description (file
//      extension, exact tool/library name, or the first quoted technology
//      mention). If both anchors equal, the cell is counted as
//      "anchor-equivalent". No hand-curated family list — anchors come from
//      the descriptions themselves.
//
//   2. Description Jaccard similarity. Tokenise both descriptions, lower-case,
//      strip stopwords, take stem-ish prefixes (8 chars); report Jaccard.
//      High similarity on a strict-miss flags benchmark labeling ambiguity.
//
// Usage:
//   node lenient-analysis.mjs --run-id=v2-full-cmd [--run-id=v2body-full-cmd ...]
// Output:
//   stdout markdown table + JSON sidecar at runs/sweep24-<runId>/lenient.json

import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SR_SRC = "/tmp/sr-probe/data/eval_core";

const args = (() => {
  const ids = [];
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--run-id=")) ids.push(a.slice(9));
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!ids.length) throw new Error("at least one --run-id=ID required");
  return { ids };
})();

const STOPWORDS = new Set([
  "the","a","an","and","or","of","to","in","for","with","when","is","are","be","by",
  "on","at","as","that","this","it","its","from","into","such","use","using","used",
  "claude","skill","skills","needs","need","data","file","files","work","works",
  "support","supports","comprehensive","including",
]);

function tokenize(s) {
  return [...new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
      .map((t) => t.length > 8 ? t.slice(0, 8) : t),
  )];
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
}

// Pull a "primary anchor" from a description string: the first
// distinctive technical term — file extension, proper-noun-like
// capitalized identifier, or quoted technology mention.
function primaryAnchor(desc) {
  if (!desc) return null;
  // file extension like .xlsx
  const ext = desc.match(/\.([a-z0-9]{2,5})\b/i);
  if (ext) return ext[1].toLowerCase();
  // quoted tech name
  const q = desc.match(/"([A-Za-z][A-Za-z0-9._-]{2,})"/);
  if (q) return q[1].toLowerCase();
  // first capitalized multi-letter token after a space (proper noun)
  const cap = desc.match(/(?:^|\s)([A-Z][A-Za-z0-9_-]{2,})/);
  if (cap) return cap[1].toLowerCase();
  // fallback: first token > 4 chars and not a generic verb
  const fallback = desc.toLowerCase().match(/\b([a-z][a-z0-9_-]{4,})\b/);
  return fallback ? fallback[1] : null;
}

async function readSkillDescription(home, safeId) {
  const p = join(home, ".claude", "skills", safeId, "SKILL.md.skill-router-disabled");
  if (!existsSync(p)) return null;
  const body = await readFile(p, "utf8");
  const m = body.match(/^description:\s*(.+?)$/m);
  if (!m) return null;
  return m[1].replace(/^"|"$/g, "");
}

const main = async () => {
  const relevance = JSON.parse(await readFile(join(SR_SRC, "relevance.json"), "utf8"));
  const out = {};
  for (const runId of args.ids) {
    const dir = join(__dirname, "runs", `sweep24-${runId}`);
    if (!existsSync(dir)) { console.error(`skip ${runId}: ${dir} not found`); continue; }
    const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8"));
    const cellsJsonPath = join(dir, "cells.json");
    if (!existsSync(cellsJsonPath)) { console.error(`skip ${runId}: cells.json not found (run render-sweep-24 first)`); continue; }
    const cells = JSON.parse(await readFile(cellsJsonPath, "utf8")).cells;
    const home = summary.home;

    const rows = [];
    let strict = 0, anchorEquiv = 0;
    for (const q of summary.queries) {
      const c = cells[q.id];
      if (!c) continue;
      const gtSafe = q.expected;
      const matched = c.matched;
      const gtDesc = await readSkillDescription(home, gtSafe);
      const matchedDesc = matched ? await readSkillDescription(home, matched) : null;
      const gtAnchor = primaryAnchor(gtDesc);
      const matchedAnchor = primaryAnchor(matchedDesc);
      const sim = jaccard(tokenize(gtDesc), tokenize(matchedDesc));
      const strictHit = c.correct;
      const anchorHit = matched && gtAnchor && matchedAnchor && gtAnchor === matchedAnchor;
      if (strictHit) strict++;
      if (strictHit || anchorHit) anchorEquiv++;
      rows.push({
        id: q.id,
        gt: gtSafe,
        matched: matched ?? null,
        gtAnchor, matchedAnchor,
        strict: strictHit,
        anchorEquiv: !!anchorHit,
        jaccard: Number(sim.toFixed(3)),
        gtDesc: (gtDesc || "").slice(0, 160),
        matchedDesc: (matchedDesc || "").slice(0, 160),
      });
    }
    out[runId] = {
      strict: strict + "/24",
      anchorEquivalent: anchorEquiv + "/24",
      rows,
    };
    await writeFile(join(dir, "lenient.json"), JSON.stringify(out[runId], null, 2));

    console.log(`\n=== ${runId} ===`);
    console.log(`  strict:           ${strict}/24  (${(strict/24*100).toFixed(1)}%)`);
    console.log(`  anchor-equivalent: ${anchorEquiv}/24  (${(anchorEquiv/24*100).toFixed(1)}%)`);
    const misses = rows.filter((r) => !r.strict);
    console.log(`\n  strict misses (sorted by jaccard desc):`);
    misses.sort((a, b) => b.jaccard - a.jaccard);
    for (const m of misses) {
      const tag = m.anchorEquiv ? "ANCHOR-EQ" : "miss";
      console.log(`    [j=${m.jaccard.toFixed(2)}] [${tag}] ${m.id}`);
      console.log(`      gt(${m.gtAnchor}):       ${m.gtDesc.slice(0, 100)}`);
      console.log(`      matched(${m.matchedAnchor}): ${m.matchedDesc.slice(0, 100)}`);
    }
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
