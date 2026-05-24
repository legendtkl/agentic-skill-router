#!/usr/bin/env node
// Analyze runs/claudemd-probe/ output and decide whether Phase 2 gate
// criteria are met. Prints a compact table to stdout.
//
// Gate criteria:
//   Phase 1A: trigger_rate(with-CLAUDE.md) >= 0.95 on disabled-corpus
//             cells; trigger lift over without-CLAUDE.md >= 0.20.
//   Phase 1B: direct_match_preservation(with-CLAUDE.md) >= 0.90.
//             CLAUDE.md must not cause more router calls when a direct
//             match exists.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "runs", "claudemd-probe");
const SUMMARY_PATH = join(OUT_DIR, "summary.json");
const ROUTER_TOOL_PATTERN = /skill-router-skills|skill[_-]router[_-]skills/i;
const SKILL_TOOL_PATTERN = /^(?:mcp__)?Skill\b|^Skill_/i;

async function parseCellJsonl(path) {
  const text = await readFile(path, "utf8");
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); }
    catch { /* ignore broken json */ }
  }
  let routerToolCalls = 0;
  let anySkillToolCalls = 0;
  const skillToolNames = [];
  let finalAssistantText = "";
  let totalCost = null;
  let model = null;
  let numTurns = null;
  let timedOut = false;
  for (const ev of events) {
    if (ev.type === "_run_error") {
      timedOut = /timed out/.test(ev.error || "");
      continue;
    }
    if (ev.type === "system" && ev.subtype === "init" && ev.model) {
      model = ev.model;
    }
    if (ev.type === "assistant" && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === "tool_use") {
          const name = block.name || "";
          if (ROUTER_TOOL_PATTERN.test(name)) routerToolCalls++;
          if (SKILL_TOOL_PATTERN.test(name)) {
            anySkillToolCalls++;
            skillToolNames.push(name);
          }
          // Also check Skill tool with `skillName` input naming convention
          if (block.input?.skill && ROUTER_TOOL_PATTERN.test(String(block.input.skill))) {
            routerToolCalls++;
          }
        }
        if (block.type === "text" && block.text) {
          finalAssistantText = block.text;
        }
      }
    }
    if (ev.type === "result" && ev.subtype === "success") {
      totalCost = ev.total_cost_usd ?? totalCost;
      numTurns = ev.num_turns ?? numTurns;
    }
  }
  let matchedSkillName = null;
  const m = finalAssistantText.match(/\{[^{}]*"matched_skill_name"\s*:\s*"([^"]+)"[^{}]*\}/);
  if (m) matchedSkillName = m[1];
  return {
    routerToolCalls, anySkillToolCalls, skillToolNames,
    matchedSkillName, totalCost, model, numTurns, timedOut,
    finalText: finalAssistantText.slice(0, 200),
  };
}

function fmtPct(num, denom) {
  if (!denom) return "n/a";
  return `${num}/${denom} (${((100 * num) / denom).toFixed(0)}%)`;
}

async function main() {
  if (!existsSync(SUMMARY_PATH)) {
    console.error(`missing ${SUMMARY_PATH} — run claudemd-policy-probe.mjs first`);
    process.exit(1);
  }
  const summary = JSON.parse(await readFile(SUMMARY_PATH, "utf8"));
  const runs = summary.runs.filter((r) => r.ok);

  // ----- Phase 1A aggregation -----
  // Group by (variant, condition).
  const a1Groups = new Map(); // key -> {variant, withClaudeMd, cells:[]}
  // ----- Phase 1B aggregation -----
  const b1Groups = new Map();

  for (const run of runs) {
    if (run.phase === "1A") {
      const key = `${run.variant}|${run.withClaudeMd ? "with" : "without"}`;
      if (!a1Groups.has(key)) a1Groups.set(key, { variant: run.variant, withClaudeMd: run.withClaudeMd, cells: [] });
      a1Groups.get(key).cells.push(run);
    } else if (run.phase === "1B") {
      const key = `${run.variant}|${run.withClaudeMd ? "with" : "without"}`;
      if (!b1Groups.has(key)) b1Groups.set(key, { variant: run.variant, withClaudeMd: run.withClaudeMd, cells: [] });
      b1Groups.get(key).cells.push(run);
    }
  }

  // Parse all cell transcripts in parallel.
  const allCells = runs.filter((r) => r.ok);
  await Promise.all(allCells.map(async (run) => {
    const phaseDir = join(OUT_DIR, run.phase === "1A" ? "phase1a" : "phase1b");
    const path = join(phaseDir, `${run.label}.jsonl`);
    if (!existsSync(path)) {
      run._parse = { error: "transcript missing" };
      return;
    }
    try { run._parse = await parseCellJsonl(path); }
    catch (err) { run._parse = { error: String(err).slice(0, 200) }; }
  }));

  // ===== Print Phase 1A table =====
  console.log("\n==== Phase 1A — Fallback trigger lift (corpus DISABLED) ====\n");
  console.log("variant       | cond     | trigger_rate (router_tool>=1) | mean_cost | accuracy");
  console.log("--------------+----------+-------------------------------+-----------+----------");
  const a1Rows = [];
  for (const [key, group] of [...a1Groups.entries()].sort()) {
    const cells = group.cells;
    const triggered = cells.filter((c) => (c._parse?.routerToolCalls ?? 0) >= 1).length;
    const correct = cells.filter((c) => {
      const matched = c._parse?.matchedSkillName;
      const q = c.queryObj || summary.runs.find((r) => r.label === c.label)?.queryObj;
      const exp = q?.expected?.replace(/^user:/, "");
      return matched && exp && matched === exp;
    }).length;
    const mean_cost = cells.filter((c) => c._parse?.totalCost != null).reduce((s, c) => s + c._parse.totalCost, 0) / Math.max(1, cells.length);
    console.log(
      `${group.variant.padEnd(13)} | ${(group.withClaudeMd ? "WITH" : "without").padEnd(8)} | ${fmtPct(triggered, cells.length).padEnd(29)} | $${mean_cost.toFixed(3).padStart(7)} | ${fmtPct(correct, cells.length)}`
    );
    a1Rows.push({ variant: group.variant, withClaudeMd: group.withClaudeMd, triggered, total: cells.length, correct, meanCost: mean_cost });
  }

  // ===== Print Phase 1B table =====
  console.log("\n==== Phase 1B — Direct-match preservation (gt skill ENABLED + router available) ====\n");
  console.log("variant       | cond     | direct_match | router_calls | mean_cost");
  console.log("--------------+----------+--------------+--------------+-----------");
  const b1Rows = [];
  for (const [key, group] of [...b1Groups.entries()].sort()) {
    const cells = group.cells;
    // Direct match: agent invoked the gt Skill (any non-router Skill tool)
    // OR returned matched_skill_name == gtSkill.
    const dm = cells.filter((c) => {
      const usedNonRouterSkill = (c._parse?.anySkillToolCalls ?? 0) > (c._parse?.routerToolCalls ?? 0);
      const matched = c._parse?.matchedSkillName === c.gtSkill;
      return usedNonRouterSkill || matched;
    }).length;
    const routerCalls = cells.filter((c) => (c._parse?.routerToolCalls ?? 0) >= 1).length;
    const mean_cost = cells.filter((c) => c._parse?.totalCost != null).reduce((s, c) => s + c._parse.totalCost, 0) / Math.max(1, cells.length);
    console.log(
      `${group.variant.padEnd(13)} | ${(group.withClaudeMd ? "WITH" : "without").padEnd(8)} | ${fmtPct(dm, cells.length).padEnd(12)} | ${fmtPct(routerCalls, cells.length).padEnd(12)} | $${mean_cost.toFixed(3).padStart(7)}`
    );
    b1Rows.push({ variant: group.variant, withClaudeMd: group.withClaudeMd, dm, total: cells.length, routerCalls, meanCost: mean_cost });
  }

  // ===== Gate check =====
  console.log("\n==== Gate check ====\n");
  const a1With = a1Rows.filter((r) => r.withClaudeMd);
  const a1Without = a1Rows.filter((r) => !r.withClaudeMd);
  const totalWith = a1With.reduce((s, r) => s + r.triggered, 0);
  const totalWithDen = a1With.reduce((s, r) => s + r.total, 0);
  const totalWithout = a1Without.reduce((s, r) => s + r.triggered, 0);
  const totalWithoutDen = a1Without.reduce((s, r) => s + r.total, 0);
  const triggerRateWith = totalWith / Math.max(1, totalWithDen);
  const triggerRateWithout = totalWithout / Math.max(1, totalWithoutDen);
  const triggerLift = triggerRateWith - triggerRateWithout;
  console.log(`Phase 1A trigger_rate(with)    = ${(100 * triggerRateWith).toFixed(1)}% (${totalWith}/${totalWithDen})`);
  console.log(`Phase 1A trigger_rate(without) = ${(100 * triggerRateWithout).toFixed(1)}% (${totalWithout}/${totalWithoutDen})`);
  console.log(`Phase 1A trigger_lift          = +${(100 * triggerLift).toFixed(1)} pp`);
  const a1Pass = triggerRateWith >= 0.95 && triggerLift >= 0.20;
  console.log(`Phase 1A gate (>=95% and >=+20pp): ${a1Pass ? "PASS" : "FAIL"}`);

  const b1With = b1Rows.filter((r) => r.withClaudeMd);
  const dmWith = b1With.reduce((s, r) => s + r.dm, 0);
  const dmWithDen = b1With.reduce((s, r) => s + r.total, 0);
  const b1Without = b1Rows.filter((r) => !r.withClaudeMd);
  const dmWithout = b1Without.reduce((s, r) => s + r.dm, 0);
  const dmWithoutDen = b1Without.reduce((s, r) => s + r.total, 0);
  const dmWithPct = dmWith / Math.max(1, dmWithDen);
  const dmWithoutPct = dmWithout / Math.max(1, dmWithoutDen);
  console.log(`Phase 1B direct_match(with)    = ${(100 * dmWithPct).toFixed(1)}% (${dmWith}/${dmWithDen})`);
  console.log(`Phase 1B direct_match(without) = ${(100 * dmWithoutPct).toFixed(1)}% (${dmWithout}/${dmWithoutDen})`);
  const b1Pass = dmWithPct >= 0.90 && (dmWithPct >= dmWithoutPct - 0.10);
  console.log(`Phase 1B gate (>=90% and no >10pp degradation): ${b1Pass ? "PASS" : "FAIL"}`);

  console.log(`\nOverall gate: ${a1Pass && b1Pass ? "PASS — proceed to Phase 2" : "FAIL — iterate or abandon"}\n`);

  // Cell-level table for the curious
  console.log("==== Cell detail ====\n");
  for (const run of allCells.sort((a, b) => a.label.localeCompare(b.label))) {
    const p = run._parse || {};
    const trig = (p.routerToolCalls ?? 0) >= 1 ? "T" : "-";
    const matched = p.matchedSkillName || "?";
    const exp = run.queryObj?.expected?.replace(/^user:/, "") || run.gtSkill || "?";
    const ok = matched === exp ? "✓" : "✗";
    console.log(`  ${run.label.padEnd(60)} trig=${trig} match=${matched.padEnd(12)} exp=${exp.padEnd(12)} ${ok}`);
  }

  await writeFile(join(OUT_DIR, "gate-report.json"), JSON.stringify({
    phase1a: {
      triggerRateWith,
      triggerRateWithout,
      triggerLift,
      pass: a1Pass,
      rows: a1Rows,
    },
    phase1b: {
      dmWithPct,
      dmWithoutPct,
      pass: b1Pass,
      rows: b1Rows,
    },
    overallPass: a1Pass && b1Pass,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
