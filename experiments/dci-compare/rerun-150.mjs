#!/usr/bin/env node
// rerun-150.mjs — Fresh-environment runner for the 150-skill experiment grid.
// Every (host, variant, condition, query) cell gets a brand-new HOME with:
//   - skill-router plugin (cloned from ~/.claude/plugins/cache/local/skill-router/
//     for Claude or copied for Codex) with the variant's SKILL.md patched in
//   - 150 anonymized disabled-skill directories (from experiments/dci-compare/skillrouter-skills/)
//   - auth credentials copied from the real HOME
//   - (Claude only) optional <HOME>/.claude/CLAUDE.md injection
// then invokes:
//   - claude -p "<query><STOP_TAIL>" --model claude-opus-4-7 --effort high
//   - codex exec ... -c model="gpt-5.5" -c model_reasoning_effort="high"
//
// Models:
//   Claude: claude-opus-4-7, effort high
//   Codex:  gpt-5.5, reasoning_effort high
//
// Usage:
//   node rerun-150.mjs --hosts=claude,codex --variants=J-bounded --queries=3d-scan-calc \
//        --conditions=with-claudemd --concurrency=2 --out-name=smoke-2026-05-26
//
//   # full grid:
//   node rerun-150.mjs --hosts=all --variants=all --queries=all --conditions=all \
//        --concurrency=8 --out-name=rerun-150-2026-05-26

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile, readFile, rm, cp, copyFile, rename, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const REPO_ROOT = join(EXP_DIR, "../..");
const SKILLS_SRC = join(EXP_DIR, "skillrouter-skills"); // 150 dirs of skill-001..skill-150
const VARIANTS_CLAUDE = join(EXP_DIR, "variants/routing-only");
const VARIANTS_CODEX = join(EXP_DIR, "variants/routing-only-codex");
const QUERIES_JSON = join(EXP_DIR, "queries.json");
const HOMES_DIR = join(EXP_DIR, ".rerun-homes");
const PLUGIN_TEMPLATE_CLAUDE = join(homedir(), ".claude/plugins/cache/local/skill-router/0.1.0");
const CODEX_PLUGIN_SRC = join(REPO_ROOT, "plugins/codex");
const CODEX_PLUGIN_NAME = "agentic-skill-router";
const CODEX_MARKETPLACE = "local";
const CODEX_PLUGIN_KEY = `${CODEX_PLUGIN_NAME}@${CODEX_MARKETPLACE}`;
const CODEX_PLUGIN_SKILL_DIR = "agentic-skill-router-skills";
const CODEX_PLUGIN_BIN = "agentic-skill-router";
const AGENTIC_DISABLED_SUFFIX = ".agentic-skill-router-disabled";
const LEGACY_DISABLED_SUFFIX = ".skill-router-disabled";
const CORPUS_CACHE_VERSION = 2;

const CLAUDE_AUTH = join(homedir(), ".claude/.credentials.json");
const CODEX_AUTH = join(homedir(), ".codex/auth.json");

// Variant E-digest depends on this helper script at $HOME/.claude/skill-corpus
const SKILL_CORPUS_HELPER = join(EXP_DIR, "skill-corpus");

// Env required by Codex
const LITELLM_KEY = process.env.LITELLM_KEY || "sk-prod-7xK9mQ2vLp8RzT4nHy6cJu1Ba3EfWd5Ns0";
// Proxy required by Claude (alias-injected normally)
const CLAUDE_PROXY = "http://vhlaqlen:izsexg7e00ug@tx-sh.gptclub.ai:10847";

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

const TIMEOUT_MS = Number(process.env.RERUN_TIMEOUT_MS) || 300_000; // 5 min per query

// 16 variants on 150-skill corpus = 9 base + 7 follow-on.
//
// Variant IDs that don't directly map to a SKILL.md filename use the
// `variantSkillMap` below to point at the actual file.
const ALL_VARIANTS = [
  "G-native",                 // base 1 — no router, all skills enabled
  "A-router",                 // base 2 — built-in skill-router CLI
  "B-cc",                     // base 3 — free-shell DCI agent
  "C-lite",                   // base 4 — bash-only bounded DCI
  "D-agentic",                // base 5 — structured search/find/open/summarize
  "E-digest",                 // base 6 — 2-call compact digest
  "H-bounded",                // base 7 — bounded variant of B
  "I-meta",                   // base 8 — metadata-only (no body reads)
  "J-bounded",                // base 9 — keyword grep + shortlist
  "J-bounded-v2",             // follow-on 1 — scale-stable J
  "K-bounded",                // follow-on 2 — bounded grep + frontmatter inspection
  "K-lite",                   // follow-on 3 — slim K, replicate #1
  "K-lite-replicate",         // follow-on 4 — same K-lite SKILL.md, replicate #2
  "L-agentic",                // follow-on 5 — corpus search/inspect CLI
  "M-bm25",                   // follow-on 6 — BM25 ranker + rerank
  "D-agentic-metadata",       // follow-on 7 — metadata-only variation of D
];

// Map variant IDs to the actual SKILL.md filename when they differ.
// K-lite-replicate runs the same SKILL.md as K-lite, so we statistically
// replicate the result without authoring a second variant file.
const VARIANT_SKILL_MAP = {
  "K-lite-replicate": "K-lite",
};
const ALL_CONDITIONS = ["with-claudemd", "without-claudemd"];

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

function parseArgs(argv) {
  const out = {
    hosts: ["claude", "codex"],
    variants: ["J-bounded"],
    queries: ["3d-scan-calc"],
    conditions: ["with-claudemd"],
    concurrency: 2,
    outName: `smoke-${new Date().toISOString().slice(0, 10)}`,
    keepHomes: false,
    syntheticCorpusSize: 0,
  };
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) {
      if (a === "--keep-homes") { out.keepHomes = true; continue; }
      throw new Error(`bad arg: ${a}`);
    }
    const [, k, v] = m;
    if (k === "hosts") out.hosts = v === "all" ? ["claude", "codex"] : v.split(",");
    else if (k === "variants") out.variants = v === "all" ? ALL_VARIANTS : v.split(",");
    else if (k === "queries") out.queries = v.split(",");
    else if (k === "conditions") out.conditions = v === "all" ? ALL_CONDITIONS : v.split(",");
    else if (k === "concurrency") out.concurrency = Number(v);
    else if (k === "out-name") out.outName = v;
    else if (k === "synthetic-corpus-size") out.syntheticCorpusSize = Number(v);
    else throw new Error(`unknown arg: ${k}`);
  }
  return out;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function codexDisabledSuffixForVariant(variant) {
  return AGENTIC_DISABLED_SUFFIX;
}

function normalizeCodexNewCliSkillText(body) {
  return body.replaceAll(LEGACY_DISABLED_SUFFIX, AGENTIC_DISABLED_SUFFIX);
}

async function writeCodexSkillCorpusHelper(dst) {
  let body = await readFile(SKILL_CORPUS_HELPER, "utf8");
  body = normalizeCodexNewCliSkillText(body);
  await writeFile(dst, body);
  await chmod(dst, 0o755);
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

async function loadRealCodexCorpusSkillsForCache() {
  const entries = (await readdir(SKILLS_SRC, { withFileTypes: true }))
    .filter(ent => ent.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const skills = [];
  for (const ent of entries) {
    const body = await readFile(join(SKILLS_SRC, ent.name, "SKILL.md"), "utf8");
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

async function preseedCodexSyntheticCorpusCache(home, size) {
  if (!size) return;
  const realSkills = await loadRealCodexCorpusSkillsForCache();
  if (size < realSkills.length) {
    throw new Error(`synthetic corpus size ${size} is smaller than real corpus size ${realSkills.length}`);
  }
  const skills = [
    ...realSkills,
    ...makeSyntheticNoiseSkills(size - realSkills.length),
  ];
  const stateDir = join(home, ".agentic-skill-router");
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, "corpus-cache-codex.json"), JSON.stringify({
    version: CORPUS_CACHE_VERSION,
    host: "codex",
    createdAtMs: Date.now(),
    fingerprint: `synthetic-${size}-${createHash("sha256").update(String(size)).digest("hex").slice(0, 8)}`,
    skills,
  }));
}

async function installCodexRouterPlugin(codexDir, variant) {
  const manifestPath = join(CODEX_PLUGIN_SRC, ".codex-plugin/plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const version = manifest.version || "0.1.0";
  const installPath = join(codexDir, "plugins/cache", CODEX_MARKETPLACE, CODEX_PLUGIN_NAME, version);
  const runtimePath = join(dirname(codexDir), ".agentic-skill-router/runtime", version);
  const runtimeBin = join(runtimePath, "bin", CODEX_PLUGIN_BIN);

  await rm(installPath, { recursive: true, force: true });
  await mkdir(dirname(installPath), { recursive: true });
  await cp(CODEX_PLUGIN_SRC, installPath, { recursive: true });
  await cp(join(REPO_ROOT, "skills"), join(installPath, "skills"), { recursive: true });

  const installedManifestPath = join(installPath, ".codex-plugin/plugin.json");
  const installedManifest = JSON.parse(await readFile(installedManifestPath, "utf8"));
  installedManifest.skills = "./skills/";
  await writeFile(installedManifestPath, JSON.stringify(installedManifest, null, 2) + "\n");

  await rm(runtimePath, { recursive: true, force: true });
  await mkdir(dirname(runtimePath), { recursive: true });
  await cp(join(REPO_ROOT, "bin"), join(runtimePath, "bin"), { recursive: true });
  await cp(join(REPO_ROOT, "lib"), join(runtimePath, "lib"), { recursive: true });
  await chmod(runtimeBin, 0o755);

  const wrapperPath = join(installPath, "bin", CODEX_PLUGIN_BIN);
  await mkdir(dirname(wrapperPath), { recursive: true });
  await writeFile(wrapperPath, [
    "#!/usr/bin/env sh",
    "set -eu",
    "export AGENTIC_SKILL_ROUTER_HOST=codex",
    `export AGENTIC_SKILL_ROUTER_ASSET_ROOT=${shellQuote(installPath)}`,
    `exec ${shellQuote(runtimeBin)} "$@"`,
    "",
  ].join("\n"));
  await chmod(wrapperPath, 0o755);

  const skillFileBase = VARIANT_SKILL_MAP[variant] || variant;
  const variantSrc = join(VARIANTS_CODEX, `${skillFileBase}.SKILL.md`);
  if (!existsSync(variantSrc)) throw new Error(`Codex variant missing: ${variantSrc}`);
  let body = await readFile(variantSrc, "utf8");
  body = normalizeCodexNewCliSkillText(body)
    .replaceAll("<abs-path-to-agentic-skill-router>", wrapperPath)
    .replaceAll("<abs-path-to-skill-router>", wrapperPath);
  const variantSkillDst = join(installPath, "skills", CODEX_PLUGIN_SKILL_DIR, "SKILL.md");
  await writeFile(variantSkillDst, body);
}

// Variants that need the NEW agentic-skill-router CLI (with `corpus search`
// subcommand). The OLD `~/.claude/plugins/cache/local/skill-router/` doesn't
// have `corpus`, causing variants like L-agentic / M-bm25 to fail with
// `unknown subcommand: corpus`. For these variants we install the NEW plugin
// alongside the OLD one — matching what installCodexRouterPlugin does for Codex.
const CLAUDE_NEW_CLI_VARIANTS = new Set(["L-agentic", "M-bm25"]);
const CLAUDE_PLUGIN_SRC = join(REPO_ROOT, "plugins/claude-code");
const CLAUDE_PLUGIN_NAME = "agentic-skill-router";
const CLAUDE_MARKETPLACE = "local";
const CLAUDE_PLUGIN_KEY = `${CLAUDE_PLUGIN_NAME}@${CLAUDE_MARKETPLACE}`;
const CLAUDE_PLUGIN_SKILL_DIR = "agentic-skill-router-skills";
const CLAUDE_PLUGIN_BIN = "agentic-skill-router";

async function installClaudeRouterPluginNewCli(claudeDir, variant) {
  const manifestPath = join(CLAUDE_PLUGIN_SRC, ".claude-plugin/plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const version = manifest.version || "0.1.0";
  const installPath = join(claudeDir, "plugins/cache", CLAUDE_MARKETPLACE, CLAUDE_PLUGIN_NAME, version);
  const runtimePath = join(dirname(claudeDir), ".agentic-skill-router/runtime", version);
  const runtimeBin = join(runtimePath, "bin", CLAUDE_PLUGIN_BIN);

  await rm(installPath, { recursive: true, force: true });
  await mkdir(dirname(installPath), { recursive: true });
  await cp(CLAUDE_PLUGIN_SRC, installPath, { recursive: true });
  await cp(join(REPO_ROOT, "skills"), join(installPath, "skills"), { recursive: true });

  // Fix the plugin manifest's `skills` path so Claude finds them inline
  const installedManifestPath = join(installPath, ".claude-plugin/plugin.json");
  const installedManifest = JSON.parse(await readFile(installedManifestPath, "utf8"));
  installedManifest.skills = "./skills/";
  await writeFile(installedManifestPath, JSON.stringify(installedManifest, null, 2) + "\n");

  // Runtime bin/lib (parallel to Codex's setup)
  await rm(runtimePath, { recursive: true, force: true });
  await mkdir(dirname(runtimePath), { recursive: true });
  await cp(join(REPO_ROOT, "bin"), join(runtimePath, "bin"), { recursive: true });
  await cp(join(REPO_ROOT, "lib"), join(runtimePath, "lib"), { recursive: true });
  await chmod(runtimeBin, 0o755);

  // Wrapper that sets host=claude and delegates to runtime bin
  const wrapperPath = join(installPath, "bin", CLAUDE_PLUGIN_BIN);
  await mkdir(dirname(wrapperPath), { recursive: true });
  await writeFile(wrapperPath, [
    "#!/usr/bin/env sh",
    "set -eu",
    "export AGENTIC_SKILL_ROUTER_HOST=claude-code",
    `export AGENTIC_SKILL_ROUTER_ASSET_ROOT=${shellQuote(installPath)}`,
    `exec ${shellQuote(runtimeBin)} "$@"`,
    "",
  ].join("\n"));
  await chmod(wrapperPath, 0o755);

  // Template the variant SKILL.md, replacing CLI placeholder with the wrapper path
  const skillFileBase = VARIANT_SKILL_MAP[variant] || variant;
  const variantSrc = join(VARIANTS_CLAUDE, `${skillFileBase}.SKILL.md`);
  if (!existsSync(variantSrc)) throw new Error(`Claude variant missing: ${variantSrc}`);
  let body = await readFile(variantSrc, "utf8");
  body = body
    .replaceAll(".skill-router-disabled", AGENTIC_DISABLED_SUFFIX)
    .replaceAll("<abs-path-to-agentic-skill-router>", wrapperPath)
    .replaceAll("<abs-path-to-skill-router>", wrapperPath);
  const variantSkillDst = join(installPath, "skills", CLAUDE_PLUGIN_SKILL_DIR, "SKILL.md");
  await writeFile(variantSkillDst, body);

  return { installPath, wrapperPath };
}

async function loadRealClaudeCorpusSkillsForCache() {
  const entries = (await readdir(SKILLS_SRC, { withFileTypes: true }))
    .filter(ent => ent.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const skills = [];
  for (const ent of entries) {
    const body = await readFile(join(SKILLS_SRC, ent.name, "SKILL.md"), "utf8");
    const metadata = parseSkillFrontmatter(body);
    const name = metadata.name || ent.name;
    const description = metadata.description || "";
    skills.push(cacheSkill({
      id: `user:${ent.name}`, // Claude uses user:<id> (no codex: prefix)
      name,
      description,
      metadata: {
        name, description, aliases: [], tags: [], tools: [], domains: [], intents: [], examples: [],
      },
      skillMdPath: `corpus-cache:${ent.name}`,
    }));
  }
  return skills;
}

async function preseedClaudeSyntheticCorpusCache(home, size) {
  if (!size) return;
  const realSkills = await loadRealClaudeCorpusSkillsForCache();
  if (size < realSkills.length) {
    throw new Error(`synthetic corpus size ${size} is smaller than real corpus size ${realSkills.length}`);
  }
  // Reuse Codex noise skills but rewrite id prefix to claude-code style
  const noise = makeSyntheticNoiseSkills(size - realSkills.length).map(s => ({
    ...s, id: s.id.replace(/^user:codex:/, "user:"),
  }));
  const skills = [...realSkills, ...noise];
  const stateDir = join(home, ".agentic-skill-router");
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, "corpus-cache-claude-code.json"), JSON.stringify({
    version: CORPUS_CACHE_VERSION,
    host: "claude-code",
    createdAtMs: Date.now(),
    fingerprint: `synthetic-${size}-${createHash("sha256").update(String(size)).digest("hex").slice(0, 8)}`,
    skills,
  }));
}

async function setupClaudeHome(home, variant, withClaudeMd, opts = {}) {
  // Layout:
  //   $HOME/.claude/.credentials.json (auth)
  //   $HOME/.claude/plugins/cache/local/skill-router/0.1.0/  (copied)
  //     skills/skill-router-skills/SKILL.md  (overwritten with variant)
  //   $HOME/.claude/skills/skill-001..150/  (disabled corpus)
  //   $HOME/.claude/CLAUDE.md  (if withClaudeMd)
  //   $HOME/tmp/  (TMPDIR)
  const claudeDir = join(home, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await mkdir(join(home, "tmp"), { recursive: true });

  // Auth
  await copyFile(CLAUDE_AUTH, join(claudeDir, ".credentials.json"));

  // Decide between OLD `skill-router` plugin (default) and NEW `agentic-skill-router`
  // plugin (for variants that use the `corpus search` subcommand).
  const useNewCli = CLAUDE_NEW_CLI_VARIANTS.has(variant);
  // G-native skips the router plugin entirely (all skills enabled, native auto-pick).
  if (variant !== "G-native") {
    if (useNewCli) {
      // Install NEW agentic-skill-router plugin (has `corpus search` subcommand)
      await installClaudeRouterPluginNewCli(claudeDir, variant);
    } else {
      // Install OLD skill-router plugin (legacy)
      if (!existsSync(PLUGIN_TEMPLATE_CLAUDE)) {
        throw new Error(`Claude plugin template missing: ${PLUGIN_TEMPLATE_CLAUDE}`);
      }
      const pluginDst = join(claudeDir, "plugins/cache/local/skill-router/0.1.0");
      await mkdir(dirname(pluginDst), { recursive: true });
      await cp(PLUGIN_TEMPLATE_CLAUDE, pluginDst, { recursive: true });

      const skillFileBase = VARIANT_SKILL_MAP[variant] || variant;
      const variantSrc = join(VARIANTS_CLAUDE, `${skillFileBase}.SKILL.md`);
      if (!existsSync(variantSrc)) throw new Error(`Claude variant missing: ${variantSrc}`);
      const variantSkillDst = join(pluginDst, "skills/skill-router-skills/SKILL.md");
      await copyFile(variantSrc, variantSkillDst);
    }
  }

  // Install plugin registry entry + enable it via settings (only when plugin installed)
  if (variant !== "G-native") {
    const pluginKey = useNewCli ? CLAUDE_PLUGIN_KEY : "skill-router@local";
    const pluginPath = useNewCli
      ? join(claudeDir, "plugins/cache", CLAUDE_MARKETPLACE, CLAUDE_PLUGIN_NAME, "0.1.0")
      : join(claudeDir, "plugins/cache/local/skill-router/0.1.0");
    const installed = {
      [pluginKey]: {
        version: "0.1.0",
        installedAt: new Date().toISOString(),
        source: "local",
        path: pluginPath,
      },
    };
    await writeFile(join(claudeDir, "plugins/installed_plugins.json"), JSON.stringify(installed, null, 2));
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      enabledPlugins: { [pluginKey]: true },
    }, null, 2));
  } else {
    await writeFile(join(claudeDir, "settings.json"), "{}");
  }

  // 150-skill disabled corpus.
  // For NEW-CLI variants the suffix must be `.agentic-skill-router-disabled`
  // because the new CLI scans for that suffix when listing corpus.
  const disabledSuffix = useNewCli ? AGENTIC_DISABLED_SUFFIX : LEGACY_DISABLED_SUFFIX;
  const skillsDir = join(claudeDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  for (const id of await readdir(SKILLS_SRC)) {
    const src = join(SKILLS_SRC, id, "SKILL.md");
    const dstDir = join(skillsDir, id);
    await mkdir(dstDir, { recursive: true });
    await copyFile(src, join(dstDir, `SKILL.md${disabledSuffix}`));
  }

  // For variant G-native, ENABLE all skills (router plugin already skipped above)
  if (variant === "G-native") {
    for (const id of await readdir(skillsDir)) {
      const dis = join(skillsDir, id, `SKILL.md${disabledSuffix}`);
      const en = join(skillsDir, id, "SKILL.md");
      if (existsSync(dis)) await rename(dis, en);
    }
  }

  // CLAUDE.md injection
  if (withClaudeMd && variant !== "G-native") {
    await writeFile(join(claudeDir, "CLAUDE.md"), CLAUDE_MD_TEXT);
  }

  // E-digest needs ~/.claude/skill-corpus helper script
  if (variant === "E-digest" && existsSync(SKILL_CORPUS_HELPER)) {
    const dst = join(claudeDir, "skill-corpus");
    await copyFile(SKILL_CORPUS_HELPER, dst);
    const { chmod } = await import("node:fs/promises");
    await chmod(dst, 0o755);
  }

  // 1K synthetic corpus: pre-seed cache file (for variants using NEW CLI corpus search)
  if (opts.syntheticCorpusSize && variant !== "G-native" && useNewCli) {
    await preseedClaudeSyntheticCorpusCache(home, opts.syntheticCorpusSize);
  }
}

async function setupCodexHome(home, variant, opts = {}) {
  // Codex layout:
  //   $HOME/.codex/auth.json
  //   $HOME/.codex/config.toml  (model + reasoning + plugin enable)
  //   $HOME/.codex/plugins/cache/local/skill-router/0.1.0/  (copied)
  //     skills/skill-router-skills/SKILL.md  (overwritten with variant)
  //   $HOME/.codex/skills/skill-001..150/  (disabled corpus)
  const codexDir = join(home, ".codex");
  await mkdir(codexDir, { recursive: true });
  await mkdir(join(home, "tmp"), { recursive: true });
  await copyFile(CODEX_AUTH, join(codexDir, "auth.json"));

  // G-native skips the router plugin entirely
  if (variant !== "G-native") {
    await installCodexRouterPlugin(codexDir, variant);
  }

  // config.toml: model + reasoning (plugin enabled only for non-native)
  const pluginLine = variant !== "G-native"
    ? `\n[plugins."${CODEX_PLUGIN_KEY}"]\nenabled = true\n`
    : "";
  const config = `model = "gpt-5.5"
model_reasoning_effort = "high"
${pluginLine}`;
  await writeFile(join(codexDir, "config.toml"), config);

  // 150-skill disabled corpus
  const skillsDir = join(codexDir, "skills");
  const disabledSuffix = codexDisabledSuffixForVariant(variant);
  await mkdir(skillsDir, { recursive: true });
  for (const id of await readdir(SKILLS_SRC)) {
    const src = join(SKILLS_SRC, id, "SKILL.md");
    const dstDir = join(skillsDir, id);
    await mkdir(dstDir, { recursive: true });
    await copyFile(src, join(dstDir, `SKILL.md${disabledSuffix}`));
  }
  if (variant === "G-native") {
    for (const id of await readdir(skillsDir)) {
      const dis = join(skillsDir, id, `SKILL.md${disabledSuffix}`);
      const en = join(skillsDir, id, "SKILL.md");
      if (existsSync(dis)) await rename(dis, en);
    }
  }

  if (opts.syntheticCorpusSize && variant !== "G-native") {
    await preseedCodexSyntheticCorpusCache(home, opts.syntheticCorpusSize);
  }

  // E-digest needs ~/.codex/skill-corpus helper script
  if (variant === "E-digest" && existsSync(SKILL_CORPUS_HELPER)) {
    const dst = join(codexDir, "skill-corpus");
    await writeCodexSkillCorpusHelper(dst);
    // E-digest references it as $HOME/.claude/skill-corpus in script too — symlink for safety
    const claudeDir = join(home, ".claude");
    await mkdir(claudeDir, { recursive: true });
    try { await writeCodexSkillCorpusHelper(join(claudeDir, "skill-corpus")); } catch {}
  }
}

async function runClaude(home, variant, query, outJsonl) {
  const project = join(home, "project");
  await mkdir(project, { recursive: true });
  const fullQuery = query + STOP_TAIL;
  const env = {
    ...process.env,
    HOME: home,
    TMPDIR: join(home, "tmp"),
    HTTP_PROXY: CLAUDE_PROXY,
    HTTPS_PROXY: CLAUDE_PROXY,
    NO_PROXY: "localhost,127.0.0.1",
  };
  const args = [
    "-p", fullQuery,
    "--model", "claude-opus-4-7",
    "--effort", "high",
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
  ];
  if (variant !== "G-native") {
    const useNewCli = CLAUDE_NEW_CLI_VARIANTS.has(variant);
    const pluginDir = useNewCli
      ? join(home, ".claude/plugins/cache", CLAUDE_MARKETPLACE, CLAUDE_PLUGIN_NAME, "0.1.0")
      : join(home, ".claude/plugins/cache/local/skill-router/0.1.0");
    args.push("--plugin-dir", pluginDir);
  }
  return await runChild("claude", args, { env, cwd: project }, outJsonl, "claude", home);
}

async function runCodex(home, variant, query, outJsonl) {
  const project = join(home, "project");
  await mkdir(project, { recursive: true });
  const fullQuery = query + STOP_TAIL;
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    TMPDIR: join(home, "tmp"),
    LITELLM_KEY,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    http_proxy: "",
    https_proxy: "",
  };
  delete env.HTTP_PROXY; delete env.HTTPS_PROXY; delete env.http_proxy; delete env.https_proxy;
  env.LITELLM_KEY = LITELLM_KEY;
  if (!env.AGENTIC_SKILL_ROUTER_CORPUS_CACHE_TTL_MS) {
    env.AGENTIC_SKILL_ROUTER_CORPUS_CACHE_TTL_MS = "3600000";
  }
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-C", project,
    "-s", "danger-full-access",
    "--dangerously-bypass-approvals-and-sandbox",
    "-c", `model="gpt-5.5"`,
    "-c", `model_reasoning_effort="high"`,
    "--output-last-message", join(home, "last.txt"),
    fullQuery,
  ];
  return await runChild("codex", args, { env, cwd: project }, outJsonl, "codex", home);
}

async function runChild(cmd, args, opts, outJsonl, kind, home) {
  const t0 = Date.now();
  let timedOut = false;
  const events = [];
  let stdoutBuf = "", stderrBuf = "";
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", err => events.push({ type: "_run_error", error: String(err).slice(0, 400) }));
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => {
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
  child.stderr.on("data", chunk => { stderrBuf += chunk; });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5000);
  }, TIMEOUT_MS);
  const exitCode = await new Promise(r => child.on("close", r));
  clearTimeout(timer);
  if (stdoutBuf.trim()) {
    try { events.push(JSON.parse(stdoutBuf)); } catch { events.push({ type: "_raw", line: stdoutBuf }); }
  }
  if (stderrBuf) events.push({ type: "_stderr", text: stderrBuf.slice(0, 6000) });
  if (timedOut) events.push({ type: "_run_error", error: `${kind} timed out after ${TIMEOUT_MS}ms` });
  // Codex final message + rollout-derived true ctx_end
  if (kind === "codex") {
    if (existsSync(join(opts.cwd, "..", "last.txt"))) {
      try {
        const finalTxt = await readFile(join(opts.cwd, "..", "last.txt"), "utf8");
        events.push({ type: "_final_message", text: finalTxt });
      } catch {}
    }
    // Pull thread_id from stream, then read the rollout's last token_count.info.last_token_usage
    const threadEvt = events.find(e => e?.type === "thread.started");
    const threadId = threadEvt?.thread_id;
    if (threadId && home) {
      try {
        const rolloutMetrics = await readLastTokenCountFromRollout(home, threadId);
        const { snapshots, ...summary } = rolloutMetrics;
        events.push({ type: "_rollout_metrics", ...summary });
        events.push({ type: "_rollout_all_snapshots", snapshots });
      } catch (err) {
        events.push({ type: "_rollout_metrics_error", error: String(err).slice(0, 200) });
      }
    }
  }
  await writeFile(outJsonl, events.map(e => JSON.stringify(e)).join("\n") + "\n");
  return { exitCode, timedOut, durationMs: Date.now() - t0, eventCount: events.length };
}

// Find the rollout JSONL Codex wrote under $HOME/.codex/sessions and pull the
// LAST `event_msg/token_count` with non-null info — `info.last_token_usage`
// is the final internal Responses-API prompt size (true ctx_end), whereas
// `turn.completed.usage.input_tokens` is cumulative across all internal calls.
async function readLastTokenCountFromRollout(home, threadId) {
  const sessionsRoot = join(home, ".codex/sessions");
  const path = await findRolloutByThreadId(sessionsRoot, threadId);
  if (!path) throw new Error(`no rollout for thread ${threadId}`);
  const raw = await readFile(path, "utf8");
  const snapshots = []; // chronological list of every token_count with info
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed?.type === "event_msg" && parsed?.payload?.type === "token_count" && parsed?.payload?.info) {
      snapshots.push(parsed.payload.info);
    }
  }
  if (!snapshots.length) throw new Error(`no token_count with info in ${path}`);
  const last = snapshots[snapshots.length - 1];
  return {
    lastTokenUsage: last.last_token_usage || null,
    totalTokenUsage: last.total_token_usage || null,
    modelContextWindow: last.model_context_window || null,
    rolloutPath: path,
    snapshots, // full per-call history (for ctx_start + per-turn ctx growth)
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

async function runCell({ host, variant, condition, query, outDir, keepHomes, syntheticCorpusSize }) {
  const label = `${host}.${variant}.${condition}.${query}`;
  const homeId = `${host}-${variant}-${condition}-${query}`;
  const home = join(HOMES_DIR, homeId);
  log(`[${label}] start (home=${home})`);
  try {
    await rm(home, { recursive: true, force: true });
    if (host === "claude") {
      await setupClaudeHome(home, variant, condition === "with-claudemd", { syntheticCorpusSize });
    } else {
      await setupCodexHome(home, variant, { syntheticCorpusSize });
    }
    const queryObj = await loadQuery(query);
    const cellDir = join(outDir, `${host}-${variant}-${condition}`);
    await mkdir(cellDir, { recursive: true });
    const outJsonl = join(cellDir, `${query}.jsonl`);
    const t0 = Date.now();
    const res = host === "claude"
      ? await runClaude(home, variant, queryObj.query, outJsonl)
      : await runCodex(home, variant, queryObj.query, outJsonl);
    const dur = Date.now() - t0;
    log(`[${label}] done exit=${res.exitCode} timedOut=${res.timedOut} dur=${(dur/1000).toFixed(1)}s events=${res.eventCount}`);
    return { host, variant, condition, queryId: query, expected: queryObj.expected, ...res };
  } catch (err) {
    log(`[${label}] ERROR: ${err.message}`);
    return { host, variant, condition, queryId: query, error: String(err).slice(0, 500) };
  } finally {
    if (!keepHomes) {
      await rm(home, { recursive: true, force: true });
    }
  }
}

async function loadQuery(id) {
  const j = JSON.parse(await readFile(QUERIES_JSON, "utf8"));
  const q = j.queries.find(x => x.id === id);
  if (!q) throw new Error(`query not found: ${id}`);
  return q;
}

async function withCap(items, cap, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: cap }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = join(EXP_DIR, "runs", args.outName);
  await mkdir(outDir, { recursive: true });

  // Build cells: for each host × variant × condition × query
  const cells = [];
  for (const host of args.hosts) {
    for (const variant of args.variants) {
      // Codex doesn't have a CLAUDE.md condition — skip without-claudemd to avoid dup
      const conditions = host === "codex" ? [args.conditions[0]] : args.conditions;
      for (const condition of conditions) {
        for (const query of args.queries) {
          cells.push({ host, variant, condition, query });
        }
      }
    }
  }
  log(`Cells: ${cells.length} (concurrency=${args.concurrency})`);
  const t0 = Date.now();
  const results = await withCap(cells, args.concurrency, c => runCell({
    ...c,
    outDir,
    keepHomes: args.keepHomes,
    syntheticCorpusSize: args.syntheticCorpusSize,
  }));
  const elapsedMs = Date.now() - t0;

  // Write summary
  const summary = {
    startedAt: new Date(t0).toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs,
    args,
    results,
  };
  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  log(`Done. ${results.length} cells in ${(elapsedMs/1000).toFixed(0)}s. Out: ${outDir}`);
}

main().catch(e => { console.error(e.stack ?? e.message); process.exit(1); });
