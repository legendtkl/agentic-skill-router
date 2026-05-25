#!/usr/bin/env node
// Claude Code routing-only bench for the post-J variants added in commit
// c113b38 (D-agentic metadata-only, K-bounded, K-lite, L-agentic, M-bm25).
// Mirrors the Codex experiments at runs/codex-routing-only-{k,k-lite-fix,
// l-agentic,m-bm25-...}/. CLAUDE.md is always present (the paired study
// already established the trigger lift for the 9-variant set; we are not
// re-litigating the paired arm).
//
// Variants run sequentially (one HOME per variant). Within a HOME the 24
// queries run sequentially. Output goes to
// runs/claude-routing-only-newvariants-<TAG>/ with one subdir per variant.

import { spawn, execFile } from "node:child_process";
import {
  mkdir, writeFile, readFile, readdir, rename, copyFile, rm, cp, stat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const REPO_ROOT = resolve(EXP_DIR, "..", "..");
const BASE_HOME = join(EXP_DIR, ".tmp-home");
const HOMES_DIR = join(EXP_DIR, ".tmp-home-newvariants");
const VARIANTS_DIR = join(EXP_DIR, "variants", "routing-only");
const CORPUS_DIR = join(EXP_DIR, "skillrouter-skills");
const PLUGIN_VERSION = "0.1.0";
const PLUGIN_DIR_REL = join(".claude", "plugins", "cache", "local",
                            "skill-router", PLUGIN_VERSION);

const TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 240_000;
const RUN_TAG = process.env.RUN_TAG || new Date().toISOString().slice(0, 10).replace(/-/g, "");
const OUT_DIR = process.env.OUT_DIR
  ? resolve(process.env.OUT_DIR)
  : join(EXP_DIR, "runs", `claude-routing-only-newvariants-${RUN_TAG}`);
const SYNTHETIC_CORPUS_SIZE = Number(process.env.SYNTHETIC_CORPUS_SIZE || "0");
const PROXY = process.env.CLAUDE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";

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

const ALL_VARIANTS = [
  { id: "D-agentic", mode: "router" },
  { id: "K-bounded", mode: "router" },
  { id: "K-lite",    mode: "router" },
  { id: "L-agentic", mode: "router" },
  { id: "M-bm25",    mode: "router" },
];
const VARIANTS = process.env.ONLY_VARIANTS
  ? ALL_VARIANTS.filter((v) => process.env.ONLY_VARIANTS.split(",").includes(v.id))
  : ALL_VARIANTS;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function md5(s) {
  return createHash("md5").update(s).digest("hex").slice(0, 12);
}

async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function ensureBaseHome() {
  if (await pathExists(BASE_HOME)) {
    const stateFile = join(BASE_HOME, ".base-ready");
    if (await pathExists(stateFile)) {
      log(`base HOME exists at ${BASE_HOME} (.base-ready present; reusing)`);
      return;
    }
    log(`base HOME exists but no .base-ready marker; rebuilding`);
    await rm(BASE_HOME, { recursive: true, force: true });
  }
  log(`building base HOME at ${BASE_HOME}`);
  await mkdir(join(BASE_HOME, ".claude"), { recursive: true });
  // Auth.
  const credSrc = join(homedir(), ".claude", ".credentials.json");
  if (!await pathExists(credSrc)) {
    throw new Error(`missing ${credSrc}; claude -p cannot authenticate`);
  }
  await copyFile(credSrc, join(BASE_HOME, ".claude", ".credentials.json"));
  log(`copied credentials`);

  // Plugin install.
  log(`npm run install:plugin (HOME=${BASE_HOME})`);
  const env = { ...process.env, HOME: BASE_HOME };
  delete env.SKILL_ROUTER_HOST;
  delete env.AGENTS_HOME;
  delete env.CLAUDE_HOME;
  await execFileAsync("npm", ["run", "install:plugin"], {
    cwd: REPO_ROOT, env, maxBuffer: 32 * 1024 * 1024, timeout: 300_000,
  });
  log(`plugin installed`);

  // Corpus.
  log(`copying 150-skill corpus -> ${join(BASE_HOME, ".claude", "skills")}`);
  const skillsDst = join(BASE_HOME, ".claude", "skills");
  await mkdir(skillsDst, { recursive: true });
  const entries = (await readdir(CORPUS_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory());
  let copied = 0;
  for (const ent of entries) {
    await cp(join(CORPUS_DIR, ent.name), join(skillsDst, ent.name), { recursive: true });
    copied++;
  }
  log(`copied ${copied} skills`);

  // Mark base ready.
  await writeFile(join(BASE_HOME, ".base-ready"), new Date().toISOString());
}

async function setCorpusState(home, target) {
  const root = join(home, ".claude", "skills");
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  let renames = 0;
  for (const id of dirs) {
    const en = join(root, id, "SKILL.md");
    const dis = join(root, id, "SKILL.md.skill-router-disabled");
    if (target === "enabled" && existsSync(dis) && !existsSync(en)) {
      await rename(dis, en); renames++;
    } else if (target === "disabled" && existsSync(en) && !existsSync(dis)) {
      await rename(en, dis); renames++;
    }
  }
  return renames;
}

// Synthetic noise skills used for the L-agentic-1k variant. Mirrors
// `makeSyntheticNoiseSkills` in codex-routing-only-4x5.mjs so the two hosts
// share the same fingerprint and the 1K Pareto comparison is comparable.
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

function cacheSkill({ id, name, description, metadata, skillMdPath }) {
  return {
    id, name, description, metadata,
    source: "user",
    pluginKey: null,
    skillMdPath,
    isDisabled: true,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  };
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
    let raw = line.slice(idx + 1).trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    out[key] = raw;
  }
  return out;
}

async function loadRealCorpusSkillsForCache() {
  const entries = (await readdir(CORPUS_DIR, { withFileTypes: true }))
    .filter((ent) => ent.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const skills = [];
  for (const ent of entries) {
    const body = await readFile(join(CORPUS_DIR, ent.name, "SKILL.md"), "utf8");
    const meta = parseSkillFrontmatter(body);
    const name = meta.name || ent.name;
    const description = meta.description || "";
    skills.push(cacheSkill({
      id: `user:${ent.name}`,
      name,
      description,
      metadata: {
        name, description, aliases: [], tags: [], tools: [],
        domains: [], intents: [], examples: [],
      },
      skillMdPath: `corpus-cache:${ent.name}`,
    }));
  }
  return skills;
}

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
      id: `user:${name}`,
      name,
      description,
      metadata: {
        name, description,
        aliases: [`${domain} ${action}`],
        tags: [domain, action], tools: [tool],
        domains: [domain, secondary],
        intents: [`${action} ${tool}`], examples: [],
      },
      skillMdPath: `corpus-cache:${name}`,
    }));
  }
  return skills;
}

async function preseedSyntheticCorpusCache(home, size) {
  const realSkills = await loadRealCorpusSkillsForCache();
  if (size < realSkills.length) {
    throw new Error(`SYNTHETIC_CORPUS_SIZE=${size} smaller than real corpus size ${realSkills.length}`);
  }
  const syntheticNoise = makeSyntheticNoiseSkills(size - realSkills.length);
  const skills = [...realSkills, ...syntheticNoise];
  const stateDir = join(home, ".skill-router");
  await mkdir(stateDir, { recursive: true });
  await rm(join(stateDir, "corpus-bm25-index-claude-code.json"), { force: true });
  await writeFile(join(stateDir, "corpus-cache-claude-code.json"), JSON.stringify({
    version: 2,
    host: "claude-code",
    createdAtMs: Date.now(),
    fingerprint: `synthetic-${size}`,
    skills,
  }));
  log(`preseeded Claude Code corpus cache with ${skills.length} skills at ${stateDir}`);

  // Also materialize synthetic skill dirs on disk so shell-based variants
  // (K-bounded, K-lite, J-bounded) see them via glob/find. The real 150 dirs
  // are already present from BASE_HOME copy; only the synthetic noise needs
  // to be written.
  const skillsRoot = join(home, ".claude", "skills");
  let materialized = 0;
  for (const s of syntheticNoise) {
    const dir = join(skillsRoot, s.name);
    await mkdir(dir, { recursive: true });
    const body = [
      "---",
      `name: ${JSON.stringify(s.name)}`,
      `description: ${JSON.stringify(s.description || "")}`,
      "---",
      "",
    ].join("\n");
    await writeFile(join(dir, "SKILL.md.skill-router-disabled"), body);
    materialized++;
  }
  if (materialized) log(`materialized ${materialized} synthetic noise skill dirs under ${skillsRoot}`);
}

async function prepareVariantHome(variant, runLabel) {
  const home = join(HOMES_DIR, `${variant.id}.${runLabel}`);
  await rm(home, { recursive: true, force: true });
  await cp(BASE_HOME, home, { recursive: true });
  const target = variant.mode === "native" ? "enabled" : "disabled";
  const n = await setCorpusState(home, target);

  if (variant.mode === "router") {
    const pluginRoot = join(home, PLUGIN_DIR_REL);
    const dst = join(pluginRoot, "skills", "skill-router-skills", "SKILL.md");
    const routerBin = join(pluginRoot, "bin", "skill-router");
    const variantPath = join(VARIANTS_DIR, `${variant.id}.SKILL.md`);
    let body = await readFile(variantPath, "utf8");
    body = body.replaceAll("<abs-path-to-skill-router>", routerBin);
    await writeFile(dst, body);
  }
  await mkdir(join(home, "tmp"), { recursive: true });
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(join(home, ".claude", "CLAUDE.md"), CLAUDE_MD_TEXT);
  if (SYNTHETIC_CORPUS_SIZE > 0 && variant.mode === "router") {
    await preseedSyntheticCorpusCache(home, SYNTHETIC_CORPUS_SIZE);
  }
  log(`[${variant.id}] HOME ready: corpus=${target} (${n} renames), CLAUDE.md present`);
  return home;
}

async function preflight(home, variant) {
  if (variant.mode === "router") {
    const dst = join(home, PLUGIN_DIR_REL, "skills", "skill-router-skills", "SKILL.md");
    const body = await readFile(dst, "utf8");
    if (!body.includes(`skill-router.variant: "${variant.id}"`)) {
      throw new Error(`preflight: variant marker missing in ${dst}`);
    }
  }
  if (!existsSync(join(home, ".claude", "CLAUDE.md"))) {
    throw new Error(`preflight: CLAUDE.md missing in ${home}`);
  }
}

async function runOne(variant, home, queryObj) {
  const project = join(home, "project");
  await mkdir(project, { recursive: true });
  const env = {
    ...process.env, HOME: home, TMPDIR: join(home, "tmp"),
    NO_PROXY: process.env.NO_PROXY || "localhost,127.0.0.1",
    ...(PROXY ? { HTTP_PROXY: PROXY, HTTPS_PROXY: PROXY } : {}),
  };
  if (SYNTHETIC_CORPUS_SIZE > 0 && !env.SKILL_ROUTER_CORPUS_CACHE_TTL_MS) {
    env.SKILL_ROUTER_CORPUS_CACHE_TTL_MS = "3600000";
  }
  delete env.SKILL_ROUTER_HOST;
  delete env.AGENTS_HOME;
  delete env.CLAUDE_HOME;

  const fullQuery = queryObj.query + STOP_TAIL;
  const args = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
  ];
  if (variant.mode === "router") {
    args.push("--plugin-dir", join(home, PLUGIN_DIR_REL));
  }
  const label = `${variant.id}.${queryObj.id}`;
  const outDir = join(OUT_DIR, variant.id);
  const out = join(outDir, `${queryObj.id}.jsonl`);
  await mkdir(outDir, { recursive: true });
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
  const dur = Date.now() - t0;
  log(`[${label}] exit=${exitCode} timedOut=${timedOut} dur=${(dur/1000).toFixed(1)}s events=${events.length}`);
  return {
    variant: variant.id, queryId: queryObj.id, expected: queryObj.expected,
    exitCode, timedOut, durationMs: dur,
  };
}

async function main() {
  if (!PROXY) {
    log(`WARN: no HTTP_PROXY/HTTPS_PROXY/CLAUDE_PROXY set; claude may fail in environments that require a proxy`);
  }
  const queries = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  const onlyQueries = process.env.ONLY_QUERIES
    ? new Set(process.env.ONLY_QUERIES.split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  const runQueries = onlyQueries ? queries.filter((q) => onlyQueries.has(q.id)) : queries;
  if (runQueries.length === 0) throw new Error("no queries selected");
  const runLabel = SYNTHETIC_CORPUS_SIZE > 0 ? `syn${SYNTHETIC_CORPUS_SIZE}` : "150";

  log(`harness: ${VARIANTS.length} variants x ${runQueries.length} queries = ${VARIANTS.length * runQueries.length} cells. timeout=${TIMEOUT_MS}ms out=${OUT_DIR}`);

  await ensureBaseHome();
  await mkdir(HOMES_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const startedAt = new Date().toISOString();
  const runs = [];
  for (const variant of VARIANTS) {
    const home = await prepareVariantHome(variant, runLabel);
    try { await preflight(home, variant); }
    catch (err) {
      log(`[${variant.id}] preflight failed: ${err.message}`);
      continue;
    }
    for (const q of runQueries) {
      try {
        runs.push(await runOne(variant, home, q));
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        log(`[${variant.id}.${q.id}] error: ${err.message}`);
        runs.push({
          variant: variant.id, queryId: q.id, expected: q.expected,
          error: String(err).slice(0, 500),
        });
      }
    }
  }
  const finishedAt = new Date().toISOString();

  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({
    startedAt,
    finishedAt,
    timeoutMs: TIMEOUT_MS,
    syntheticCorpusSize: SYNTHETIC_CORPUS_SIZE || null,
    runLabel,
    claudeMdText: CLAUDE_MD_TEXT,
    stopTail: STOP_TAIL,
    variants: VARIANTS,
    queries: runQueries.map((q) => ({ id: q.id, expected: q.expected, domain: q.domain })),
    runs,
  }, null, 2));
  log(`summary -> ${join(OUT_DIR, "summary.json")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
