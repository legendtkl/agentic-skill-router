#!/usr/bin/env node
// Generate paper-grade SVG figures for the SkillRouter routing experiment.
// Reads runs/, queries.json, corpus-manifest.json; writes figures/*.svg.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS = join(__dirname, "runs");
const FIG = join(__dirname, "figures");

const VARIANTS = ["A-router", "B-cc", "C-lite", "D-agentic", "E-digest", "F-index", "G-native", "H-bounded", "I-meta", "J-bounded"];
const COLOR = {
  "A-router": "#3b82f6", "B-cc": "#10b981", "C-lite": "#f59e0b", "D-agentic": "#ef4444",
  "E-digest": "#8b5cf6", "F-index": "#0891b2", "G-native": "#64748b", "H-bounded": "#db2777",
  "I-meta": "#65a30d", "J-bounded": "#14b8a6",
};
const SHORT = { "A-router": "A", "B-cc": "B", "C-lite": "C", "D-agentic": "D", "E-digest": "E", "F-index": "F", "G-native": "G", "H-bounded": "H", "I-meta": "I", "J-bounded": "J" };

function detect(text, tools) {
  const m = text.match(/"matched_skill_path"\s*:\s*"([^"]+)"/);
  if (m) { const d = /\/skills\/([^/]+)\/SKILL\.md/.exec(m[1]); if (d) return `user:${d[1]}`; }
  for (const [tn, ti] of tools) {
    if (tn === "Skill" && ti && !String(ti.skill || "").startsWith("skill-router:")) return `user:${ti.skill}`;
  }
  const n = text.match(/"matched_skill_name"\s*:\s*"([^"]+)"/);
  if (n && n[1] && n[1] !== "null") return `user:${n[1]}`;
  return null;
}

async function loadAgg() {
  const queries = JSON.parse(await readFile(join(__dirname, "queries.json"), "utf8")).queries;
  const manifest = JSON.parse(await readFile(join(__dirname, "corpus-manifest.json"), "utf8")).skills;
  const agg = {};
  for (const v of VARIANTS) {
    // cr  = cache_read total (a billing-side accumulation, dominated by the
    //       fixed Claude Code system prompt re-read every turn — NOT a clean
    //       measure of how much skill corpus the routing actually ingested).
    // retr = tool_result payload tokens — the skill corpus the routing step
    //       genuinely pulled into context. This is the honest "routing
    //       context" metric.
    // endCtx = context-window OCCUPANCY at task end (a stock): the final
    //   assistant turn's input+cache_creation+cache_read. This is the honest
    //   "how much context did finding the skill consume" metric.
    // startCtx = first-turn occupancy (fixed Claude Code system prompt + the
    //   skill-router SKILL.md + the query, before any retrieval).
    const a = { hit: 0, toDist: 0, toNoise: 0, toNone: 0, tools: 0, turns: 0, ms: 0,
      inp: 0, out: 0, cc: 0, cr: 0, retr: 0, cost: 0,
      startCtxSum: 0, endCtxSum: 0, ctxRuns: 0 };
    for (const q of queries) {
      let text = "", tools = [];
      const ctxSeries = [];
      try {
        const lines = (await readFile(join(RUNS, v, `${q.id}.jsonl`), "utf8")).split(/\r?\n/).filter(Boolean);
        for (const ln of lines) {
          let e; try { e = JSON.parse(ln); } catch { continue; }
          if (e.type === "result") {
            text = e.result || "";
            const u = e.usage || {};
            a.turns += e.num_turns || 0; a.ms += e.duration_ms || 0; a.cost += e.total_cost_usd || 0;
            a.inp += u.input_tokens || 0; a.out += u.output_tokens || 0;
            a.cc += u.cache_creation_input_tokens || 0; a.cr += u.cache_read_input_tokens || 0;
          }
          if (e.type === "assistant") {
            for (const b of e.message.content) if (b.type === "tool_use") tools.push([b.name, b.input || {}]);
            const u = e.message.usage || {};
            const c = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
            if (c > 0 && (ctxSeries.length === 0 || ctxSeries[ctxSeries.length - 1] !== c)) ctxSeries.push(c);
          }
          if (e.type === "user") for (const b of (e.message?.content || [])) {
            if (b && b.type === "tool_result") {
              let o = b.content;
              if (Array.isArray(o)) o = o.map((x) => (x && typeof x === "object" ? x.text || "" : String(x))).join("");
              a.retr += Math.round((typeof o === "string" ? o.length : 0) / 4);
            }
          }
        }
      } catch { /* missing */ }
      a.tools += tools.length;
      if (ctxSeries.length) {
        a.startCtxSum += ctxSeries[0];
        a.endCtxSum += ctxSeries[ctxSeries.length - 1];
        a.ctxRuns++;
      }
      const sel = detect(text, tools);
      if (sel === q.expected) a.hit++;
      else if (!sel) a.toNone++;
      else {
        const o = manifest[sel.replace("user:", "")]?.origin;
        if (o === "distractor") a.toDist++;
        else if (o === "noise") a.toNoise++;
        else a.toNone++;
      }
    }
    const r = a.ctxRuns || 1;
    a.startCtx = Math.round(a.startCtxSum / r);
    a.endCtx = Math.round(a.endCtxSum / r);
    a.netCtx = a.endCtx - a.startCtx;
    agg[v] = a;
  }
  return { agg, n: queries.length };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const svgWrap = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="ui-sans-serif,system-ui,Arial">
<rect width="${w}" height="${h}" fill="#ffffff"/>
${body}
</svg>`;

// ---- Figure 1: accuracy bar ----
function figAccuracy(agg, n) {
  const W = 720, H = 400, ML = 92, MR = 70, MT = 54, MB = 40;
  const plotW = W - ML - MR, plotH = H - MT - MB;
  const bh = plotH / VARIANTS.length * 0.62;
  const gap = plotH / VARIANTS.length;
  let body = `<text x="${W / 2}" y="28" text-anchor="middle" font-size="16" font-weight="700">Figure 1. 路由准确率（命中数 / ${n}）</text>`;
  // gridlines
  for (let i = 0; i <= n; i += 4) {
    const x = ML + (i / n) * plotW;
    body += `<line x1="${x}" y1="${MT}" x2="${x}" y2="${MT + plotH}" stroke="#e5e7eb"/>`;
    body += `<text x="${x}" y="${MT + plotH + 22}" text-anchor="middle" font-size="11" fill="#6b7280">${i}</text>`;
  }
  VARIANTS.forEach((v, i) => {
    const y = MT + i * gap + (gap - bh) / 2;
    const w = (agg[v].hit / n) * plotW;
    body += `<text x="${ML - 10}" y="${y + bh / 2 + 4}" text-anchor="end" font-size="12" font-weight="600">${esc(v)}</text>`;
    body += `<rect x="${ML}" y="${y}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${COLOR[v]}"/>`;
    const pct = Math.round((agg[v].hit / n) * 100);
    body += `<text x="${ML + w + 8}" y="${y + bh / 2 + 4}" font-size="12" font-weight="700" fill="#111">${agg[v].hit}/${n} (${pct}%)</text>`;
  });
  return svgWrap(W, H, body);
}

// ---- Figure 2: cost vs accuracy scatter (Pareto) ----
function figPareto(agg, n) {
  const W = 720, H = 460, ML = 70, MR = 30, MT = 54, MB = 56;
  const plotW = W - ML - MR, plotH = H - MT - MB;
  const costs = VARIANTS.map((v) => agg[v].cost);
  const cMin = 2.5, cMax = Math.ceil(Math.max(...costs) * 2) / 2;
  const aMin = 0, aMax = n;
  const X = (c) => ML + ((c - cMin) / (cMax - cMin)) * plotW;
  const Y = (acc) => MT + plotH - ((acc - aMin) / (aMax - aMin)) * plotH;
  let body = `<text x="${W / 2}" y="28" text-anchor="middle" font-size="16" font-weight="700">Figure 2. 成本–准确率权衡（越靠左上越优）</text>`;
  // axes
  body += `<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + plotH}" stroke="#374151"/>`;
  body += `<line x1="${ML}" y1="${MT + plotH}" x2="${ML + plotW}" y2="${MT + plotH}" stroke="#374151"/>`;
  for (let acc = 0; acc <= n; acc += 4) {
    const y = Y(acc);
    body += `<line x1="${ML}" y1="${y}" x2="${ML + plotW}" y2="${y}" stroke="#eee"/>`;
    body += `<text x="${ML - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6b7280">${acc}</text>`;
  }
  for (let c = cMin; c <= cMax + 0.001; c += 0.5) {
    const x = X(c);
    body += `<text x="${x}" y="${MT + plotH + 20}" text-anchor="middle" font-size="11" fill="#6b7280">$${c.toFixed(1)}</text>`;
  }
  body += `<text x="${ML + plotW / 2}" y="${H - 14}" text-anchor="middle" font-size="12" fill="#374151">总成本 (USD, 24 queries)</text>`;
  body += `<text transform="translate(20,${MT + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#374151">命中数 / ${n}</text>`;
  // points
  for (const v of VARIANTS) {
    const x = X(agg[v].cost), y = Y(agg[v].hit);
    body += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="${COLOR[v]}" fill-opacity="0.85" stroke="#fff" stroke-width="1.5"/>`;
    body += `<text x="${(x + 12).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="11" font-weight="700" fill="#111">${esc(v)}</text>`;
  }
  return svgWrap(W, H, body);
}

// ---- Figure 3: outcome composition stacked bar ----
function figFailure(agg, n) {
  const W = 720, H = 400, ML = 92, MR = 130, MT = 54, MB = 40;
  const plotW = W - ML - MR, plotH = H - MT - MB;
  const gap = plotH / VARIANTS.length, bh = gap * 0.62;
  const seg = [["hit", "#10b981", "命中"], ["toDist", "#f59e0b", "误选 distractor"], ["toNoise", "#9ca3af", "误选 noise"], ["toNone", "#ef4444", "无匹配/无声明"]];
  let body = `<text x="${W / 2}" y="28" text-anchor="middle" font-size="16" font-weight="700">Figure 3. 路由结果构成</text>`;
  VARIANTS.forEach((v, i) => {
    const y = MT + i * gap + (gap - bh) / 2;
    body += `<text x="${ML - 10}" y="${y + bh / 2 + 4}" text-anchor="end" font-size="12" font-weight="600">${esc(v)}</text>`;
    let x = ML;
    for (const [k, col] of seg) {
      const w = (agg[v][k] / n) * plotW;
      if (w > 0) {
        body += `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}"/>`;
        if (w > 18) body += `<text x="${(x + w / 2).toFixed(1)}" y="${y + bh / 2 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${agg[v][k]}</text>`;
      }
      x += w;
    }
  });
  // legend
  seg.forEach(([, col, label], i) => {
    const ly = MT + 10 + i * 22;
    body += `<rect x="${W - MR + 6}" y="${ly}" width="13" height="13" fill="${col}"/>`;
    body += `<text x="${W - MR + 24}" y="${ly + 11}" font-size="11" fill="#374151">${esc(label)}</text>`;
  });
  return svgWrap(W, H, body);
}

// ---- Figure 4: context-window occupancy (stock, not flow) ----
// Each bar = task-end context occupancy = startCtx (fixed baseline, dark) +
// netCtx (what the routing actually added, light). This is the honest
// "context a routing run consumes", unlike the flow-accumulated cache_read.
function figResource(agg) {
  const W = 720, H = 420, ML = 92, MR = 96, MT = 62, MB = 44;
  const plotW = W - ML - MR, plotH = H - MT - MB;
  const gap = plotH / VARIANTS.length, bh = gap * 0.58;
  const maxEnd = Math.max(...VARIANTS.map((v) => agg[v].endCtx));
  const scale = plotW / (maxEnd * 1.04);
  let body = `<text x="${W / 2}" y="26" text-anchor="middle" font-size="16" font-weight="700">Figure 4. 上下文窗口占用（task 结束时的存量）</text>`;
  body += `<text x="${W / 2}" y="44" text-anchor="middle" font-size="11" fill="#6b7280">深色=起始占用（固定系统提示+SKILL.md+query）；浅色=路由过程净增；总长=task 结束时上下文 token</text>`;
  for (let g = 0; g <= maxEnd; g += 10000) {
    const x = ML + g * scale;
    body += `<line x1="${x}" y1="${MT}" x2="${x}" y2="${MT + plotH}" stroke="#eee"/>`;
    body += `<text x="${x}" y="${MT + plotH + 18}" text-anchor="middle" font-size="10" fill="#9ca3af">${g / 1000}K</text>`;
  }
  VARIANTS.forEach((v, i) => {
    const a = agg[v];
    const y = MT + i * gap + (gap - bh) / 2;
    body += `<text x="${ML - 10}" y="${y + bh / 2 + 4}" text-anchor="end" font-size="12" font-weight="600">${esc(v)}</text>`;
    const sw = a.startCtx * scale, nw = a.netCtx * scale;
    body += `<rect x="${ML}" y="${y}" width="${sw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${COLOR[v]}" fill-opacity="0.9"/>`;
    body += `<rect x="${(ML + sw).toFixed(1)}" y="${y}" width="${nw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${COLOR[v]}" fill-opacity="0.32"/>`;
    body += `<text x="${(ML + sw + nw + 7).toFixed(1)}" y="${y + bh / 2 + 4}" font-size="11" font-weight="700" fill="#111">${(a.endCtx / 1000).toFixed(1)}K</text>`;
  });
  return svgWrap(W, H, body);
}

const main = async () => {
  await mkdir(FIG, { recursive: true });
  const { agg, n } = await loadAgg();
  await writeFile(join(FIG, "fig1-accuracy.svg"), figAccuracy(agg, n));
  await writeFile(join(FIG, "fig2-pareto.svg"), figPareto(agg, n));
  await writeFile(join(FIG, "fig3-failure.svg"), figFailure(agg, n));
  await writeFile(join(FIG, "fig4-resource.svg"), figResource(agg));
  console.log(`wrote 4 figures to ${FIG}`);
  for (const v of VARIANTS) {
    const a = agg[v];
    console.log(`  ${v.padEnd(11)} hit=${a.hit}/${n} startCtx=${(a.startCtx/1000).toFixed(1)}K endCtx=${(a.endCtx/1000).toFixed(1)}K net=${(a.netCtx/1000).toFixed(1)}K tools=${a.tools} cost=$${a.cost.toFixed(2)}`);
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
