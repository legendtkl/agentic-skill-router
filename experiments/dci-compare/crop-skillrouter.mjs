#!/usr/bin/env node
// Crop the SkillRouter eval-core dataset into a ~150-skill routing benchmark.
//
// SkillRouter (arXiv:2603.22455) ships an 80K-skill pool — far too large to
// fit every variant's catalog into context. This script crops it to a
// controlled subset while keeping all routing-signal data third-party and
// unmodified:
//
//   * queries  = the single-skill SkillsBench tasks' instruction_text
//   * gt skill = each task's ground-truth skill (gt/* entity)
//   * targeted distractors = the GPT-4o-mini distractors SkillRouter
//     generated per gt skill (distractor/dist_<gt>_* entities) — "topically
//     plausible but wrong" siblings, the genuine near-confounders
//   * noise = random skills from the easy pool, padding to the cap
//
// ANSWER-LEAKAGE FIX: every installed skill is given a neutral, opaque
// directory name AND frontmatter name (`skill-001` ... `skill-NNN`), assigned
// after a deterministic shuffle so the numbering reveals nothing about
// gt/distractor/noise membership. Only `description` and the body text — the
// genuine routing signal — are preserved verbatim. The skill-NNN -> origin
// mapping is written to corpus-manifest.json for analysis only; the harness
// and the agent never see it.
//
// Usage: node crop-skillrouter.mjs [--src DIR] [--cap 150]
import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skillRouterEvalCorePath } from "../skillrouter-dataset.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const SRC = args.src;
const CAP = args.cap;
const OUT_DIR = join(__dirname, "skillrouter-skills");
const QUERIES_OUT = join(__dirname, "queries.json");
const MANIFEST_OUT = join(__dirname, "corpus-manifest.json");

function parseArgs(argv) {
  const out = { src: skillRouterEvalCorePath(), cap: 150 };
  for (const a of argv) {
    if (a.startsWith("--src=")) out.src = skillRouterEvalCorePath(a.slice(6));
    else if (a.startsWith("--cap=")) out.cap = Number(a.slice(6));
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

// Replace the `name:` field inside a SKILL.md YAML frontmatter block only.
function setFrontmatterName(body, newName) {
  if (!body.startsWith("---")) {
    return `---\nname: ${newName}\ndescription: ""\n---\n\n${body}`;
  }
  const end = body.indexOf("\n---", 3);
  if (end < 0) return body;
  const fm = body.slice(0, end);
  const rest = body.slice(end);
  const newFm = /^name:.*$/m.test(fm)
    ? fm.replace(/^name:.*$/m, `name: ${newName}`)
    : `${fm}\nname: ${newName}`;
  return newFm + rest;
}

async function readJsonl(path) {
  const out = [];
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) out.push(JSON.parse(line));
  }
  return out;
}

const main = async () => {
  const rel = JSON.parse(await readFile(join(SRC, "relevance.json"), "utf8"));
  const taskLines = (await readFile(join(SRC, "tasks.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean);
  const tasks = Object.fromEntries(taskLines.map((l) => { const t = JSON.parse(l); return [t.task_id, t]; }));

  // 1. single-skill tasks only (our router selects exactly one skill)
  const single = Object.entries(rel).filter(([, v]) => v.gt_skill_ids.length === 1);
  console.error(`single-skill tasks: ${single.length}`);

  // 2. index the full pool from easy/ + hard/ shards
  const pool = new Map();
  for (const tier of ["easy", "hard"]) {
    const dir = join(SRC, tier);
    let shards = [];
    try { shards = (await readdir(dir)).filter((f) => f.endsWith(".jsonl.gz")).sort(); } catch { continue; }
    for (const shard of shards) {
      for (const rec of await readJsonl(join(dir, shard))) {
        if (!pool.has(rec.skill_id)) pool.set(rec.skill_id, rec);
      }
    }
  }
  console.error(`indexed pool: ${pool.size} skills`);

  // 3. distractor groups keyed by gt skill name (distractor/dist_<gt>_<hash>)
  const distractorByGt = new Map();
  for (const id of pool.keys()) {
    if (!id.startsWith("distractor/dist_")) continue;
    const mid = id.slice("distractor/dist_".length).replace(/_[^_]+$/, "");
    if (!distractorByGt.has(mid)) distractorByGt.set(mid, []);
    distractorByGt.get(mid).push(id);
  }

  // 4. assemble the cropped corpus: origin metadata kept separately from the
  //    skill content. `selected` maps origId -> { rec, origin }.
  const selected = new Map();
  const pendingQueries = [];   // { taskId, gtOrigId, domain, hasTargetedDistractors }
  for (const [taskId, relInfo] of single) {
    const gtId = relInfo.gt_skill_ids[0];
    const gtRec = pool.get(gtId);
    if (!gtRec) { console.error(`  skip ${taskId}: gt ${gtId} not in pool`); continue; }
    if (!selected.has(gtId)) selected.set(gtId, { rec: gtRec, origin: "gt" });
    const gtName = gtId.split("/").slice(1).join("/");
    const distractors = distractorByGt.get(gtName) ?? [];
    for (const dId of distractors) {
      if (!selected.has(dId)) selected.set(dId, { rec: pool.get(dId), origin: "distractor" });
    }
    pendingQueries.push({
      taskId,
      gtOrigId: gtId,
      domain: tasks[taskId]?.domain ?? "",
      hasTargetedDistractors: distractors.length > 0,
      query: tasks[taskId].instruction_text,
    });
  }
  console.error(`gt + targeted distractors: ${selected.size} skills for ${pendingQueries.length} queries`);

  // 5. pad with random noise skills (deterministic shuffle)
  let seed = 20260522;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const noiseCandidates = shuffle(
    [...pool.keys()].filter((id) => !id.startsWith("gt/") && !id.startsWith("distractor/") && !selected.has(id)),
  );
  let noiseAdded = 0;
  for (const id of noiseCandidates) {
    if (selected.size >= CAP) break;
    selected.set(id, { rec: pool.get(id), origin: "noise" });
    noiseAdded++;
  }
  console.error(`noise skills added: ${noiseAdded}  ->  total corpus: ${selected.size}`);

  // 6. ANONYMIZE: shuffle the whole corpus, then assign opaque skill-NNN ids.
  //    Numbering is post-shuffle so the index leaks no origin information.
  const origIds = shuffle([...selected.keys()]);
  const width = String(origIds.length).length;
  const anonOf = new Map();
  origIds.forEach((origId, i) => {
    anonOf.set(origId, `skill-${String(i + 1).padStart(width, "0")}`);
  });

  // 7. write the corpus: dir = skill-NNN, SKILL.md = body with neutral name
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = {};
  for (const [origId, { rec, origin }] of selected) {
    const anon = anonOf.get(origId);
    const dir = join(OUT_DIR, anon);
    await mkdir(dir, { recursive: true });
    let body = rec.body ?? "";
    if (!body.trimStart().startsWith("---")) {
      const desc = Array.isArray(rec.description) ? rec.description.join(", ") : (rec.description ?? "");
      body = `---\nname: ${anon}\ndescription: ${JSON.stringify(desc)}\n---\n\n${body}`;
    } else {
      body = setFrontmatterName(body, anon);
    }
    await writeFile(join(dir, "SKILL.md"), body);
    manifest[anon] = { origin, origSkillId: origId };
  }

  // 8. queries with anonymized `expected`
  const queries = pendingQueries.map((q) => ({
    id: q.taskId,
    expected: `user:${anonOf.get(q.gtOrigId)}`,
    domain: q.domain,
    hasTargetedDistractors: q.hasTargetedDistractors,
    kind: "skillrouter",
    tier: "discriminating",
    query: q.query,
  }));

  await writeFile(QUERIES_OUT, JSON.stringify({ queries }, null, 2) + "\n");
  await writeFile(MANIFEST_OUT, JSON.stringify({
    note: "skill-NNN -> origin mapping. For analysis only — never installed or shown to the agent.",
    cap: CAP,
    counts: {
      gt: [...selected.values()].filter((s) => s.origin === "gt").length,
      distractor: [...selected.values()].filter((s) => s.origin === "distractor").length,
      noise: noiseAdded,
    },
    skills: manifest,
  }, null, 2) + "\n");

  const withDist = queries.filter((q) => q.hasTargetedDistractors).length;
  console.error(`\nwrote ${selected.size} anonymized skills to ${OUT_DIR}`);
  console.error(`wrote ${queries.length} queries to ${QUERIES_OUT} (${withDist} have targeted distractors)`);
  console.error(`wrote origin map to ${MANIFEST_OUT}`);
};

main().catch((err) => { console.error(err); process.exit(1); });
