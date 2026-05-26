#!/usr/bin/env node
// run.mjs — drive claude -p / codex exec against the SkillRouter Easy
// metadata-only benchmark.
//
// Per (host, variant) cell:
//   1. Set up isolated HOME under .tmp-homes/<host>-<variant>/ (unless
//      --no-setup).
//   2. Install the agentic-skill-router plugin into that HOME, then overwrite
//      the plugin's SKILL.md with the experiment variant's SKILL.md (templated
//      with the absolute runtime CLI path for M-bm25).
//   3. Install the 78,361 Easy-pool metadata-only skills into that HOME via
//      install-easy-pool.mjs.
//   4. Run queries in parallel (bounded concurrency) and write
//      runs/<host>-<variant>/<queryId>.jsonl plus a summary.json.
//
// Usage:
//   node run.mjs --host=claude|codex|all --variant=K|J|M|all \
//                [--smoke] [--queries=ID1,ID2,...] \
//                [--concurrency=N] [--timeout-ms=N] \
//                [--setup-only] [--no-setup]
//
// --smoke   shorthand for --queries=3d-scan-calc,citation-check (one single
//           and one multi-skill query) — minimal end-to-end plumbing check.
//
// Exit codes: 0 ok, 2 if any cell had a failed query (still write outputs).

import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
  copyFile,
  readdir,
  stat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const EXP_DIR = __dirname;
const HOMES_DIR = join(EXP_DIR, ".tmp-homes");
const VARIANTS_DIR = join(EXP_DIR, "variants");
const RUNS_DIR = join(EXP_DIR, "runs");

const ALL_HOSTS = ["claude", "codex"];
const VARIANT_ALIASES = {
  K: "K-bounded",
  "K-bounded": "K-bounded",
  J: "J-bounded-v2",
  "J-v2": "J-bounded-v2",
  "J-bounded-v2": "J-bounded-v2",
  M: "M-bm25",
  "M-bm25": "M-bm25",
};
const ALL_VARIANTS = ["K-bounded", "J-bounded-v2", "M-bm25"];

const PLUGIN_KEY = "agentic-skill-router@local";
const PLUGIN_NAME = "agentic-skill-router";
const PLUGIN_VERSION = JSON.parse(
  await readFile(join(REPO_ROOT, "plugins", "claude-code", ".claude-plugin", "plugin.json"), "utf8"),
).version;

// Proxy / API key requirements differ per host. Per repo CLAUDE.md:
//   - claude needs HTTP_PROXY/HTTPS_PROXY (shell alias normally injects);
//     PATH-launched claude does not inherit the alias, so we re-inject.
//   - codex needs LITELLM_KEY and must run with proxies UNSET.
const CLAUDE_PROXY = {
  HTTP_PROXY: "http://vhlaqlen:izsexg7e00ug@tx-sh.gptclub.ai:10847",
  HTTPS_PROXY: "http://vhlaqlen:izsexg7e00ug@tx-sh.gptclub.ai:10847",
  NO_PROXY: "localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
};
const CODEX_LITELLM_KEY = "sk-prod-7xK9mQ2vLp8RzT4nHy6cJu1Ba3EfWd5Ns0";

const STOP_TAIL = `

---
ROUTING-ONLY mode: this session evaluates skill-routing accuracy only.
After identifying the up-to-ten best matching disabled skills (ranked from
most to least confident), output exactly one line of minified JSON on its
own and stop:

{"matched_skill_names":["sr-AAAAA","sr-BBBBB","sr-CCCCC","sr-DDDDD","sr-EEEEE","sr-FFFFF","sr-GGGGG","sr-HHHHH","sr-IIIII","sr-JJJJJ"]}

Use the directory ids (sr-XXXXX), not the frontmatter \`name:\` field. Return
fewer than 10 ids if fewer plausible candidates exist; never invent ids.
Do NOT read any skill body, do NOT execute the user's task above, do NOT
produce any other text. This overrides any "execute the task" guidance in
the skill router's instructions.`;

function parseArgs(argv) {
  const out = {
    host: null,
    variants: null,
    smoke: false,
    queries: null,
    concurrency: 4,
    timeoutMs: 480_000,
    setupOnly: false,
    noSetup: false,
    cellConcurrency: 6,
  };
  for (const a of argv) {
    if (a.startsWith("--host=")) out.host = a.slice(7);
    else if (a.startsWith("--variant=")) out.variants = a.slice(10);
    else if (a === "--smoke") out.smoke = true;
    else if (a.startsWith("--queries=")) out.queries = a.slice(10).split(",").filter(Boolean);
    else if (a.startsWith("--concurrency=")) out.concurrency = Number(a.slice(14));
    else if (a.startsWith("--cell-concurrency=")) out.cellConcurrency = Number(a.slice(19));
    else if (a.startsWith("--timeout-ms=")) out.timeoutMs = Number(a.slice(13));
    else if (a === "--setup-only") out.setupOnly = true;
    else if (a === "--no-setup") out.noSetup = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!out.host) throw new Error("--host=claude|codex|all required");
  const hosts = out.host === "all" ? ALL_HOSTS : out.host.split(",");
  for (const h of hosts) if (!ALL_HOSTS.includes(h)) throw new Error(`bad host: ${h}`);
  const variantSpec = out.variants ?? "all";
  const variants =
    variantSpec === "all"
      ? ALL_VARIANTS
      : variantSpec.split(",").map((v) => {
          const r = VARIANT_ALIASES[v];
          if (!r) throw new Error(`bad variant: ${v} (try K, J, M)`);
          return r;
        });
  if (out.smoke && !out.queries) {
    out.queries = ["3d-scan-calc", "citation-check"];
  }
  return { ...out, hosts, variantList: variants };
}

function log(msg) {
  process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
}

// ------------------------- Setup per (host, variant) -------------------------

function cellHome(host, variant) {
  return join(HOMES_DIR, `${host}-${variant}`);
}

function pluginInstallPath(host, home) {
  if (host === "claude") {
    return join(home, ".claude", "plugins", "cache", "local", PLUGIN_NAME, PLUGIN_VERSION);
  }
  return join(home, ".codex", "plugins", "cache", "local", PLUGIN_NAME, PLUGIN_VERSION);
}

function runtimeBinPath(home) {
  // Per scripts/install*.mjs: runtime lands under ~/.agentic-skill-router.
  return join(home, ".agentic-skill-router", "runtime", PLUGIN_VERSION, "bin", "agentic-skill-router");
}

async function runChild(cmd, args, env, label) {
  return await new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    c.stdout.on("data", (d) => { out += d.toString(); });
    c.stderr.on("data", (d) => { err += d.toString(); });
    c.on("error", reject);
    c.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${label} exit ${code}\n--- stdout ---\n${out.slice(-2000)}\n--- stderr ---\n${err.slice(-2000)}`));
      } else {
        resolve({ out, err });
      }
    });
  });
}

async function setupCell(host, variant) {
  const home = cellHome(host, variant);
  log(`[setup] ${host}/${variant} HOME=${home}`);

  // Refuse to wipe a HOME with running processes — caller passes --no-setup
  // when iterating fast and the HOME is already known-good.
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  await mkdir(join(home, "tmp"), { recursive: true });

  // Copy auth from the real HOME so claude / codex can authenticate. The
  // skills install will overwrite skills/ but leave credentials untouched.
  const realHome = process.env.AGENTIC_SKILL_ROUTER_REAL_HOME || homedir();
  if (host === "claude") {
    const src = join(realHome, ".claude", ".credentials.json");
    if (existsSync(src)) {
      await mkdir(join(home, ".claude"), { recursive: true });
      await copyFile(src, join(home, ".claude", ".credentials.json"));
    } else {
      throw new Error(`claude credentials not found at ${src} — log in first via \`claude /login\``);
    }
  } else {
    const src = join(realHome, ".codex", "auth.json");
    if (existsSync(src)) {
      await mkdir(join(home, ".codex"), { recursive: true });
      await copyFile(src, join(home, ".codex", "auth.json"));
    } else {
      throw new Error(`codex auth not found at ${src} — log in first`);
    }
  }

  // 1. install plugin into HOME (Claude uses install.mjs; Codex uses install-codex.mjs).
  const installScript = host === "claude" ? "install.mjs" : "install-codex.mjs";
  const env = {
    ...process.env,
    HOME: home,
    CLAUDE_HOME: join(home, ".claude"),
    CODEX_HOME: join(home, ".codex"),
    AGENTIC_SKILL_ROUTER_RUNTIME_ROOT: join(home, ".agentic-skill-router", "runtime"),
  };
  await runChild("node", [join(REPO_ROOT, "scripts", installScript)], env, `${installScript} for ${host}/${variant}`);

  // 2. Overwrite the plugin's SKILL.md with our experiment variant's SKILL.md.
  //    M-bm25 contains a `<abs-path-to-agentic-skill-router>` placeholder we
  //    substitute with the runtime binary path in this HOME.
  const variantSrc = join(VARIANTS_DIR, host, `${variant}.SKILL.md`);
  const pluginSkillDir = join(pluginInstallPath(host, home), "skills", "agentic-skill-router-skills");
  await mkdir(pluginSkillDir, { recursive: true });
  const pluginSkillMd = join(pluginSkillDir, "SKILL.md");
  let body = await readFile(variantSrc, "utf8");
  body = body.replace(/<abs-path-to-agentic-skill-router>/g, runtimeBinPath(home));
  await writeFile(pluginSkillMd, body);
  log(`[setup] ${host}/${variant} plugin SKILL.md <- variants/${host}/${variant}.SKILL.md`);

  // 3. Install the 78,361 Easy-pool metadata-only skills into this HOME.
  //    Also produces .flat-metadata.tsv inside the skills root, used by the
  //    K-bounded / J-bounded-v2 variants.
  await runChild(
    "node",
    [
      join(EXP_DIR, "install-easy-pool.mjs"),
      `--host=${host}`,
      `--home=${home}`,
      `--out=${join(RUNS_DIR, `install-${host}-${variant}`)}`,
    ],
    env,
    `install-easy-pool for ${host}/${variant}`,
  );

  // 4. M-bm25 specific: pre-warm the BM25 index cache so the first agent
  //    query does not pay the 17s cold-build cost. The cache lives at
  //    $HOME/.agentic-skill-router/corpus-bm25-index-{host}.json and stays
  //    valid until the corpus fingerprint changes.
  if (variant === "M-bm25") {
    const cliBin = runtimeBinPath(home);
    if (existsSync(cliBin)) {
      const warmupEnv = {
        ...env,
        AGENTIC_SKILL_ROUTER_CORPUS_CACHE_TTL_MS: "86400000",
      };
      try {
        await runChild(cliBin, ["skills", "corpus", "search", "--ranker=bm25", "--any", "test", "--limit", "1", "--json"], warmupEnv, `bm25 pre-warm for ${host}/${variant}`);
        log(`[setup] ${host}/${variant} BM25 cache pre-warmed`);
      } catch (err) {
        log(`[setup] ${host}/${variant} BM25 pre-warm failed (non-fatal): ${String(err).slice(0, 200)}`);
      }
    }
  }

  log(`[setup] ${host}/${variant} READY`);
  return home;
}

// ------------------------- Run a single query --------------------------------

function envForRun(host, home) {
  const base = {
    ...process.env,
    HOME: home,
    TMPDIR: join(home, "tmp"),
    CLAUDE_HOME: join(home, ".claude"),
    CODEX_HOME: join(home, ".codex"),
    AGENTIC_SKILL_ROUTER_RUNTIME_ROOT: join(home, ".agentic-skill-router", "runtime"),
    // Keep the BM25 / corpus caches warm for the lifetime of the run.
    AGENTIC_SKILL_ROUTER_CORPUS_CACHE_TTL_MS: "86400000",
  };
  if (host === "claude") {
    return { ...base, ...CLAUDE_PROXY };
  }
  // Codex must NOT have proxies set; LITELLM_KEY must be present.
  const env = { ...base, LITELLM_KEY: CODEX_LITELLM_KEY };
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.http_proxy;
  delete env.https_proxy;
  return env;
}

async function runClaudeQuery(home, queryObj, timeoutMs) {
  const project = join(home, "project-routing-only");
  await mkdir(project, { recursive: true });
  const env = envForRun("claude", home);
  const fullQuery = queryObj.query + STOP_TAIL;
  const args = [
    "-p", fullQuery,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
    "--plugin-dir", pluginInstallPath("claude", home),
  ];
  return await spawnCapture("claude", args, env, project, timeoutMs);
}

async function runCodexQuery(home, queryObj, timeoutMs) {
  const project = join(home, "project-routing-only");
  await mkdir(project, { recursive: true });
  const env = envForRun("codex", home);
  const fullQuery = queryObj.query + STOP_TAIL;
  const finalMsgPath = join(home, `final-${queryObj.id}.txt`);
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-C", project,
    "-s", "danger-full-access",
    "--dangerously-bypass-approvals-and-sandbox",
    "-c", `model="gpt-5.5"`,
    "-c", `model_reasoning_effort="high"`,
    "--output-last-message", finalMsgPath,
    fullQuery,
  ];
  const result = await spawnCapture("codex", args, env, project, timeoutMs);
  try {
    const finalMessage = await readFile(finalMsgPath, "utf8");
    if (finalMessage) result.events.push({ type: "_final_message", text: finalMessage });
  } catch {}
  return result;
}

async function spawnCapture(cmd, args, env, cwd, timeoutMs) {
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  const child = spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.on("error", (err) => {
    if (timedOut) return;
    events.push({ type: "_run_error", error: `spawn failed: ${String(err).slice(0, 400)}` });
  });
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
  }, timeoutMs);
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  if (stdoutBuf.trim()) {
    try { events.push(JSON.parse(stdoutBuf)); } catch { events.push({ type: "_raw", line: stdoutBuf }); }
  }
  if (stderrBuf) events.push({ type: "_stderr", text: stderrBuf.slice(0, 8000) });
  if (timedOut) events.push({ type: "_run_error", error: `${cmd} timed out after ${timeoutMs}ms` });
  return { events, exitCode, timedOut, durationMs: Date.now() - t0 };
}

// ------------------------- Parse top-10 from events --------------------------

const TOP10_JSON_RE = /\{\s*"matched_skill_names"\s*:\s*\[[^\]]*\]\s*\}/;

function extractTopK(events) {
  // Search across plausible carriers, most-recent first:
  //   - codex `_final_message`
  //   - codex `item.completed` -> `item.text` (agent_message)
  //   - claude `assistant` -> `message.content[].text`
  //   - any `_raw` line that looks like the answer
  const candidates = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || typeof e !== "object") continue;
    if (e.type === "_final_message" && typeof e.text === "string") {
      candidates.push(e.text);
    } else if (e.type === "item.completed" && e.item && (e.item.text || e.item.message)) {
      candidates.push(String(e.item.text ?? e.item.message ?? ""));
    } else if (e.type === "assistant" && e.message && Array.isArray(e.message.content)) {
      for (const c of e.message.content) {
        if (c && typeof c.text === "string") candidates.push(c.text);
      }
    } else if (e.type === "_raw" && typeof e.line === "string") {
      candidates.push(e.line);
    } else if (e.type === "result" && typeof e.result === "string") {
      candidates.push(e.result);
    }
    if (candidates.length >= 8) break;
  }
  for (const text of candidates) {
    const m = text.match(TOP10_JSON_RE);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        if (Array.isArray(parsed.matched_skill_names)) {
          return parsed.matched_skill_names.filter((x) => typeof x === "string").slice(0, 10);
        }
      } catch {}
    }
  }
  return null;
}

// ------------------------- Per-cell orchestration ----------------------------

async function loadQueries() {
  // queries.json under runs/install-claude (any install is fine; queries are
  // host-independent). If both exist, prefer claude's by convention.
  const candidates = [
    join(RUNS_DIR, "install-claude", "queries.json"),
    join(RUNS_DIR, "install-codex", "queries.json"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return JSON.parse(await readFile(c, "utf8")).queries;
  }
  throw new Error(`no queries.json found in ${candidates.join(" / ")} — run install-easy-pool.mjs first`);
}

async function runCell({ host, variant, queries, concurrency, timeoutMs }) {
  const home = cellHome(host, variant);
  const outDir = join(RUNS_DIR, `${host}-${variant}`);
  await mkdir(outDir, { recursive: true });
  const t0 = Date.now();
  const results = [];

  // Bounded-concurrency worker pool over queries.
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= queries.length) return;
      const q = queries[i];
      try {
        const runner = host === "claude" ? runClaudeQuery : runCodexQuery;
        const { events, exitCode, timedOut, durationMs } = await runner(home, q, timeoutMs);
        const topK = extractTopK(events);
        const outPath = join(outDir, `${q.id}.jsonl`);
        await writeFile(outPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
        const top1 = Array.isArray(topK) && topK.length > 0 ? topK[0] : null;
        const expected = new Set(q.expected_anon);
        const hit1 = top1 != null && expected.has(top1);
        const recAt10 = Array.isArray(topK)
          ? topK.filter((x) => expected.has(x)).length / Math.max(q.expected_anon.length, 1)
          : 0;
        results.push({
          query_id: q.id, tier: q.tier, gt_count: q.gt_count,
          expected_anon: q.expected_anon, top_k: topK, top1, hit1, recall_at_10: recAt10,
          exitCode, timedOut, durationMs,
        });
        log(`[${host}/${variant}] ${q.id} exit=${exitCode} timedOut=${timedOut} hit1=${hit1} top1=${top1} (${(durationMs/1000).toFixed(1)}s)`);
      } catch (err) {
        log(`[${host}/${variant}] ${q.id} THREW: ${String(err).slice(0, 300)}`);
        results.push({ query_id: q.id, tier: q.tier, error: String(err).slice(0, 500) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, worker));

  results.sort((a, b) => a.query_id.localeCompare(b.query_id));
  const hits = results.filter((r) => r.hit1).length;
  const seen = results.filter((r) => Number.isFinite(r.hit1)).length || results.length;
  const summary = {
    host, variant,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    queries: queries.length,
    answered: results.filter((r) => Array.isArray(r.top_k)).length,
    timeouts: results.filter((r) => r.timedOut).length,
    errors: results.filter((r) => r.error).length,
    hit1: hits,
    hit1_rate: hits / queries.length,
    hit1_single: results.filter((r) => r.tier === "single" && r.hit1).length,
    hit1_multi: results.filter((r) => r.tier === "multi" && r.hit1).length,
    n_single: queries.filter((q) => q.tier === "single").length,
    n_multi: queries.filter((q) => q.tier === "multi").length,
    timeoutMs, concurrency,
    results,
  };
  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  log(`[${host}/${variant}] DONE  hit1=${hits}/${queries.length}=${(summary.hit1_rate*100).toFixed(1)}%  answered=${summary.answered}  timeouts=${summary.timeouts}  errors=${summary.errors}  ${(summary.elapsedMs/1000).toFixed(0)}s`);
  return summary;
}

// ------------------------- Top-level ----------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(HOMES_DIR, { recursive: true });
  await mkdir(RUNS_DIR, { recursive: true });

  const cells = [];
  for (const h of args.hosts) for (const v of args.variantList) cells.push({ host: h, variant: v });
  log(`harness: ${cells.length} cells (${args.hosts.join(",")} × ${args.variantList.join(",")}) ` +
      `${args.smoke ? "(smoke)" : ""} concurrency=${args.concurrency}/cell, cell-concurrency=${args.cellConcurrency}, timeout=${args.timeoutMs}ms`);

  // Phase A: setup all cells (parallel — independent HOMEs and tmp files).
  if (!args.noSetup) {
    const setupCap = Math.min(args.cellConcurrency, cells.length);
    let idx = 0;
    async function setupWorker() {
      while (true) {
        const i = idx++;
        if (i >= cells.length) return;
        const c = cells[i];
        try {
          await setupCell(c.host, c.variant);
        } catch (err) {
          log(`[setup-FAIL] ${c.host}/${c.variant}: ${err.message}`);
          c.setupError = err.message;
        }
      }
    }
    await Promise.all(Array.from({ length: setupCap }, setupWorker));
  } else {
    log(`[setup] skipped (--no-setup)`);
  }

  if (args.setupOnly) {
    log(`--setup-only set, exiting after setup`);
    return;
  }

  // Phase B: run cells. We parallelize across cells AND across queries inside
  // each cell, so total in-flight agents ≤ cellConcurrency × concurrency.
  const queriesAll = await loadQueries();
  const queries = args.queries
    ? queriesAll.filter((q) => args.queries.includes(q.id))
    : queriesAll;
  if (args.queries && queries.length !== args.queries.length) {
    const missing = args.queries.filter((id) => !queriesAll.some((q) => q.id === id));
    log(`WARN: --queries had ${missing.length} unknown ids: ${missing.join(",")}`);
  }
  log(`harness: ${queries.length} queries per cell`);

  const summaries = [];
  let cellIdx = 0;
  async function cellWorker() {
    while (true) {
      const i = cellIdx++;
      if (i >= cells.length) return;
      const c = cells[i];
      if (c.setupError) {
        summaries.push({ host: c.host, variant: c.variant, error: c.setupError });
        continue;
      }
      try {
        const s = await runCell({
          host: c.host, variant: c.variant, queries,
          concurrency: args.concurrency, timeoutMs: args.timeoutMs,
        });
        summaries.push(s);
      } catch (err) {
        log(`[cell-FAIL] ${c.host}/${c.variant}: ${err.message}`);
        summaries.push({ host: c.host, variant: c.variant, error: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.cellConcurrency, cells.length) }, cellWorker));

  // Aggregate summary across cells.
  const agg = {
    finishedAt: new Date().toISOString(),
    cells: summaries.map((s) => ({
      host: s.host, variant: s.variant,
      hit1: s.hit1, hit1_rate: s.hit1_rate,
      hit1_single: s.hit1_single, hit1_multi: s.hit1_multi,
      n_single: s.n_single, n_multi: s.n_multi,
      answered: s.answered, timeouts: s.timeouts, errors: s.errors,
      elapsedMs: s.elapsedMs, error: s.error,
    })),
  };
  await writeFile(join(RUNS_DIR, "all-summary.json"), JSON.stringify(agg, null, 2) + "\n");
  log(`harness DONE  -> ${join(RUNS_DIR, "all-summary.json")}`);
  for (const c of agg.cells) {
    if (c.error) {
      log(`  ${c.host}/${c.variant}: ERROR ${c.error}`);
    } else {
      log(`  ${c.host}/${c.variant}: Hit@1 = ${c.hit1}/${c.hit1 != null ? (c.hit1 / c.hit1_rate).toFixed(0) : "?"} = ${(c.hit1_rate * 100).toFixed(1)}%  (single ${c.hit1_single}/${c.n_single}, multi ${c.hit1_multi}/${c.n_multi})`);
    }
  }
  if (agg.cells.some((c) => c.error)) process.exitCode = 2;
}

main().catch((e) => { console.error(e.stack ?? e.message ?? String(e)); process.exit(1); });
