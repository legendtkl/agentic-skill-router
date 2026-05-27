#!/usr/bin/env node
// extract-metrics.mjs — Single source of truth for how every metric is
// computed from a Claude or Codex transcript. All other tooling (renderers,
// aggregators) should consume the output of this file.
//
// Inputs:  per-query JSONL transcript (Claude stream-json or Codex --json
//          stream + appended _rollout_metrics block)
// Output:  flat { metrics: {...}, derived: {...} } object per (host, cell, query)
//
// Usage:   node extract-metrics.mjs <transcript.jsonl>

import { readFile } from "node:fs/promises";

const ROUTER_TOOL_PATTERN = /skill-router-skills|skill[_-]router[_-]skills|agentic[_-]skill[_-]router[_-]skills/i;

// ─────────────────────────────────────────────────────────────────────────
// CLAUDE — stream-json schema: alternating `system`/`assistant`/`user`/`result`
//
// Each `assistant.message.usage` is THIS API CALL's usage:
//   input_tokens              = fresh tokens added this call
//   cache_creation_input_tokens = tokens written to prompt cache this call
//   cache_read_input_tokens   = tokens read from prompt cache this call
//   output_tokens             = tokens generated this call
//
// CTX of a single call = input + cache_create + cache_read
//
// `result.usage` is CUMULATIVE across all calls (token spend, not ctx size).
// `result.duration_ms` = wall clock; `duration_api_ms` = time in API;
// `ttft_ms` = time-to-first-token; `num_turns` = total assistant messages.
// `total_cost_usd` is Anthropic's real billing number.
// `modelUsage` breaks down per-model (Opus vs Haiku helper calls).
//
// ROUTER TRIGGERED if any assistant.tool_use has name `Skill` and
// input.skill matches the router pattern, OR the name itself matches.
// ─────────────────────────────────────────────────────────────────────────

export function parseClaude(events) {
  const assistantUsages = [];   // per-call usage history (in order, deduped by message.id)
  const seenMsgIds = new Set(); // Claude stream-json sometimes emits the same assistant message twice
  const tools = [];             // per-tool-call summary (deduped by tool_use.id)
  const seenToolIds = new Set();
  const toolResults = new Map(); // tool_use_id -> { success, content_len }
  let result = null;
  let model = null;
  let routerTriggered = false;
  let finalText = "";

  for (const ev of events) {
    if (ev?.type === "system" && ev.subtype === "init") {
      model = ev.model;
    } else if (ev?.type === "assistant") {
      const msgId = ev.message?.id;
      // Usage: stream-json emits MULTIPLE events per logical message (one per content
      // block: thinking, tool_use, text). They all carry the SAME final usage, so
      // count it only once per msgId.
      const u = ev.message?.usage;
      if (u && msgId && !seenMsgIds.has(msgId)) {
        seenMsgIds.add(msgId);
        assistantUsages.push(u);
      } else if (u && !msgId) {
        assistantUsages.push(u);
      }
      // Content: process EVERY event because different streaming chunks of the same
      // message carry different content blocks (the dedup on tool_use.id below
      // prevents double-counting the same tool call).
      for (const c of ev.message?.content || []) {
        if (c.type === "tool_use") {
          if (c.id && seenToolIds.has(c.id)) continue;
          if (c.id) seenToolIds.add(c.id);
          const name = String(c.name || "");
          const inputSkill = String(c.input?.skill || "");
          if (ROUTER_TOOL_PATTERN.test(name) || ROUTER_TOOL_PATTERN.test(inputSkill)) {
            routerTriggered = true;
          }
          // Persist a compact view of the input for traces (truncate big payloads)
          let inputDesc;
          if (name === "Bash") inputDesc = c.input?.command || "";
          else if (name === "Skill") inputDesc = `${c.input?.skill || ""}(${(c.input?.args || "").slice(0, 100)})`;
          else if (name === "Read") inputDesc = c.input?.file_path || "";
          else if (name === "Grep") inputDesc = `pattern="${c.input?.pattern || ""}" path=${c.input?.path || ""}`;
          else inputDesc = JSON.stringify(c.input || {});
          tools.push({ id: c.id, tool: name, input: String(inputDesc).slice(0, 250) });
        } else if (c.type === "text" && c.text?.trim()) {
          finalText = c.text;
        }
      }
    } else if (ev?.type === "user") {
      // Capture tool_result success/content for bashErrorCount + result size
      const turResult = ev.tool_use_result || {};
      for (const c of ev.message?.content || []) {
        if (c?.type === "tool_result" && c.tool_use_id) {
          let content = c.content;
          if (Array.isArray(content)) content = content.map(x => x?.text || "").join("");
          // is_error on the tool_result content block, OR success=false on the run wrapper, OR
          // common bash-error patterns in the content text
          const isError = !!c.is_error || turResult.success === false;
          toolResults.set(c.tool_use_id, { isError, contentLen: String(content || "").length });
        }
      }
    } else if (ev?.type === "result") {
      result = ev;
    }
  }

  // Count tool errors by joining tools with their results
  let bashErrorCount = 0;
  for (const t of tools) {
    if (t.tool !== "Bash") continue;
    const r = toolResults.get(t.id);
    if (r?.isError) bashErrorCount++;
  }

  // Final matched skill — extract from final assistant text, JSON-form
  let matched = null;
  const m = finalText.match(/"matched_skill_name"\s*:\s*"([^"]+)"/);
  if (m) matched = m[1];
  // Also accept matched_skill_names array (multi-skill output)
  const mArr = finalText.match(/"matched_skill_names"\s*:\s*\[\s*"([^"]+)"/);
  if (!matched && mArr) matched = mArr[1];

  // CTX_START = first call's input + cache_create + cache_read
  const ctxOf = u => (u?.input_tokens || 0) + (u?.cache_creation_input_tokens || 0) + (u?.cache_read_input_tokens || 0);
  const ctxStart = assistantUsages.length ? ctxOf(assistantUsages[0]) : null;
  const ctxEnd = assistantUsages.length ? ctxOf(assistantUsages[assistantUsages.length - 1]) : null;

  // Tool-call types histogram
  const toolHist = {};
  for (const t of tools) toolHist[t.tool] = (toolHist[t.tool] || 0) + 1;

  // Cumulative tokens for cost & cache-hit-ratio (from result.usage)
  const cu = result?.usage || {};
  const totalCtxTokens = (cu.input_tokens || 0) + (cu.cache_read_input_tokens || 0) + (cu.cache_creation_input_tokens || 0);
  const cacheHitRatio = totalCtxTokens ? (cu.cache_read_input_tokens || 0) / totalCtxTokens : null;

  // Final answer text length
  const outputTextLen = (result?.result || finalText || "").length;

  return {
    host: "claude",
    model,
    matched,
    routerTriggered,
    metrics: {
      // ─── core 7 ───
      numTurns: result?.num_turns ?? null,
      durationMs: result?.duration_ms ?? null,
      ctxStart,
      ctxEnd,
      ctxGrowth: (ctxStart != null && ctxEnd != null) ? ctxEnd - ctxStart : null,
      costUsd: result?.total_cost_usd ?? null,
      // ─── strongly recommended extras ───
      toolCallCount: tools.length,
      toolHist,
      bashErrorCount,
      cacheHitRatio,
      outputTextLen,
      // ─── status flags (for failureType classification later) ───
      isError: result?.is_error ?? null,
      apiErrorStatus: result?.api_error_status ?? null,
      stopReason: result?.stop_reason ?? null,
      terminalReason: result?.terminal_reason ?? null,
      // ─── trace + debugging ───
      apiCallCount: assistantUsages.length,
      steps: tools.map(t => ({ tool: t.tool, input: t.input })),
      // assistantUsages dropped to keep cells.json compact
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CODEX — stream-json schema: thread.started, turn.started/completed,
// item.started/completed (command_execution / agent_message).
//
// `turn.completed.usage` is CUMULATIVE across all internal Responses API
// calls within the agent session. NOT useful for ctx_end.
//
// True per-call usage lives ONLY in the rollout file
// ($CODEX_HOME/sessions/.../rollout-...-<thread_id>.jsonl) as
// `event_msg/token_count` events. Each has:
//   info.last_token_usage  = THIS API call's usage (input_tokens TOTAL including cached)
//   info.total_token_usage = cumulative session usage
//   info.model_context_window = model's max ctx
//
// Our runner pre-reads those and appends as `_rollout_metrics` event to the
// transcript. We also store the full token_count history so we can recover
// ctx_start and per-turn ctx growth.
//
// CTX_START = first call's last_token_usage.input_tokens
// CTX_END   = last  call's last_token_usage.input_tokens
//   (OpenAI convention: input_tokens is total prompt size, cached_input_tokens
//   is the subset that hit the cache)
//
// TURNS = number of token_count events (one per internal API call)
//
// ROUTER TRIGGERED if any command_execution.command references
//   /skills/skill-router-skills/SKILL.md
//   (the agent read the SKILL.md to load the variant's workflow)
//
// Duration: Codex doesn't report it natively. We use the runner's wall time
// (saved in the surrounding job summary, not in the JSONL itself).
//
// Cost: not reported by Codex. We estimate using gpt-5.5 list price:
//   fresh = input - cached
//   cost = (fresh*5 + cached*0.5 + output*30) / 1e6 USD
// ─────────────────────────────────────────────────────────────────────────

// gpt-5.5 list pricing per 1M tokens (as documented in §5 of the markdown report)
const GPT55_PRICE = { input: 5, cached: 0.5, output: 30 };

// All per-call token_count snapshots — populated by our runner from the rollout.
// If not present (e.g. rollout couldn't be read) we fall back to turn.completed.usage.
export function parseCodex(events, opts = {}) {
  const commands = [];   // list of { command, output, exit }
  const turnCompleted = [];
  let agentFinalText = "";
  let threadId = null;
  let rollout = null;
  let rolloutAllSnapshots = null; // [{lastTokenUsage, totalTokenUsage}, ...] from full history if available

  for (const ev of events) {
    if (ev?.type === "thread.started") threadId = ev.thread_id;
    else if (ev?.type === "turn.completed") turnCompleted.push(ev);
    else if (ev?.type === "item.completed") {
      const item = ev.item || {};
      if (item.type === "command_execution") {
        commands.push({ command: item.command || "", output: item.aggregated_output || "", exit: item.exit_code });
      } else if (item.type === "agent_message") {
        agentFinalText = item.text || "";
      }
    } else if (ev?.type === "_rollout_metrics") {
      rollout = ev;
    } else if (ev?.type === "_rollout_all_snapshots") {
      rolloutAllSnapshots = ev.snapshots;
    } else if (ev?.type === "_final_message" && !agentFinalText) {
      agentFinalText = ev.text || "";
    }
  }

  // Matched skill — from final message
  let matched = null;
  const m = agentFinalText.match(/"matched_skill_name"\s*:\s*"([^"]+)"/);
  if (m) matched = m[1];
  const mArr = agentFinalText.match(/"matched_skill_names"\s*:\s*\[\s*"([^"]+)"/);
  if (!matched && mArr) matched = mArr[1];

  // Router triggered — any command referenced the SKILL.md?
  const routerTriggered = commands.some(c =>
    c.command.includes("/skills/skill-router-skills/SKILL.md") ||
    c.command.includes("/skills/agentic-skill-router-skills/SKILL.md"));

  // Token usage — prefer per-call rollout snapshots, fall back to single rollout point, then turn.completed
  let ctxStart = null, ctxEnd = null, turns = null;
  let cumInput = null, cumCached = null, cumOutput = null, cumReasoning = null;
  let modelContextWindow = null;

  if (rolloutAllSnapshots && rolloutAllSnapshots.length) {
    const first = rolloutAllSnapshots[0]?.last_token_usage || {};
    const last = rolloutAllSnapshots[rolloutAllSnapshots.length - 1]?.last_token_usage || {};
    ctxStart = first.input_tokens ?? null;
    ctxEnd = last.input_tokens ?? null;
    turns = rolloutAllSnapshots.length;
    const totalTcu = rolloutAllSnapshots[rolloutAllSnapshots.length - 1]?.total_token_usage || {};
    cumInput = totalTcu.input_tokens ?? null;
    cumCached = totalTcu.cached_input_tokens ?? null;
    cumOutput = totalTcu.output_tokens ?? null;
    cumReasoning = totalTcu.reasoning_output_tokens ?? null;
    modelContextWindow = rolloutAllSnapshots[rolloutAllSnapshots.length - 1]?.model_context_window ?? null;
  } else if (rollout) {
    // Single endpoint snapshot — only ctx_end available, not ctx_start
    const last = rollout.lastTokenUsage || {};
    const total = rollout.totalTokenUsage || {};
    ctxEnd = last.input_tokens ?? null;
    cumInput = total.input_tokens ?? null;
    cumCached = total.cached_input_tokens ?? null;
    cumOutput = total.output_tokens ?? null;
    cumReasoning = total.reasoning_output_tokens ?? null;
    modelContextWindow = rollout.modelContextWindow ?? null;
  } else if (turnCompleted.length) {
    const u = turnCompleted[turnCompleted.length - 1].usage || {};
    cumInput = u.input_tokens ?? null;
    cumCached = u.cached_input_tokens ?? null;
    cumOutput = u.output_tokens ?? null;
    cumReasoning = u.reasoning_output_tokens ?? null;
  }

  // Cost estimate: cumulative tokens × gpt-5.5 list rates
  let costUsd = null;
  if (cumInput != null && cumOutput != null) {
    const cached = cumCached || 0;
    const fresh = Math.max((cumInput || 0) - cached, 0);
    costUsd = (fresh * GPT55_PRICE.input + cached * GPT55_PRICE.cached + (cumOutput || 0) * GPT55_PRICE.output) / 1e6;
  }

  // Cache-hit-ratio: in OpenAI's convention, input_tokens TOTAL includes the cached portion,
  // so ratio = cached / input
  const cacheHitRatio = cumInput ? (cumCached || 0) / cumInput : null;

  // Bash errors: command_execution.exit_code != 0
  const bashErrorCount = commands.filter(c => c.exit != null && c.exit !== 0).length;

  const toolHist = { Bash: commands.length };
  const durationMs = opts.durationMs ?? null;
  const outputTextLen = agentFinalText.length;

  return {
    host: "codex",
    model: "gpt-5.5",
    matched,
    routerTriggered,
    metrics: {
      // ─── core 7 ───
      numTurns: turns,
      durationMs,
      ctxStart,
      ctxEnd,
      ctxGrowth: (ctxStart != null && ctxEnd != null) ? ctxEnd - ctxStart : null,
      costUsd,
      // ─── strongly recommended extras ───
      toolCallCount: commands.length,
      toolHist,
      bashErrorCount,
      cacheHitRatio,
      outputTextLen,
      // ─── trace + debugging ───
      apiCallCount: turns,
      modelContextWindow,
      steps: commands.map(c => ({
        tool: "Bash",
        input: c.command.replace(/^\/usr\/bin\/zsh -lc "/, "").replace(/"$/, "").slice(0, 250),
      })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FAILURE TYPE classification (for miss analysis)
//   - hit           : matched == expected (after normalization)
//   - format_error  : agent never produced a parseable matched_skill_name
//   - no_match      : agent explicitly returned "no-match" / empty string
//   - hallucinated  : matched id doesn't exist in the corpus pool (e.g. "jax",
//                     "user:pdf", or a skill-XXX outside the pool range)
//   - distractor    : matched exists in the pool but isn't the expected one
//
// validPoolIds: a Set of all skill ids that legitimately exist in the corpus.
//               For the 150-skill experiment this is {skill-001..skill-150}.
// expected: the ground-truth id for this query (string, possibly prefixed user:)
// matched: what the agent returned (string or null)
// ─────────────────────────────────────────────────────────────────────────

const norm = s => String(s || "").replace(/^user:codex:/, "").replace(/^user:/, "").trim();

export function classifyFailure(matched, expected, validPoolIds) {
  if (matched == null || matched === "") return "format_error";
  if (matched === "no-match") return "no_match";
  const m = norm(matched);
  const e = norm(expected);
  if (m === e) return "hit";
  if (validPoolIds && !validPoolIds.has(m)) return "hallucinated";
  return "distractor";
}

// ─────────────────────────────────────────────────────────────────────────
// AGGREGATION across a variant (set of queries)
//
// Per-variant aggregates needed:
//   accuracy        = hits / total
//   triggerRate     = router_triggered_count / total
//   totalTurns      = sum(numTurns)
//   avgTurns        = totalTurns / total
//   avgCtxStart     = mean(ctxStart) over queries where present
//   avgCtxEnd       = mean(ctxEnd) over queries where present
//   maxCtxEnd       = max(ctxEnd)
//   sumCost         = sum(costUsd)
//   avgCost         = mean(costUsd)
//   sumDuration     = sum(durationMs)
//   avgDuration     = mean(durationMs)
//   timeouts        = count(timedOut === true)
//   errors          = count(matched == null OR isError === true)
// ─────────────────────────────────────────────────────────────────────────

export function aggregate(cells, validPoolIds = null) {
  let n = 0, hits = 0, triggers = 0, timeouts = 0;
  let totalTurns = 0, turnsCount = 0;
  let ctxStartSum = 0, ctxStartCount = 0;
  let ctxEndSum = 0, ctxEndCount = 0;
  let ctxGrowthSum = 0, ctxGrowthCount = 0;
  let costSum = 0, costCount = 0;
  let durSum = 0, durCount = 0;
  let toolCallSum = 0, bashErrSum = 0;
  let cacheHitSum = 0, cacheHitCount = 0;
  let outLenSum = 0, outLenCount = 0;
  // failure type buckets
  const failures = { hit: 0, format_error: 0, no_match: 0, hallucinated: 0, distractor: 0 };
  for (const c of cells) {
    n++;
    if (c.hit) hits++;
    if (c.routerTriggered) triggers++;
    if (c.timedOut) timeouts++;
    const m = c.metrics || {};
    if (m.numTurns != null) { totalTurns += m.numTurns; turnsCount++; }
    if (m.ctxStart != null) { ctxStartSum += m.ctxStart; ctxStartCount++; }
    if (m.ctxEnd != null) { ctxEndSum += m.ctxEnd; ctxEndCount++; }
    if (m.ctxGrowth != null) { ctxGrowthSum += m.ctxGrowth; ctxGrowthCount++; }
    if (m.costUsd != null) { costSum += m.costUsd; costCount++; }
    if (m.durationMs != null) { durSum += m.durationMs; durCount++; }
    if (m.toolCallCount != null) toolCallSum += m.toolCallCount;
    if (m.bashErrorCount != null) bashErrSum += m.bashErrorCount;
    if (m.cacheHitRatio != null) { cacheHitSum += m.cacheHitRatio; cacheHitCount++; }
    if (m.outputTextLen != null) { outLenSum += m.outputTextLen; outLenCount++; }
    // failure classification (requires expected + validPoolIds)
    const ft = classifyFailure(c.matched, c.expected, validPoolIds);
    failures[ft] = (failures[ft] || 0) + 1;
  }
  return {
    n,
    accuracy: n ? hits / n : null,
    hits,
    triggerRate: n ? triggers / n : null,
    triggers,
    totalTurns,
    avgTurns: turnsCount ? totalTurns / turnsCount : null,
    avgCtxStart: ctxStartCount ? ctxStartSum / ctxStartCount : null,
    avgCtxEnd: ctxEndCount ? ctxEndSum / ctxEndCount : null,
    avgCtxGrowth: ctxGrowthCount ? ctxGrowthSum / ctxGrowthCount : null,
    sumCost: costSum,
    avgCost: costCount ? costSum / costCount : null,
    sumDuration: durSum,
    avgDuration: durCount ? durSum / durCount : null,
    timeouts,
    // extras
    totalToolCalls: toolCallSum,
    avgToolCalls: n ? toolCallSum / n : null,
    totalBashErrors: bashErrSum,
    avgCacheHitRatio: cacheHitCount ? cacheHitSum / cacheHitCount : null,
    avgOutputTextLen: outLenCount ? outLenSum / outLenCount : null,
    failures,
  };
}

// CLI: dump metrics for one transcript
async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: extract-metrics.mjs <transcript.jsonl>");
    process.exit(1);
  }
  const raw = await readFile(path, "utf8");
  const events = raw.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  // Auto-detect host: presence of `_rollout_metrics` => Codex
  const isCodex = events.some(e => e?.type === "_rollout_metrics" || e?.type === "thread.started");
  const result = isCodex ? parseCodex(events) : parseClaude(events);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
