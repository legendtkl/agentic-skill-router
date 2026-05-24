#!/usr/bin/env node
// DCI retriever comparison harness.
// Runs N queries x M variants through `claude -p --output-format=stream-json`
// and writes per-run jsonl transcripts to runs/<variant>/<query-id>.jsonl.
//
// Usage:
//   node experiments/dci-compare/run.mjs [--smoke] [--variant=A|B1|B2|all]
//                                        [--reuse-home] [--keep-home]
//                                        [--max-turns=25]
//
// NOTE: this driver runs serially. For parallel multi-variant execution use
// `routing-only-parallel.mjs` (paired CLAUDE.md A/B) or `routing-only-paired.mjs`.
import { spawn, execFile } from "node:child_process";
import { mkdir, cp, copyFile, readFile, writeFile, readdir, rename, symlink, stat, rm, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const EXP_DIR = __dirname;
const VARIANTS_DIR = join(EXP_DIR, "variants");
const RUNS_DIR = join(EXP_DIR, "runs");
const HOME_CACHE = join(EXP_DIR, ".tmp-home");
const CORPUS_CACHE = join(EXP_DIR, ".corpus-cache");

const MAX_BUFFER = 50 * 1024 * 1024;
const CLAUDE_RUN_TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 240_000;
const GIT_TIMEOUT_MS = 90_000;
const NPM_TIMEOUT_MS = 180_000;

const REPOS = [
  { owner: "openai", repo: "skills", sha: "590b49edc158611a2b2ed715ae73f27eb70d251a", subdir: "skills/.curated", prefix: "" },
  { owner: "anthropics", repo: "skills", sha: "690f15cac7f7b4c055c5ab109c79ed9259934081", subdir: "skills", prefix: "ant-" },
  { owner: "obra", repo: "superpowers-skills", sha: "cdcd624ad3fd8026deb692e565351854569798dd", subdir: "skills", prefix: "obra-" },
  { owner: "tech-leads-club", repo: "agent-skills", sha: "81e7e0dd3abe314aa004ec276c1d64643d2bd6c0", subdir: "packages/skills-catalog/skills", prefix: "tlc-" },
];

// Hard cap on the installed disabled-skill corpus. openai(38)+anthropics(17)
// +obra(31)=86 are taken in full; the remainder is filled from tech-leads-club.
const CORPUS_CAP = 100;

const VARIANTS = ["A-router", "B-cc", "C-lite", "D-agentic", "E-digest", "F-index", "G-native", "H-bounded", "I-meta", "J-bounded"];

// router  = disabled corpus + skill-router-skills plugin drives retrieval
// native  = corpus left ENABLED, no skill-router; Claude Code's own skill
//           auto-selection picks (the "no router at all" baseline)
const VARIANT_MODE = {
  "A-router": "router",
  "B-cc": "router",
  "C-lite": "router",
  "D-agentic": "router",
  "E-digest": "router",
  "F-index": "router",
  "G-native": "native",
  "H-bounded": "router",
  "I-meta": "router",
  "J-bounded": "router",
};

const NATIVE_SYSTEM_PROMPT = [
  "This session is a skill-routing benchmark. A set of Agent Skills is",
  "installed and available to you.",
  "",
  "For EVERY user request — regardless of subject, even if conversational,",
  "even if you could answer directly — your FIRST tool call MUST be the",
  "Skill tool, invoking the single installed skill whose description best",
  "matches the request. Immediately after invoking it, STOP. Do NOT execute",
  "the skill's task. Output exactly one line of minified JSON and nothing",
  'else: {"matched_skill_path":null,"matched_skill_name":"<invoked skill id>"}',
  'If no installed skill matches, output {"matched_skill_path":null,"matched_skill_name":null}.',
].join("\n");

const ROUTER_SYSTEM_PROMPT = [
  "This session is a disabled-skill routing benchmark.",
  "",
  "For EVERY user request — regardless of subject, even if it is purely",
  "conversational, even if you believe you can answer directly, even if",
  "you intend to refuse or ask clarifying questions — your FIRST tool",
  "call MUST be the `skill-router:skill-router-skills` Skill. After",
  "invoking it, follow its workflow exactly. Do not call any other tool",
  "before it; do not answer or refuse before it.",
].join("\n");

const args = parseArgs(process.argv.slice(2));

const main = async () => {
  const allQueries = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  let selectedQueries = args.smoke ? allQueries.slice(0, 1) : allQueries;
  if (args.only.length > 0) {
    selectedQueries = allQueries.filter((q) => args.only.includes(q.id));
    const missing = args.only.filter((id) => !allQueries.some((q) => q.id === id));
    if (missing.length) throw new Error(`--only: unknown query id(s): ${missing.join(", ")}`);
  }
  const selectedVariants = args.variant === "all" ? VARIANTS : [resolveVariant(args.variant)];

  log(`harness: ${selectedQueries.length} query(s) x ${selectedVariants.length} variant(s) = ${selectedQueries.length * selectedVariants.length} run(s)`);

  await mkdir(RUNS_DIR, { recursive: true });
  // Clear any prior per-run transcripts for the variant/query cells about to
  // be (re)run, so a report can never mix stale runs with fresh ones. Only
  // the targeted cells are cleared — a partial `--only=` re-run keeps the
  // rest intact.
  for (const variant of selectedVariants) {
    const vdir = join(RUNS_DIR, variant);
    for (const q of selectedQueries) {
      await rm(join(vdir, `${q.id}.jsonl`), { force: true });
    }
  }
  const env = await setupFreshHome();

  if (!args.reuseHome) {
    await installPlugin(env);
    await installSkillCorpus(env);
    await disableAllUserSkills(env);
  } else {
    log(`reusing HOME=${env.HOME}`);
  }
  // The variant-E corpus wrapper is always (re)installed so it is present
  // even when an older fresh HOME is reused.
  await installCorpusWrapper(env);
  // Claude OAuth tokens rotate; refresh the credential copy each run so a
  // long-lived reused HOME does not start failing with 401s.
  await refreshCredentials(env);

  const routerSkillPath = await installedRouterSkillPath(env.HOME);
  const routerBin = await installedRouterBin(env.HOME);
  env.SKILL_ROUTER_PLUGIN_DIR = await installedPluginRoot(env.HOME);

  const results = [];
  for (const variant of selectedVariants) {
    const mode = VARIANT_MODE[variant] ?? "router";
    log(`== variant ${variant} (${mode} mode) ==`);
    if (mode === "native") {
      await setCorpusState(env, "enabled");
    } else {
      await setCorpusState(env, "disabled");
      await patchSkillMd(routerSkillPath, variant, env);
    }
    await mkdir(join(RUNS_DIR, variant), { recursive: true });

    for (const query of selectedQueries) {
      const runFile = join(RUNS_DIR, variant, `${query.id}.jsonl`);
      log(`  query: ${query.id} (expected ${query.expected}) -> ${runFile}`);
      const t0 = Date.now();
      try {
        const { events, exitCode, timedOut } = await runClaude(query.query, env, mode, variant);
        await writeJsonl(runFile, events);
        const summary = summarizeRun(events);
        const duration = Date.now() - t0;
        results.push({ variant, query: query.id, expected: query.expected, exitCode, duration, timedOut: timedOut || undefined, ...summary });
        const tag = timedOut ? "TIMEOUT" : "done";
        log(`    ${tag}: turns=${summary.numTurns}, in=${summary.totalInput}, out=${summary.totalOutput}, cache_create=${summary.totalCacheCreate}, cache_read=${summary.totalCacheRead}, ms=${duration}`);
      } catch (err) {
        log(`    FAILED: ${err.message}`);
        // Persist an error-marker transcript so the cell is still visible to
        // the report (counted in the denominator as a miss) rather than
        // silently dropping out of N.
        await writeJsonl(runFile, [{ type: "_run_error", error: String(err).slice(0, 1000) }]);
        results.push({ variant, query: query.id, expected: query.expected, error: String(err).slice(0, 500) });
      }
    }
  }

  await writeFile(join(RUNS_DIR, "summary.json"), JSON.stringify({
    routerSkillPath,
    routerBin,
    home: env.HOME,
    variants: selectedVariants,
    queries: selectedQueries.map((q) => ({ id: q.id, expected: q.expected, kind: q.kind })),
    results,
    finishedAt: new Date().toISOString(),
  }, null, 2));
  log(`wrote summary -> ${join(RUNS_DIR, "summary.json")}`);

  if (!args.keepHome && !args.reuseHome) {
    log(`(home preserved at ${env.HOME}; pass --reuse-home to reuse, or rm -rf manually)`);
  }
};

function parseArgs(argv) {
  const out = { smoke: false, variant: "all", reuseHome: false, keepHome: false, maxTurns: 25, only: [] };
  for (const a of argv) {
    if (a === "--smoke") out.smoke = true;
    else if (a === "--reuse-home") out.reuseHome = true;
    else if (a === "--keep-home") out.keepHome = true;
    else if (a.startsWith("--variant=")) out.variant = a.slice(10);
    else if (a.startsWith("--max-turns=")) out.maxTurns = Number(a.slice(12));
    else if (a.startsWith("--only=")) out.only = a.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

function resolveVariant(name) {
  const found = VARIANTS.find((v) => v === name || v.startsWith(`${name}-`));
  if (!found) throw new Error(`unknown variant: ${name}`);
  return found;
}

async function setupFreshHome() {
  const exists = existsSync(HOME_CACHE);
  if (args.reuseHome && exists) {
    return buildEnv(HOME_CACHE);
  }
  if (exists) {
    log(`removing stale HOME ${HOME_CACHE}`);
    await rm(HOME_CACHE, { recursive: true, force: true });
  }
  await mkdir(HOME_CACHE, { recursive: true });
  await mkdir(join(HOME_CACHE, ".claude"), { recursive: true });
  // copy local Claude credentials so claude -p can authenticate
  const credSrc = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credSrc)) throw new Error(`missing ${credSrc}; claude -p needs auth`);
  await copyFile(credSrc, join(HOME_CACHE, ".claude", ".credentials.json"));
  return buildEnv(HOME_CACHE);
}

function buildEnv(home) {
  const projectCwd = join(home, "project");
  const stateDir = join(projectCwd, ".skill-router");
  // `claude -p` needs the site proxy. Read it from the environment or the
  // optional CLAUDE_PROXY var — never hard-code credentials in the repo.
  // Run with:  HTTPS_PROXY=... HTTP_PROXY=... node run.mjs   (or set CLAUDE_PROXY)
  const proxy = process.env.CLAUDE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  return {
    ...process.env,
    HOME: home,
    SKILL_ROUTER_STATE_DIR: stateDir,
    SKILL_ROUTER_CWD: projectCwd,
    ...(proxy ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy } : {}),
    NO_PROXY: process.env.NO_PROXY || "localhost,127.0.0.1",
    CLAUDE_HOME: undefined,
    SKILL_ROUTER_HOST: undefined,
  };
}

async function installPlugin(env) {
  log(`npm run install:plugin (HOME=${env.HOME})`);
  await mkdir(join(env.HOME, "project", ".skill-router"), { recursive: true });
  await mkdir(join(env.HOME, "project", ".git"), { recursive: true });
  await execFileAsync("npm", ["run", "install:plugin"], {
    cwd: REPO_ROOT,
    env,
    maxBuffer: MAX_BUFFER,
    timeout: NPM_TIMEOUT_MS,
  });
}

async function installSkillCorpus(env) {
  const skillsRoot = join(env.HOME, ".claude", "skills");
  await mkdir(skillsRoot, { recursive: true });

  // Pre-built corpus directories, tried in order. The first one present wins.
  //   skillrouter-skills : cropped SkillRouter eval-core (crop-skillrouter.mjs)
  //   synthetic-skills   : fully synthetic controlled corpus (gen-synthetic-corpus.mjs)
  for (const corpus of ["skillrouter-skills", "synthetic-skills"]) {
    const root = join(EXP_DIR, corpus);
    if (!existsSync(root)) continue;
    const dirs = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const id of dirs) {
      await cp(join(root, id), join(skillsRoot, id), { recursive: true });
    }
    log(`installed ${dirs.length} skills from ${corpus}`);
    return dirs.length;
  }

  await mkdir(CORPUS_CACHE, { recursive: true });
  let total = 0;
  for (const repoSpec of REPOS) {
    const repoDir = join(CORPUS_CACHE, `${repoSpec.owner}-${repoSpec.repo}`);
    if (!existsSync(repoDir) || !existsSync(join(repoDir, ".git"))) {
      log(`clone ${repoSpec.owner}/${repoSpec.repo}`);
      await mkdir(repoDir, { recursive: true });
      await execFileAsync("git", ["init", repoDir], { env, timeout: GIT_TIMEOUT_MS });
      await execFileAsync("git", ["-C", repoDir, "remote", "add", "origin", `https://github.com/${repoSpec.owner}/${repoSpec.repo}.git`], { env, timeout: GIT_TIMEOUT_MS });
    }
    await execFileAsync("git", ["-C", repoDir, "fetch", "--depth=1", "origin", repoSpec.sha], { env, timeout: GIT_TIMEOUT_MS });
    await execFileAsync("git", ["-C", repoDir, "checkout", "--detach", repoSpec.sha], { env, timeout: GIT_TIMEOUT_MS });

    const sourceRoot = join(repoDir, repoSpec.subdir);
    // walk one or more levels - obra/tech-leads-club have nested categories
    const entries = await collectSkillDirs(sourceRoot);
    let count = 0;
    for (const entry of entries) {
      if (total >= CORPUS_CAP) break;
      const dstName = `${repoSpec.prefix}${basename(entry)}`;
      const dst = join(skillsRoot, dstName);
      if (existsSync(dst)) {
        log(`  skip collision ${dstName}`);
        continue;
      }
      await cp(entry, dst, { recursive: true });
      count++;
      total++;
    }
    log(`installed ${count} skills from ${repoSpec.owner}/${repoSpec.repo} (prefix='${repoSpec.prefix}')`);
    if (total >= CORPUS_CAP) break;
  }
  log(`total installed user skills: ${total}`);
  return total;
}

async function collectSkillDirs(root) {
  // Find all dirs that directly contain SKILL.md, regardless of depth.
  const out = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name === "SKILL.md")) {
      out.push(cur);
      continue; // do not recurse into a skill dir
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".")) stack.push(join(cur, e.name));
    }
  }
  return out.sort();
}

async function disableAllUserSkills(env) {
  const routerBin = await installedRouterBin(env.HOME);
  const { stdout } = await execFileAsync(routerBin, ["skills", "list", "--json"], { env, maxBuffer: MAX_BUFFER });
  const all = JSON.parse(stdout);
  const userSkills = all.filter((s) => s.pluginKey === null && s.id.startsWith("user:") && s.id.split(":").length === 2);
  log(`disabling ${userSkills.length} user skills via router CLI`);
  const ids = userSkills.map((s) => s.id);
  // chunk to keep command line manageable
  const CHUNK = 30;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    await execFileAsync(routerBin, ["skills", "disable", ...chunk, "--yes", "--reason=dci-compare", "--json"], {
      env,
      maxBuffer: MAX_BUFFER,
    });
  }
}

async function refreshCredentials(env) {
  const credSrc = join(homedir(), ".claude", ".credentials.json");
  const credDst = join(env.HOME, ".claude", ".credentials.json");
  if (!existsSync(credSrc)) return;
  // Symlink (not copy) so a mid-batch OAuth token rotation in the real HOME
  // is picked up immediately by every subsequent claude -p child.
  await rm(credDst, { force: true });
  await symlink(credSrc, credDst);
  log(`linked credentials -> ${credSrc}`);
}

async function installCorpusWrapper(env) {
  const dst = join(env.HOME, ".claude", "skill-corpus");
  await copyFile(join(EXP_DIR, "skill-corpus"), dst);
  await execFileAsync("chmod", ["+x", dst], { env });
  log(`installed corpus wrapper -> ${dst}`);
}

async function installedRouterBin(home) {
  const manifest = JSON.parse(await readFile(join(REPO_ROOT, "plugins", "claude-code", ".claude-plugin", "plugin.json"), "utf8"));
  return join(home, ".claude", "plugins", "cache", "local", "skill-router", manifest.version, "bin", "skill-router");
}

async function installedRouterSkillPath(home) {
  const manifest = JSON.parse(await readFile(join(REPO_ROOT, "plugins", "claude-code", ".claude-plugin", "plugin.json"), "utf8"));
  return join(home, ".claude", "plugins", "cache", "local", "skill-router", manifest.version, "skills", "skill-router-skills", "SKILL.md");
}

async function installedPluginRoot(home) {
  const manifest = JSON.parse(await readFile(join(REPO_ROOT, "plugins", "claude-code", ".claude-plugin", "plugin.json"), "utf8"));
  return join(home, ".claude", "plugins", "cache", "local", "skill-router", manifest.version);
}

async function patchSkillMd(installedPath, variant, env) {
  const src = join(VARIANTS_DIR, `${variant}.SKILL.md`);
  let body = await readFile(src, "utf8");
  const home = env.HOME;
  const routerBin = await installedRouterBin(home);
  body = body.replaceAll("<abs-path-to-skill-router>", routerBin);
  // Variant F bakes the live disabled-skill corpus index into the skill body.
  if (body.includes("<<CORPUS-INDEX>>")) {
    const index = await generateCorpusIndex(env);
    body = body.replace("<<CORPUS-INDEX>>", index);
  }
  await writeFile(installedPath, body);
  log(`  patched ${basename(installedPath)} -> ${variant}`);
}

// Build a `<skill-id>\t<description>` index of the disabled corpus.
async function generateCorpusIndex(env) {
  const skillsRoot = join(env.HOME, ".claude", "skills");
  const dirs = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const lines = [];
  for (const id of dirs) {
    for (const fname of ["SKILL.md.skill-router-disabled", "SKILL.md"]) {
      const path = join(skillsRoot, id, fname);
      if (!existsSync(path)) continue;
      const text = await readFile(path, "utf8");
      const m = text.match(/^description:\s*(.+)$/m);
      let desc = m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
      if (desc.length > 280) desc = desc.slice(0, 280);
      lines.push(`${id}\t${desc}`);
      break;
    }
  }
  return lines.join("\n");
}

// Toggle the whole user-skill corpus by renaming SKILL.md <-> the disabled
// form. This is the same rename the router uses, so router variants still
// see a correctly "disabled" corpus.
async function setCorpusState(env, state) {
  const skillsRoot = join(env.HOME, ".claude", "skills");
  const dirs = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  let changed = 0;
  for (const id of dirs) {
    const enabled = join(skillsRoot, id, "SKILL.md");
    const disabled = join(skillsRoot, id, "SKILL.md.skill-router-disabled");
    if (state === "enabled" && existsSync(disabled) && !existsSync(enabled)) {
      await rename(disabled, enabled);
      changed++;
    } else if (state === "disabled" && existsSync(enabled) && !existsSync(disabled)) {
      await rename(enabled, disabled);
      changed++;
    }
  }
  if (changed) log(`  corpus -> ${state} (${changed} skills renamed)`);
}

function runClaude(query, env, mode, variant) {
  const pluginInstallDir = env.SKILL_ROUTER_PLUGIN_DIR;
  const isNative = mode === "native";
  // J-bounded is evaluated WITHOUT a system-prompt injection — the variant
  // must rely solely on its SKILL.md description to be naturally selected
  // by Claude Code (the realistic deployment condition).
  const skipSystemPrompt = variant === "J-bounded";
  return new Promise((resolve, reject) => {
    const claudeBin = "claude";
    const claudeArgs = [
      "-p",
      query,
      "--output-format=stream-json",
      "--verbose",
      "--permission-mode=bypassPermissions",
      `--max-turns=${args.maxTurns}`,
    ];
    if (!skipSystemPrompt) {
      claudeArgs.push("--append-system-prompt",
        isNative ? NATIVE_SYSTEM_PROMPT : ROUTER_SYSTEM_PROMPT);
    }
    // Native mode deliberately does NOT load the skill-router plugin — it
    // tests Claude Code's own skill auto-selection over the enabled corpus.
    if (pluginInstallDir && !isNative) {
      claudeArgs.push("--plugin-dir", pluginInstallDir);
    }
    const child = spawn(
      claudeBin,
      claudeArgs,
      {
        env,
        cwd: join(env.HOME, "project"),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const events = [];
    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, CLAUDE_RUN_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      let newline;
      while ((newline = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, newline);
        stdoutBuf = stdoutBuf.slice(newline + 1);
        if (line.trim()) {
          try { events.push(JSON.parse(line)); } catch { events.push({ type: "_raw", line }); }
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderrBuf += chunk; });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutBuf.trim()) {
        try { events.push(JSON.parse(stdoutBuf)); } catch { events.push({ type: "_raw", line: stdoutBuf }); }
      }
      if (stderrBuf) {
        events.push({ type: "_stderr", text: stderrBuf.slice(0, 4000) });
      }
      if (timedOut) {
        events.push({ type: "_run_error", error: `claude -p timed out after ${CLAUDE_RUN_TIMEOUT_MS}ms` });
      }
      resolve({ events, exitCode: code, timedOut });
    });
  });
}

async function writeJsonl(path, events) {
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(path, lines);
}

function summarizeRun(events) {
  let totalInput = 0, totalOutput = 0, totalCacheCreate = 0, totalCacheRead = 0;
  let numTurns = 0;
  let durationMs = 0;
  let costUsd = 0;
  let finalText = "";
  const toolCalls = [];

  for (const e of events) {
    if (e.type === "assistant" && e.message?.content) {
      const usage = e.message.usage;
      if (usage) {
        // Each assistant event reports cumulative-style usage for that turn.
        totalInput += usage.input_tokens || 0;
        totalOutput += usage.output_tokens || 0;
        totalCacheCreate += usage.cache_creation_input_tokens || 0;
        totalCacheRead += usage.cache_read_input_tokens || 0;
      }
      for (const block of e.message.content) {
        if (block.type === "tool_use") {
          toolCalls.push({ name: block.name, input: block.input });
        } else if (block.type === "text") {
          finalText = block.text; // overwrite; last text is the final
        }
      }
    } else if (e.type === "result") {
      numTurns = e.num_turns || 0;
      durationMs = e.duration_ms || 0;
      costUsd = e.total_cost_usd || 0;
      // result.usage gives the authoritative totals
      if (e.usage) {
        totalInput = e.usage.input_tokens ?? totalInput;
        totalOutput = e.usage.output_tokens ?? totalOutput;
        totalCacheCreate = e.usage.cache_creation_input_tokens ?? totalCacheCreate;
        totalCacheRead = e.usage.cache_read_input_tokens ?? totalCacheRead;
      }
      if (typeof e.result === "string" && e.result) finalText = e.result;
    }
  }

  return { numTurns, durationMs, costUsd, totalInput, totalOutput, totalCacheCreate, totalCacheRead, finalText, toolCalls };
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
