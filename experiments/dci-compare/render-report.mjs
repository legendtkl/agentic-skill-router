#!/usr/bin/env node
// Read runs/<variant>/<query>.jsonl + runs/summary.json + queries.json and
// render a single self-contained HTML report at runs/report.html.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const RUNS_DIR = join(EXP_DIR, "runs");
const REPORT = join(RUNS_DIR, "report.html");

const VARIANT_LABELS = {
  "A-router": "A: self-implemented retriever (skill-router auto mode)",
  "B-cc": "B: DCI-Agent-CC (free shell, arXiv:2605.05242)",
  "C-lite": "C: DCI-Agent-Lite (bash-only + bounded pipelines, arXiv:2605.05242)",
  "D-agentic": "D: AgenticRAG (structured search/find/open/summarize, arXiv:2605.05538)",
  "E-digest": "E: compact corpus digest (turn-optimized DCI, 2-call wrapper)",
  "F-index": "F: pre-baked corpus index (catalog embedded in skill, 1-call)",
  "G-native": "G: native (no router — Claude Code's own skill auto-selection)",
  "H-bounded": "H: DCI-Agent-CC, bounded (scoped glob + no bare ls + bounded output)",
  "I-meta": "I: DCI shell, metadata-only (descriptions only, never reads skill bodies)",
  "J-bounded": "J: bounded metadata-only (keyword-filtered description shortlist, never reads bodies)",
};
const VARIANT_COLORS = {
  "A-router": "#3b82f6",
  "B-cc": "#10b981",
  "C-lite": "#f59e0b",
  "D-agentic": "#ef4444",
  "E-digest": "#8b5cf6",
  "F-index": "#0891b2",
  "G-native": "#64748b",
  "H-bounded": "#db2777",
  "I-meta": "#65a30d",
  "J-bounded": "#14b8a6",
};

const main = async () => {
  const queries = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  const variants = Object.keys(VARIANT_LABELS);

  const data = {};
  for (const variant of variants) {
    data[variant] = {};
    const variantDir = join(RUNS_DIR, variant);
    let entries = [];
    try { entries = await readdir(variantDir); } catch { entries = []; }
    for (const q of queries) {
      const file = join(variantDir, `${q.id}.jsonl`);
      if (!entries.includes(`${q.id}.jsonl`)) {
        data[variant][q.id] = null;
        continue;
      }
      const text = await readFile(file, "utf8");
      const events = text.split(/\r?\n/).filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return { type: "_raw", line }; }
      });
      data[variant][q.id] = analyze(events, q);
    }
  }

  const impl = await loadImplementations(variants);
  const figures = await loadFigures();
  const html = renderHtml({ queries, variants, data, impl, figures });
  await writeFile(REPORT, html);
  console.log(`wrote ${REPORT}`);
};

// Load the core implementation artifacts so the report shows HOW each variant
// works, not just its metrics.
// Load the paper-grade SVG figures (gen-figures.mjs) for inline embedding.
async function loadFigures() {
  const names = ["fig1-accuracy", "fig2-pareto", "fig3-failure", "fig4-resource"];
  const out = {};
  for (const n of names) {
    try { out[n] = await readFile(join(EXP_DIR, "figures", `${n}.svg`), "utf8"); }
    catch { out[n] = ""; }
  }
  return out;
}

async function loadImplementations(variants) {
  const out = {};
  for (const v of variants) {
    const files = [];
    if (v === "G-native") {
      files.push({
        label: "native mode — no SKILL.md; Claude Code selects from all enabled skills",
        lang: "text",
        body: NATIVE_PROMPT_TEXT,
        caption: "harness --append-system-prompt (run.mjs NATIVE_SYSTEM_PROMPT)",
      });
    } else {
      const skillPath = join(EXP_DIR, "variants", `${v}.SKILL.md`);
      try {
        files.push({
          label: `variants/${v}.SKILL.md`,
          lang: "markdown",
          body: await readFile(skillPath, "utf8"),
          caption: "the disabled-skill workflow patched into the installed skill-router-skills slot",
        });
      } catch {/* missing */}
    }
    if (v === "E-digest") {
      try {
        files.push({
          label: "skill-corpus (bash wrapper)",
          lang: "bash",
          body: await readFile(join(EXP_DIR, "skill-corpus"), "utf8"),
          caption: "thin mechanical corpus-access wrapper installed at ~/.claude/skill-corpus",
        });
      } catch {/* missing */}
    }
    out[v] = files;
  }
  return out;
}

const NATIVE_PROMPT_TEXT = [
  "This session is a skill-routing benchmark. A set of Agent Skills is",
  "installed and available to you.",
  "",
  "For EVERY user request — regardless of subject, even if conversational,",
  "even if you could answer directly — your FIRST tool call MUST be the",
  "Skill tool, invoking the single installed skill whose description best",
  "matches the request. Immediately after invoking it, STOP. Do NOT execute",
  "the skill's task. Output exactly one line of minified JSON and nothing",
  'else: {"matched_skill_path":null,"matched_skill_name":"<invoked skill id>"}',
  'If no installed skill matches, output {"matched_skill_path":null,"matched_skill_name":null}.',
  "",
  "(In native mode the skill-router plugin is NOT loaded — all 86 corpus",
  " skills are left ENABLED so Claude Code's own skill auto-selection picks.)",
].join("\n");

function analyze(events, query) {
  let totalInput = 0, totalOutput = 0, totalCacheCreate = 0, totalCacheRead = 0;
  let numTurns = 0;
  let durationMs = 0;
  let costUsd = 0;
  let finalText = "";
  const timeline = [];
  const ctxSeries = [];
  let initSkills = [];
  let initPlugins = [];

  for (const e of events) {
    if (e.type === "system" && e.subtype === "init") {
      initSkills = e.skills ?? [];
      initPlugins = (e.plugins ?? []).map((p) => p.name);
    } else if (e.type === "assistant" && e.message?.content) {
      for (const block of e.message.content) {
        if (block.type === "tool_use") {
          timeline.push({
            kind: "tool",
            name: block.name,
            inputSummary: summarizeInput(block.name, block.input),
          });
        } else if (block.type === "text" && block.text) {
          finalText = block.text;
          timeline.push({ kind: "text", text: clipText(block.text, 600) });
        }
      }
      // Per-turn context-window OCCUPANCY (a stock): input + cache_creation +
      // cache_read for this turn. Deduped because stream-json emits two
      // assistant events per turn sharing one usage.
      const u = e.message.usage;
      if (u) {
        const c = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        if (c > 0 && (ctxSeries.length === 0 || ctxSeries[ctxSeries.length - 1] !== c)) ctxSeries.push(c);
      }
    } else if (e.type === "user" && e.message?.content) {
      for (const block of e.message.content) {
        if (block?.type === "tool_result") {
          let out = block.content;
          if (Array.isArray(out)) out = out.map((x) => (x && typeof x === "object" ? x.text || "" : String(x))).join("");
          if (typeof out !== "string") out = JSON.stringify(out);
          if (timeline.length && timeline[timeline.length - 1].kind === "tool") {
            timeline[timeline.length - 1].outputSummary = clipText(out, 500);
            timeline[timeline.length - 1].outputBytes = Buffer.byteLength(out || "", "utf8");
          }
        }
      }
    } else if (e.type === "result") {
      numTurns = e.num_turns ?? 0;
      durationMs = e.duration_ms ?? 0;
      costUsd = e.total_cost_usd ?? 0;
      if (e.usage) {
        totalInput = e.usage.input_tokens ?? 0;
        totalOutput = e.usage.output_tokens ?? 0;
        totalCacheCreate = e.usage.cache_creation_input_tokens ?? 0;
        totalCacheRead = e.usage.cache_read_input_tokens ?? 0;
      }
      if (typeof e.result === "string" && e.result) finalText = e.result;
    }
  }

  const selectedSkill = detectSelectedSkill(timeline, finalText);
  const hit = !!selectedSkill && selectedSkill === query.expected;

  return {
    numTurns,
    durationMs,
    costUsd,
    totalInput,
    totalOutput,
    totalCacheCreate,
    totalCacheRead,
    totalContext: totalInput + totalCacheCreate + totalCacheRead,
    startCtx: ctxSeries.length ? ctxSeries[0] : 0,
    endCtx: ctxSeries.length ? ctxSeries[ctxSeries.length - 1] : 0,
    timeline,
    finalText,
    selectedSkill,
    hit,
    initSkills,
    initPlugins,
  };
}

function skillBaseName(id) {
  // strip "user:" prefix and any namespace prefix
  const trimmed = id.replace(/^user:/, "");
  const parts = trimmed.split(":");
  return parts[parts.length - 1];
}

function detectSelectedSkill(timeline, finalText) {
  // 1. matched_skill_path → /skills/<dir>/SKILL.md → user:<dir>
  const pathMatch = finalText.match(/"matched_skill_path"\s*:\s*"([^"]+)"/);
  if (pathMatch) {
    const dirMatch = /\/skills\/([^/]+)\/SKILL\.md/.exec(pathMatch[1]);
    if (dirMatch) return `user:${dirMatch[1]}`;
  }
  // 2. native (variant G): the agent invokes the picked skill directly via
  //    the Skill tool. Any Skill call that is NOT the router itself is the
  //    pick. The native skill id == its directory id.
  for (const item of timeline) {
    if (item.kind !== "tool" || item.name !== "Skill") continue;
    const sum = item.inputSummary || "";
    if (sum.startsWith("skill-router:")) continue;
    const m = /^([A-Za-z0-9_.:-]+)/.exec(sum);
    if (m) return `user:${m[1]}`;
  }
  // 3. matched_skill_name from final JSON → map to user:<name>.
  //    With anonymized corpora the frontmatter name == dir id (skill-NNN),
  //    so this agrees with path-based detection.
  const nameMatch = finalText.match(/"matched_skill_name"\s*:\s*"([^"]+)"/);
  if (nameMatch && nameMatch[1] && nameMatch[1] !== "null") {
    return `user:${nameMatch[1]}`;
  }
  // NOTE: a former 4th fallback ("any tool output containing a /skills/<dir>/
  // SKILL.md path counts as the selection") was removed — it credited a run
  // for merely *reading* a candidate file among several, which scores
  // inspection as a decision. A run that produced no explicit declared
  // selection is now correctly counted as a miss.
  return null;
}

function summarizeInput(toolName, input) {
  if (!input) return "";
  try {
    if (toolName === "Bash" && input.command) {
      return clipText(input.command, 220);
    }
    if (toolName === "Read" && input.file_path) {
      return shortPath(input.file_path);
    }
    if (toolName === "Skill" && input.skill) {
      const args = input.args ? `(${clipText(input.args, 80)})` : "";
      return `${input.skill}${args}`;
    }
    return clipText(JSON.stringify(input), 220);
  } catch {
    return "";
  }
}

function shortPath(p) {
  return p.replace(/^.+?\.tmp-home/, "<fresh-home>").replace(/^.+?\.claude/, "<HOME>/.claude");
}

function clipText(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 3) + "…" : s;
}

function renderHtml({ queries, variants, data, impl, figures }) {
  // aggregate metrics
  const agg = {};
  for (const v of variants) {
    let hits = 0, turns = 0, dur = 0, cost = 0, input = 0, output = 0, cc = 0, cr = 0, runs = 0, tools = 0;
    let startCtxSum = 0, endCtxSum = 0, ctxRuns = 0;
    for (const q of queries) {
      const d = data[v][q.id];
      if (!d) continue;
      runs++;
      if (d.hit) hits++;
      turns += d.numTurns;
      dur += d.durationMs;
      cost += d.costUsd;
      input += d.totalInput;
      output += d.totalOutput;
      cc += d.totalCacheCreate;
      cr += d.totalCacheRead;
      tools += d.timeline.filter((t) => t.kind === "tool").length;
      if (d.endCtx > 0) { startCtxSum += d.startCtx; endCtxSum += d.endCtx; ctxRuns++; }
    }
    const cr0 = ctxRuns || 1;
    agg[v] = { runs, hits, turns, dur, cost, input, output, cc, cr, tools,
      startCtx: Math.round(startCtxSum / cr0), endCtx: Math.round(endCtxSum / cr0) };
  }

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>DCI Retriever Comparison Report</title>
<style>
  :root {
    --A: ${VARIANT_COLORS["A-router"]};
    --B: ${VARIANT_COLORS["B-cc"]};
    --C: ${VARIANT_COLORS["C-lite"]};
    --D: ${VARIANT_COLORS["D-agentic"]};
    --E: ${VARIANT_COLORS["E-digest"]};
    --F: ${VARIANT_COLORS["F-index"]};
    --G: ${VARIANT_COLORS["G-native"]};
    --H: ${VARIANT_COLORS["H-bounded"]};
    --I: ${VARIANT_COLORS["I-meta"]};
    --J: ${VARIANT_COLORS["J-bounded"]};
  }
  body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1280px; margin: 0 auto; color: #111; background: #fafafa; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  h2 { margin: 28px 0 12px; font-size: 18px; border-bottom: 1px solid #e5e5e5; padding-bottom: 6px; }
  h3 { margin: 16px 0 8px; font-size: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #f3f4f6; font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .hit { color: #059669; }
  .miss { color: #dc2626; }
  .gray { color: #888; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; color: white; }
  .v-A { background: var(--A); }
  .v-B { background: var(--B); }
  .v-C { background: var(--C); }
  .v-D { background: var(--D); }
  .v-E { background: var(--E); }
  .v-F { background: var(--F); }
  .v-G { background: var(--G); }
  .v-H { background: var(--H); }
  .v-I { background: var(--I); }
  .v-J { background: var(--J); }
  details { background: white; border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px 14px; margin: 10px 0; }
  details > summary { cursor: pointer; font-weight: 600; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 8px; }
  .card { background: white; border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px; }
  .card .head { font-weight: 600; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
  .metrics { font-size: 12px; color: #555; margin-bottom: 8px; }
  .metrics span { margin-right: 10px; }
  .tline { margin-top: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .tline .step { padding: 4px 0; border-bottom: 1px dashed #eee; }
  .tline .step:last-child { border-bottom: none; }
  .tline .name { font-weight: 600; color: #2563eb; }
  .tline .in { color: #6b7280; }
  .tline .out { color: #4b5563; }
  .tline .txt { color: #111; background: #f9fafb; padding: 4px 6px; border-radius: 4px; white-space: pre-wrap; }
  .bar-chart { display: grid; grid-template-columns: 200px 1fr; gap: 8px; align-items: center; margin: 6px 0; font-size: 12px; }
  .bar { height: 18px; background: #ddd; border-radius: 3px; position: relative; overflow: hidden; }
  .bar > span { display: block; height: 100%; }
  .bar .label { position: absolute; left: 6px; top: 0; line-height: 18px; font-size: 11px; color: #fff; mix-blend-mode: difference; }
  code { background: #f3f4f6; padding: 0 4px; border-radius: 3px; font-size: 12px; }
  .impl-file { margin: 10px 0; }
  .impl-label { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 600; color: #1f2937; }
  .impl-caption { font-size: 11px; color: #6b7280; margin: 2px 0 4px; }
  pre.code { background: #1e293b; color: #e2e8f0; padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: 11.5px; line-height: 1.5; }
  pre.code code { background: none; color: inherit; padding: 0; font-size: inherit; }
</style>
</head><body>
<h1>DCI Retriever Comparison Report</h1>
<p style="color:#666;font-size:13px;">
Comparing ${variants.length} disabled-skill routing implementations across ${queries.length} queries:
<b>A</b> = self-implemented retriever (skill-router CLI <code>auto</code> mode: metadata → dci → lexical cascade);
<b>B</b> = DCI-Agent-CC (Claude Code with free shell, per arXiv:2605.05242 §3);
<b>C</b> = DCI-Agent-Lite (bash-only with bounded grep pipelines, per arXiv:2605.05242 §3);
<b>D</b> = AgenticRAG (structured search/find/open/summarize loop, per arXiv:2605.05538 §3);
<b>E</b> = compact corpus digest (a thin 2-call bash wrapper — turn-optimized DCI);
<b>F</b> = pre-baked corpus index (catalog embedded in the skill, 1-call retrieval);
<b>G</b> = native (no router — all skills enabled, Claude Code's own skill auto-selection);
<b>H</b> = DCI-Agent-CC bounded (scoped glob, no bare ls, bounded output);
<b>I</b> = metadata-only (description catalog, never reads skill bodies).
Generated from <code>runs/&lt;variant&gt;/&lt;query&gt;.jsonl</code> stream-json transcripts.
</p>

<h2>Aggregate</h2>
<p style="color:#666;font-size:12px;">
<b>起始 ctx / 结束 ctx</b> 是每个 run 上下文窗口的实际 token 占用（存量 = input+cache_creation+cache_read），按 N 个 query 取均值 —— 这是"寻找 skill 消耗的真实上下文"。
<b>cache_read</b> 是 24 个 run 的累积计费量（流量，被轮次数放大，<i>不</i>等于上下文占用）。turns/tools/cost 均为 24 个 run 的合计，括号内为单轮均值。
</p>
<table>
  <thead><tr><th>Variant</th><th class="num">Hits / N</th><th class="num">起始 ctx</th><th class="num">结束 ctx</th><th class="num">Σ turns (单轮)</th><th class="num">Σ tool calls (单轮)</th><th class="num">cache_read Σ<br/><small>(计费累计)</small></th><th class="num">Σ cost (单轮)</th></tr></thead>
  <tbody>
    ${variants.map((v) => {
      const a = agg[v];
      const r = a.runs || 1;
      return `<tr><td><span class="pill v-${variantKey(v)}">${v}</span> ${VARIANT_LABELS[v]}</td>
        <td class="num">${a.hits} / ${a.runs}</td>
        <td class="num">${fmt(a.startCtx)}</td>
        <td class="num"><b>${fmt(a.endCtx)}</b></td>
        <td class="num">${a.turns} <small class="gray">(${(a.turns/r).toFixed(1)})</small></td>
        <td class="num">${a.tools} <small class="gray">(${(a.tools/r).toFixed(1)})</small></td>
        <td class="num">${fmt(a.cr)}</td>
        <td class="num">$${a.cost.toFixed(2)} <small class="gray">($${(a.cost/r).toFixed(3)})</small></td>
      </tr>`;
    }).join("")}
  </tbody>
</table>

<h3>结束 ctx — task 结束时上下文窗口占用（单轮均值，tokens）</h3>
${renderBars(variants, variants.map((v) => agg[v].endCtx))}

<h3>Σ cost — 24 query 累计成本 (USD)</h3>
${renderBars(variants, variants.map((v) => agg[v].cost))}

<h3>Σ tool calls — 24 query 累计工具调用</h3>
${renderBars(variants, variants.map((v) => agg[v].tools))}

${(figures && (figures["fig1-accuracy"] || figures["fig2-pareto"])) ? `<h2>Figures</h2>
<div style="display:flex;flex-wrap:wrap;gap:16px;">
  <div>${figures["fig1-accuracy"] || ""}</div>
  <div>${figures["fig2-pareto"] || ""}</div>
  <div>${figures["fig3-failure"] || ""}</div>
  <div>${figures["fig4-resource"] || ""}</div>
</div>` : ""}

${renderTierBreakdown(queries, variants, data)}

<h2>Per-query results</h2>
<table>
  <thead><tr>
    <th>Query</th>
    <th>Expected</th>
    ${variants.map((v) => `<th class="num"><span class="pill v-${variantKey(v)}">${v}</span></th>`).join("")}
  </tr></thead>
  <tbody>
    ${queries.map((q) => {
      const cells = variants.map((v) => {
        const d = data[v][q.id];
        if (!d) return `<td class="num gray">—</td>`;
        const mark = d.hit ? "✓" : "✗";
        const cls = d.hit ? "hit" : "miss";
        return `<td class="num ${cls}">${mark} ${d.selectedSkill ?? "no-match"}<br/><small class="gray">turns=${d.numTurns} endCtx=${fmt(d.endCtx)} out=${fmt(d.totalOutput)}</small></td>`;
      }).join("");
      return `<tr><td><code>${q.id}</code><br/><small class="gray">${escapeHtml(clipText(q.query, 110))}</small></td><td><code>${q.expected}</code></td>${cells}</tr>`;
    }).join("")}
  </tbody>
</table>

<h2>Per-query execution traces</h2>
${queries.map((q) => renderQueryDetails(q, variants, data)).join("")}

<h2>Variant implementations</h2>
<p style="color:#666;font-size:13px;">
The core definition of each variant — the SKILL.md workflow (or, for G, the
native system prompt). This is what was patched into the installed
<code>skill-router-skills</code> slot for each run.
</p>
${variants.map((v) => renderImplementation(v, impl[v] || [])).join("")}

<p style="color:#999;font-size:11px;margin-top:30px">Generated ${new Date().toISOString()}.</p>
</body></html>
`;
}

function renderImplementation(variant, files) {
  const key = variantKey(variant);
  const inner = files.map((f) => `
    <div class="impl-file">
      <div class="impl-label">${escapeHtml(f.label)}</div>
      ${f.caption ? `<div class="impl-caption">${escapeHtml(f.caption)}</div>` : ""}
      <pre class="code"><code>${escapeHtml(f.body)}</code></pre>
    </div>`).join("");
  return `<details><summary><span class="pill v-${key}">${variant}</span> ${escapeHtml(VARIANT_LABELS[variant])}</summary>
  ${inner || '<div class="gray">no implementation file</div>'}
  </details>`;
}

function renderQueryDetails(q, variants, data) {
  return `<details><summary>${q.id} — <code>${q.expected}</code> <small style="color:#666;font-weight:normal">${escapeHtml(clipText(q.query, 140))}</small></summary>
  <div class="grid3">
    ${variants.map((v) => {
      const d = data[v][q.id];
      if (!d) return `<div class="card"><div class="head">${v}</div><div class="gray">no data</div></div>`;
      const mark = d.hit ? `<span class="hit">✓ ${d.selectedSkill}</span>` : `<span class="miss">✗ ${d.selectedSkill ?? "no-match"}</span>`;
      return `<div class="card">
        <div class="head"><span class="pill v-${variantKey(v)}">${v}</span> ${mark}</div>
        <div class="metrics">
          <span>turns <b>${d.numTurns}</b></span>
          <span>ms <b>${d.durationMs}</b></span>
          <span>起始/结束 ctx <b>${fmt(d.startCtx)}/${fmt(d.endCtx)}</b></span>
          <span>out <b>${fmt(d.totalOutput)}</b></span>
          <span>cost <b>$${d.costUsd.toFixed(4)}</b></span>
        </div>
        <div class="tline">
          ${d.timeline.map(renderStep).join("")}
        </div>
      </div>`;
    }).join("")}
  </div>
  </details>`;
}

function renderStep(item) {
  if (item.kind === "text") {
    return `<div class="step"><div class="txt">${escapeHtml(item.text)}</div></div>`;
  }
  const out = item.outputSummary ? `<div class="out">${escapeHtml(item.outputSummary)}</div>` : "";
  const bytes = item.outputBytes !== undefined ? ` <span class="gray">(${item.outputBytes}B)</span>` : "";
  return `<div class="step"><div><span class="name">${item.name}</span>${bytes}: <span class="in">${escapeHtml(item.inputSummary || "")}</span></div>${out}</div>`;
}

function renderTierBreakdown(queries, variants, data) {
  // Accuracy split by query tier — the core result of the synthetic benchmark.
  const TIERS = [
    { key: "distinct", label: "Tier 1 — distinct (metadata clearly distinguishes)" },
    { key: "confusable", label: "Tier 2 — confusable (metadata present but muddied)" },
    { key: "near-duplicate", label: "Tier 3 — near-duplicate (metadata insufficient, body required)" },
  ];
  const tierQs = (k) => queries.filter((q) => (q.tier || q.kind) === k);
  const presentTiers = TIERS.filter((t) => tierQs(t.key).length > 0);
  if (presentTiers.length < 2) return "";
  const rows = variants.map((v) => {
    const cells = presentTiers.map((t) => {
      const qs = tierQs(t.key);
      const hits = qs.filter((q) => data[v][q.id] && data[v][q.id].hit).length;
      const pct = qs.length ? Math.round((hits / qs.length) * 100) : 0;
      const cls = pct === 100 ? "hit" : pct >= 60 ? "" : "miss";
      return `<td class="num ${cls}">${hits}/${qs.length} <small class="gray">(${pct}%)</small></td>`;
    });
    return `<tr><td><span class="pill v-${variantKey(v)}">${v}</span></td>${cells.join("")}</tr>`;
  }).join("");
  return `<h2>Accuracy by query tier</h2>
<p style="color:#666;font-size:13px;">
The synthetic benchmark splits queries into three tiers by how much the skill
<em>description</em> reveals. Tier 1 should be solvable by everyone; Tier 2
separates careful reasoning from naive matching; Tier 3 can only be solved by
reading skill bodies.
</p>
<table>
  <thead><tr><th>Variant</th>${presentTiers.map((t) => `<th class="num">${t.label}</th>`).join("")}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderBars(variants, values) {
  const max = Math.max(...values);
  return variants.map((v, i) => {
    const pct = max > 0 ? (values[i] / max) * 100 : 0;
    return `<div class="bar-chart">
      <div><span class="pill v-${variantKey(v)}">${v}</span> ${fmt(values[i])}</div>
      <div class="bar"><span style="width:${pct.toFixed(1)}%; background:${VARIANT_COLORS[v]}"></span></div>
    </div>`;
  }).join("");
}

function variantKey(v) {
  if (v === "A-router") return "A";
  if (v === "B-cc") return "B";
  if (v === "C-lite") return "C";
  if (v === "D-agentic") return "D";
  if (v === "E-digest") return "E";
  if (v === "F-index") return "F";
  if (v === "G-native") return "G";
  if (v === "H-bounded") return "H";
  if (v === "I-meta") return "I";
  if (v === "J-bounded") return "J";
  return "X";
}

function fmt(n) {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}k`;
  return String(n);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

main().catch((err) => { console.error(err); process.exit(1); });
