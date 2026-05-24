#!/usr/bin/env node
// Render markdown report for scaling-jbounded run.
//
// Reads runs/<run-id>/summary.json + per-cell jsonl transcripts, produces:
//   runs/<run-id>/report.md    — aggregate table + per-query detail
//   runs/<run-id>/cells.json   — machine-readable per-cell metrics (for cross-run analysis)
//
// Usage:
//   node render.mjs --run-id=cap-1000

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const OUT_DIR = join(__dirname, "runs", args.runId);

function parseArgs(argv) {
  const out = { runId: "cap-1000" };
  for (const a of argv) {
    if (a.startsWith("--run-id=")) out.runId = a.slice(9);
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

// Opus 4.7 list prices. Used to estimate cost when result.total_cost_usd is
// missing (timeout). Marked with `*` in the report.
const MODEL_PRICING = {
  "claude-opus-4-7[1m]":  { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  "claude-opus-4-7":      { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  "claude-sonnet-4-6":    { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  "default":              { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
};

function analyze(text, expected) {
  const events = text.split(/\r?\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { type: "_raw", line: l }; }
  });
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const model = init?.model || "default";
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  const result = events.find((e) => e.type === "result");
  const runErr = events.find((e) => e.type === "_run_error");
  const turnCtx = [];
  let finalText = "";
  let skillFired = false;
  let bashCalls = 0;
  // Track J-bounded diagnostic: did the first grep return >=1 line containing gt id?
  let firstGrepHadGt = null;
  let firstGrepLineCount = null;
  for (const e of events) {
    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      const u = e.message.usage || {};
      turnCtx.push((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
      for (const b of e.message.content) {
        if (b.type === "tool_use") {
          if (b.name === "Skill") skillFired = true;
          if (b.name === "Bash") bashCalls++;
        } else if (b.type === "text") {
          finalText = b.text;
        }
      }
    }
    // Bash tool results come back as user messages with tool_result content.
    if (e.type === "user" && Array.isArray(e.message?.content) && firstGrepHadGt === null) {
      for (const b of e.message.content) {
        if (b.type === "tool_result" && typeof b.content === "string" && b.content.includes("description:")) {
          const lines = b.content.split("\n").filter((l) => l.trim());
          firstGrepLineCount = lines.length;
          firstGrepHadGt = lines.some((l) => l.includes(expected));
          break;
        }
        if (b.type === "tool_result" && Array.isArray(b.content)) {
          const textPart = b.content.find((c) => c.type === "text");
          if (textPart && textPart.text?.includes("description:")) {
            const lines = textPart.text.split("\n").filter((l) => l.trim());
            firstGrepLineCount = lines.length;
            firstGrepHadGt = lines.some((l) => l.includes(expected));
            break;
          }
        }
      }
    }
  }
  let matched = null;
  for (const m of (finalText || "").matchAll(/"matched_skill_name"\s*:\s*"([^"]+)"/g)) {
    if (m[1] && !m[1].includes("<")) matched = m[1];
  }
  const correct = matched != null && matched === expected;
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
    numTurns: result?.num_turns ?? turnCtx.length,
    durationMs: result?.duration_ms || null,
    cost,
    costEstimated: result?.total_cost_usd == null,
    startCtx: turnCtx[0] || 0,
    endCtx: turnCtx.at(-1) || 0,
    matched,
    correct,
    skillFired,
    bashCalls,
    firstGrepHadGt,
    firstGrepLineCount,
    timedOut: !!runErr,
  };
}

function fmtK(n) { return n == null ? "—" : (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(Math.round(n))); }
function fmtCost(c) { return c == null ? "—" : "$" + c.toFixed(2); }
function fmtMs(ms) { return ms == null ? "—" : (ms / 1000).toFixed(1) + "s"; }
function fmtPct(p) { return p == null ? "—" : Math.round(p * 100) + "%"; }

async function main() {
  const summary = JSON.parse(await readFile(join(OUT_DIR, "summary.json"), "utf8"));
  const queries = summary.queries;
  const variants = summary.variants.map((v) => v.id);
  const cells = {};
  for (const v of variants) {
    cells[v] = {};
    for (const q of queries) {
      const f = join(OUT_DIR, v, `${q.id}.jsonl`);
      if (!existsSync(f)) continue;
      const expectedShort = q.expected.replace(/^user:/, "");
      cells[v][q.id] = analyze(await readFile(f, "utf8"), expectedShort);
    }
  }

  const aggRows = variants.map((v) => {
    const xs = queries.map((q) => cells[v]?.[q.id]).filter(Boolean);
    if (!xs.length) return null;
    const sum = (k) => xs.reduce((s, x) => s + (x[k] || 0), 0);
    const shortlistHits = xs.filter((x) => x.firstGrepHadGt === true).length;
    const shortlistKnown = xs.filter((x) => x.firstGrepHadGt !== null).length;
    return {
      v,
      n: xs.length,
      acc: xs.filter((x) => x.correct).length,
      triggered: xs.filter((x) => x.skillFired).length,
      sumTurns: sum("numTurns"),
      sumDuration: sum("durationMs"),
      sumCost: sum("cost"),
      avgEndCtx: sum("endCtx") / xs.length,
      shortlistHits,
      shortlistKnown,
      anyEstimated: xs.some((x) => x.costEstimated),
      timeouts: xs.filter((x) => x.timedOut).length,
    };
  }).filter(Boolean);

  let md = `# scaling-jbounded — ${summary.runId}\n\n`;
  md += `- corpus: \`${summary.corpus}\`\n`;
  md += `- queries: ${queries.length}\n`;
  md += `- variants: ${variants.join(", ")}\n`;
  md += `- append-system-prompt: \`${summary.appendSystemPrompt}\`\n`;
  md += `- started: ${summary.startedAt}\n`;
  md += `- finished: ${summary.finishedAt}\n\n`;

  md += `## Aggregate\n\n`;
  md += `| variant | accuracy | trigger rate | shortlist∋gt | ∑ turns | ∑ duration | ∑ cost | avg ctx_end | timeouts |\n`;
  md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
  for (const r of aggRows) {
    const slCell = r.shortlistKnown > 0
      ? `${r.shortlistHits}/${r.shortlistKnown}`
      : "—";
    md += `| ${r.v} | ${r.acc}/${r.n} | ${fmtPct(r.triggered / r.n)} | ${slCell} | ${r.sumTurns} | ${fmtMs(r.sumDuration)} | ${fmtCost(r.sumCost)}${r.anyEstimated ? " *" : ""} | ${fmtK(r.avgEndCtx)} | ${r.timeouts} |\n`;
  }
  md += `\n*\`shortlist∋gt\` = how often the first \`Bash\` tool result (a description grep) contained the gt skill id. Only counted when a bash result was observed. Missing for variants that don't grep before deciding.*\n\n`;

  md += `## Per-query detail\n\n`;
  for (const v of variants) {
    md += `### ${v}\n\n`;
    md += `| query | expected | matched | ✓ | turns | dur | cost | ctx_end | trigger | sl∋gt | sl_n |\n`;
    md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
    for (const q of queries) {
      const c = cells[v]?.[q.id];
      if (!c) { md += `| ${q.id} | ${q.expected} | _missing_ |  |  |  |  |  |  |  |  |\n`; continue; }
      const sl = c.firstGrepHadGt === null ? "—" : (c.firstGrepHadGt ? "✓" : "✗");
      md += `| ${q.id} | ${q.expected.replace(/^user:/,"")} | ${c.matched ?? "—"} | ${c.correct ? "✓" : "✗"} | ${c.numTurns} | ${fmtMs(c.durationMs)} | ${fmtCost(c.cost)}${c.costEstimated ? "*" : ""} | ${fmtK(c.endCtx)} | ${c.skillFired ? "✓" : "✗"} | ${sl} | ${c.firstGrepLineCount ?? "—"} |\n`;
    }
    md += `\n`;
  }

  await writeFile(join(OUT_DIR, "report.md"), md);
  await writeFile(join(OUT_DIR, "cells.json"), JSON.stringify({
    runId: summary.runId,
    corpus: summary.corpus,
    appendSystemPrompt: summary.appendSystemPrompt,
    cells,
    aggregate: aggRows,
  }, null, 2));
  console.log(`wrote ${join(OUT_DIR, "report.md")}`);
  console.log(`wrote ${join(OUT_DIR, "cells.json")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
