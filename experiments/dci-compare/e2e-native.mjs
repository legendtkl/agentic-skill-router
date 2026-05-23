#!/usr/bin/env node
// End-to-end Claude Code baseline: native skill auto-trigger over the
// SkillRouter-cropped 150-skill corpus, with NO --append-system-prompt and
// NO skill-router plugin. Stages a dialogue-parser fixture, runs claude -p,
// captures the full stream-json transcript so we can see:
//   1. did Claude pick the right skill via the Skill tool?
//   2. when did SKILL.md body land in the conversation?
//   3. did Claude follow it and produce the requested output files?
//
// Reuses .tmp-home (same corpus the routing benchmark uses), flips it to
// enabled state for the run, restores disabled state in a finally block so
// J-bounded experiments can keep using the same HOME afterwards.

import { spawn } from "node:child_process";
import { mkdir, writeFile, readdir, rename, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const HOME = join(EXP_DIR, ".tmp-home");
const SKILLS_ROOT = join(HOME, ".claude", "skills");
const PROJECT = join(HOME, "project-e2e");
const FIXTURE = join(PROJECT, "script.txt");
const OUT_TRANSCRIPT = join(EXP_DIR, "runs", "native-e2e.jsonl");
const TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 600_000;

const SCRIPT_TEXT = `[GateScene]
Guard: Halt! State your name and business. -> NameChoice

[NameChoice]
1. I am Sir Aldric, Knight of the Realm. -> KnightPath
2. Just a humble traveler seeking shelter. -> TravelerPath
3. [Lie] I'm a merchant with important goods. -> MerchantPath
4. [Attack] Draw your sword! -> CombatStart

[KnightPath]
Guard: Welcome, sir knight. -> End

[TravelerPath]
Guard: Pass through. -> End

[MerchantPath]
Guard: I do not believe you. -> End

[CombatStart]
Guard: Defend! -> End

[End]
Story: Story ends here.
`;

const QUERY = [
  "You will implement a dialogue parser that converts a text file into a",
  "structured JSON graph.",
  "",
  `Input: ${FIXTURE}`,
  `Output JSON graph: ${join(PROJECT, "dialogue.json")}`,
  `Output Graphviz visualization: ${join(PROJECT, "dialogue.dot")}`,
  `Parser source: ${join(PROJECT, "solution.py")}`,
  "",
  "Implement `def parse_script(text: str)` in solution.py that takes the",
  "script content as input and returns the parsed graph (dict with nodes",
  "and edges). Process basic structure (graph, node, edge) so the format",
  "below parses:",
  "",
  "```",
  "[GateScene]",
  "Guard: Halt! State your name and business. -> NameChoice",
  "",
  "[NameChoice]",
  "1. I am Sir Aldric, Knight of the Realm. -> KnightPath",
  "2. Just a humble traveler seeking shelter. -> TravelerPath",
  "3. [Lie] I'm a merchant with important goods. -> MerchantPath",
  "4. [Attack] Draw your sword! -> CombatStart",
  "```",
  "",
  "Output JSON shape:",
  '{"nodes":[{"id":"","text":"","speaker":"","type":""}],"edges":[{"from":"","to":"","text":""}]}',
  "",
  "Node types: 'line' and 'choice'. Constraints: every node reachable from",
  "the first node; every edge target exists except the last node; multiple",
  "paths can lead to node 'End'.",
].join("\n");

async function toggleCorpus(targetState) {
  const dirs = (await readdir(SKILLS_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  let changed = 0;
  for (const id of dirs) {
    const en = join(SKILLS_ROOT, id, "SKILL.md");
    const dis = join(SKILLS_ROOT, id, "SKILL.md.skill-router-disabled");
    if (targetState === "enabled" && existsSync(dis) && !existsSync(en)) {
      await rename(dis, en); changed++;
    } else if (targetState === "disabled" && existsSync(en) && !existsSync(dis)) {
      await rename(en, dis); changed++;
    }
  }
  console.log(`[corpus] -> ${targetState} (${changed} renamed)`);
}

async function runClaude() {
  const env = { ...process.env, HOME };
  const args = [
    "-p", QUERY,
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
    "--max-turns=20",
  ];
  await mkdir(dirname(OUT_TRANSCRIPT), { recursive: true });
  const events = [];
  let stdoutBuf = "";
  let stderrBuf = "";
  let timedOut = false;
  console.log("[claude] spawn");
  const t0 = Date.now();
  const child = spawn("claude", args, { env, cwd: PROJECT, stdio: ["ignore", "pipe", "pipe"] });
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
  if (stderrBuf) events.push({ type: "_stderr", text: stderrBuf.slice(0, 4000) });
  if (timedOut) events.push({ type: "_run_error", error: `claude -p timed out after ${TIMEOUT_MS}ms` });
  await writeFile(OUT_TRANSCRIPT, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[claude] done exit=${exitCode} timedOut=${timedOut} duration=${dur}s events=${events.length}`);
  console.log(`[claude] transcript -> ${OUT_TRANSCRIPT}`);
}

async function main() {
  await mkdir(PROJECT, { recursive: true });
  await writeFile(FIXTURE, SCRIPT_TEXT);
  console.log(`[fixture] -> ${FIXTURE}`);
  try {
    await toggleCorpus("enabled");
    await runClaude();
  } finally {
    await toggleCorpus("disabled");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
