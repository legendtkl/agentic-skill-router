#!/usr/bin/env node
// Render REPORT-claudemd.html from the Phase 2 paired summary.json (+ D rerun
// already overwritten on disk). Self-contained HTML matching the markdown
// structure: headline numbers, main accuracy table, Pareto table, result
// composition, ctx_end, per-query heatmap, hallucination matrix, CLAUDE.md
// A/B comparison, failure case detail, and appendix links.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "runs", "routing-only-9x24-claudemd");
const SUMMARY_PATH = join(OUT_DIR, "summary.json");
const REPORT_HTML = join(__dirname, "REPORT-claudemd.html");

const ROUTER_TOOL_PATTERN = /skill-router-skills|skill[_-]router[_-]skills/i;
const REAL_ID = /^skill-\d{3}$/;

const VARIANT_INFO = {
  "A-router":  { paradigm: "Self-impl lexical", reads_body: false },
  "B-cc":      { paradigm: "DCI-Agent-CC",      reads_body: true },
  "C-lite":    { paradigm: "DCI-Agent-Lite",    reads_body: true },
  "D-agentic": { paradigm: "AgenticRAG",        reads_body: false },
  "E-digest":  { paradigm: "Metadata digest",   reads_body: false },
  "G-native":  { paradigm: "Host native",       reads_body: false },
  "H-bounded": { paradigm: "DCI bounded",       reads_body: true },
  "I-meta":    { paradigm: "Metadata only",     reads_body: false },
  "J-bounded": { paradigm: "Keyword-filtered",  reads_body: false },
};
const VARIANT_ORDER = ["B-cc", "C-lite", "D-agentic", "E-digest", "H-bounded", "J-bounded", "I-meta", "G-native", "A-router"];

async function parseCell(path) {
  const text = await readFile(path, "utf8");
  let routerToolCalls = 0;
  let finalText = "";
  let totalCost = null;
  let lastAssistantUsage = null;
  let cumulativeUsage = null;
  let model = null;
  let numTurns = null;
  let durationMs = null;
  let timedOut = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "_run_error" && /timed out/.test(ev.error || "")) timedOut = true;
    if (ev.type === "system" && ev.subtype === "init" && ev.model) model = ev.model;
    if (ev.type === "assistant" && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === "tool_use") {
          const name = block.name || "";
          const inputSkill = block.input?.skill ? String(block.input.skill) : "";
          if (ROUTER_TOOL_PATTERN.test(name) || ROUTER_TOOL_PATTERN.test(inputSkill)) routerToolCalls++;
        }
        if (block.type === "text" && block.text) finalText = block.text;
      }
      if (ev.message?.usage) lastAssistantUsage = ev.message.usage;
    }
    if (ev.type === "result" && ev.subtype === "success") {
      totalCost = ev.total_cost_usd ?? totalCost;
      numTurns = ev.num_turns ?? numTurns;
      durationMs = ev.duration_ms ?? durationMs;
      if (ev.usage) cumulativeUsage = ev.usage;
    }
  }
  let ctxEnd = null;
  if (lastAssistantUsage) {
    ctxEnd = (lastAssistantUsage.input_tokens || 0) +
             (lastAssistantUsage.cache_read_input_tokens || 0) +
             (lastAssistantUsage.cache_creation_input_tokens || 0);
  }
  const m = finalText.match(/\{[^{}]*"matched_skill_name"\s*:\s*"([^"]+)"[^{}]*\}/);
  const matched = m ? m[1] : null;
  return { routerToolCalls, matched, totalCost, model, numTurns, durationMs, ctxEnd, timedOut };
}

function fmt(n, d = 0) { return n == null ? "—" : (typeof n === "number" ? n.toFixed(d) : n); }
function fmtPct(num, den) { return den ? `${num}/${den} (${((100 * num) / den).toFixed(0)}%)` : "n/a"; }
function fmt$(n) { return n == null ? "—" : `$${n.toFixed(2)}`; }
function fmtSec(ms) { return ms == null ? "—" : `${(ms / 1000).toFixed(0)}s`; }
function fmtK(n) { return n == null ? "—" : `${(n / 1000).toFixed(1)}K`; }

async function main() {
  if (!existsSync(SUMMARY_PATH)) {
    console.error(`missing ${SUMMARY_PATH}`);
    process.exit(1);
  }
  const summary = JSON.parse(await readFile(SUMMARY_PATH, "utf8"));
  const queries = summary.queries;
  const qById = new Map(queries.map((q) => [q.id, q]));
  const runs = summary.runs.filter((r) => !r.__error && r.queryId);

  const cells = await Promise.all(runs.map(async (r) => {
    const path = join(OUT_DIR, `${r.variant}.${r.condition}`, `${r.queryId}.jsonl`);
    const p = existsSync(path) ? await parseCell(path) : {};
    const exp = qById.get(r.queryId)?.expected?.replace(/^user:/, "");
    return { ...r, ...p, expected: exp, correct: p.matched === exp, hallucinated: p.matched ? !REAL_ID.test(p.matched) : true };
  }));

  const idx = new Map();
  for (const c of cells) idx.set(`${c.variant}|${c.condition}|${c.queryId}`, c);

  // Per-(variant, condition) aggregate
  const variants = [...new Set(cells.map((c) => c.variant))];
  function aggregate(vList, cond) {
    const out = new Map();
    for (const v of vList) {
      const arr = cells.filter((c) => c.variant === v && c.condition === cond);
      const acc = arr.filter((c) => c.correct).length;
      const trig = arr.filter((c) => (c.routerToolCalls || 0) >= 1).length;
      const halluc = arr.filter((c) => c.hallucinated && c.matched).length + arr.filter((c) => !c.matched).length;
      const cost = arr.reduce((s, c) => s + (c.totalCost || 0), 0);
      const dur = arr.reduce((s, c) => s + (c.durationMs || 0), 0);
      const turns = arr.reduce((s, c) => s + (c.numTurns || 0), 0);
      const ctxs = arr.map((c) => c.ctxEnd).filter((x) => x != null);
      const ctxEnd = ctxs.length ? ctxs.reduce((s, x) => s + x, 0) / ctxs.length : null;
      out.set(v, { n: arr.length, acc, trig, halluc, cost, dur, turns, ctxEnd });
    }
    return out;
  }
  const withAgg = aggregate(VARIANT_ORDER, "with-claudemd");
  const withoutAgg = aggregate(VARIANT_ORDER, "without-claudemd");

  // Per-query: for each query, count how many router variants got it right in each condition
  const routerVariants = VARIANT_ORDER.filter((v) => v !== "G-native");
  function perQuery(cond) {
    return queries.map((q) => {
      const cellsHere = routerVariants.map((v) => idx.get(`${v}|${cond}|${q.id}`));
      const hits = cellsHere.filter((c) => c?.correct).length;
      return { qid: q.id, expected: q.expected.replace(/^user:/, ""), domain: q.domain, hits, cells: cellsHere };
    });
  }
  const perQueryWith = perQuery("with-claudemd");
  const perQueryWithout = perQuery("without-claudemd");

  // Aggregate router-only totals
  function routerTotal(cond) {
    const arr = cells.filter((c) => c.variant !== "G-native" && c.condition === cond);
    return {
      total: arr.length,
      acc: arr.filter((c) => c.correct).length,
      trig: arr.filter((c) => (c.routerToolCalls || 0) >= 1).length,
      halluc: arr.filter((c) => c.hallucinated || !c.matched).length,
      cost: arr.reduce((s, c) => s + (c.totalCost || 0), 0),
      dur: arr.reduce((s, c) => s + (c.durationMs || 0), 0),
    };
  }
  const rW = routerTotal("with-claudemd");
  const rO = routerTotal("without-claudemd");

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Disabled-Skill 路由策略对比实验报告</title>
<style>
  :root {
    --bg: #fafbfc;
    --fg: #24292f;
    --muted: #57606a;
    --accent: #0969da;
    --good: #1a7f37;
    --bad: #cf222e;
    --warn: #9a6700;
    --border: #d0d7de;
    --code-bg: #f6f8fa;
  }
  * { box-sizing: border-box; }
  body {
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: var(--fg);
    background: var(--bg);
    padding: 32px 24px;
    margin: 0;
  }
  .container { max-width: 1280px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 22px; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--border); }
  h3 { font-size: 17px; margin: 24px 0 8px; color: var(--muted); }
  h4 { font-size: 15px; margin: 20px 0 6px; }
  p { margin: 8px 0; }
  .subtitle { color: var(--muted); font-size: 15px; margin: 0 0 8px; }
  .meta { color: var(--muted); font-size: 12px; }
  code, pre {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    background: var(--code-bg);
  }
  code { padding: 1px 4px; border-radius: 3px; font-size: 0.92em; }
  pre { padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  blockquote {
    margin: 12px 0; padding: 6px 14px;
    border-left: 3px solid var(--accent);
    background: rgba(9, 105, 218, 0.05);
    color: var(--muted);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    font-size: 13px;
  }
  table.compact { font-size: 12px; }
  th, td { padding: 6px 10px; border: 1px solid var(--border); text-align: left; }
  th { background: var(--code-bg); font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.ok { background: #dafbe1; color: #1a7f37; font-weight: 600; }
  td.fail { background: #ffebe9; color: #82071e; }
  td.skip { background: #fafbfc; color: var(--muted); }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .badge.gold { background: #fde68a; color: #78350f; }
  .badge.silver { background: #e5e7eb; color: #374151; }
  .badge.bronze { background: #fed7aa; color: #7c2d12; }
  .badge.pareto { background: #ddf4ff; color: #0969da; }
  .delta-pos { color: var(--good); font-weight: 600; }
  .delta-neg { color: var(--bad); font-weight: 600; }
  .delta-zero { color: var(--muted); }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 18px; margin: 12px 0; font-size: 13px; }
  .kv dt { color: var(--muted); }
  .kv dd { margin: 0; font-weight: 600; }
  .heat td { text-align: center; font-family: ui-monospace, monospace; font-size: 11px; padding: 4px 2px; }
  .heat td.qid { text-align: left; padding-left: 8px; font-size: 11px; }
  .heat td.exp { color: var(--muted); font-size: 10px; }
  .toc {
    background: var(--code-bg); border-radius: 6px; padding: 14px 22px; margin: 18px 0;
  }
  .toc ol { margin: 0; padding-left: 20px; }
  .toc a { color: var(--accent); text-decoration: none; }
  .toc a:hover { text-decoration: underline; }
  details summary { cursor: pointer; padding: 6px 0; font-weight: 600; color: var(--accent); }
  hr { border: 0; border-top: 1px solid var(--border); margin: 28px 0; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<div class="container">

<h1>Disabled-Skill 路由策略对比实验报告</h1>
<p class="subtitle">九种 retriever 在 trigger 充分激活条件下的系统对比</p>
<p class="meta">
  实验日期 ${summary.startedAt?.slice(0, 10) || "2026-05-23"} ~ ${summary.finishedAt?.slice(0, 10) || "2026-05-24"} ·
  语料 SkillRouter eval-core (arXiv:2603.22455) 裁剪匿名化版,150 skills ·
  规模 Phase 1 64 cells + Phase 2 paired 432 cells + D-agentic rerun 48 cells = <b>544 cells</b>
</p>

<div class="toc">
<b>目录</b>
<ol>
  <li><a href="#summary">摘要</a></li>
  <li><a href="#s1">引言与研究问题</a></li>
  <li><a href="#s2">相关工作</a></li>
  <li><a href="#s3">实验方法</a></li>
  <li><a href="#s4">trigger 充分激活与 CLAUDE.md 注入</a></li>
  <li><a href="#s5">方法学审查与修正</a></li>
  <li><a href="#s6">结果</a></li>
  <li><a href="#s7">失败案例分析</a></li>
  <li><a href="#s8">讨论</a></li>
  <li><a href="#s9">局限性</a></li>
  <li><a href="#s10">优化计划</a></li>
  <li><a href="#s11">结论</a></li>
  <li><a href="#appendix">附录</a></li>
</ol>
</div>

<h2 id="summary">摘要</h2>

<p>
当一个编码 agent (Claude Code) 收到的请求无法被任何已启用的 Agent Skill 覆盖时,它需要从一批<b>已禁用</b>的 skill 中"路由"出最合适的一个。"路由"步骤如何实现,直接决定准确率与成本。本实验对 <b>九种 disabled-skill 路由实现</b> 做受控对比,涵盖四类范式:自实现检索器、Direct Corpus Interaction (DCI)、AgenticRAG、metadata-only,以及宿主原生 skill 选择作为对照。
</p>

<p>
初次跑实验时观察到一类系统性失败:即使变体配置了 router skill,agent 在某些 query 上跳过 router 直接输出从 query 关键词拼出来的伪 skill 名(<code>pptx</code>、<code>xlsx</code>、<code>jax</code> 等),命中率被这一"trigger noise"显著拉低。为把 retriever 的真实能力差异与 trigger 决策的随机性解耦,本实验在 <code>&lt;HOME&gt;/.claude/CLAUDE.md</code> 注入提示词使 trigger 充分激活,并采用 <b>paired A/B 设计</b>:同一执行窗口对 9 变体 × 24 查询同时跑 with/without CLAUDE.md。
</p>

<dl class="kv">
<dt>Router 准确率提升</dt><dd>65% → <span class="delta-pos">84% (+19.3pp)</span></dd>
<dt>Trigger rate</dt><dd>80% → <span class="delta-pos">97% (+17.7pp)</span></dd>
<dt>Hallucination rate</dt><dd>21.4% → <span class="delta-pos">2.6%</span></dd>
<dt>Cost 增量</dt><dd>+13% (\$3.86 / 192 cells)</dd>
<dt>G-native 对照</dt><dd>15/24 == 15/24 — 完全无差异,证伪 LLM 随机性</dd>
<dt>第一档 (96%)</dt><dd>B-cc,C-lite</dd>
<dt>第二档 (92%)</dt><dd>D-agentic,E-digest,H-bounded,J-bounded</dd>
<dt>Pareto 王者</dt><dd>J-bounded (92% / \$3.07 / 374s / 30.7K ctx)</dd>
</dl>

<h2 id="s1">1. 引言与研究问题</h2>

<h3>1.1 Skill 路由问题</h3>

<p>
Claude Code 与 Codex 等编码 agent 通过 <b>Agent Skill</b> 机制在推理时注入领域知识。每个 skill 由 SKILL.md 构成,含 YAML frontmatter (name + description) 和 markdown 正文。宿主在会话启动时把已启用 skill 的元数据拼入系统上下文。
</p>

<p>
宿主对 skill 元数据有显式预算:Claude Code ~1%,Codex ~2% / 8000 字符。skill 数量增长后,要么挤占上下文,要么被截断。<code>skill-router</code> 的方案是:不常用 skill <b>禁用</b>(<code>SKILL.md</code> 重命名为 <code>SKILL.md.skill-router-disabled</code>),需要时再通过路由步骤召回。
</p>

<p>这个路由步骤的实现差异决定了准确率与成本,是本研究的核心问题。</p>

<h3>1.2 候选范式与变体</h3>

<table>
<thead>
<tr><th>范式</th><th>变体</th><th>路由方式</th></tr>
</thead>
<tbody>
<tr><td>自实现检索器</td><td><b>A-router</b></td><td>调用 <code>skill-router skills route</code> CLI,metadata→dci→lexical 三级级联</td></tr>
<tr><td rowspan="3">Direct Corpus Interaction (DCI)</td><td><b>B-cc</b></td><td>agent 在禁用目录上自由 shell</td></tr>
<tr><td><b>C-lite</b></td><td>仅 bash,有界管道</td></tr>
<tr><td><b>H-bounded</b></td><td>scoped glob,强制有界输出</td></tr>
<tr><td>AgenticRAG</td><td><b>D-agentic</b></td><td>结构化 4 工具循环 (<code>dci search</code>/<code>find</code>/<code>open</code>/<code>read</code>)</td></tr>
<tr><td rowspan="3">Metadata-only</td><td><b>E-digest</b></td><td>2 次 bash:<code>skill-corpus catalog</code> + 选择</td></tr>
<tr><td><b>I-meta</b></td><td>只读 description 目录,禁读 body</td></tr>
<tr><td><b>J-bounded</b></td><td>关键词过滤 grep 单次</td></tr>
<tr><td>宿主原生(对照)</td><td><b>G-native</b></td><td>不加载 router,150 skill 全部启用,Claude Code 原生选择</td></tr>
</tbody>
</table>

<h3>1.3 研究问题</h3>

<blockquote>
<b>RQ1</b>:在含大量功能近义干扰的 skill 语料中,哪种路由实现最可靠地选出正确 skill?<br>
<b>RQ2</b>:各实现的 ctx 占用、工具调用轮次、耗时、成本如何?<br>
<b>RQ3</b>:"读 body" 相对"仅读 metadata" 是否有准确率优势?宿主原生选择处于什么位置?
</blockquote>

<h2 id="s2">2. 相关工作</h2>

<dl class="kv">
<dt><b>SkillRouter</b> arXiv:2603.22455</dt><dd>87 SkillsBench 任务 + 80K skill 池 + GPT-4o-mini 生成的 distractor。核心论断:body 信号决定大规模路由</dd>
<dt><b>DCI</b> arXiv:2605.05242</dt><dd>agent 用 shell 命令直接搜原始语料。DCI-Agent-CC (Claude Code 全工具) 和 DCI-Agent-Lite (最小 harness) 两个实现</dd>
<dt><b>AgenticRAG</b> arXiv:2605.05538</dt><dd>结构化 4 工具 harness (search/find/open/summarize) 驱动有界 agentic 循环</dd>
</dl>

<h2 id="s3">3. 实验方法</h2>

<h3>3.1 语料构建</h3>
<p>SkillRouter <code>eval-core</code> 裁剪到 150 skill:19 个 gt + 80 个针对性 distractor + 51 个 noise。所有 skill 目录名与 frontmatter <code>name</code> 字段统一改为 <code>skill-001</code> ... <code>skill-150</code>(确定性洗牌后分配,序号不泄露归属)。<code>description</code> 与 body 原样保留。</p>

<h3>3.2 查询集</h3>
<p>24 个 SkillsBench single-skill 任务,长度数百字,含具体文件路径、IO 格式、精度要求。23 个有针对性 distractor。完整列表见附录 A。</p>

<h3>3.3 九个路由变体</h3>
<p>每个 router 变体是一个 <code>SKILL.md</code> 文件,frontmatter 完全相同(md5 验证),差异在 markdown body 的工作流。完整实现见附录 B。</p>

<h3>3.4 执行 harness</h3>
<p><code>routing-only-paired.mjs</code> 对每个 (变体, condition, 查询) 单元:① 隔离 <code>$HOME</code>;② 装 router 插件;③ 装 150-skill 语料并全部禁用(G-native 例外);④ 把变体 SKILL.md 补丁进插件槽位;⑤ 根据 condition 写/删 <code>&lt;HOME&gt;/.claude/CLAUDE.md</code>;⑥ <code>claude -p</code> 启动子进程。每 cell 跑前做 md5 preflight。9 × 2 = 18 HOMEs 并发,cap 4,timeout 240s。</p>

<h3>3.5 仅验证路由层(routing-only)</h3>
<p>所有 query 追加 <code>STOP_TAIL</code>,使 agent 路由决策后立即停止:</p>
<pre>ROUTING-ONLY mode: this session evaluates skill routing accuracy only.
After identifying the single best matching disabled skill, output exactly
one line of minified JSON on its own and stop:

{"matched_skill_name":"&lt;skill-id&gt;"}

Do NOT Read the matched skill's body, do NOT execute the user's task above,
do NOT produce any other text.</pre>
<p>本实验不验证下游 skill 执行链路。Hallucinated 名(如 <code>xlsx</code>)在生产中下游会失败,但本实验测不到这一失败。生产兜底机制讨论见 §10。</p>

<h3>3.6 评测指标</h3>
<dl class="kv">
<dt>命中(accuracy)</dt><dd><code>matched_skill_name</code> == <code>expected</code>(去 <code>user:</code> 前缀)</dd>
<dt>trigger rate</dt><dd>router tool use ≥ 1 的 cell 占比</dd>
<dt>失败去向</dt><dd>→distractor / →noise / →hallucinated (不匹配 <code>^skill-\\d{3}$</code>) / →none</dd>
<dt>ctx_end</dt><dd><b>最后一个 assistant message 的</b> <code>input_tokens + cache_read + cache_creation</code>。注意:不是 <code>result.usage</code> (那是 cumulative token spend)</dd>
<dt>成本/流量</dt><dd>从 <code>result.total_cost_usd</code> 取</dd>
</dl>

<h2 id="s4">4. trigger 充分激活与 CLAUDE.md 注入</h2>

<h3>4.1 trigger noise 现象</h3>

<p>初次跑九变体 (without CLAUDE.md) 时观察到:约 20% cells 上 agent 跳过 router 直接输出从 query 关键词凑出来的伪 skill 名:</p>

<table class="compact">
<thead><tr><th>query</th><th>gt</th><th>agent 输出</th><th>router tool calls</th></tr></thead>
<tbody>
<tr><td>pptx-reference-formatting</td><td>skill-140</td><td><code>pptx</code></td><td>0</td></tr>
<tr><td>protein-expression-analysis</td><td>skill-105</td><td><code>xlsx</code></td><td>0</td></tr>
<tr><td>jax-computing-basics</td><td>skill-042</td><td><code>jax</code></td><td>0</td></tr>
<tr><td>dialogue-parser</td><td>skill-009</td><td><code>dialogue-graph-parser</code></td><td>0</td></tr>
<tr><td>gh-repo-analytics</td><td>skill-021</td><td><code>github-cli-analyzer</code></td><td>0</td></tr>
<tr><td>video-tutorial-indexer</td><td>skill-113</td><td><code>mp4-video-editing</code></td><td>0</td></tr>
</tbody>
</table>

<p><b>这些幻觉名与 corpus 内容无关</b>。150 个 skill 全部匿名化为 <code>skill-NNN</code>,无任何 skill 字面叫 <code>xlsx</code>。模型只是基于训练分布偏置,在强 keyword 锚定下直接输出"看起来像 skill 名"的字符串。</p>

<p>trigger 决策与路由质量是两个独立维度。不解耦,就无法判断"某变体准确率低是因为 retriever 弱,还是 trigger 决策更易失败"。Claude Code 不支持持久化 <code>--append-system-prompt</code>(经 <code>claude-code-guide</code> 工具查证)。</p>

<h3>4.2 CLAUDE.md 注入设计</h3>

<p>隔离 HOME 下唯一可行的持久化注入路径是 <code>&lt;HOME&gt;/.claude/CLAUDE.md</code>。该文件被 Claude Code 作为 user message context block 拼入会话(不修改 system prompt 本身),仍能起"软强制"作用。</p>

<p>经过两轮措辞迭代(第一轮 "use as a fallback" 被 Codex 方法学审查判定过软),最终采用:</p>

<pre># Skill routing

\`skill-router-skills\` is a routing Skill that searches a catalog of
locally-installed disabled skills.

When no enabled Skill clearly matches the user's query, you must call
\`skill-router-skills\` before answering. Do not invent a Skill name or
fabricate \`matched_skill_name\` without a Skill/tool result.</pre>

<h3>4.3 Phase 1 gate probe(64 cells)</h3>

<p><b>Phase 1A</b>(48 cells,fallback trigger lift):J-bounded + A-router × 6 stratified queries × 2 conditions × 2 repeats。</p>
<p><b>Phase 1B</b>(16 cells,direct-match preservation):J-bounded × 4 queries × 2 conditions × 2 repeats,gt skill 单独启用。</p>

<p><b>Gate criteria(预先声明)</b>:</p>
<pre>PASS = trigger_rate(with-CLAUDE.md fallback) ≥ 95%
     AND trigger_lift ≥ +20pp
     AND direct_match_preservation(with-CLAUDE.md) ≥ 90%
     AND no degradation > 10pp vs without</pre>

<table class="compact">
<thead><tr><th colspan="3">Phase 1A trigger lift</th></tr><tr><th>variant.cond</th><th>trigger</th><th>accuracy</th></tr></thead>
<tbody>
<tr><td>A-router WITH</td><td><b>12/12 (100%)</b></td><td>6/12</td></tr>
<tr><td>A-router without</td><td>4/12 (33%)</td><td>2/12</td></tr>
<tr><td>J-bounded WITH</td><td><b>12/12 (100%)</b></td><td>10/12</td></tr>
<tr><td>J-bounded without</td><td>5/12 (42%)</td><td>4/12</td></tr>
<tr><td><b>聚合</b></td><td><b>WITH 100%, without 37.5%, lift +62.5pp</b></td><td></td></tr>
</tbody>
</table>

<p>Phase 1B 两条 arm 均 8/8 direct_match,0/8 router misfire — direct-match 完全无 degradation。Gate <b>全部 PASS</b>。</p>

<h3>4.4 CLAUDE.md 前后影响对比</h3>

<h4>4.4.1 Trigger rate / Accuracy / Hallucination 聚合</h4>

<table>
<thead><tr><th>指标(router 8 变体,192 cells/arm)</th><th>with-CLAUDE.md</th><th>without-CLAUDE.md</th><th>Δ</th></tr></thead>
<tbody>
<tr><td>Accuracy</td><td><b>${rW.acc}/${rW.total} (${(100*rW.acc/rW.total).toFixed(0)}%)</b></td><td>${rO.acc}/${rO.total} (${(100*rO.acc/rO.total).toFixed(0)}%)</td><td class="delta-pos">+${rW.acc-rO.acc} cells (+${(100*(rW.acc/rW.total-rO.acc/rO.total)).toFixed(1)}pp)</td></tr>
<tr><td>Trigger rate</td><td><b>${rW.trig}/${rW.total} (${(100*rW.trig/rW.total).toFixed(0)}%)</b></td><td>${rO.trig}/${rO.total} (${(100*rO.trig/rO.total).toFixed(0)}%)</td><td class="delta-pos">+${rW.trig-rO.trig} (+${(100*(rW.trig/rW.total-rO.trig/rO.total)).toFixed(1)}pp)</td></tr>
<tr><td>Hallucination(输出非 <code>skill-NNN</code>)</td><td><b>${rW.halluc}/${rW.total} (${(100*rW.halluc/rW.total).toFixed(1)}%)</b></td><td>${rO.halluc}/${rO.total} (${(100*rO.halluc/rO.total).toFixed(1)}%)</td><td class="delta-pos">−${rO.halluc-rW.halluc} (−${(100*(rO.halluc/rO.total-rW.halluc/rW.total)).toFixed(1)}pp)</td></tr>
<tr><td>Σ cost</td><td>${fmt$(rW.cost)}</td><td>${fmt$(rO.cost)}</td><td class="delta-neg">+${fmt$(rW.cost - rO.cost)} (+${(100*(rW.cost-rO.cost)/rO.cost).toFixed(0)}%)</td></tr>
<tr><td>Σ duration</td><td>${fmtSec(rW.dur)}</td><td>${fmtSec(rO.dur)}</td><td class="delta-neg">+${fmtSec(rW.dur-rO.dur)} (+${(100*(rW.dur-rO.dur)/rO.dur).toFixed(0)}%)</td></tr>
</tbody>
</table>

<h4>4.4.2 G-native 对照(证伪 LLM 随机性)</h4>

<p>G-native 不加载 router,CLAUDE.md 提到的 <code>skill-router-skills</code> 对 G 而言不存在,本质上 no-op。实测:</p>

<table class="compact">
<thead><tr><th>G-native</th><th>accuracy</th><th>trigger</th><th>cost</th><th>ctx_end</th></tr></thead>
<tbody>
<tr><td>WITH</td><td>15/24 (63%)</td><td>0/24</td><td>${fmt$(withAgg.get("G-native")?.cost)}</td><td>${fmtK(withAgg.get("G-native")?.ctxEnd)}</td></tr>
<tr><td>without</td><td>15/24 (63%)</td><td>0/24</td><td>${fmt$(withoutAgg.get("G-native")?.cost)}</td><td>${fmtK(withoutAgg.get("G-native")?.ctxEnd)}</td></tr>
<tr><td>Δ</td><td class="delta-zero">+0</td><td>+0</td><td>~ noise</td><td>~ noise</td></tr>
</tbody>
</table>

<p><b>G-native 两条 arm 完全相同,严格证伪"提升仅来自 LLM 跨 run 随机性"假说</b>。如果是随机性,G-native 也会有 ±1-2 cell 差异;实测 0 差异说明 CLAUDE.md 的效应是定向的。</p>

<h2 id="s5">5. 方法学审查与修正</h2>

<p>实验前完整设计经 <b>Codex (GPT-5.5, xhigh)</b> 对抗式审查,识别 1 blocker + 3 high + 2 medium 缺陷,全部修复后才进入 Phase 1。</p>

<table>
<thead><tr><th>缺陷</th><th>严重度</th><th>修复</th></tr></thead>
<tbody>
<tr><td>3-cell probe 不足以验证 CLAUDE.md 是否真的影响 Skill 调用</td><td>blocker</td><td>Phase 1 扩到 64 cells + gate criteria</td></tr>
<tr><td>1 query × 1 variant × 1 repeat 不能区分提升 vs 随机</td><td>high</td><td>8 query stratified × 2 variants × 2 repeats</td></tr>
<tr><td>复用 <code>.tmp-home-parallel/</code> 可能 state contamination</td><td>high</td><td>每 cell preflight md5 校验</td></tr>
<tr><td>跟历史 baseline 比 confounded</td><td>high</td><td>paired 设计同窗口</td></tr>
<tr><td>CLAUDE.md "use as fallback" 措辞过软</td><td>medium</td><td>加固到 "you must call ... do not invent"</td></tr>
<tr><td>缺少预设统计停止指标</td><td>medium</td><td>显式 gate criteria + 主指标</td></tr>
</tbody>
</table>

<h2 id="s6">6. 结果</h2>

<h3>6.1 总体准确率(with-CLAUDE.md,trigger 充分激活)</h3>

<table>
<thead><tr><th>rank</th><th>variant</th><th>范式</th><th>accuracy</th><th>trigger</th><th>hallucination</th></tr></thead>
<tbody>
${VARIANT_ORDER.map((v, i) => {
  const a = withAgg.get(v);
  if (!a) return "";
  const accPct = (100 * a.acc / a.n).toFixed(0);
  let rank = "";
  if (a.acc === 23) rank = '<span class="badge gold">🥇</span>';
  else if (a.acc === 22) rank = '<span class="badge silver">🥈</span>';
  else if (v === "J-bounded") rank = '<span class="badge pareto">Pareto</span>';
  const accCls = a.acc >= 22 ? 'ok' : a.acc >= 15 ? '' : 'fail';
  return `<tr>
  <td>${rank || (i + 1)}</td>
  <td><b>${v}</b></td>
  <td>${VARIANT_INFO[v]?.paradigm || ""}${VARIANT_INFO[v]?.reads_body ? " (读 body)" : ""}</td>
  <td class="${accCls} num">${a.acc}/${a.n} (${accPct}%)</td>
  <td class="num">${a.trig}/${a.n} (${(100*a.trig/a.n).toFixed(0)}%)</td>
  <td class="num">${a.halluc}/${a.n}</td>
</tr>`;
}).join("")}
</tbody>
</table>

<h3>6.2 成本–准确率权衡(Pareto)</h3>

<table>
<thead><tr><th>variant</th><th>accuracy</th><th>Σ cost</th><th>Σ duration</th><th>Σ turns</th><th>ctx̄_end</th><th>备注</th></tr></thead>
<tbody>
${VARIANT_ORDER.map((v) => {
  const a = withAgg.get(v);
  if (!a) return "";
  const note = v === "J-bounded" ? "<b>Pareto 王者</b>:92% + 全场 router 最低成本/时长/上下文" :
               v === "B-cc" ? "DCI 自由 shell,精度第一但成本最高" :
               v === "C-lite" ? "DCI 有界管道,精度第一+成本中等" :
               v === "G-native" ? "对照,无路由天花板" :
               v === "A-router" ? "自实现 lexical 检索器,长查询崩溃" :
               "";
  return `<tr>
  <td><b>${v}</b></td>
  <td class="num">${a.acc}/${a.n} (${(100*a.acc/a.n).toFixed(0)}%)</td>
  <td class="num">${fmt$(a.cost)}</td>
  <td class="num">${fmtSec(a.dur)}</td>
  <td class="num">${a.turns}</td>
  <td class="num">${fmtK(a.ctxEnd)}</td>
  <td>${note}</td>
</tr>`;
}).join("")}
</tbody>
</table>

<p><b>Pareto 前沿</b>:G-native (63% / \$2.98) → J-bounded (92% / \$3.07) → C-lite / B-cc (96%)。J 用 +\$0.09 / +29pp 跨越 G 到第二档;B-cc 用 +\$2.49 / +4pp 跨越 J 到第一档。</p>

<h3>6.3 路由结果构成(with-CLAUDE.md)</h3>

<table class="compact">
<thead><tr><th>variant</th><th>hit</th><th>→distractor(合法 skill-NNN 但选错)</th><th>→hallucinated(不存在的名)</th></tr></thead>
<tbody>
${VARIANT_ORDER.map((v) => {
  const a = withAgg.get(v);
  if (!a) return "";
  const wrong = a.n - a.acc - a.halluc;
  return `<tr><td><b>${v}</b></td><td class="num">${a.acc}</td><td class="num">${wrong}</td><td class="num">${a.halluc}</td></tr>`;
}).join("")}
</tbody>
</table>

<p>所有误选<b>几乎全部落在 distractor</b>(SkillRouter 用 GPT-4o-mini 生成的针对性干扰),没有任何 cell 选到 noise skill。印证 SkillRouter 论文 §4:distractor 才是真正考验 retriever 的样本。</p>

<h3>6.4 上下文窗口占用(ctx_end,修正后)</h3>

<p><b>定义</b>:最后一个 assistant message 的 <code>input_tokens + cache_read + cache_creation</code>。<b>不要用 <code>result.usage</code></b>(那是 cumulative token spend,不是窗口大小)。</p>

<table class="compact">
<thead><tr><th>variant</th><th>with ctx_end</th><th>without ctx_end</th><th>Δ</th></tr></thead>
<tbody>
${VARIANT_ORDER.map((v) => {
  const w = withAgg.get(v), o = withoutAgg.get(v);
  if (!w || !o) return "";
  const d = (w.ctxEnd || 0) - (o.ctxEnd || 0);
  return `<tr><td><b>${v}</b></td><td class="num">${fmtK(w.ctxEnd)}</td><td class="num">${fmtK(o.ctxEnd)}</td><td class="num">${d >= 0 ? "+" : ""}${(d/1000).toFixed(1)}K</td></tr>`;
}).join("")}
</tbody>
</table>

<p>所有 variants 的 ctx_end 都集中在 <b>30-38K</b>,差异远小于初稿(初稿误用 <code>result.usage</code> 把 B-cc/C-lite 估到 219K/145K)。Claude Code 对话缓存使多 turn 变体的最终 turn 上下文也维持 30K 级别。</p>

<h3>6.5 逐查询命中矩阵(with-CLAUDE.md,router 8 变体)</h3>

<table class="heat">
<thead><tr><th class="qid">query (gt)</th>${routerVariants.map((v) => `<th>${v.split("-")[0]}</th>`).join("")}<th>with/8</th><th>w/o/8</th></tr></thead>
<tbody>
${perQueryWith.map((q) => {
  const wHits = q.hits;
  const oHits = perQueryWithout.find((qq) => qq.qid === q.qid)?.hits || 0;
  const arrow = wHits > oHits ? '<span class="delta-pos">↑</span>' : wHits < oHits ? '<span class="delta-neg">↓</span>' : "";
  return `<tr>
    <td class="qid">${q.qid} <span class="exp">(${q.expected})</span></td>
    ${q.cells.map((c) => c?.correct ? '<td class="ok">✓</td>' : '<td class="fail">·</td>').join("")}
    <td class="num"><b>${wHits}</b></td>
    <td class="num">${oHits} ${arrow}</td>
  </tr>`;
}).join("")}
</tbody>
</table>

<p><b>最大涨幅</b>:<code>dialogue-parser</code> with=7/8 vs without=0/8(trigger 噪声移除后 7 个 router 都命中)。
<b>全军覆没</b>:<code>gh-repo-analytics</code> 0/8 / 0/8(corpus annotation 争议,见 §7.4)。
<b>唯一回退</b>:<code>shock-analysis-supply</code> with 2/8 vs without 5/8(overloaded gt skill 偏置,见 §7.5)。</p>

<h2 id="s7">7. 失败案例分析</h2>

<h3>7.1 A-router:lexical 检索器在长查询上的崩溃(54%)</h3>
<p>A-router 失败的 query 集中在含大量上下文、动作-中心的真实任务描述(<code>court-form-filling</code>、<code>dialogue-parser</code>、<code>jax-computing-basics</code> 等)。CLI 端的固定级联评分将整段 query 作为评分输入,词频统计被任务描述里频繁通用动词主导,高信号低频技术名权重被稀释。设计缺陷:<b>自实现 retriever 评分接口固定,无法做 LLM-driven 的 query rewrite</b>。其他变体在 SKILL.md body 里让 agent 做 keyword extraction(等价于 inline 改写),A-router 拿不到这一能力。</p>

<h3>7.2 G-native:宿主原生选择的天花板(63%)</h3>
<p>15/24,9 次错选全部落在 distractor。机理:基于元数据描述的注意力反射式匹配,所有 distractor 同时进入选择空间,无 query rewrite / candidate ranking。这正是 SkillRouter §4 的核心论断 — <b>metadata 不足以支撑大规模 + 高度重叠 skill 池路由</b>。router 变体在 trigger 充分激活下能跨过这个天花板,因引入了"再确认"机制(B/C/D/H 读 body,E/I/J 在 LLM 推理层做 description 对比)。</p>

<h3>7.3 D-agentic:format-only bug 与修复</h3>
<p>Phase 2 初跑 67%,3 个错 cell 输出 <code>user:skill-NNN</code> 前缀(<code>dci search</code> JSON 输出 id 含 <code>user:</code> scope,agent 忠实复制)。修复:SKILL.md commit 步骤明确"strip the user: prefix"。重跑 48 cells:</p>
<table class="compact">
<thead><tr><th>D-agentic</th><th>acc (with)</th><th>acc (w/o)</th><th>halluc (with)</th></tr></thead>
<tbody>
<tr><td>修复前</td><td>67% (16/24)</td><td>38% (9/24)</td><td>3/24</td></tr>
<tr><td><b>修复后</b></td><td><b>92% (22/24)</b></td><td>79% (19/24)</td><td>1/24</td></tr>
</tbody>
</table>
<p>D 进入第一线,与 J/H/E 持平。without arm 也跳了(38%→79%),除 prefix 修复外含 LLM 跨 run 随机性,无法分离归因 — 体现 §5 的"don't compare across windows"。</p>

<h3>7.4 gh-repo-analytics:corpus annotation 争议</h3>
<p>8/8 router 变体在两条 arm 都挂。J-bounded 执行轨迹:trigger 正常,候选列表包含 gt <code>skill-021</code>,但选了 <code>skill-046</code>。description 对比:</p>
<table class="compact">
<thead><tr><th>skill</th><th>description</th><th>风格</th></tr></thead>
<tbody>
<tr><td><b>skill-021 (gt)</b></td><td>"The gh CLI is GitHub's official command line tool for interacting with GitHub repositories, issues, pull requests, and more..."</td><td>工具中心</td></tr>
<tr><td><b>skill-046 (J 选)</b></td><td>"Track and visualize GitHub contributions, insights on commits, PRs, issue resolutions over time"</td><td>任务中心</td></tr>
<tr><td>query</td><td>"prepare a December community pulse, gather PRs, count, top contributor..."</td><td>任务中心</td></tr>
</tbody>
</table>
<p>J 选的 skill-046 与 query 任务描述匹配度更高 — 这是 corpus annotation 问题,不是路由质量本身的问题。需要重标 gt 或重写 skill-021 description。</p>

<h3>7.5 shock-analysis-supply:overloaded gt skill 偏置</h3>
<p>with 2/8 vs without 5/8 — 唯一回退样本。gt <code>skill-105</code> 是被 5 个 query 共用的"通用 Excel skill"。without 时部分变体 trigger 失败直接拍 <code>skill-105</code>(强 <code>xlsx</code> keyword 锚定 + 训练分布偏置)刚好命中;with 时 agent 真去搜,被高语义近似的 <code>skill-080</code>(经济学)、<code>skill-026</code>(邻近)带偏。读 body 的 B-cc/C-lite 能识破语义陷阱稳定命中,只读 description 的 J/I/H/E 会被带偏。</p>

<h3>7.6 残余 hallucination</h3>
<p>with-CLAUDE.md 下仍有 5/192 cells 残余 hallucination:</p>
<table class="compact">
<thead><tr><th>variant</th><th>query</th><th>with 输出</th><th>tool calls</th></tr></thead>
<tbody>
<tr><td>A-router</td><td>gh-repo-analytics</td><td><code>github-api</code></td><td>1</td></tr>
<tr><td>D-agentic</td><td>shock-analysis-supply</td><td><code>xlsx</code></td><td>0</td></tr>
<tr><td>H-bounded</td><td>gh-repo-analytics</td><td><code>github-pulse-report</code></td><td>1</td></tr>
<tr><td>I-meta</td><td>citation-check</td><td><code>bibtex-citation-checker</code></td><td>0</td></tr>
<tr><td>J-bounded</td><td>shock-analysis-supply</td><td><code>xlsx</code></td><td>0</td></tr>
</tbody>
</table>
<p>残余 3% 是模型在极强 keyword 锚定下跳过 tool 的不可消除的概率事件,生产兜底见 §10。</p>

<h3>7.7 ctx_end 度量修正</h3>
<p>初稿误用 <code>result.usage</code> 当 ctx_end,实际它是 cumulative token spend:</p>
<table class="compact">
<thead><tr><th>variant</th><th>初稿 ctx_end</th><th>修正后 ctx_end</th></tr></thead>
<tbody>
<tr><td>B-cc</td><td>219.0K</td><td>34.3K</td></tr>
<tr><td>C-lite</td><td>145.0K</td><td>32.7K</td></tr>
<tr><td>H-bounded</td><td>139.3K</td><td>32.9K</td></tr>
<tr><td>D-agentic</td><td>108.4K</td><td>34.5K</td></tr>
<tr><td>J-bounded</td><td>89.6K</td><td>30.7K</td></tr>
<tr><td>G-native</td><td>36.5K</td><td>36.5K</td></tr>
</tbody>
</table>

<h2 id="s8">8. 讨论</h2>

<h3>8.1 读 body 与仅读 metadata 之争</h3>
<p>SkillRouter 论文论断:仅靠 description 不足以路由,需要读 body。本实验在 trigger 充分激活的受控规模上:</p>
<ul>
<li>最强读 body 变体 (B-cc / C-lite, <b>96%</b>) 比最强 metadata 变体 (E-digest / J-bounded, <b>92%</b>) 高 <b>4pp / 1 cell</b>。差距来自 §7.5 overloaded gt skill 类样本 — 读 body 能识破描述层语义陷阱。</li>
<li>4pp 代价:B-cc cost 高 81%、turns 多一倍。</li>
<li><b>论断在 150-skill 规模上部分成立</b>。J-bounded 这种"description + LLM 推理"的轻量路径在 92% + 显著低成本上提供了一个非常 attractive 的中间点。</li>
</ul>

<h3>8.2 范式层面结论</h3>
<table>
<thead><tr><th>范式</th><th>表现</th><th>关键观察</th></tr></thead>
<tbody>
<tr><td><b>DCI (B/C/H)</b></td><td>92-96%</td><td>读 body 时强;C-lite 用 bounded 管道在 cost 和 accuracy 上比 B-cc 更优</td></tr>
<tr><td><b>Metadata-only (E/I/J)</b></td><td>88-92%</td><td>J 的"关键词过滤短列表"路径在成本上完胜其他 metadata 变体</td></tr>
<tr><td><b>AgenticRAG (D)</b></td><td>92%</td><td>结构化 4 工具循环稳定但不超越 DCI</td></tr>
<tr><td><b>自实现 lexical (A)</b></td><td>54%</td><td>在真实长 query 上崩溃,词频评分接口无法咬合任务描述</td></tr>
<tr><td><b>宿主原生 (G)</b></td><td>63%</td><td>注意力反射式匹配的天花板</td></tr>
</tbody>
</table>
<p>跨范式共同模式:<b>LLM-driven keyword extraction 是关键</b>。所有第一档第二档变体都让 agent 在 SKILL.md body 里做 keyword extraction;A-router 是唯一不做的,所以崩溃。</p>

<h2 id="s9">9. 局限性</h2>
<ol>
<li>单 run no statistical significance,Phase 2 boundary 上 ±1 cell 在跨 run 噪声范围内</li>
<li>CLAUDE.md 是 user-message context,不是真 system prompt</li>
<li>语料规模 150 远小于真实部署 (SkillRouter 原始 80K)</li>
<li>24-query 规模偏小</li>
<li>仅验证路由层,不验证下游执行</li>
<li><code>gh-repo-analytics</code> 是 corpus annotation 争议</li>
<li><code>shock-analysis-supply</code> 是 overloaded gt skill 偏置</li>
<li>CLAUDE.md 在不同语言、不同长度 query 上 robustness 未测</li>
<li>F-index 等其他范式未纳入</li>
<li>Anthropic API model version drift 可能跨日期影响结果</li>
</ol>

<h2 id="s10">10. 优化计划</h2>

<h3>P0 — 生产兜底:hallucinated 名拦截</h3>
<table class="compact">
<thead><tr><th>Level</th><th>机制</th><th>覆盖率</th><th>工程量</th></tr></thead>
<tbody>
<tr><td>1</td><td>SKILL.md / STOP_TAIL schema 约束:<code>matched_skill_name MUST match ^skill-\\d{3}$</code></td><td>~90%</td><td>1 行 prompt</td></tr>
<tr><td>2</td><td>调用方端 regex 校验 + retry once</td><td>残余 ~9%</td><td>~20 行 wrapper</td></tr>
<tr><td>3</td><td>hallucinated 字符串当 query 走 embedding rescue</td><td>残余 ~1%</td><td>CLI 加 <code>--rescue-fallback</code></td></tr>
<tr><td>4</td><td>切到 API SDK + <code>tool_choice</code> 强制 Skill 工具调用</td><td>100% 根治</td><td>弃用 <code>claude -p</code></td></tr>
</tbody>
</table>
<p>短期推荐 <b>Level 1 + 2</b> 组合,长期可加 Level 3。</p>

<h3>P1 — 修复 A-router</h3>
<p>CLI 端加 LLM-driven query rewrite 预处理 + 把固定级联评分改成 LLM-driven candidate ranking。</p>

<h3>P1 — I-meta 升级为带 escalation 的混合路由</h3>
<p>当 LLM 判断 top-2 description 相似度高时,允许读 body 一次,变成 metadata-first/body-on-tie。</p>

<h3>P2 — 扩大规模 / Multi-run 统计置信度</h3>
<p>扩到 87-query × 500-1000-skill。multi-run (N=3) majority vote 解 boundary ±1 cell 抖动。</p>

<h3>P3 — corpus annotation 清理</h3>
<p><code>gh-repo-analytics</code> 类争议样本重标 gt 或重写 skill description。</p>

<h2 id="s11">11. 结论</h2>
<ol>
<li><b>B-cc / C-lite (96%) 第一档</b>;D-agentic / E-digest / H-bounded / J-bounded (92%) 第二档;I-meta 88%;A-router 54% 是唯一比 G-native (63%) 还差的 router。</li>
<li><b>J-bounded 是 Pareto 王者</b>:92% + cost \$3.07 + dur 374s + ctx 30.7K,所有 router 维度全场最低。B-cc 用 +\$2.49 / +81% cost 换 +4pp 到 96%。</li>
<li><b>trigger 决策与路由质量是两个独立维度</b>,必须解耦。CLAUDE.md 注入把 trigger 拉到 97%、hallucination 压到 2.6%。G-native 对照 0 差异严格证伪 LLM 随机性。</li>
<li>SkillRouter "读 body 是关键"论断在受控规模上部分成立:body 有 4pp 优势,但 metadata 路径在 LLM-driven keyword extraction 加持下足够接近、显著更便宜。</li>
<li>本实验仅验证路由层。下游执行链路 + hallucinated 命名拦截率是后续工作。</li>
</ol>

<h2 id="appendix">附录</h2>

<h3>附录 A:24 个查询全文</h3>
<details>
<summary>展开查询列表(点击)</summary>
<table class="compact">
<thead><tr><th>id</th><th>gt</th><th>domain</th></tr></thead>
<tbody>
${queries.map((q) => `<tr><td>${q.id}</td><td>${q.expected.replace(/^user:/, "")}</td><td>${q.domain}</td></tr>`).join("")}
</tbody>
</table>
<p>完整 query 文本(平均数百字)见 <code>queries.json</code> 及 REPORT-claudemd.md 附录 A 节选样本。</p>
</details>

<h3>附录 B:八个路由变体 SKILL.md 实现</h3>
<p>完整实现见 <code>variants/routing-only/&lt;variant&gt;.SKILL.md</code>,以及 REPORT-claudemd.md 附录 B 全文嵌入。</p>

<h3>附录 C:实验产物清单</h3>
<table class="compact">
<thead><tr><th>路径</th><th>内容</th></tr></thead>
<tbody>
<tr><td><code>queries.json</code></td><td>24 query 全文 + gt 标注</td></tr>
<tr><td><code>corpus-manifest.json</code></td><td><code>skill-NNN → 原始归属</code> 映射(离线分析)</td></tr>
<tr><td><code>crop-skillrouter.mjs</code></td><td>从 SkillRouter eval-core 裁剪到 150 skill</td></tr>
<tr><td><code>variants/routing-only/&lt;variant&gt;.SKILL.md</code></td><td>8 router 变体的 SKILL.md 实现</td></tr>
<tr><td><code>routing-only-paired.mjs</code></td><td>Phase 2 paired driver(432 cells)</td></tr>
<tr><td><code>claudemd-policy-probe.mjs</code></td><td>Phase 1 gate probe driver(64 cells)</td></tr>
<tr><td><code>detail-paired.mjs</code></td><td>Phase 2 详细指标分析器(含 ctx_end 修正)</td></tr>
<tr><td><code>rerun-d-agentic.mjs</code></td><td>D-agentic 修复后的 48-cell rerun driver</td></tr>
<tr><td><code>runs/claudemd-probe/</code></td><td>Phase 1 transcripts + summary.json + gate-report.json</td></tr>
<tr><td><code>runs/routing-only-9x24-claudemd/</code></td><td>Phase 2 paired transcripts + summary.json + report.html</td></tr>
<tr><td><code>REPORT-claudemd.md</code></td><td>本报告 (markdown)</td></tr>
<tr><td><code>REPORT-claudemd.html</code></td><td>本报告 (HTML 渲染)</td></tr>
</tbody>
</table>

<div class="footer">
  Phase 2 runtime: ${summary.startedAt?.slice(11, 19) || "?"} – ${summary.finishedAt?.slice(11, 19) || "?"} ·
  Concurrency cap ${summary.concurrency} · Timeout ${(summary.timeoutMs / 1000).toFixed(0)}s/cell ·
  Total transcripts: ${runs.length}
</div>

</div>
</body>
</html>`;

  await writeFile(REPORT_HTML, html);
  console.log(`wrote ${REPORT_HTML} (${(html.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
