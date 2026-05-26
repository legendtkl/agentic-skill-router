#!/usr/bin/env node
// extract-all-traces.mjs — Walk every historical JSONL transcript directory
// (in this worktree AND the dci/codex worktrees that hold the original
// transcripts), parse per-query agent traces, and produce a single compact
// JSON file with per-query metrics + tool-call chains.
//
// Output schema:
//   {
//     "<experiment-key>": {
//       "<variant>": {
//         "<queryId>": {
//           "matched": "skill-079",
//           "expected": "skill-079",
//           "hit": true,
//           "metrics": {
//             "turns": 5,
//             "durationMs": 21588,
//             "costUsd": 0.4032,
//             "ctxEnd": 116100,
//             "inputTokens": 12345,
//             "outputTokens": 741,
//             "cacheRead": 75465,
//             "cacheCreate": 18244,
//             "reasoningTokens": 395
//           },
//           "steps": [{ "tool": "Bash", "input": "...", "result": "..." }, { "text": "..." }]
//         }
//       }
//     }
//   }
//
// Usage: node extract-all-traces.mjs [--out=runs/all-traces.json]

import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// Old worktrees that still hold the original JSONL transcripts
const DCI_WORKTREE = "/Users/bytedance/github/skill-router/.claude/worktrees/dci/experiments";
const CODEX_WORKTREE = "/Users/bytedance/github/skill-router/.claude/worktrees/codex/experiments";

function truncate(s, n = 220) {
  if (!s) return "";
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---------- Claude stream-json parser ----------

function parseClaudeJsonl(lines) {
  const steps = [];
  const stepById = new Map();
  let lastResult = null;
  let model = null;

  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type === "system" && d.subtype === "init") {
      model = d.model;
    } else if (d.type === "assistant") {
      const msg = d.message || {};
      for (const c of msg.content || []) {
        if (c.type === "tool_use") {
          let inp;
          if (c.name === "Bash") inp = c.input?.command || "";
          else if (c.name === "Skill") inp = (c.input?.skill || "") + "(" + truncate(c.input?.args || "", 100) + ")";
          else if (c.name === "Read") inp = c.input?.file_path || "";
          else if (c.name === "Grep") inp = `pattern="${c.input?.pattern || ""}" path=${c.input?.path || ""}`;
          else inp = JSON.stringify(c.input || {});
          const step = { tool: c.name, input: truncate(inp, 250), id: c.id };
          steps.push(step);
          stepById.set(c.id, step);
        } else if (c.type === "text" && c.text?.trim()) {
          steps.push({ text: truncate(c.text.trim(), 250) });
        }
      }
    } else if (d.type === "user") {
      const msg = d.message || {};
      for (const c of msg.content || []) {
        if (c?.type === "tool_result" && c.tool_use_id) {
          const step = stepById.get(c.tool_use_id);
          if (step) {
            let content = c.content;
            if (Array.isArray(content)) content = content.map(x => x?.text || "").join("");
            step.result = truncate(String(content || ""), 250);
            delete step.id;
          }
        }
      }
    } else if (d.type === "result") {
      lastResult = d;
    }
  }
  // Cleanup unfilled ids
  for (const s of steps) if (s.id) delete s.id;
  // Parse matched skill from final result text
  let matched = null;
  if (lastResult?.result) {
    const m = String(lastResult.result).match(/"matched_skill_name"\s*:\s*"([^"]+)"/);
    if (m) matched = m[1];
  }
  const usage = lastResult?.usage || {};
  return {
    steps,
    matched,
    metrics: {
      turns: lastResult?.num_turns,
      durationMs: lastResult?.duration_ms,
      costUsd: lastResult?.total_cost_usd,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens,
      cacheCreate: usage.cache_creation_input_tokens,
      ctxEnd: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
      model,
    },
  };
}

// ---------- Codex stream-json parser ----------

function parseCodexJsonl(lines) {
  const steps = [];
  let usage = {};
  let turns = 0;
  let durationMs = null;
  let matched = null;

  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type === "item.completed") {
      const item = d.item || {};
      if (item.type === "command_execution") {
        let cmd = item.command || "";
        cmd = cmd.replace(/^\/usr\/bin\/zsh -lc "/, "").replace(/"$/, "");
        steps.push({
          tool: "Bash",
          input: truncate(cmd, 250),
          result: truncate(item.aggregated_output || "", 250),
        });
      } else if (item.type === "agent_message") {
        const txt = item.text || "";
        steps.push({ text: truncate(txt, 250) });
        const m = txt.match(/"matched_skill_name"\s*:\s*"([^"]+)"/);
        if (m) matched = m[1];
      }
    } else if (d.type === "turn.completed") {
      turns++;
      usage = d.usage || usage;
    } else if (d.type === "_stderr") {
      const m = String(d.text || "").match(/Duration:\s*([\d.]+)s/);
      if (m) durationMs = parseFloat(m[1]) * 1000;
    } else if (d.type === "_final_message") {
      const txt = d.text || "";
      const m = txt.match(/"matched_skill_name"\s*:\s*"([^"]+)"/);
      if (m) matched = m[1];
    }
  }
  const inputTokens = usage.input_tokens || 0;
  const cached = usage.cached_input_tokens || 0;
  const fresh = Math.max(inputTokens - cached, 0);
  const outputTokens = usage.output_tokens || 0;
  const reasoningTokens = usage.reasoning_output_tokens || 0;
  // gpt-5.5 pricing per 1M: fresh $5, cached $0.5, output $30
  const costUsd = (fresh * 5 + cached * 0.5 + outputTokens * 30) / 1e6;
  return {
    steps,
    matched,
    metrics: {
      turns,
      durationMs,
      costUsd,
      inputTokens,
      cachedInputTokens: cached,
      outputTokens,
      reasoningTokens,
      ctxEnd: inputTokens, // total input including cached read = effective context
    },
  };
}

// ---------- experiment registry ----------

const EXPERIMENTS = [
  // §1 Claude paired (split into two arms for clarity)
  {
    key: "claude-150-with-claudemd",
    label: "Claude Code 150-skill (with CLAUDE.md)",
    host: "claude",
    parser: "claude",
    base: join(DCI_WORKTREE, "dci-compare/runs/routing-only-9x24-claudemd"),
    variants: ["G-native","A-router","B-cc","C-lite","D-agentic","E-digest","H-bounded","I-meta","J-bounded"],
    pathFor: (variant) => `${variant}.with-claudemd`,
  },
  {
    key: "claude-150-without-claudemd",
    label: "Claude Code 150-skill (without CLAUDE.md)",
    host: "claude",
    parser: "claude",
    base: join(DCI_WORKTREE, "dci-compare/runs/routing-only-9x24-claudemd"),
    variants: ["G-native","A-router","B-cc","C-lite","D-agentic","E-digest","H-bounded","I-meta","J-bounded"],
    pathFor: (variant) => `${variant}.without-claudemd`,
  },
  // §2 Codex 9x24
  {
    key: "codex-150-initial",
    label: "Codex 150-skill (initial 9 variants)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-9x24"),
    variants: ["G-native","A-router","B-cc","C-lite","D-agentic","E-digest","H-bounded","I-meta","J-bounded"],
    pathFor: (variant) => variant,
  },
  // §2.2 Codex follow-ons (each its own dir)
  {
    key: "codex-150-d-metadata",
    label: "Codex 150-skill (D-agentic metadata-only)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-d-agentic-metadata-24-20260524"),
    variants: ["D-agentic"],
    pathFor: (variant) => variant,
    displayName: "D-agentic (metadata-only)",
  },
  {
    key: "codex-150-k-bounded",
    label: "Codex 150-skill (K-bounded)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-k-24-20260524"),
    variants: ["K-bounded"],
    pathFor: (variant) => variant,
  },
  {
    key: "codex-150-k-lite-high",
    label: "Codex 150-skill (K-lite high effort)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-k-lite-24-high-20260524"),
    variants: ["K-lite"],
    pathFor: (variant) => variant,
    displayName: "K-lite (high)",
  },
  {
    key: "codex-150-k-lite-fix",
    label: "Codex 150-skill (K-lite fixed)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-k-lite-fix-24-20260524"),
    variants: ["K-lite"],
    pathFor: (variant) => variant,
    displayName: "K-lite (fixed)",
  },
  {
    key: "codex-150-l-agentic",
    label: "Codex 150-skill (L-agentic)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-l-agentic-24-20260525-v2"),
    variants: ["L-agentic"],
    pathFor: (variant) => variant,
  },
  {
    key: "codex-150-m-bm25",
    label: "Codex 150-skill (M-bm25)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-m-bm25-index-fix-24-20260525"),
    variants: ["M-bm25"],
    pathFor: (variant) => variant,
  },
  // §3 Codex L 1K
  {
    key: "codex-1k-l-agentic",
    label: "Codex 1K synthetic (L-agentic)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-l-agentic-1k-24-20260525"),
    variants: ["L-agentic"],
    pathFor: (variant) => variant,
  },
  // §5 Codex 79K Hard
  {
    key: "codex-hard-m-bm25-current24",
    label: "Codex 79K Hard (M-bm25, current 24 subset)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-m-bm25-skillrouter-hard-24-20260525"),
    variants: ["M-bm25"],
    pathFor: (variant) => variant,
  },
  {
    key: "codex-hard-m-bm25-paper",
    label: "Codex 79K Hard (M-bm25, paper-core single)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-paper-single-hard-m-bm25-24-20260525"),
    variants: ["M-bm25"],
    pathFor: (variant) => variant,
  },
  {
    key: "codex-hard-jv2-paper",
    label: "Codex 79K Hard (J-bounded-v2, paper-core single)",
    host: "codex",
    parser: "codex",
    base: join(CODEX_WORKTREE, "dci-compare/runs/codex-routing-only-paper-single-hard-j-v2-24-20260525"),
    variants: ["J-bounded-v2"],
    pathFor: (variant) => variant,
  },
  // §9 Easy 78K (transcripts in THIS worktree)
  ...["claude-J-bounded-v2","claude-K-bounded","claude-M-bm25"].map(name => {
    const [host, ...rest] = name.split("-");
    const variant = rest.join("-");
    return {
      key: `easy78k-${name}`,
      label: `Easy 78K × 75 core (${name})`,
      host,
      parser: "claude",
      base: join(ROOT, `experiments/skillrouter-easy/runs/${name}`),
      variants: [variant],
      pathFor: () => ".", // queries are directly in this dir
      isEasy78K: true,
    };
  }),
  ...["codex-J-bounded-v2","codex-K-bounded","codex-M-bm25"].map(name => {
    const [host, ...rest] = name.split("-");
    const variant = rest.join("-");
    return {
      key: `easy78k-${name}`,
      label: `Easy 78K × 75 core (${name})`,
      host,
      parser: "codex",
      base: join(ROOT, `experiments/skillrouter-easy/runs/${name}`),
      variants: [variant],
      pathFor: () => ".",
      isEasy78K: true,
    };
  }),
];

// Load ground-truth from existing summary.json files. Different experiments
// store expected/matched differently, so we centralize all lookups here.
//   key format: "<experimentKey>::<variant>::<queryId>" -> { expected, summaryMatched }
async function loadGroundTruth() {
  const map = new Map();

  // dci-compare summary.json files have runs[].{variant, queryId, expected, matched}
  const dciSummaries = [
    { key: "codex-150-initial", path: "experiments/dci-compare/runs/codex-routing-only-9x24/summary.json" },
    { key: "codex-150-d-metadata", path: "experiments/dci-compare/runs/codex-routing-only-d-agentic-metadata-24-20260524/summary.json" },
    { key: "codex-150-k-bounded", path: "experiments/dci-compare/runs/codex-routing-only-k-24-20260524/summary.json" },
    { key: "codex-150-k-lite-high", path: "experiments/dci-compare/runs/codex-routing-only-k-lite-24-high-20260524/summary.json" },
    { key: "codex-150-k-lite-fix", path: "experiments/dci-compare/runs/codex-routing-only-k-lite-fix-24-20260524/summary.json" },
    { key: "codex-150-l-agentic", path: "experiments/dci-compare/runs/codex-routing-only-l-agentic-24-20260525-v2/summary.json" },
    { key: "codex-150-m-bm25", path: "experiments/dci-compare/runs/codex-routing-only-m-bm25-index-fix-24-20260525/summary.json" },
    { key: "codex-1k-l-agentic", path: "experiments/dci-compare/runs/codex-routing-only-l-agentic-1k-24-20260525/summary.json" },
    { key: "codex-hard-m-bm25-current24", path: "experiments/dci-compare/runs/codex-routing-only-m-bm25-skillrouter-hard-24-20260525/summary.json" },
    { key: "codex-hard-m-bm25-paper", path: "experiments/dci-compare/runs/codex-routing-only-paper-single-hard-m-bm25-24-20260525/summary.json" },
    { key: "codex-hard-jv2-paper", path: "experiments/dci-compare/runs/codex-routing-only-paper-single-hard-j-v2-24-20260525/summary.json" },
  ];
  for (const e of dciSummaries) {
    try {
      const d = JSON.parse(await readFile(join(ROOT, e.path), "utf8"));
      for (const r of d.runs || []) {
        map.set(`${e.key}::${r.variant}::${r.queryId}`, { expected: r.expected, summaryMatched: r.matched });
        // Codex 150-skill all share expected for the 24 queries (same corpus)
        if (e.key === "codex-150-initial") {
          map.set(`__shared-150::${r.queryId}`, { expected: r.expected });
        }
      }
    } catch (err) {
      console.error(`  could not load ${e.path}: ${err.message}`);
    }
  }

  // §9 Easy 78K: per-query results in summary.json with expected_anon (array) and top1/top_k
  for (const name of ["claude-J-bounded-v2","claude-K-bounded","claude-M-bm25","codex-J-bounded-v2","codex-K-bounded","codex-M-bm25"]) {
    try {
      const d = JSON.parse(await readFile(join(ROOT, "experiments/skillrouter-easy/runs", name, "summary.json"), "utf8"));
      const variant = name.split("-").slice(1).join("-");
      for (const r of d.results || []) {
        map.set(`easy78k-${name}::${variant}::${r.query_id}`, {
          expected: r.expected_anon, // array
          summaryMatched: r.top1,
          topK: r.top_k,
          hit1: r.hit1,
        });
      }
    } catch (err) {
      console.error(`  could not load easy78k summary for ${name}: ${err.message}`);
    }
  }

  return map;
}

// ---------- driver ----------

async function processExperiment(exp, groundTruth) {
  const out = {};
  for (const variant of exp.variants) {
    const dir = join(exp.base, exp.pathFor(variant));
    if (!existsSync(dir)) {
      console.error(`  skip ${exp.key}/${variant}: ${dir} missing`);
      continue;
    }
    let files;
    try { files = await readdir(dir); } catch { continue; }
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));
    if (!jsonlFiles.length) continue;
    out[variant] = {};
    let hitCount = 0;
    for (const f of jsonlFiles) {
      const queryId = f.replace(/\.jsonl$/, "");
      const lines = (await readFile(join(dir, f), "utf8")).split("\n").filter(Boolean);
      const parsed = exp.parser === "claude" ? parseClaudeJsonl(lines) : parseCodexJsonl(lines);

      // Lookup ground truth from summary.json (most reliable source)
      let gt = groundTruth.get(`${exp.key}::${variant}::${queryId}`);
      // Claude 150-skill paired and Codex 150-skill extensions share queries
      if (!gt && /^(claude-150|codex-150)/.test(exp.key)) {
        gt = groundTruth.get(`__shared-150::${queryId}`);
      }
      const expected = gt?.expected;
      // Prefer summary-derived matched (more reliable than regex parse for multi-skill)
      const matched = gt?.summaryMatched ?? parsed.matched;

      // Hit detection: prefer summary's hit1 if available (e.g. §9 multi-skill)
      let hit;
      if (gt?.hit1 != null) {
        hit = !!gt.hit1;
      } else if (matched != null && expected != null) {
        if (Array.isArray(expected)) {
          hit = expected.includes(matched);
        } else {
          const norm = s => String(s || "").replace(/^user:codex:/, "").replace(/^user:/, "").trim();
          hit = norm(matched) === norm(expected);
        }
      } else {
        hit = false;
      }
      if (hit) hitCount++;

      out[variant][queryId] = {
        matched,
        expected,
        hit,
        topK: gt?.topK,
        metrics: parsed.metrics,
        steps: parsed.steps,
      };
    }
    console.error(`  ${exp.key}/${variant}: ${Object.keys(out[variant]).length} queries, ${hitCount} hits`);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let outPath = join(__dirname, "runs/all-traces.json");
  for (const a of args) if (a.startsWith("--out=")) outPath = a.slice(6);

  console.error("Loading ground truth from summary.json files...");
  const groundTruth = await loadGroundTruth();
  console.error(`Ground truth: ${groundTruth.size} entries`);

  const result = {};
  for (const exp of EXPERIMENTS) {
    console.error(`Processing ${exp.key} (${exp.label})`);
    if (!existsSync(exp.base)) {
      console.error(`  base ${exp.base} missing, skip`);
      continue;
    }
    result[exp.key] = {
      label: exp.label,
      host: exp.host,
      displayName: exp.displayName,
      isEasy78K: exp.isEasy78K || false,
      variants: await processExperiment(exp, groundTruth),
    };
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 0)); // minified
  const sz = (await stat(outPath)).size;
  console.error(`\nWrote ${outPath} (${(sz / 1024).toFixed(0)} KB, ${(sz / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(e => { console.error(e.stack ?? e.message); process.exit(1); });
