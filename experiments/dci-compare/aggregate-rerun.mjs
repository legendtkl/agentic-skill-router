#!/usr/bin/env node
// aggregate-rerun.mjs — Walk a rerun-150 output directory, extract metrics
// from every per-query JSONL, write:
//   1. cells.json — flat array, one row per (host, variant, condition, query)
//   2. aggregates.json — per (host, variant, condition) summaries
//
// Usage: node aggregate-rerun.mjs --in=runs/rerun-150-full-2026-05-26 [--out=...]

import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { parseClaude, parseCodex, aggregate, classifyFailure } from "./extract-metrics.mjs";

const VALID_POOL = new Set();
for (let i = 1; i <= 150; i++) VALID_POOL.add(`skill-${String(i).padStart(3, "0")}`);

function parseArgs(argv) {
  const out = { in: null, out: null };
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  if (!out.in) throw new Error("--in=<dir> required");
  if (!out.out) out.out = out.in;
  return out;
}

// Cell directory naming: <host>-<variant>-<condition>
function parseCellDir(name) {
  // Conditions are exactly with-claudemd / without-claudemd
  for (const cond of ["with-claudemd", "without-claudemd"]) {
    const suffix = `-${cond}`;
    if (name.endsWith(suffix)) {
      const head = name.slice(0, -suffix.length);
      const m = head.match(/^(claude|codex)-(.+)$/);
      if (m) return { host: m[1], variant: m[2], condition: cond };
    }
  }
  // Codex without condition (we still tag it for consistency)
  const m = name.match(/^(claude|codex)-(.+)$/);
  if (m) return { host: m[1], variant: m[2], condition: "with-claudemd" };
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inDir = args.in;
  if (!existsSync(inDir)) throw new Error(`missing: ${inDir}`);

  // Find the per-cell summary (durations + expected)
  const runSummary = JSON.parse(await readFile(join(inDir, "summary.json"), "utf8")).catch?.(() => null) ?? null;
  let runSummaryObj = null;
  try { runSummaryObj = JSON.parse(await readFile(join(inDir, "summary.json"), "utf8")); } catch {}
  const runIndex = new Map(); // key: "<host>-<variant>-<cond>-<query>" → runner-provided result
  for (const r of runSummaryObj?.results || []) {
    runIndex.set(`${r.host}-${r.variant}-${r.condition}-${r.queryId}`, r);
  }

  // Walk cell directories
  const cells = []; // per-query metric rows
  const entries = await readdir(inDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const meta = parseCellDir(e.name);
    if (!meta) continue;
    const cellDir = join(inDir, e.name);
    const files = await readdir(cellDir);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const queryId = f.replace(/\.jsonl$/, "");
      const raw = await readFile(join(cellDir, f), "utf8");
      const events = raw.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const isCodex = events.some(ev => ev?.type === "_rollout_metrics" || ev?.type === "thread.started");
      const runRec = runIndex.get(`${meta.host}-${meta.variant}-${meta.condition}-${queryId}`);
      const parsed = isCodex
        ? parseCodex(events, { durationMs: runRec?.durationMs })
        : parseClaude(events);
      const expected = runRec?.expected || null;
      const norm = s => String(s || "").replace(/^user:codex:/, "").replace(/^user:/, "").trim();
      const hit = parsed.matched != null && expected != null && norm(parsed.matched) === norm(expected);
      // Detect cells that errored out (e.g. Claude API 429 session limit, Codex 401).
      // For these we set apiError=true and zero out the failureType bucket so
      // accuracy denominators exclude them.
      const apiError = parsed.metrics?.isError === true || parsed.metrics?.apiErrorStatus != null;
      const failureType = apiError ? "api_error" : classifyFailure(parsed.matched, expected, VALID_POOL);
      cells.push({
        host: meta.host,
        variant: meta.variant,
        condition: meta.condition,
        queryId,
        expected,
        matched: parsed.matched,
        hit,
        routerTriggered: parsed.routerTriggered,
        timedOut: runRec?.timedOut ?? false,
        apiError,
        failureType,
        metrics: parsed.metrics,
      });
    }
  }

  await writeFile(join(args.out, "cells.json"), JSON.stringify(cells, null, 1));
  console.error(`Wrote cells.json (${cells.length} cells)`);

  // Aggregate per (host, variant, condition).
  // Cells with apiError=true (rate limit / auth) are EXCLUDED from the aggregate
  // (they didn't actually evaluate the variant), but their count is reported as `apiErrors`.
  const aggregates = {};
  const byKey = new Map();
  for (const c of cells) {
    const key = `${c.host}-${c.variant}-${c.condition}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
  }
  for (const [key, group] of byKey) {
    const errs = group.filter(c => c.apiError).length;
    const real = group.filter(c => !c.apiError);
    const agg = aggregate(real, VALID_POOL);
    agg.apiErrors = errs;
    agg.totalCells = group.length;
    aggregates[key] = agg;
  }
  await writeFile(join(args.out, "aggregates.json"), JSON.stringify(aggregates, null, 1));
  console.error(`Wrote aggregates.json (${Object.keys(aggregates).length} aggregates)`);
}

main().catch(e => { console.error(e.stack ?? e.message); process.exit(1); });
