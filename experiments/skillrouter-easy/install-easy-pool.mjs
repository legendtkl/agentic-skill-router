#!/usr/bin/env node
// install-easy-pool.mjs — materialize the SkillRouter Easy pool (78,361 skills)
// as metadata-only `SKILL.md.agentic-skill-router-disabled` files under a target
// host's skills root, and emit the anonymized manifest + 75 core queries.
//
// Usage:
//   node install-easy-pool.mjs --host=claude|codex [--home=<dir>] \
//        [--src=/tmp/sr-probe/data/eval_core] [--out=runs/install-<host>]
//
// Outputs (in --out, default runs/install-<host>):
//   manifest.json   — { generated_at, host, src, anon -> {origSkillId,origName,source} }
//   queries.json    — { queries: [{id, expected_anon, expected_orig, gt_count,
//                                   tier:"single|multi", domain, kind, query}] }
//   install.log     — short summary, line per phase
//
// Side effect:
//   Writes 78,361 directories under <HOME>/.<host>/skills/sr-XXXXX/ each
//   containing one ~150-byte SKILL.md.agentic-skill-router-disabled file with
//   only YAML frontmatter (name + description). No body — that is the whole
//   point of the "metadata-only" test.
//
// Anonymization: every original skill_id is replaced with an opaque sr-XXXXX
// directory id, assigned after a deterministic shuffle (seed=20260525). The
// frontmatter `name:` and `description:` fields are preserved verbatim —
// together they form the paper's "nd" input (Section 2, Table 9), and stripping
// them would make this benchmark not comparable to the paper's nd column.
// Directory-id anonymization is still required because the upstream Easy pool
// uses `gt/<name>` as the skill_id prefix for 196 ground-truth skills, which
// would otherwise leak ground-truth membership to the agent through path
// inspection. Variants must therefore route by *directory name* (the
// `sr-XXXXX` id), not by the frontmatter `name:` field.

import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DISABLED_SUFFIX = ".agentic-skill-router-disabled";
const SHUFFLE_SEED = 20260525;

function parseArgs(argv) {
  const out = {
    host: null,
    home: null,
    src: "/tmp/sr-probe/data/eval_core",
    out: null,
  };
  for (const a of argv) {
    if (a.startsWith("--host=")) out.host = a.slice(7);
    else if (a.startsWith("--home=")) out.home = a.slice(7);
    else if (a.startsWith("--src=")) out.src = a.slice(6);
    else if (a.startsWith("--out=")) out.out = a.slice(6);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!out.host || !["claude", "codex"].includes(out.host)) {
    throw new Error(`--host=claude|codex required (got ${out.host})`);
  }
  return out;
}

function hostSkillsRoot(host, home) {
  const h = home ?? homedir();
  return host === "claude"
    ? join(h, ".claude", "skills")
    : join(h, ".codex", "skills");
}

// Deterministic LCG shuffle so repeated runs produce identical anon ids.
function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function* iterJsonlGz(path) {
  const rl = createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
}

async function loadEasyPool(srcDir) {
  const dir = join(srcDir, "easy");
  const shards = (await readdir(dir))
    .filter((f) => f.endsWith(".jsonl.gz"))
    .sort();
  const pool = new Map();
  for (const shard of shards) {
    for await (const rec of iterJsonlGz(join(dir, shard))) {
      if (!pool.has(rec.skill_id)) pool.set(rec.skill_id, rec);
    }
  }
  return pool;
}

function descAsString(d) {
  if (Array.isArray(d)) return d.join(", ");
  return d ?? "";
}

// Single-quote-safe YAML string for the `description:` value. We always emit
// a double-quoted JSON string — that is also valid YAML 1.2 flow scalar — so
// we never have to think about colons, hashes, or wrap rules.
function yamlSafeString(s) {
  return JSON.stringify(String(s));
}

async function loadTasks(srcDir) {
  const lines = (await readFile(join(srcDir, "tasks.jsonl"), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean);
  const out = {};
  for (const l of lines) {
    const t = JSON.parse(l);
    out[t.task_id] = t;
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const skillsRoot = hostSkillsRoot(args.host, args.home);
  const outDir = resolve(
    args.out ? args.out : join(__dirname, "runs", `install-${args.host}`),
  );

  process.stderr.write(
    `host=${args.host}  skillsRoot=${skillsRoot}  out=${outDir}\n`,
  );

  process.stderr.write("[1/6] reading easy pool ...\n");
  const pool = await loadEasyPool(args.src);
  process.stderr.write(`      ${pool.size} unique skills indexed\n`);

  process.stderr.write("[2/6] reading relevance.json + tasks.jsonl ...\n");
  const rel = JSON.parse(
    await readFile(join(args.src, "relevance.json"), "utf8"),
  );
  const tasks = await loadTasks(args.src);
  const coreQueries = Object.entries(rel).filter(
    ([, v]) => Array.isArray(v.core_gt_ids) && v.core_gt_ids.length > 0,
  );
  process.stderr.write(`      ${coreQueries.length} core queries\n`);

  // Sanity: every gt skill referenced by a core query should be in the easy
  // pool. If any are missing, we still proceed but log the gap so scoring
  // can account for it.
  const missingGt = new Set();
  for (const [, v] of coreQueries) {
    for (const g of v.core_gt_ids) {
      if (!pool.has(g)) missingGt.add(g);
    }
  }
  process.stderr.write(
    `      gt skills not in pool: ${missingGt.size} (these are unreachable)\n`,
  );

  process.stderr.write("[3/6] anonymizing skill ids (deterministic shuffle) ...\n");
  const rand = makeRand(SHUFFLE_SEED);
  const origIds = shuffle([...pool.keys()], rand);
  const width = String(origIds.length).length; // 5 for ~78K
  const anonOf = new Map();
  origIds.forEach((origId, i) => {
    anonOf.set(origId, `sr-${String(i + 1).padStart(width, "0")}`);
  });

  process.stderr.write("[4/6] clearing target skills root ...\n");
  await rm(skillsRoot, { recursive: true, force: true });
  await mkdir(skillsRoot, { recursive: true });

  process.stderr.write(
    `[5/6] writing ${origIds.length} metadata-only SKILL.md${DISABLED_SUFFIX} files ...\n`,
  );
  let written = 0;
  let totalBytes = 0;
  for (const origId of origIds) {
    const rec = pool.get(origId);
    const anon = anonOf.get(origId);
    const desc = descAsString(rec.description);
    const origName = String(rec.name ?? "").trim() || anon;
    // Metadata-only frontmatter. We preserve the upstream `name` and
    // `description` verbatim because together they are the paper's "nd"
    // input (Section 2, Table 9). The body is intentionally omitted —
    // every byte beyond the closing `---` is dropped so disk + grep stay
    // tiny on 78K skills. Directory id is anonymous (sr-XXXXX) to prevent
    // gt/<name> path-prefix leakage; variants route by directory name.
    const content =
      `---\nname: ${yamlSafeString(origName)}\n` +
      `description: ${yamlSafeString(desc)}\n---\n`;
    const dir = join(skillsRoot, anon);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `SKILL.md${DISABLED_SUFFIX}`);
    await writeFile(path, content);
    written++;
    totalBytes += content.length;
    if (written % 10000 === 0) {
      process.stderr.write(`      ... ${written}/${origIds.length}\n`);
    }
  }
  process.stderr.write(
    `      wrote ${written} skills, ${(totalBytes / 1e6).toFixed(2)} MB content\n`,
  );

  // Flat metadata index — one TSV line per skill:
  //   <sr-id>\t<name>\t<description>
  // The 78K disabled-skill files are still the source of truth, but a single
  // ~17 MB TSV is ~500x faster to scan than walking 78K inodes with find +
  // xargs grep (24s vs <100ms in our smoke). Variants are free to use either.
  process.stderr.write("[5b/6] writing flat metadata TSV index ...\n");
  const flatPath = join(skillsRoot, ".flat-metadata.tsv");
  const lines = [];
  for (const origId of origIds) {
    const rec = pool.get(origId);
    const anon = anonOf.get(origId);
    const name = String(rec.name ?? "").replace(/[\t\n\r]/g, " ");
    const desc = descAsString(rec.description).replace(/[\t\n\r]/g, " ");
    lines.push(`${anon}\t${name}\t${desc}`);
  }
  await writeFile(flatPath, lines.join("\n") + "\n");
  process.stderr.write(`      flat index -> ${flatPath} (${(lines.join("\n").length / 1e6).toFixed(2)} MB)\n`);

  process.stderr.write("[6/6] emitting manifest.json + queries.json ...\n");
  await mkdir(outDir, { recursive: true });
  const manifest = {
    generated_at: new Date().toISOString(),
    host: args.host,
    src: args.src,
    skills_root: skillsRoot,
    disabled_suffix: DISABLED_SUFFIX,
    shuffle_seed: SHUFFLE_SEED,
    skill_count: origIds.length,
    skills: {},
  };
  for (const origId of origIds) {
    const rec = pool.get(origId);
    const anon = anonOf.get(origId);
    manifest.skills[anon] = {
      origSkillId: origId,
      origName: rec.name ?? null,
      source: rec.source ?? null,
    };
  }
  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  const queries = coreQueries.map(([taskId, relInfo]) => {
    const gtAnon = relInfo.core_gt_ids
      .map((g) => anonOf.get(g) ?? null)
      .filter((x) => x !== null);
    const gtMissing = relInfo.core_gt_ids.filter((g) => !anonOf.has(g));
    return {
      id: taskId,
      expected_anon: gtAnon,
      expected_orig: relInfo.core_gt_ids,
      expected_missing_from_pool: gtMissing,
      gt_count: relInfo.core_gt_ids.length,
      tier: relInfo.core_gt_ids.length === 1 ? "single" : "multi",
      domain: tasks[taskId]?.domain ?? "",
      kind: "skillrouter-easy",
      task_type: relInfo.task_type ?? "",
      query: tasks[taskId]?.instruction_text ?? "",
    };
  });
  // Sort by id for deterministic ordering across runs.
  queries.sort((a, b) => a.id.localeCompare(b.id));
  const singleN = queries.filter((q) => q.tier === "single").length;
  const multiN = queries.length - singleN;
  await writeFile(
    join(outDir, "queries.json"),
    JSON.stringify({ count: queries.length, single: singleN, multi: multiN, queries }, null, 2) + "\n",
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const summary =
    `host=${args.host} skills=${origIds.length} ` +
    `queries=${queries.length} (single=${singleN}, multi=${multiN}) ` +
    `missing_gt=${missingGt.size} ` +
    `bytes=${totalBytes} elapsed=${elapsed}s`;
  await writeFile(join(outDir, "install.log"), summary + "\n");
  process.stderr.write(`\n${summary}\n`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? String(err));
  process.exit(1);
});
