#!/usr/bin/env node
// Merge disjoint Codex routing-only run directories into one reportable run.
//
// Default inputs:
//   runs/codex-routing-only-4x24  (G-native, C-lite, I-meta, J-bounded)
//   runs/codex-routing-only-5x24  (A-router, B-cc, D-agentic, E-digest, H-bounded)
// Output:
//   runs/codex-routing-only-9x24

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const OUT_DIR = resolve(process.env.CODEX_MERGE_OUT || join(EXP_DIR, "runs", "codex-routing-only-9x24"));
const SOURCE_DIRS = (process.env.CODEX_MERGE_SOURCES || [
  join(EXP_DIR, "runs", "codex-routing-only-4x24"),
  join(EXP_DIR, "runs", "codex-routing-only-5x24"),
].join(",")).split(",").map((s) => resolve(s.trim())).filter(Boolean);

const VARIANT_ORDER = [
  "G-native",
  "A-router",
  "B-cc",
  "C-lite",
  "D-agentic",
  "E-digest",
  "H-bounded",
  "I-meta",
  "J-bounded",
];

async function main() {
  const summaries = [];
  for (const dir of SOURCE_DIRS) {
    const summaryPath = join(dir, "summary.json");
    if (!existsSync(summaryPath)) throw new Error(`missing ${summaryPath}`);
    summaries.push({ dir, summary: JSON.parse(await readFile(summaryPath, "utf8")) });
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const variantsById = new Map();
  const runs = [];
  const variantStats = [];
  let queries = null;
  for (const { dir, summary } of summaries) {
    if (!queries) queries = summary.queries;
    const queryKey = JSON.stringify(summary.queries);
    if (queryKey !== JSON.stringify(queries)) {
      throw new Error(`query set mismatch in ${dir}`);
    }
    for (const variant of summary.variants) {
      if (variantsById.has(variant.id)) throw new Error(`duplicate variant ${variant.id}`);
      variantsById.set(variant.id, variant);
      const src = join(dir, variant.id);
      if (!existsSync(src)) throw new Error(`missing variant directory ${src}`);
      await cp(src, join(OUT_DIR, variant.id), { recursive: true });
    }
    runs.push(...summary.runs);
    variantStats.push(...(summary.variantStats || []));
  }

  const order = new Map(VARIANT_ORDER.map((id, i) => [id, i]));
  const variants = [...variantsById.values()].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  runs.sort((a, b) => {
    const av = order.get(a.variant) ?? 99;
    const bv = order.get(b.variant) ?? 99;
    return av - bv || a.queryId.localeCompare(b.queryId);
  });
  variantStats.sort((a, b) => (order.get(a.variant) ?? 99) - (order.get(b.variant) ?? 99));
  const variantIds = new Set(variants.map((v) => v.id));
  const queryIds = new Set((queries || []).map((q) => q.id));
  const requiredVariants = new Set(VARIANT_ORDER);
  const expectedRunCount = requiredVariants.size * queryIds.size;
  if (variantIds.size !== requiredVariants.size || [...requiredVariants].some((id) => !variantIds.has(id))) {
    throw new Error(`merged variants must be exactly ${[...requiredVariants].join(", ")}`);
  }
  if (runs.length !== expectedRunCount) {
    throw new Error(`merged run count mismatch: got ${runs.length}, expected ${expectedRunCount}`);
  }
  const seenRuns = new Set();
  for (const run of runs) {
    if (!variantIds.has(run.variant)) throw new Error(`run references unknown variant ${run.variant}`);
    if (!queryIds.has(run.queryId)) throw new Error(`run references unknown query ${run.queryId}`);
    const key = `${run.variant}\t${run.queryId}`;
    if (seenRuns.has(key)) throw new Error(`duplicate merged run ${run.variant}/${run.queryId}`);
    seenRuns.add(key);
  }
  for (const variant of variantIds) {
    for (const query of queryIds) {
      const key = `${variant}\t${query}`;
      if (!seenRuns.has(key)) throw new Error(`missing merged run ${variant}/${query}`);
    }
  }

  const summary = {
    startedAt: summaries.map((s) => s.summary.startedAt).sort()[0],
    finishedAt: summaries.map((s) => s.summary.finishedAt).sort().at(-1),
    model: summaries[0].summary.model,
    reasoningEffort: summaries[0].summary.reasoningEffort,
    homesDir: summaries[0].summary.homesDir,
    outDir: OUT_DIR,
    timeoutMs: summaries[0].summary.timeoutMs,
    variants,
    queries,
    variantStats,
    runs,
    mergedFrom: SOURCE_DIRS.map((dir) => basename(dir)),
    note: "Merged Codex routing-only run. STOP_TAIL appended to each query; matched_skill_name is the routing decision only.",
  };
  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`merged ${SOURCE_DIRS.length} runs -> ${join(OUT_DIR, "summary.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
