#!/usr/bin/env node
// Render a per-cell + per-variant metrics table for the Codex 4x5 bench.
//
// Codex's stream-json emits a single `turn.completed` per cell. Per-cell
// metrics we extract from the JSONL:
//   - tool_calls         : count of item.completed where item.type == command_execution
//   - agent_msgs         : count of item.completed where item.type == agent_message
//   - cum_in_tok         : usage.input_tokens          (SEE NOTE BELOW)
//   - cached_in          : usage.cached_input_tokens
//   - out_tok            : usage.output_tokens
//   - reason_tok         : usage.reasoning_output_tokens
//   - cost_usd_est       : computed from gpt-5.5 standard API list pricing;
//                          actual cost depends on subscription plan (n/a) but
//                          the relative ordering is comparable.
//
// IMPORTANT — what input_tokens means in `codex exec --json`:
//   `turn.completed.usage.input_tokens` is the CUMULATIVE total of input
//   tokens billed across every internal Responses API call inside that turn
//   (= `usage.total.input_tokens` in codex-rs source). It is NOT the prompt
//   size of the last call, and it is NOT the context-window size at session
//   end. A C-lite cell with 9 shell calls drives ~10 internal Responses
//   requests, each one re-sending the running history; the per-call inputs
//   sum to ~103K even though the last call's prompt is much smaller.
//
//   Codex's app-server protocol exposes `ThreadTokenUsage { total, last,
//   model_context_window }`, but `codex exec --json --ephemeral` only forwards
//   `total`. To recover real ctx_end we would need to either drop --ephemeral
//   and read the rollout `token_count.info.last_token_usage`, or drive codex
//   via app-server `thread/tokenUsage/updated` events.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_NAME = process.env.CODEX_RUN_NAME || "codex-routing-only-4x5";
const RUN_DIR = process.env.CODEX_RUN_DIR || join(__dirname, "runs", RUN_NAME);

// Estimated gpt-5.5 standard API list price. All in USD per 1M tokens.
// Source checked 2026-05-24: https://openai.com/api/pricing/
const PRICE = {
  input: 5.0,          // standard input
  cached_input: 0.5,   // cached input rate
  output: 30.0,        // output
};

function estCost(usage) {
  if (!usage) return 0;
  const inFresh = Math.max(0, (usage.input_tokens || 0) - (usage.cached_input_tokens || 0));
  const inCached = usage.cached_input_tokens || 0;
  // Codex reports reasoning_output_tokens separately, but rollout totals show
  // output_tokens is already inclusive for total-token accounting.
  const out = (usage.output_tokens || 0);
  return (
    (inFresh / 1e6) * PRICE.input +
    (inCached / 1e6) * PRICE.cached_input +
    (out / 1e6) * PRICE.output
  );
}

function readJsonl(buf) {
  return buf.split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { type: "_unparsed", line: l }; }
  });
}

async function readCell(variant, queryId, runMeta) {
  const path = join(RUN_DIR, variant, `${queryId}.jsonl`);
  const events = readJsonl(await readFile(path, "utf8"));
  const turnCompleted = events.find((e) => e.type === "turn.completed");
  const usage = turnCompleted?.usage || null;
  const toolCalls = events.filter((e) => e.type === "item.completed" && e.item?.type === "command_execution").length;
  const agentMsgs = events.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").length;
  const inferredRouterTriggered = events.some((e) => e.type === "item.completed" &&
    e.item?.type === "command_execution" &&
    String(e.item.command || "").includes("/skills/skill-router-skills/SKILL.md"));
  return {
    variant,
    queryId,
    usage,
    cumInTok: usage?.input_tokens || 0,
    cachedIn: usage?.cached_input_tokens || 0,
    outTok: usage?.output_tokens || 0,
    reasonTok: usage?.reasoning_output_tokens || 0,
    toolCalls,
    agentMsgs,
    costUsd: estCost(usage),
    routerTriggered: runMeta?.routerTriggered ?? inferredRouterTriggered,
    // Pulled from rollout last_token_usage by the driver (see runOne).
    ctxEndLast: runMeta?.lastTokenUsage?.input_tokens ?? null,
    ctxEndLastTotal: runMeta?.lastTokenUsage?.total_tokens ?? null,
    modelCtxWindow: runMeta?.modelContextWindow ?? null,
  };
}

function padR(s, n) { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }
function fmtUsd(n) { return n < 0.01 ? n.toFixed(4) : n.toFixed(3); }

async function main() {
  const summary = JSON.parse(await readFile(join(RUN_DIR, "summary.json"), "utf8"));
  const variantIds = summary.variants.map((v) => v.id);
  const variantModes = Object.fromEntries(summary.variants.map((v) => [v.id, v.mode]));
  const expectedByQ = Object.fromEntries(summary.queries.map((q) => [q.id, q.expected]));
  const queryIds = summary.queries.map((q) => q.id);
  const runs = summary.runs;

  // Cells.
  const cells = [];
  for (const variant of variantIds) {
    for (const queryId of queryIds) {
      const run = runs.find((r) => r.variant === variant && r.queryId === queryId);
      const cell = await readCell(variant, queryId, run);
      cell.matched = run?.matched ?? null;
      cell.expected = expectedByQ[queryId];
      cell.correct = cell.matched === cell.expected;
      cell.durationMs = run?.durationMs ?? 0;
      cells.push(cell);
    }
  }

  // ---- Per-cell table ----
  const cellHeader = ["variant", "query", "match", "exp", "ok", "router", "dur(s)", "tools", "msgs", "ctx_end", "ctx_win", "cum_in", "cached", "out", "reason", "$est"];
  const cellRows = cells.map((c) => [
    c.variant,
    c.queryId,
    c.matched ?? "-",
    c.expected,
    c.correct ? "✓" : "✗",
    variantModes[c.variant] === "router" ? (c.routerTriggered ? "✓" : "✗") : "n/a",
    (c.durationMs / 1000).toFixed(1),
    String(c.toolCalls),
    String(c.agentMsgs),
    c.ctxEndLast != null ? String(c.ctxEndLast) : "-",
    c.modelCtxWindow != null ? String(c.modelCtxWindow) : "-",
    String(c.cumInTok),
    String(c.cachedIn),
    String(c.outTok),
    String(c.reasonTok),
    fmtUsd(c.costUsd),
  ]);

  // ---- Per-variant rollup ----
  const variantRows = variantIds.map((v) => {
    const cs = cells.filter((c) => c.variant === v);
    const correct = cs.filter((c) => c.correct).length;
    const routerTriggered = variantModes[v] === "router" ? cs.filter((c) => c.routerTriggered).length : null;
    const totalDur = cs.reduce((s, c) => s + c.durationMs, 0);
    const totalTools = cs.reduce((s, c) => s + c.toolCalls, 0);
    const totalMsgs = cs.reduce((s, c) => s + c.agentMsgs, 0);
    const totalCumIn = cs.reduce((s, c) => s + c.cumInTok, 0);
    const totalCached = cs.reduce((s, c) => s + c.cachedIn, 0);
    const totalOut = cs.reduce((s, c) => s + c.outTok, 0);
    const totalReason = cs.reduce((s, c) => s + c.reasonTok, 0);
    const totalCost = cs.reduce((s, c) => s + c.costUsd, 0);
    const avgCumIn = Math.round(totalCumIn / cs.length);
    const ctxEndCells = cs.filter((c) => c.ctxEndLast != null);
    const avgCtxEnd = ctxEndCells.length ? Math.round(ctxEndCells.reduce((s, c) => s + c.ctxEndLast, 0) / ctxEndCells.length) : null;
    const maxCtxEnd = ctxEndCells.length ? Math.max(...ctxEndCells.map((c) => c.ctxEndLast)) : null;
    return {
      v,
      n: cs.length,
      correct,
      routerTriggered,
      totalDur,
      totalTools,
      totalMsgs,
      avgCumIn,
      avgCtxEnd,
      maxCtxEnd,
      totalCached,
      totalOut,
      totalReason,
      totalCost,
    };
  });

  const variantHeader = ["variant", "acc", "router", "Σdur(s)", "Σtools", "Σmsgs", "avg ctx_end", "max ctx_end", "avg cum_in", "Σcached", "Σout", "Σreason", "Σ$est"];
  const variantStatRows = variantRows.map((r) => [
    r.v,
    `${r.correct}/${r.n}`,
    variantModes[r.v] === "router" ? `${r.routerTriggered}/${r.n}` : "n/a",
    (r.totalDur / 1000).toFixed(1),
    String(r.totalTools),
    String(r.totalMsgs),
    r.avgCtxEnd != null ? String(r.avgCtxEnd) : "-",
    r.maxCtxEnd != null ? String(r.maxCtxEnd) : "-",
    String(r.avgCumIn),
    String(r.totalCached),
    String(r.totalOut),
    String(r.totalReason),
    fmtUsd(r.totalCost),
  ]);

  function printTable(header, rows) {
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
    const fmt = (cols) => cols.map((c, i) => i === 0 ? padR(c, widths[i]) : padL(c, widths[i])).join(" | ");
    const sep = widths.map((w) => "-".repeat(w)).join("-|-");
    process.stdout.write(fmt(header) + "\n" + sep + "\n");
    for (const r of rows) process.stdout.write(fmt(r) + "\n");
  }

  process.stdout.write(`\n# ${benchTitle(summary)} — per-cell metrics\n\n`);
  process.stdout.write(`model: ${summary.model} | reasoning_effort: ${summary.reasoningEffort} | timeout: ${summary.timeoutMs / 1000}s\n`);
  process.stdout.write(`cost estimate uses gpt-5.5 standard API list pricing; actual Codex billing/service tier may differ\n\n`);
  printTable(cellHeader, cellRows);

  process.stdout.write("\n# Per-variant rollup\n\n");
  printTable(variantHeader, variantStatRows);

  // ---- Markdown report ----
  const md = renderMarkdown(summary, cellHeader, cellRows, variantHeader, variantStatRows);
  await writeFile(join(RUN_DIR, "report.md"), md);
  process.stdout.write(`\nwrote ${join(RUN_DIR, "report.md")}\n`);
}

function renderMarkdown(summary, cellHeader, cellRows, variantHeader, variantRows) {
  const mdTable = (header, rows) => {
    const head = `| ${header.join(" | ")} |`;
    const sep = `| ${header.map(() => "---").join(" | ")} |`;
    const body = rows.map((r) => `| ${r.map((c) => String(c)).join(" | ")} |`).join("\n");
    return `${head}\n${sep}\n${body}`;
  };
  return [
    `# ${benchTitle(summary)}`,
    ``,
    `- **Model**: \`${summary.model}\` (\`reasoning_effort=${summary.reasoningEffort}\`)`,
    `- **Timeout/cell**: ${summary.timeoutMs / 1000}s`,
    `- **Started**: ${summary.startedAt}`,
    `- **Finished**: ${summary.finishedAt}`,
    `- **Variants**: ${summary.variants.map((v) => `${v.id} (${v.mode})`).join(", ")}`,
    `- **Queries**: ${summary.queries.map((q) => q.id).join(", ")}`,
    `- **Cost estimate**: based on gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M). Actual Codex billing/service tier may differ. Reasoning tokens are reported separately but treated as included in output tokens for the estimate.`,
    ``,
    `## Per-cell metrics`,
    ``,
    mdTable(cellHeader, cellRows),
    ``,
    `## Per-variant rollup`,
    ``,
    mdTable(variantHeader, variantRows),
    ``,
    `## Column definitions`,
    ``,
    `- **match / exp / ok**: routed skill id vs. ground-truth, ✓/✗`,
    `- **router**: whether the router variant actually loaded \`skill-router-skills/SKILL.md\`; native mode is n/a.`,
    `- **dur(s)**: wall-clock duration of \`codex exec\``,
    `- **tools**: count of \`command_execution\` items (shell calls). G-native uses no router so this is 0.`,
    `- **msgs**: count of \`agent_message\` items (model-emitted text turns)`,
    `- **ctx_end**: real prompt size of the FINAL internal Responses API call, read from rollout \`event_msg/token_count.info.last_token_usage.input_tokens\` (requires --ephemeral OFF). This is the conventional "context size at session end" comparable to Claude Code's per-turn input.`,
    `- **ctx_win**: \`info.model_context_window\` — the model's hard ctx limit (gpt-5.5 reports 258400).`,
    `- **cum_in**: \`turn.completed.usage.input_tokens\` — CUMULATIVE input tokens billed across every internal Responses API call in the agentic loop (= \`info.total_token_usage.input_tokens\`). Useful for cost, NOT for ctx-saturation.`,
    `- **cached**: cached input tokens (server-side prompt-cache reuse)`,
    `- **out**: output tokens (visible)`,
    `- **reason**: reasoning output tokens (high-effort thinking budget; displayed separately, not added again to $est)`,
    `- **$est**: estimated USD using gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M)`,
    ``,
    `## Notes`,
    ``,
    `- Completed cells: ${summary.runs.length}/${summary.variants.length * summary.queries.length}; exit failures: ${summary.runs.filter((r) => r.exitCode !== 0).length}; timeouts: ${summary.runs.filter((r) => r.timedOut).length}.`,
    summary.queries.length === 5
      ? `- 5-query smoke accuracy can be too easy to discriminate. Three queries (3d-scan-calc, dialogue-parser, citation-check) overlap with the Claude Code 9x3 sanity bench.`
      : `- Full-query run; compare against the Claude Code 9x24 table before drawing cross-host conclusions.`,
    `- Codex has no per-turn input-token breakdown like Claude Code's stream-json, so we cannot report ctx_start. The ctx_end value is the final internal Responses API call's prompt size from rollout token_count.`,
    ``,
  ].join("\n");
}

function benchTitle(summary) {
  return `Codex Routing-Only Bench (${summary.variants.length} variants × ${summary.queries.length} queries)`;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
