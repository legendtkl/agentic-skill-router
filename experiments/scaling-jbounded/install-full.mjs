#!/usr/bin/env node
// Install the FULL SkillRouter eval-core corpus into a target HOME.
//
// Streams every `easy/*.jsonl.gz` + `hard/*.jsonl.gz` shard, de-dups by
// skill_id (first occurrence wins), and writes each skill as
//   <HOME>/.claude/skills/<safe_id>/SKILL.md.skill-router-disabled
//
// `safe_id` = original `skill_id` with `/` replaced by `__`, so the
// directory name is filesystem-legal. The frontmatter `name:` field is
// rewritten to match safe_id (otherwise the agent sees `name: gt/foo`
// but `basename(dirname)` says `gt__foo` — and routing would mis-emit).
//
// Skills are written DIRECTLY in disabled state — no enable/disable cycle.
// This bypasses the skill-router CLI's per-skill state tracking; for a
// smoke probe we only need the variants' grep to see the files.
//
// Usage:
//   node install-full.mjs --home=.tmp-home
//                         [--src=/tmp/sr-probe/data/eval_core]
//                         [--concurrency=32]
//                         [--limit=N]            (cap total skills written)

import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const SRC = args.src;
const SKILLS_ROOT = join(args.home.startsWith("/") ? args.home : join(__dirname, args.home), ".claude", "skills");
const CONCURRENCY = args.concurrency;
const LIMIT = args.limit;

function parseArgs(argv) {
  const out = {
    src: "/tmp/sr-probe/data/eval_core",
    home: ".tmp-home",
    concurrency: 32,
    limit: 0,
  };
  for (const a of argv) {
    if (a.startsWith("--src=")) out.src = a.slice(6);
    else if (a.startsWith("--home=")) out.home = a.slice(7);
    else if (a.startsWith("--concurrency=")) out.concurrency = Number(a.slice(14));
    else if (a.startsWith("--limit=")) out.limit = Number(a.slice(8));
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

function safeId(id) { return id.replace(/\//g, "__"); }

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

async function listShards() {
  const out = [];
  for (const tier of ["easy", "hard"]) {
    const dir = join(SRC, tier);
    let names = [];
    try { names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl.gz")).sort(); } catch { continue; }
    for (const n of names) out.push(join(dir, n));
  }
  return out;
}

async function* iterShard(path) {
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
}

async function writeSkill(rec) {
  const sid = safeId(rec.skill_id);
  const dir = join(SKILLS_ROOT, sid);
  await mkdir(dir, { recursive: true });
  let body = rec.body ?? "";
  if (!body.trimStart().startsWith("---")) {
    const desc = Array.isArray(rec.description) ? rec.description.join(", ") : (rec.description ?? "");
    body = `---\nname: ${sid}\ndescription: ${JSON.stringify(desc)}\n---\n\n${body}`;
  } else {
    body = setFrontmatterName(body, sid);
  }
  await writeFile(join(dir, "SKILL.md.skill-router-disabled"), body);
}

async function runWithCap(items, cap, work) {
  let next = 0, done = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { await work(items[i]); } catch (err) { console.error(`item ${i} failed: ${err.message}`); }
      done++;
      if (done % 5000 === 0) console.log(`  wrote ${done} / ${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, worker));
}

const main = async () => {
  await mkdir(SKILLS_ROOT, { recursive: true });
  const shards = await listShards();
  console.log(`found ${shards.length} shards under ${SRC}`);
  const seen = new Set();
  const records = [];
  for (const shard of shards) {
    let n = 0;
    for await (const rec of iterShard(shard)) {
      if (seen.has(rec.skill_id)) continue;
      seen.add(rec.skill_id);
      records.push(rec);
      n++;
      if (LIMIT > 0 && records.length >= LIMIT) break;
    }
    console.log(`  ${basename(shard)}: +${n} (cum ${records.length})`);
    if (LIMIT > 0 && records.length >= LIMIT) break;
  }
  console.log(`writing ${records.length} skills to ${SKILLS_ROOT} (concurrency=${CONCURRENCY})`);
  const t0 = Date.now();
  await runWithCap(records, CONCURRENCY, writeSkill);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
};

main().catch((err) => { console.error(err); process.exit(1); });
