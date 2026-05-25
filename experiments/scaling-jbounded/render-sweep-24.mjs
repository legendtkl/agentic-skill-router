#!/usr/bin/env node
// Aggregate a sweep-24 run into markdown + JSON.
//
// Reads runs/sweep24-<runId>/summary.json + per-query *.jsonl,
// computes accuracy / trigger / turns / cost / ctx_end,
// writes runs/sweep24-<runId>/report.md and cells.json.
//
// Usage:
//   node render-sweep-24.mjs --run-id=v2-150

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const RUN_DIR = join(__dirname, "runs", `sweep24-${args.runId}`);

function parseArgs(argv) {
  const out = { runId: "" };
  for (const a of argv) {
    if (a.startsWith("--run-id=")) out.runId = a.slice(9);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!out.runId) throw new Error("--run-id required");
  return out;
}

const MODEL_PRICING = {
  "claude-opus-4-7[1m]":  { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  "claude-opus-4-7":      { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
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
  let finalText = "", bashCalls = 0, skillFired = false;
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
    endCtx: turnCtx.at(-1) || 0,
    matched,
    correct,
    skillFired,
    bashCalls,
    timedOut: !!runErr,
  };
}

const fmtK = (n) => n == null ? "—" : (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(Math.round(n)));
const fmtMs = (ms) => ms == null ? "—" : (ms / 1000).toFixed(1) + "s";
const fmtCost = (c) => c == null ? "—" : "$" + c.toFixed(3);

const main = async () => {
  const summary = JSON.parse(await readFile(join(RUN_DIR, "summary.json"), "utf8"));
  const cells = {};
  for (const q of summary.queries) {
    const f = join(RUN_DIR, `${q.id}.jsonl`);
    if (!existsSync(f)) continue;
    cells[q.id] = analyze(await readFile(f, "utf8"), q.expected);
  }
  const xs = Object.values(cells);
  const sum = (k) => xs.reduce((s, x) => s + (x[k] || 0), 0);
  const acc = xs.filter((x) => x.correct).length;
  const trig = xs.filter((x) => x.skillFired).length;
  const tos = xs.filter((x) => x.timedOut).length;
  const agg = {
    n: xs.length,
    accuracy: acc / xs.length,
    triggerRate: trig / xs.length,
    sumTurns: sum("numTurns"),
    sumDuration: sum("durationMs"),
    sumCost: sum("cost"),
    avgEndCtx: sum("endCtx") / xs.length,
    timeouts: tos,
  };

  let md = `# sweep24 ${args.runId}\n\n`;
  md += `- variant: \`${summary.variant}\`\n`;
  md += `- home: \`${summary.home.replace(/^.+?\.tmp-home/, ".tmp-home")}\`\n`;
  md += `- queries-source: \`${summary.queriesSource}\`\n`;
  md += `- concurrency: ${summary.concurrency}\n`;
  md += `- started: ${summary.startedAt}\n`;
  md += `- finished: ${summary.finishedAt}\n\n`;
  md += `## Aggregate\n\n`;
  md += `| n | accuracy | trigger | Σ turns | Σ duration | Σ cost | avg ctx_end | timeouts |\n`;
  md += `| --- | --- | --- | --- | --- | --- | --- | --- |\n`;
  md += `| ${agg.n} | ${acc}/${agg.n} (${(agg.accuracy*100).toFixed(1)}%) | ${trig}/${agg.n} | ${agg.sumTurns} | ${fmtMs(agg.sumDuration)} | ${fmtCost(agg.sumCost)} | ${fmtK(agg.avgEndCtx)} | ${tos} |\n\n`;

  md += `## Per-query\n\n`;
  md += `| query | expected | matched | ✓ | turns | bash | dur | cost | ctx_end | trigger |\n`;
  md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
  for (const q of summary.queries) {
    const c = cells[q.id];
    if (!c) { md += `| ${q.id} | ${q.expected} | _missing_ |  |  |  |  |  |  |  |\n`; continue; }
    md += `| ${q.id} | ${q.expected} | ${c.matched ?? "—"} | ${c.correct ? "✓" : "✗"} | ${c.numTurns} | ${c.bashCalls} | ${fmtMs(c.durationMs)} | ${fmtCost(c.cost)}${c.costEstimated ? "*" : ""} | ${fmtK(c.endCtx)} | ${c.skillFired ? "✓" : "✗"} |\n`;
  }

  await writeFile(join(RUN_DIR, "report.md"), md);
  await writeFile(join(RUN_DIR, "cells.json"), JSON.stringify({ runId: args.runId, variant: summary.variant, home: summary.home, queriesSource: summary.queriesSource, aggregate: agg, cells }, null, 2));
  console.log(`wrote ${join(RUN_DIR, "report.md")}`);
  console.log(`accuracy: ${acc}/${agg.n} (${(agg.accuracy*100).toFixed(1)}%)  trigger: ${trig}/${agg.n}  sumCost: ${fmtCost(agg.sumCost)}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
