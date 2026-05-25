#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { buildSkillCorpusBm25Index, searchSkillCorpus, searchSkillCorpusBm25Index } from "../../src/corpus.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "runs", `corpus-ranker-scale-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const SIZES = (process.env.CORPUS_SCALE_SIZES || "150,80000").split(",").map((s) => Number(s.trim())).filter(Boolean);
const RANKERS = ["weighted", "bm25", "bm25-json-hot"];

const TARGETS = [
  {
    shortId: "skill-079",
    description: "Analyze 3D STL mesh files to calculate geometric volume, surface components, and model statistics.",
    metadata: { aliases: ["stl", "mesh volume"], tools: ["stl"], domains: ["3d geometry"], intents: ["volume calculation"] },
    query: { all: ["stl"], any: ["mesh", "volume", "3d"] },
  },
  {
    shortId: "skill-117",
    description: "Create PDDL travel planning problem instances for TPP solvers and agent planning benchmarks.",
    metadata: { aliases: ["pddl", "tpp"], tools: ["pddl"], domains: ["planning"], intents: ["travel planning problem"] },
    query: { all: ["pddl"], any: ["tpp", "planning", "solver"] },
  },
  {
    shortId: "skill-140",
    description: "Format PowerPoint PPTX references, citations, and slide bibliography sections.",
    metadata: { aliases: ["pptx references"], tools: ["pptx"], domains: ["presentation"], intents: ["reference formatting"] },
    query: { all: ["pptx"], any: ["reference", "citation", "presentation"] },
  },
  {
    shortId: "skill-021",
    description: "Analyze GitHub repositories, pull requests, issues, contributors, and repository activity metrics.",
    metadata: { aliases: ["github analytics"], tools: ["github"], domains: ["repository analytics"], intents: ["repo metrics"] },
    query: { all: ["github"], any: ["repo", "analytics", "contributors"] },
  },
  {
    shortId: "skill-043",
    description: "Check citation claims against evidence, references, papers, and quoted source material.",
    metadata: { aliases: ["citation check"], tools: ["references"], domains: ["evidence review"], intents: ["claim verification"] },
    query: { all: ["citation"], any: ["evidence", "reference", "claims"] },
  },
  {
    shortId: "skill-080",
    description: "Detrend economic time series and calculate correlations for GDP, indicators, and macro datasets.",
    metadata: { aliases: ["economic detrending"], tools: ["correlation"], domains: ["economics"], intents: ["time series detrending"] },
    query: { all: ["detrend"], any: ["correlation", "economic", "gdp"] },
  },
];

const NOISE_DOMAINS = [
  "analytics", "documents", "finance", "media", "planning", "search", "workflow", "visualization",
  "forms", "simulation", "biology", "education", "operations", "compliance", "translation", "database",
];
const NOISE_TOOLS = [
  "json", "csv", "xlsx", "pdf", "api", "sql", "python", "markdown", "browser", "dashboard",
  "calendar", "email", "images", "video", "charts", "logs",
];
const NOISE_ACTIONS = [
  "extract", "generate", "summarize", "validate", "transform", "classify", "merge", "compare",
  "index", "search", "report", "calculate", "review", "clean", "monitor", "configure",
];

function makeSkills(size) {
  const skills = [];
  for (const target of TARGETS) {
    skills.push(skill({
      id: `user:codex:${target.shortId}`,
      name: target.shortId,
      description: target.description,
      metadata: {
        name: target.shortId,
        description: target.description,
        aliases: target.metadata.aliases,
        tools: target.metadata.tools,
        domains: target.metadata.domains,
        intents: target.metadata.intents,
        examples: [],
        tags: [],
      },
    }));
  }
  for (let i = skills.length; i < size; i++) {
    const domain = NOISE_DOMAINS[i % NOISE_DOMAINS.length];
    const tool = NOISE_TOOLS[(i * 7) % NOISE_TOOLS.length];
    const action = NOISE_ACTIONS[(i * 13) % NOISE_ACTIONS.length];
    const secondary = NOISE_DOMAINS[(i * 17) % NOISE_DOMAINS.length];
    const target = TARGETS[i % TARGETS.length];
    const conflictEvery = i % 5 === 0;
    skills.push(skill({
      id: `user:codex:noise-${String(i).padStart(5, "0")}`,
      name: `noise-${String(i).padStart(5, "0")}`,
      description: conflictEvery
        ? `${action} ${target.metadata.tools[0]} ${target.metadata.domains[0]} workflow helper for generic ${secondary} reports.`
        : `${action} ${domain} ${tool} workflow helper for ${secondary} data reports and operational tasks.`,
      metadata: {
        name: `noise-${String(i).padStart(5, "0")}`,
        description: conflictEvery
          ? `${action} ${target.metadata.tools[0]} ${target.metadata.domains[0]} workflow helper.`
          : `${action} ${domain} ${tool} workflow helper.`,
        aliases: conflictEvery ? [`${target.metadata.tools[0]} ${action}`] : [`${domain} ${action}`],
        tools: conflictEvery ? [target.metadata.tools[0]] : [tool],
        domains: conflictEvery ? [target.metadata.domains[0], secondary] : [domain, secondary],
        intents: conflictEvery ? [`${action} ${target.metadata.tools[0]}`] : [`${action} ${tool}`],
        examples: [],
        tags: [domain, action],
      },
    }));
  }
  return skills;
}

function skill(opts) {
  return {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    metadata: opts.metadata,
    source: "user",
    pluginKey: null,
    skillMdPath: `/synthetic/${opts.name}/SKILL.md.skill-router-disabled`,
    isDisabled: true,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const rows = [];
  for (const size of SIZES) {
    const skills = makeSkills(size);
    let bm25Index = null;
    let bm25BuildMs = 0;
    for (const ranker of RANKERS) {
      if (ranker === "bm25" || ranker === "bm25-json-hot") {
        const buildStart = performance.now();
        bm25Index = buildSkillCorpusBm25Index(skills);
        bm25BuildMs = performance.now() - buildStart;
      }
      const serializedIndex = ranker === "bm25-json-hot" ? JSON.stringify(bm25Index) : null;
      const latencies = [];
      let top1 = 0;
      let top3 = 0;
      let totalMatches = 0;
      for (const target of TARGETS) {
        const start = performance.now();
        const result = ranker === "bm25" || ranker === "bm25-json-hot"
          ? searchSkillCorpusBm25Index(
            ranker === "bm25-json-hot" ? JSON.parse(serializedIndex) : bm25Index,
            { ...target.query, ranker: "bm25", limit: 30 },
          )
          : searchSkillCorpus(skills, { ...target.query, ranker, limit: 30 });
        latencies.push(performance.now() - start);
        const shortIds = result.matches.map((match) => match.shortId);
        if (shortIds[0] === target.shortId) top1++;
        if (shortIds.slice(0, 3).includes(target.shortId)) top3++;
        totalMatches += result.corpus.totalMatches;
      }
      rows.push({
        size,
        ranker,
        queries: TARGETS.length,
        top1,
        top3,
        avgMs: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)),
        p95Ms: Number(percentile(latencies, 0.95).toFixed(2)),
        maxMs: Number(Math.max(...latencies).toFixed(2)),
        buildMs: Number((ranker === "bm25" || ranker === "bm25-json-hot" ? bm25BuildMs : 0).toFixed(2)),
        indexDocs: ranker === "bm25" || ranker === "bm25-json-hot" ? bm25Index.corpus.indexed : 0,
        avgMatches: Number((totalMatches / TARGETS.length).toFixed(1)),
      });
    }
  }
  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({ rows }, null, 2));
  console.table(rows);
  console.log(`summary -> ${join(OUT_DIR, "summary.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
