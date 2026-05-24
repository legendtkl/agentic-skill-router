#!/usr/bin/env node
// Phase 1 probe: validate `<HOME>/.claude/CLAUDE.md` as a trigger-lift
// mechanism for the skill-router-skills Skill.
//
// Design follows the Codex methodology review:
//   - Phase 1A (48 cells, fallback): 6 queries × 2 variants (J, A) × 2
//     conditions (with/without CLAUDE.md) × 2 repeats.
//     Corpus fully DISABLED, only skill-router-skills available; tests
//     whether CLAUDE.md raises router tool-call rate to >= 95%.
//   - Phase 1B (16 cells, direct-match preservation): 4 queries × 1
//     variant (J) × 2 conditions × 2 repeats. The ground-truth skill is
//     ENABLED so it's directly available; tests that CLAUDE.md does NOT
//     hijack the agent away from the direct match.
//
// Each cell runs under one of 6 isolated per-purpose HOMEs at
// `.tmp-home-claudemd-probe/<id>/`. Preflight assertions are run before
// every cell so state contamination from previous cells fails loudly.

import { spawn } from "node:child_process";
import {
  mkdir, writeFile, readFile, readdir, rename, copyFile, rm, cp, stat, unlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const BASE_HOME = join(EXP_DIR, ".tmp-home");
const PROBE_HOMES_DIR = join(EXP_DIR, ".tmp-home-claudemd-probe");
const VARIANTS_DIR = join(EXP_DIR, "variants", "routing-only");
const OUT_DIR = join(EXP_DIR, "runs", "claudemd-probe");
const TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 240_000;
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY) || 4;
const REPEATS = Number(process.env.REPEATS) || 2;

const STOP_TAIL = `

---
ROUTING-ONLY mode: this session evaluates skill routing accuracy only.
After identifying the single best matching disabled skill, output exactly
one line of minified JSON on its own and stop:

{"matched_skill_name":"<skill-id>"}

Do NOT Read the matched skill's body, do NOT execute the user's task above,
do NOT produce any other text. This overrides any "execute the task"
guidance in the skill router's instructions.`;

const CLAUDE_MD_TEXT = `# Skill routing

\`skill-router-skills\` is a routing Skill that searches a catalog of
locally-installed disabled skills.

When no enabled Skill clearly matches the user's query, you must call
\`skill-router-skills\` before answering. Do not invent a Skill name or
fabricate \`matched_skill_name\` without a Skill/tool result.
`;

// Phase 1A: trigger lift on disabled-corpus fallback path.
const FALLBACK_QUERY_IDS = [
  "pptx-reference-formatting",   // J baseline: 0-tool hallucinated "pptx"
  "protein-expression-analysis", // J baseline: 0-tool hallucinated "xlsx"
  "gh-repo-analytics",           // I-meta baseline: 0-tool hallucinated "github-cli-analytics"
  "dialogue-parser",             // stable in earlier 9x3 probe
  "citation-check",              // stable in earlier 9x3 probe
  "taxonomy-tree-merge",         // semantic-hard
];
const FALLBACK_VARIANTS = ["J-bounded", "A-router"];

// Phase 1B: direct-match preservation. The ground-truth skill is enabled,
// the router is also loaded. Agent must pick the gt skill, not the router.
const DM_CELLS = [
  { queryId: "protein-expression-analysis", gtSkill: "skill-105" },
  { queryId: "citation-check",              gtSkill: "skill-043" },
  { queryId: "dialogue-parser",             gtSkill: "skill-009" },
  { queryId: "taxonomy-tree-merge",         gtSkill: "skill-068" },
];
const DM_VARIANT = "J-bounded";

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function md5(s) {
  return createHash("md5").update(s).digest("hex").slice(0, 12);
}

// Rename SKILL.md <-> SKILL.md.skill-router-disabled inside `home/.claude/skills`.
// If `onlyEnable` is set, that one skill is enabled, all others disabled.
// Otherwise `target` ("enabled"|"disabled") is applied to every skill.
async function setCorpusState(home, target, onlyEnable = null) {
  const root = join(home, ".claude", "skills");
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  let renames = 0;
  for (const id of dirs) {
    const en = join(root, id, "SKILL.md");
    const dis = join(root, id, "SKILL.md.skill-router-disabled");
    const want = onlyEnable ? (id === onlyEnable) : (target === "enabled");
    if (want && existsSync(dis) && !existsSync(en)) {
      await rename(dis, en); renames++;
    } else if (!want && existsSync(en) && !existsSync(dis)) {
      await rename(en, dis); renames++;
    }
  }
  return renames;
}

async function prepareHome(homeId, variant, withClaudeMd, onlyEnable = null) {
  const home = join(PROBE_HOMES_DIR, homeId);
  await rm(home, { recursive: true, force: true });
  await cp(BASE_HOME, home, { recursive: true });
  if (onlyEnable) {
    await setCorpusState(home, "disabled", onlyEnable);
  } else {
    await setCorpusState(home, "disabled");
  }
  const pluginSkillMd = join(home, ".claude", "plugins", "cache", "local",
    "skill-router", "0.1.0", "skills", "skill-router-skills", "SKILL.md");
  await copyFile(join(VARIANTS_DIR, `${variant}.SKILL.md`), pluginSkillMd);
  await mkdir(join(home, "tmp"), { recursive: true });
  await mkdir(join(home, ".claude"), { recursive: true });
  const claudeMdPath = join(home, ".claude", "CLAUDE.md");
  if (withClaudeMd) {
    await writeFile(claudeMdPath, CLAUDE_MD_TEXT);
  } else {
    if (existsSync(claudeMdPath)) await unlink(claudeMdPath);
  }
  return home;
}

// Assert filesystem state matches expectations before spawning claude -p.
async function preflight(home, variant, withClaudeMd, expectedEnabled = null) {
  const pluginSkillMd = join(home, ".claude", "plugins", "cache", "local",
    "skill-router", "0.1.0", "skills", "skill-router-skills", "SKILL.md");
  const a = md5(await readFile(pluginSkillMd, "utf8"));
  const b = md5(await readFile(join(VARIANTS_DIR, `${variant}.SKILL.md`), "utf8"));
  if (a !== b) throw new Error(`Preflight: plugin SKILL.md md5 ${a} != expected ${b} for variant ${variant}`);
  const cmd = join(home, ".claude", "CLAUDE.md");
  const present = existsSync(cmd);
  if (present !== !!withClaudeMd) {
    throw new Error(`Preflight: CLAUDE.md present=${present} expected=${!!withClaudeMd}`);
  }
  const root = join(home, ".claude", "skills");
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  const enabledIds = dirs.filter((id) => existsSync(join(root, id, "SKILL.md")));
  if (expectedEnabled === null) {
    if (enabledIds.length !== 0) {
      throw new Error(`Preflight: expected fallback (0 enabled), got ${enabledIds.length} (${enabledIds.slice(0, 3).join(",")}...)`);
    }
  } else {
    if (enabledIds.length !== 1 || enabledIds[0] !== expectedEnabled) {
      throw new Error(`Preflight: expected only ${expectedEnabled} enabled, got [${enabledIds.join(",")}]`);
    }
  }
}

async function runCell({ home, variant, queryObj, label, phaseDir }) {
  const project = join(home, "project");
  await mkdir(project, { recursive: true });
  const env = { ...process.env, HOME: home, TMPDIR: join(home, "tmp") };
  const fullQuery = queryObj.query + STOP_TAIL;
  const pluginDir = join(home, ".claude", "plugins", "cache", "local", "skill-router", "0.1.0");
  const args = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
    "--plugin-dir", pluginDir,
  ];
  const out = join(phaseDir, `${label}.jsonl`);
  await mkdir(dirname(out), { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  log(`[${label}] spawn`);
  const child = spawn("claude", args, { env, cwd: project, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", (err) => {
    if (timedOut) return;
    timedOut = true;
    events.push({ type: "_run_error", error: `spawn failed: ${String(err).slice(0, 400)}` });
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk;
    let nl;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.trim()) {
        try { events.push(JSON.parse(line)); }
        catch { events.push({ type: "_raw", line }); }
      }
    }
  });
  child.stderr.on("data", (chunk) => { stderrBuf += chunk; });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5000);
  }, TIMEOUT_MS);
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  if (stdoutBuf.trim()) {
    try { events.push(JSON.parse(stdoutBuf)); }
    catch { events.push({ type: "_raw", line: stdoutBuf }); }
  }
  if (stderrBuf) events.push({ type: "_stderr", text: stderrBuf.slice(0, 4000) });
  if (timedOut) events.push({ type: "_run_error", error: `claude -p timed out after ${TIMEOUT_MS}ms` });
  await writeFile(out, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[${label}] exit=${exitCode} timedOut=${timedOut} dur=${dur}s events=${events.length}`);
  return { label, exitCode, timedOut, durationMs: Date.now() - t0 };
}

// Runs all cells assigned to one HOME serially. Each HOME has a fixed
// (variant, withClaudeMd, corpus-state). For Phase 1B we additionally
// toggle the corpus before each cell to enable a different gt skill.
async function runHome(homeSpec, cells, phaseDir) {
  const { homeId, variant, withClaudeMd } = homeSpec;
  log(`[${homeId}] preparing HOME (variant=${variant}, claudeMd=${withClaudeMd})`);
  const home = await prepareHome(homeId, variant, withClaudeMd);
  const results = [];
  for (const cell of cells) {
    try {
      if (cell.gtSkill) {
        // Phase 1B: toggle corpus to only-enable this query's gt skill.
        await setCorpusState(home, "disabled", cell.gtSkill);
      }
      await preflight(home, variant, withClaudeMd, cell.gtSkill || null);
      const res = await runCell({
        home, variant, queryObj: cell.queryObj, label: cell.label, phaseDir,
      });
      results.push({ ...cell, ...res, ok: true });
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      log(`[${cell.label}] error: ${err.message}`);
      results.push({ ...cell, ok: false, error: String(err).slice(0, 500) });
    }
  }
  return results;
}

async function runWithCap(items, cap, work) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]).catch((err) => ({ __error: String(err).slice(0, 500) }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, worker));
  return out;
}

async function main() {
  const queriesAll = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  const qById = new Map(queriesAll.map((q) => [q.id, q]));
  const fallbackQueries = FALLBACK_QUERY_IDS.map((id) => {
    const q = qById.get(id);
    if (!q) throw new Error(`fallback query id ${id} not in queries.json`);
    return q;
  });
  const dmQueries = DM_CELLS.map(({ queryId, gtSkill }) => {
    const q = qById.get(queryId);
    if (!q) throw new Error(`DM query id ${queryId} not in queries.json`);
    return { queryObj: q, gtSkill };
  });

  log(`PHASE 1A: ${FALLBACK_VARIANTS.length} variants × ${fallbackQueries.length} queries × 2 conditions × ${REPEATS} repeats = ${FALLBACK_VARIANTS.length * fallbackQueries.length * 2 * REPEATS} cells`);
  log(`PHASE 1B: 1 variant × ${dmQueries.length} queries × 2 conditions × ${REPEATS} repeats = ${dmQueries.length * 2 * REPEATS} cells`);

  const startedAt = new Date().toISOString();
  await mkdir(PROBE_HOMES_DIR, { recursive: true });
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const phase1aDir = join(OUT_DIR, "phase1a");
  const phase1bDir = join(OUT_DIR, "phase1b");
  await mkdir(phase1aDir, { recursive: true });
  await mkdir(phase1bDir, { recursive: true });

  // Build Phase 1A HOME assignments: 4 HOMEs, each owns 6 queries × REPEATS cells.
  const phase1aHomes = [];
  for (const variant of FALLBACK_VARIANTS) {
    for (const withClaudeMd of [true, false]) {
      const homeId = `phase1a-${variant}-${withClaudeMd ? "with" : "without"}`;
      const cells = [];
      for (const q of fallbackQueries) {
        for (let r = 1; r <= REPEATS; r++) {
          cells.push({
            queryObj: q,
            phase: "1A",
            variant,
            withClaudeMd,
            repeat: r,
            label: `${variant}.${withClaudeMd ? "with" : "without"}.${q.id}.r${r}`,
          });
        }
      }
      phase1aHomes.push({ homeId, variant, withClaudeMd, cells });
    }
  }

  // Build Phase 1B HOME assignments: 2 HOMEs (with/without), each owns 4 queries × REPEATS cells.
  const phase1bHomes = [];
  for (const withClaudeMd of [true, false]) {
    const homeId = `phase1b-${DM_VARIANT}-${withClaudeMd ? "with" : "without"}`;
    const cells = [];
    for (const { queryObj, gtSkill } of dmQueries) {
      for (let r = 1; r <= REPEATS; r++) {
        cells.push({
          queryObj,
          gtSkill,
          phase: "1B",
          variant: DM_VARIANT,
          withClaudeMd,
          repeat: r,
          label: `${DM_VARIANT}.${withClaudeMd ? "with" : "without"}.${queryObj.id}.r${r}`,
        });
      }
    }
    phase1bHomes.push({ homeId, variant: DM_VARIANT, withClaudeMd, cells });
  }

  // Phase 1A: 4 HOMEs run in parallel, cells within each HOME run serially.
  log(`PHASE 1A: launching ${phase1aHomes.length} HOMEs with concurrency ${CONCURRENCY}`);
  const phase1aResults = await runWithCap(phase1aHomes, CONCURRENCY,
    (h) => runHome(h, h.cells, phase1aDir));

  // Phase 1B: 2 HOMEs run in parallel after Phase 1A finishes.
  log(`PHASE 1B: launching ${phase1bHomes.length} HOMEs with concurrency ${CONCURRENCY}`);
  const phase1bResults = await runWithCap(phase1bHomes, CONCURRENCY,
    (h) => runHome(h, h.cells, phase1bDir));

  const finishedAt = new Date().toISOString();
  const allRuns = [
    ...phase1aResults.flatMap((r) => r.__error ? [{ __error: r.__error }] : r),
    ...phase1bResults.flatMap((r) => r.__error ? [{ __error: r.__error }] : r),
  ];

  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({
    startedAt,
    finishedAt,
    probeHomesDir: PROBE_HOMES_DIR,
    timeoutMs: TIMEOUT_MS,
    concurrency: CONCURRENCY,
    repeats: REPEATS,
    claudeMdText: CLAUDE_MD_TEXT,
    stopTail: STOP_TAIL,
    phase1a: {
      variants: FALLBACK_VARIANTS,
      queries: FALLBACK_QUERY_IDS,
      cellCount: FALLBACK_VARIANTS.length * FALLBACK_QUERY_IDS.length * 2 * REPEATS,
    },
    phase1b: {
      variant: DM_VARIANT,
      cells: DM_CELLS,
      cellCount: DM_CELLS.length * 2 * REPEATS,
    },
    runs: allRuns,
  }, null, 2));
  log(`summary -> ${join(OUT_DIR, "summary.json")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
