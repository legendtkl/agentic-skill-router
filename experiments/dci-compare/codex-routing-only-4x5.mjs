#!/usr/bin/env node
// Codex port of the routing-only bench, 4 variants x 5 queries.
//
// Strategies covered: G-native (no router, corpus enabled), C-lite, I-meta,
// J-bounded, and K-bounded. Queries are 5 picked from queries.json (3 overlap with the
// Claude Code 9x3 set for cross-host comparison + 2 new). Model is gpt-5.5
// with reasoning_effort=high, served through the host's OpenAI subscription
// (the codex CLI reads ~/.codex/auth.json which is copied into each per-
// variant HOME).
//
// Output: runs/codex-routing-only-4x5/<variant>/<query>.jsonl + summary.json.

import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";
import { optionalSkillRouterEvalCorePath } from "../skillrouter-dataset.mjs";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const REPO_ROOT = resolve(EXP_DIR, "..", "..");
const CODEX_PLUGIN_MANIFEST = join(REPO_ROOT, "plugins", "codex", ".codex-plugin", "plugin.json");
const CORPUS_DIR = join(EXP_DIR, "skillrouter-skills");
const VARIANTS_DIR = join(EXP_DIR, "variants", "routing-only-codex");
const BASE_HOME = join(EXP_DIR, ".tmp-home-codex", "_base");
const BASE_MANIFEST = join(BASE_HOME, ".skill-router-bench-base.json");
const HOMES_DIR = join(EXP_DIR, ".tmp-home-codex");
let OUT_DIR = join(EXP_DIR, "runs", "codex-routing-only-4x5");
const TIMEOUT_MS = Number(process.env.CODEX_RUN_TIMEOUT_MS) || 240_000;
const REAL_CODEX_AUTH = join(homedir(), ".codex", "auth.json");
const MODEL = "gpt-5.5";
const REASONING_EFFORT = "high";
const QUERY_SET = process.env.CODEX_QUERY_SET || "subset";
const SYNTHETIC_CORPUS_SIZE = Number(process.env.CODEX_SYNTHETIC_CORPUS_SIZE || "0");
const SKILLROUTER_EVAL_CORE = optionalSkillRouterEvalCorePath("CODEX_SKILLROUTER_EVAL_CORE", "SKILLROUTER_EVAL_CORE");
const SKILLROUTER_EVAL_TIER = process.env.CODEX_SKILLROUTER_EVAL_TIER || "hard";
const CORPUS_CACHE_VERSION = 2;
let pluginVersionPromise = null;
let originalSkillRouterCorpusPromise = null;

const ALL_VARIANTS = [
  { id: "G-native", mode: "native" },
  { id: "A-router", mode: "router" },
  { id: "B-cc", mode: "router" },
  { id: "C-lite", mode: "router" },
  { id: "D-agentic", mode: "router" },
  { id: "E-digest", mode: "router" },
  { id: "H-bounded", mode: "router" },
  { id: "I-meta", mode: "router" },
  { id: "J-bounded", mode: "router" },
  { id: "J-bounded-v2", mode: "router" },
  { id: "K-bounded", mode: "router" },
  { id: "K-lite", mode: "router" },
  { id: "L-agentic", mode: "router" },
  { id: "M-bm25", mode: "router" },
];
const DEFAULT_VARIANT_IDS = ["G-native", "C-lite", "I-meta", "J-bounded"];
const VARIANTS = (process.env.CODEX_VARIANT_SET === "all"
  ? ALL_VARIANTS
  : ALL_VARIANTS.filter((v) => DEFAULT_VARIANT_IDS.includes(v.id)));

// 5-query subset. The first three overlap with the Claude Code 9x3 set so
// we can compare cross-host on the same queries; the last two are new.
const QUERY_IDS = [
  "3d-scan-calc",
  "dialogue-parser",
  "citation-check",
  "court-form-filling",
  "data-to-d3",
];

const STOP_TAIL = `

---
ROUTING-ONLY mode: this session evaluates skill routing accuracy only.
After identifying the single best matching disabled skill, output exactly
one line of minified JSON on its own and stop:

{"matched_skill_name":"<skill-id>"}

Do NOT read the matched skill's body, do NOT execute the user's task above,
do NOT produce any other text. This overrides any "execute the task"
guidance in the skill router's instructions.`;

function log(msg) {
  process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
}

async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function getCodexPluginVersion() {
  pluginVersionPromise ??= readFile(CODEX_PLUGIN_MANIFEST, "utf8")
    .then((text) => JSON.parse(text).version)
    .then((version) => {
      if (!version) throw new Error(`missing version in ${CODEX_PLUGIN_MANIFEST}`);
      return version;
    });
  return pluginVersionPromise;
}

async function ensureBaseHome() {
  const expectedManifest = await buildBaseManifest();
  if (await pathExists(BASE_HOME)) {
    let currentManifest = null;
    try { currentManifest = JSON.parse(await readFile(BASE_MANIFEST, "utf8")); } catch {}
    if (process.env.CODEX_REBUILD_BASE !== "1" && manifestsEqual(currentManifest, expectedManifest)) {
      log(`base HOME exists at ${BASE_HOME} (manifest match; reusing)`);
      return;
    }
    const reason = process.env.CODEX_REBUILD_BASE === "1" ? "CODEX_REBUILD_BASE=1" : "manifest missing/stale";
    log(`rebuilding base HOME at ${BASE_HOME} (${reason})`);
    await rm(BASE_HOME, { recursive: true, force: true });
  }
  log(`building base HOME at ${BASE_HOME}`);
  await mkdir(join(BASE_HOME, ".codex"), { recursive: true });
  await mkdir(join(BASE_HOME, ".codex", "skills"), { recursive: true });
  await mkdir(join(BASE_HOME, ".codex", "prompts"), { recursive: true });
  await mkdir(join(BASE_HOME, ".codex", "plugins"), { recursive: true });

  if (!await pathExists(REAL_CODEX_AUTH)) {
    throw new Error(`no auth.json at ${REAL_CODEX_AUTH}; codex CLI cannot authenticate`);
  }
  await copyFile(REAL_CODEX_AUTH, join(BASE_HOME, ".codex", "auth.json"));

  // Minimal config: model + reasoning effort + plugin enabled. Real codex
  // config lives in the user's real HOME; we never touch it.
  const config = `model = "${MODEL}"\nmodel_reasoning_effort = "${REASONING_EFFORT}"\n\n[plugins."skill-router@local"]\nenabled = true\n`;
  await writeFile(join(BASE_HOME, ".codex", "config.toml"), config);

  log(`copying 150-skill corpus -> ${join(BASE_HOME, ".codex", "skills")}`);
  const corpusEntries = await readdir(CORPUS_DIR, { withFileTypes: true });
  let copied = 0;
  for (const ent of corpusEntries) {
    if (!ent.isDirectory()) continue;
    await cp(join(CORPUS_DIR, ent.name), join(BASE_HOME, ".codex", "skills", ent.name), { recursive: true });
    copied++;
  }
  log(`copied ${copied} skills`);

  log(`installing skill-router plugin into base HOME`);
  const env = { ...process.env, HOME: BASE_HOME, CODEX_HOME: join(BASE_HOME, ".codex") };
  delete env.SKILL_ROUTER_HOST;
  delete env.AGENTS_HOME;
  await execFileAsync("npm", ["run", "install:codex-plugin"], {
    cwd: REPO_ROOT, env, maxBuffer: 32 * 1024 * 1024, timeout: 300_000,
  });
  await writeFile(BASE_MANIFEST, JSON.stringify({ ...expectedManifest, generatedAt: new Date().toISOString() }, null, 2));
  log(`plugin installed`);
}

async function buildBaseManifest() {
  const pluginManifest = JSON.parse(await readFile(join(REPO_ROOT, "plugins", "codex", ".codex-plugin", "plugin.json"), "utf8"));
  const auth = await stat(REAL_CODEX_AUTH);
  return {
    manifestVersion: 1,
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    pluginVersion: pluginManifest.version,
    corpusHash: await hashCorpus(CORPUS_DIR),
    auth: { size: auth.size, mtimeMs: Math.round(auth.mtimeMs) },
  };
}

function manifestsEqual(actual, expected) {
  if (!actual) return false;
  const normalized = ({ generatedAt, ...rest }) => rest;
  return JSON.stringify(normalized(actual)) === JSON.stringify(expected);
}

async function hashCorpus(root) {
  const h = createHash("sha256");
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile()) {
        h.update(p.slice(root.length + 1));
        h.update("\0");
        h.update(await readFile(p));
        h.update("\0");
      }
    }
  }
  return h.digest("hex");
}

async function loadRealCorpusSkillsForCache() {
  const entries = (await readdir(CORPUS_DIR, { withFileTypes: true }))
    .filter((ent) => ent.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const skills = [];
  for (const ent of entries) {
    const skillMdPath = join(CORPUS_DIR, ent.name, "SKILL.md");
    const body = await readFile(skillMdPath, "utf8");
    const metadata = parseSkillFrontmatter(body);
    const name = metadata.name || ent.name;
    const description = metadata.description || "";
    skills.push(cacheSkill({
      id: `user:codex:${ent.name}`,
      name,
      description,
      metadata: {
        name,
        description,
        aliases: [],
        tags: [],
        tools: [],
        domains: [],
        intents: [],
        examples: [],
      },
      skillMdPath: `corpus-cache:${ent.name}`,
    }));
  }
  return skills;
}

function parseSkillFrontmatter(body) {
  if (!body.startsWith("---\n")) return {};
  const end = body.indexOf("\n---", 4);
  if (end < 0) return {};
  const out = {};
  for (const line of body.slice(4, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key !== "name" && key !== "description") continue;
    out[key] = parseYamlScalar(line.slice(idx + 1).trim());
  }
  return out;
}

function parseYamlScalar(raw) {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function cacheSkill({ id, name, description, metadata, skillMdPath }) {
  return {
    id,
    name,
    description,
    metadata,
    source: "user",
    pluginKey: null,
    skillMdPath,
    isDisabled: true,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  };
}

function opaqueSkillRouterId(originalId) {
  return `sr-${createHash("sha256").update(originalId).digest("hex").slice(0, 12)}`;
}

async function loadOriginalSkillRouterCorpus() {
  if (!SKILLROUTER_EVAL_CORE) return null;
  originalSkillRouterCorpusPromise ??= loadOriginalSkillRouterCorpusUncached();
  return originalSkillRouterCorpusPromise;
}

async function loadOriginalSkillRouterCorpusUncached() {
  const root = resolve(SKILLROUTER_EVAL_CORE);
  const tierDir = join(root, SKILLROUTER_EVAL_TIER);
  const relevance = JSON.parse(await readFile(join(root, "relevance.json"), "utf8"));
  const { tasksById, paperCoreSingleQueryIds } = await loadOriginalSkillRouterTasks(root, relevance);
  const entries = (await readdir(tierDir, { withFileTypes: true }))
    .filter((ent) => ent.isFile() && ent.name.endsWith(".jsonl.gz"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) throw new Error(`no *.jsonl.gz shards under ${tierDir}`);

  const skills = [];
  const idMap = {};
  const sourceCounts = {};
  for (const ent of entries) {
    const shardPath = join(tierDir, ent.name);
    for await (const rec of readGzipJsonl(shardPath)) {
      const originalId = String(rec.skill_id || "");
      if (!originalId) continue;
      const opaqueId = opaqueSkillRouterId(originalId);
      idMap[originalId] = opaqueId;
      const frontmatter = parseSkillFrontmatter(rec.body || "");
      const originalName = stringValue(rec.name) || originalId.split("/").pop() || originalId;
      const frontmatterDescription = descriptionValue(frontmatter.description);
      const description = isMeaningfulDescription(frontmatterDescription)
        ? frontmatterDescription
        : descriptionValue(rec.description);
      const name = opaqueId;
      const source = stringValue(rec.source) || "unknown";
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
      skills.push(cacheSkill({
        id: `user:codex:${opaqueId}`,
        name,
        description,
        metadata: {
          name,
          description,
          aliases: originalName && originalName !== name ? [originalName] : [],
          tags: [],
          tools: [],
          domains: [],
          intents: [],
          examples: [],
        },
        skillMdPath: `corpus-cache:${opaqueId}`,
      }));
    }
  }

  const expectedByQueryId = {};
  const expectedOriginalByQueryId = {};
  for (const [queryId, rel] of Object.entries(relevance)) {
    const gt = singleExpectedSkillId(rel);
    if (!gt) continue;
    const mapped = idMap[gt];
    if (!mapped) throw new Error(`ground-truth skill ${gt} for ${queryId} missing from ${tierDir}`);
    expectedByQueryId[queryId] = mapped;
    expectedOriginalByQueryId[queryId] = gt;
  }

  log(`loaded SkillRouter original ${SKILLROUTER_EVAL_TIER} corpus: ${skills.length} skills (${Object.entries(sourceCounts).map(([k, v]) => `${k}=${v}`).join(", ")})`);
  return {
    root,
    tier: SKILLROUTER_EVAL_TIER,
    skills,
    idMap,
    sourceCounts,
    expectedByQueryId,
    expectedOriginalByQueryId,
    tasksById,
    paperCoreSingleQueryIds,
  };
}

async function* readGzipJsonl(path) {
  const chunks = [];
  for await (const chunk of createReadStream(path).pipe(createGunzip())) {
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
  }
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function descriptionValue(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(", ");
  return "";
}

function isMeaningfulDescription(value) {
  const trimmed = value.trim();
  return trimmed !== "" && trimmed !== "|" && trimmed !== ">";
}

async function loadOriginalSkillRouterTasks(root, relevance) {
  const text = await readFile(join(root, "tasks.jsonl"), "utf8");
  const tasks = text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const tasksById = {};
  for (const task of tasks) {
    const id = stringValue(task.task_id) || stringValue(task.id);
    if (id) tasksById[id] = task;
  }
  const paperCoreSingleQueryIds = tasks
    .map((task) => stringValue(task.task_id) || stringValue(task.id))
    .filter((id) => id && relevance[id]?.core_gt_ids?.length === 1);
  return { tasksById, paperCoreSingleQueryIds };
}

function singleExpectedSkillId(rel) {
  if (rel?.core_gt_ids?.length === 1) return rel.core_gt_ids[0];
  if (rel?.gt_skill_ids?.length === 1) return rel.gt_skill_ids[0];
  return null;
}

async function preseedOriginalSkillRouterCorpusCache(home) {
  const corpus = await loadOriginalSkillRouterCorpus();
  if (!corpus) return;
  const stateDir = join(home, ".skill-router");
  await mkdir(stateDir, { recursive: true });
  await rm(join(stateDir, "corpus-bm25-index-codex.json"), { force: true });
  await writeFile(join(stateDir, "corpus-cache-codex.json"), JSON.stringify({
    version: CORPUS_CACHE_VERSION,
    host: "codex",
    createdAtMs: Date.now(),
    fingerprint: `skillrouter-${corpus.tier}-${corpus.skills.length}`,
    skills: corpus.skills,
  }));
  log(`preseeded Codex corpus cache with SkillRouter ${corpus.tier} corpus (${corpus.skills.length} skills) at ${stateDir}`);
}

function yamlQuoted(value) {
  return JSON.stringify(String(value ?? ""));
}

async function materializeOriginalSkillRouterSkillFiles(home) {
  const corpus = await loadOriginalSkillRouterCorpus();
  if (!corpus) return;
  const root = join(home, ".codex", "skills");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  let index = 0;
  const workers = Array.from({ length: 64 }, async () => {
    while (index < corpus.skills.length) {
      const skill = corpus.skills[index++];
      const dir = join(root, skill.name);
      const displayName = skill.metadata?.aliases?.[0] || skill.name;
      const body = [
        "---",
        `name: ${yamlQuoted(displayName)}`,
        `description: ${yamlQuoted(skill.description || "")}`,
        "---",
        "",
      ].join("\n");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md.skill-router-disabled"), body);
    }
  });
  await Promise.all(workers);
  log(`materialized SkillRouter ${corpus.tier} metadata files for shell routing (${corpus.skills.length} disabled skills)`);
}

const NOISE_DOMAINS = [
  "analytics", "documents", "finance", "media", "planning", "search", "workflow", "visualization",
  "forms", "simulation", "biology", "education", "operations", "compliance", "translation", "database",
  "security", "deployment", "monitoring", "research", "customer support", "legal", "geospatial", "design",
];
const NOISE_TOOLS = [
  "json", "csv", "xlsx", "pdf", "api", "sql", "python", "markdown", "browser", "dashboard",
  "calendar", "email", "images", "video", "charts", "logs", "yaml", "webhook", "notebook", "cli",
];
const NOISE_ACTIONS = [
  "extract", "generate", "summarize", "validate", "transform", "classify", "merge", "compare",
  "index", "search", "report", "calculate", "review", "clean", "monitor", "configure",
];

function makeSyntheticNoiseSkills(count) {
  const skills = [];
  for (let i = 0; i < count; i++) {
    const n = String(i + 1).padStart(5, "0");
    const domain = NOISE_DOMAINS[i % NOISE_DOMAINS.length];
    const secondary = NOISE_DOMAINS[(i * 17) % NOISE_DOMAINS.length];
    const tool = NOISE_TOOLS[(i * 7) % NOISE_TOOLS.length];
    const action = NOISE_ACTIONS[(i * 13) % NOISE_ACTIONS.length];
    const name = `noise-${n}`;
    const description = `${action} ${domain} ${tool} workflow helper for ${secondary} data reports and operational tasks.`;
    skills.push(cacheSkill({
      id: `user:codex:${name}`,
      name,
      description,
      metadata: {
        name,
        description,
        aliases: [`${domain} ${action}`],
        tags: [domain, action],
        tools: [tool],
        domains: [domain, secondary],
        intents: [`${action} ${tool}`],
        examples: [],
      },
      skillMdPath: `corpus-cache:${name}`,
    }));
  }
  return skills;
}

async function preseedSyntheticCorpusCache(home, size) {
  const realSkills = await loadRealCorpusSkillsForCache();
  if (size < realSkills.length) {
    throw new Error(`CODEX_SYNTHETIC_CORPUS_SIZE=${size} is smaller than real corpus size ${realSkills.length}`);
  }
  const skills = [
    ...realSkills,
    ...makeSyntheticNoiseSkills(size - realSkills.length),
  ];
  const stateDir = join(home, ".skill-router");
  await mkdir(stateDir, { recursive: true });
  await rm(join(stateDir, "corpus-bm25-index-codex.json"), { force: true });
  await writeFile(join(stateDir, "corpus-cache-codex.json"), JSON.stringify({
    version: CORPUS_CACHE_VERSION,
    host: "codex",
    createdAtMs: Date.now(),
    fingerprint: `synthetic-${size}`,
    skills,
  }));
  log(`preseeded Codex corpus cache with ${skills.length} skills at ${stateDir}`);
}

async function setCorpusState(home, target) {
  const root = join(home, ".codex", "skills");
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  let n = 0;
  for (const id of dirs) {
    const en = join(root, id, "SKILL.md");
    const dis = join(root, id, "SKILL.md.skill-router-disabled");
    if (target === "enabled" && existsSync(dis) && !existsSync(en)) { await rename(dis, en); n++; }
    else if (target === "disabled" && existsSync(en) && !existsSync(dis)) { await rename(en, dis); n++; }
  }
  return n;
}

async function prepareVariantHome(variant) {
  const home = join(HOMES_DIR, variant.id);
  await rm(home, { recursive: true, force: true });
  await cp(BASE_HOME, home, { recursive: true });
  await installCorpusWrapper(home);
  const target = variant.mode === "native" ? "enabled" : "disabled";
  const n = await setCorpusState(home, target);
  log(`[${variant.id}] HOME ready, corpus=${target} (${n} renames)`);

  if (variant.mode === "router") {
    if (SKILLROUTER_EVAL_CORE) {
      await preseedOriginalSkillRouterCorpusCache(home);
      if (variant.id === "J-bounded-v2") {
        await materializeOriginalSkillRouterSkillFiles(home);
      }
    } else if (SYNTHETIC_CORPUS_SIZE > 0) {
      await preseedSyntheticCorpusCache(home, SYNTHETIC_CORPUS_SIZE);
    }

    const variantPath = join(VARIANTS_DIR, `${variant.id}.SKILL.md`);
    if (!await pathExists(variantPath)) {
      throw new Error(`missing variant SKILL.md: ${variantPath}`);
    }
    const pluginVersion = await getCodexPluginVersion();
    const pluginRoot = join(home, ".codex", "plugins", "cache", "local",
                            "skill-router", pluginVersion);
    const dst = join(pluginRoot, "skills", "skill-router-skills", "SKILL.md");
    if (!await pathExists(dirname(dst))) {
      throw new Error(`plugin skills dir missing in HOME: ${dirname(dst)}`);
    }
    const routerBin = join(pluginRoot, "bin", "skill-router");
    let body = await readFile(variantPath, "utf8");
    body = body.replaceAll("<abs-path-to-skill-router>", routerBin);
    await writeFile(dst, body);
    log(`[${variant.id}] plugin SKILL.md <- variants/routing-only-codex/${variant.id}.SKILL.md`);
  } else {
    // Native: ensure no plugin SKILL.md is present (uninstall by removing
    // the cache dir so codex sees only the corpus).
    const pluginCache = join(home, ".codex", "plugins", "cache");
    await rm(pluginCache, { recursive: true, force: true });
    log(`[${variant.id}] removed plugin cache (native mode, corpus only)`);
  }

  // Per-HOME tmp dir.
  await mkdir(join(home, "tmp"), { recursive: true });
  return home;
}

async function installCorpusWrapper(home) {
  // Variant E uses the same mechanical wrapper as the Claude experiment, but
  // points it at the Codex skill root via SKILL_CORPUS_ROOT in the skill body.
  await copyFile(join(EXP_DIR, "skill-corpus"), join(home, ".codex", "skill-corpus"));
}

async function runOne(variant, home, queryObj) {
  const project = join(home, "project-routing-only");
  await mkdir(project, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    TMPDIR: join(home, "tmp"),
  };
  if ((SYNTHETIC_CORPUS_SIZE > 0 || SKILLROUTER_EVAL_CORE) && !env.SKILL_ROUTER_CORPUS_CACHE_TTL_MS) {
    env.SKILL_ROUTER_CORPUS_CACHE_TTL_MS = "3600000";
  }
  delete env.SKILL_ROUTER_HOST;
  delete env.AGENTS_HOME;

  const fullQuery = queryObj.query + STOP_TAIL;
  const finalMessagePath = join(home, `final-${queryObj.id}.txt`);
  // NOTE: --ephemeral intentionally omitted so codex writes a rollout under
  // $CODEX_HOME/sessions/YYYY/MM/DD/rollout-...-<thread_id>.jsonl. We need
  // that rollout's `event_msg/token_count.info.last_token_usage` to recover
  // the real ctx_end (last internal Responses API call's prompt size);
  // `turn.completed.usage.input_tokens` in the JSONL stream is cumulative
  // across all internal calls, not the final prompt size.
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-C", project,
    "-s", "danger-full-access",
    "--dangerously-bypass-approvals-and-sandbox",
    "-c", `model="gpt-5.5"`,
    "-c", `model_reasoning_effort="high"`,
    "--output-last-message", finalMessagePath,
    fullQuery,
  ];

  const out = join(OUT_DIR, variant.id, `${queryObj.id}.jsonl`);
  await mkdir(dirname(out), { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  log(`[${variant.id}] ${queryObj.id} spawn`);
  const child = spawn("codex", args, { env, cwd: project, stdio: ["ignore", "pipe", "pipe"] });
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
        try { events.push(JSON.parse(line)); } catch { events.push({ type: "_raw", line }); }
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
    try { events.push(JSON.parse(stdoutBuf)); } catch { events.push({ type: "_raw", line: stdoutBuf }); }
  }
  if (stderrBuf) events.push({ type: "_stderr", text: stderrBuf.slice(0, 8000) });

  let finalMessage = "";
  try { finalMessage = await readFile(finalMessagePath, "utf8"); } catch {}
  if (finalMessage) events.push({ type: "_final_message", text: finalMessage });
  if (timedOut) events.push({ type: "_run_error", error: `codex exec timed out after ${TIMEOUT_MS}ms` });

  await writeFile(out, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  // Extract matched_skill_name from final-message or last assistant text.
  let matched = null;
  const candidates = [finalMessage];
  for (let i = events.length - 1; i >= 0 && candidates.length < 6; i--) {
    const e = events[i];
    if (e && e.type === "item.completed" && e.item && e.item.type === "agent_message") {
      candidates.push(e.item.text || "");
    }
  }
  for (const c of candidates) {
    const m = (c || "").match(/\{"matched_skill_name"\s*:\s*"([^"]+)"\}/);
    if (m) { matched = m[1]; break; }
  }

  const usage = events.find((e) => e && e.type === "turn.completed" && e.usage)?.usage || null;
  const threadId = events.find((e) => e && e.type === "thread.started")?.thread_id || null;
  const routerTriggered = variant.mode === "router"
    ? events.some((e) => e?.type === "item.completed" &&
        e.item?.type === "command_execution" &&
        String(e.item.command || "").includes("/skills/skill-router-skills/SKILL.md"))
    : null;
  let rolloutLastUsage = null;
  let rolloutModelCtxWindow = null;
  let rolloutPath = null;
  if (threadId) {
    try {
      const probe = await readLastTokenCountFromRollout(home, threadId);
      rolloutLastUsage = probe.lastTokenUsage;
      rolloutModelCtxWindow = probe.modelContextWindow;
      rolloutPath = probe.path;
    } catch (err) {
      log(`[${variant.id}] ${queryObj.id} rollout lookup failed: ${err.message}`);
    }
  }

  const dur = Date.now() - t0;
  const ctxEndLast = rolloutLastUsage?.input_tokens ?? null;
  log(`[${variant.id}] ${queryObj.id} done exit=${exitCode} timedOut=${timedOut} dur=${(dur/1000).toFixed(1)}s matched=${matched || "-"} ctx_end=${ctxEndLast ?? "?"}`);
  return {
    variant: variant.id,
    queryId: queryObj.id,
    expected: queryObj.expected,
    matched,
    exitCode,
    timedOut,
    durationMs: dur,
    usage,                       // cumulative (turn.completed.usage)
    lastTokenUsage: rolloutLastUsage,    // ctx_end source
    modelContextWindow: rolloutModelCtxWindow,
    routerTriggered,
    threadId,
    rolloutPath,
    events: events.length,
  };
}

// Locate the rollout file for a given thread_id under <home>/.codex/sessions
// and return the LAST `event_msg/token_count` payload whose `info` is
// non-null (the very first token_count in a session has info=null and only
// reports rate_limits).
async function readLastTokenCountFromRollout(home, threadId) {
  const sessionsRoot = join(home, ".codex", "sessions");
  const path = await findRolloutByThreadId(sessionsRoot, threadId);
  if (!path) throw new Error(`no rollout for thread ${threadId}`);
  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  let last = null;
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed?.type === "event_msg" && parsed?.payload?.type === "token_count" && parsed?.payload?.info) {
      last = parsed.payload;
    }
  }
  if (!last) throw new Error(`no token_count with info in ${path}`);
  return {
    lastTokenUsage: last.info.last_token_usage || null,
    totalTokenUsage: last.info.total_token_usage || null,
    modelContextWindow: last.info.model_context_window || null,
    path,
  };
}

async function findRolloutByThreadId(sessionsRoot, threadId) {
  let stack = [sessionsRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.startsWith("rollout-") && e.name.includes(threadId) && e.name.endsWith(".jsonl")) {
        return p;
      }
    }
  }
  return null;
}

async function main() {
  const allQueries = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  const originalCorpus = await loadOriginalSkillRouterCorpus();
  const querySource = originalCorpus && QUERY_SET === "paper-core-single"
    ? originalCorpus.paperCoreSingleQueryIds.map((id) => {
        const task = originalCorpus.tasksById[id];
        if (!task) throw new Error(`task id not found in tasks.jsonl: ${id}`);
        return {
          id,
          expected: "",
          domain: stringValue(task.domain),
          hasTargetedDistractors: true,
          kind: "skillrouter",
          tier: "paper-core-single",
          query: stringValue(task.instruction_text),
        };
      })
    : allQueries;
  const selectedQueryIds = QUERY_SET === "all" || QUERY_SET === "paper-core-single"
    ? querySource.map((q) => q.id)
    : QUERY_IDS;
  const queries = selectedQueryIds.map((id) => {
    const q = querySource.find((x) => x.id === id);
    if (!q) throw new Error(`query id not found in ${QUERY_SET === "paper-core-single" ? "tasks.jsonl" : "queries.json"}: ${id}`);
    // Strip "user:" prefix from expected so it matches what the codex agent
    // emits (raw skill-NNN). The corpus uses opaque ids.
    if (originalCorpus) {
      const expected = originalCorpus.expectedByQueryId[id];
      if (!expected) throw new Error(`query ${id} has no single-skill expected id in SkillRouter original corpus`);
      return {
        ...q,
        expected,
        expectedOriginal: originalCorpus.expectedOriginalByQueryId[id],
      };
    }
    return { ...q, expected: (q.expected || "").replace(/^user:/, "") };
  });
  // ONLY_VARIANTS / ONLY_QUERIES env vars filter the grid for smoke runs.
  const variantFilter = (process.env.ONLY_VARIANTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const queryFilter = (process.env.ONLY_QUERIES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const variantPool = variantFilter.length ? ALL_VARIANTS : VARIANTS;
  const runVariants = variantFilter.length ? variantPool.filter((v) => variantFilter.includes(v.id)) : variantPool;
  const runQueries = queryFilter.length ? queries.filter((q) => queryFilter.includes(q.id)) : queries;
  const missingVariants = variantFilter.filter((id) => !ALL_VARIANTS.some((v) => v.id === id));
  const missingQueries = queryFilter.filter((id) => !queries.some((q) => q.id === id));
  if (missingVariants.length > 0) throw new Error(`unknown ONLY_VARIANTS: ${missingVariants.join(", ")}`);
  if (missingQueries.length > 0) throw new Error(`unknown ONLY_QUERIES: ${missingQueries.join(", ")}`);
  if (runVariants.length === 0) throw new Error("no variants selected");
  if (runQueries.length === 0) throw new Error("no queries selected");
  if (originalCorpus && runVariants.some((v) => v.mode !== "router")) {
    throw new Error("CODEX_SKILLROUTER_EVAL_CORE/SKILLROUTER_EVAL_CORE currently supports router variants only; native variants would still see the 150-skill installed corpus");
  }
  const partialRun = runVariants.length < variantPool.length || runQueries.length < queries.length;
  const defaultRunName = QUERY_SET === "paper-core-single"
    ? "codex-routing-only-paper-core-single"
    : QUERY_SET === "all"
      ? "codex-routing-only-4x24"
      : "codex-routing-only-4x5";
  const runName = process.env.CODEX_RUN_NAME || (partialRun ? `${defaultRunName}-partial` : defaultRunName);
  OUT_DIR = process.env.CODEX_OUT_DIR ? resolve(process.env.CODEX_OUT_DIR) : join(EXP_DIR, "runs", runName);

  log(`harness: ${runVariants.length} variants x ${runQueries.length} queries = ${runVariants.length * runQueries.length} cells. Timeout=${TIMEOUT_MS}ms per cell. out=${OUT_DIR}`);

  await ensureBaseHome();
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const startedAt = new Date().toISOString();
  const runs = [];
  for (const variant of runVariants) {
    const home = await prepareVariantHome(variant);
    for (const q of runQueries) {
      const result = await runOne(variant, home, q);
      runs.push(result);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const finishedAt = new Date().toISOString();

  // Per-variant accuracy roll-up (only variants that ran this invocation).
  const variantStats = runVariants.map((v) => {
    const cells = runs.filter((r) => r.variant === v.id);
    const correct = cells.filter((c) => c.matched === c.expected).length;
    const routerTriggered = v.mode === "router" ? cells.filter((c) => c.routerTriggered).length : null;
    const totalDurMs = cells.reduce((s, c) => s + c.durationMs, 0);
    const totalTokensIn = cells.reduce((s, c) => s + (c.usage?.input_tokens || 0), 0);
    const totalTokensOut = cells.reduce((s, c) => s + (c.usage?.output_tokens || 0), 0);
    const totalReasoning = cells.reduce((s, c) => s + (c.usage?.reasoning_output_tokens || 0), 0);
    return { variant: v.id, mode: v.mode, n: cells.length, correct, routerTriggered, totalDurMs, totalTokensIn, totalTokensOut, totalReasoning };
  });

  const summary = {
    startedAt,
    finishedAt,
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    querySet: QUERY_SET,
    syntheticCorpusSize: SYNTHETIC_CORPUS_SIZE || null,
    originalSkillRouter: originalCorpus ? {
      root: originalCorpus.root,
      tier: originalCorpus.tier,
      corpusSize: originalCorpus.skills.length,
      sourceCounts: originalCorpus.sourceCounts,
      queryExpected: runQueries.map((q) => ({
        id: q.id,
        expected: q.expected,
        expectedOriginal: q.expectedOriginal,
      })),
    } : null,
    homesDir: HOMES_DIR,
    outDir: OUT_DIR,
    timeoutMs: TIMEOUT_MS,
    variants: runVariants,
    queries: runQueries.map((q) => ({ id: q.id, expected: q.expected, domain: q.domain })),
    variantStats,
    runs,
    note: "Routing-only Codex bench. STOP_TAIL appended to each query; matched_skill_name is the routing decision only.",
  };
  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  log(`summary -> ${join(OUT_DIR, "summary.json")}`);

  // Console table.
  process.stdout.write("\nVariant accuracy / triggers / wall time:\n");
  process.stdout.write("variant       | mode    | acc   | router | total wall | in_tok | out_tok | reasoning\n");
  process.stdout.write("--------------|---------|-------|--------|------------|--------|---------|----------\n");
  for (const s of variantStats) {
    const router = s.mode === "router" ? `${s.routerTriggered}/${s.n}` : "n/a";
    process.stdout.write(
      `${s.variant.padEnd(14)}| ${s.mode.padEnd(8)}| ${s.correct}/${s.n}   | ${router.padEnd(6)} | ${(s.totalDurMs/1000).toFixed(1).padStart(7)}s   | ${String(s.totalTokensIn).padStart(6)} | ${String(s.totalTokensOut).padStart(7)} | ${String(s.totalReasoning).padStart(8)}\n`
    );
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
