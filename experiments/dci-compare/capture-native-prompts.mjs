#!/usr/bin/env node
// Capture native Codex and Claude Code model requests for one routing-only
// query without sending prompts to the real upstreams.
//
// The harness starts a local HTTP server, points each CLI at it, saves the
// first matching model request body, then terminates the CLI. This gives us
// the real request shape produced by each host while keeping auth and prompt
// data local.

import { spawn } from "node:child_process";
import http from "node:http";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const REPO_ROOT = resolve(EXP_DIR, "..", "..");
const CORPUS_DIR = join(EXP_DIR, "skillrouter-skills");
const OUT_DIR = join(EXP_DIR, "runs", "native-prompt-capture");
const QUERY_ID = process.env.CAPTURE_QUERY_ID || "weighted-gdp-calc";
const CAPTURE_TIMEOUT_MS = Number(process.env.CAPTURE_TIMEOUT_MS) || 60_000;
const CODEX_MODEL = process.env.CAPTURE_CODEX_MODEL || "gpt-5.5";
const DUMMY_ANTHROPIC_KEY = "sk-ant-api03-local-capture-not-secret-00000000000000000000";

const STOP_TAIL = `

---
ROUTING-ONLY mode: this session evaluates skill routing accuracy only.
After identifying the single best matching disabled skill, output exactly
one line of minified JSON on its own and stop:

{"matched_skill_name":"<skill-id>"}

Do NOT read the matched skill's body, do NOT execute the user's task above,
do NOT produce any other text. This overrides any "execute the task"
guidance in the skill router's instructions.`;

function log(message) {
  process.stdout.write(`[capture] ${message}\n`);
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function redactHeaders(headers) {
  const redacted = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|api[-_]?key|cookie|token|session|metadata|device|thread/i.test(key)) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function parseBody(bodyText) {
  try {
    return { json: JSON.parse(bodyText) };
  } catch (error) {
    return { text: bodyText, parseError: String(error) };
  }
}

function startCaptureServer(label, { select, respond }) {
  let resolveCapture;
  let rejectCapture;
  const capturePromise = new Promise((resolve, reject) => {
    resolveCapture = resolve;
    rejectCapture = reject;
  });

  let resolved = false;
  const captures = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", rejectCapture);
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let capture = null;
      if (req.method === "POST") {
        capture = {
          label,
          method: req.method,
          url: req.url,
          headers: redactHeaders(req.headers),
          bodyText,
          receivedAt: new Date().toISOString(),
        };
        captures.push(capture);
        if (!resolved && select(capture)) {
          resolved = true;
          resolveCapture({ selected: capture, all: [...captures] });
        }
      }
      respond(req, res, capture);
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: address.port,
        capturePromise,
        close: () => {
          server.closeIdleConnections?.();
          server.closeAllConnections?.();
          return new Promise((done) => server.close(done));
        },
      });
    });
  });
}

function respondWithCaptureError(label, res) {
  res.writeHead(502, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: `${label} prompt captured locally` } }));
}

function sendAnthropicText(res, text, model = "claude-haiku-4-5-20251001") {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "close",
  });
  const writeEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  writeEvent("message_start", {
    type: "message_start",
    message: {
      id: "msg_capture",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });
  writeEvent("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  writeEvent("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  });
  writeEvent("content_block_stop", { type: "content_block_stop", index: 0 });
  writeEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 10 },
  });
  writeEvent("message_stop", { type: "message_stop" });
  res.end();
}

function requestHasClaudeSkills(capture) {
  const body = parseBody(capture.bodyText).json;
  if (!body) return false;
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.some((tool) => tool.name === "Skill" || /Skill/.test(tool.name || ""))) return true;
  return collectStrings(body).join("\n").includes("The following skills are available for use with the Skill tool:");
}

function requestHasCodexPrompt(capture) {
  const body = parseBody(capture.bodyText).json;
  if (!body) return false;
  return collectStrings(body).join("\n").includes("### Available skills");
}

function killChild(child) {
  if (child.exitCode !== null || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  setTimeout(() => {
    if (child.exitCode !== null || child.killed) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  }, 2000).unref();
}

async function spawnUntilCaptured({ label, command, args, env, cwd, server }) {
  const stderrChunks = [];
  const stdoutChunks = [];
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} capture timed out after ${CAPTURE_TIMEOUT_MS}ms`)), CAPTURE_TIMEOUT_MS);
  });

  try {
    const captureBundle = await Promise.race([server.capturePromise, timeout]);
    killChild(child);
    await new Promise((resolve) => child.once("close", resolve));
    return {
      capture: captureBundle.selected,
      allCaptures: captureBundle.all,
      child: {
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        stdoutTail: stdoutChunks.join("").slice(-4000),
        stderrTail: stderrChunks.join("").slice(-4000),
      },
    };
  } catch (error) {
    killChild(child);
    await new Promise((resolve) => child.once("close", resolve));
    throw error;
  }
}

async function prepareCodexHome() {
  const home = join(OUT_DIR, "codex-home");
  await rm(home, { recursive: true, force: true });
  await mkdir(join(home, ".codex", "skills"), { recursive: true });
  await cp(CORPUS_DIR, join(home, ".codex", "skills"), { recursive: true });
  await writeFile(join(home, ".codex", "config.toml"), `model = "${CODEX_MODEL}"\nmodel_reasoning_effort = "high"\n`);
  await mkdir(join(home, "project"), { recursive: true });
  return home;
}

async function prepareClaudeHome() {
  const home = join(OUT_DIR, "claude-home");
  const configDir = join(home, ".claude");
  await rm(home, { recursive: true, force: true });
  await mkdir(join(configDir, "skills"), { recursive: true });
  await cp(CORPUS_DIR, join(configDir, "skills"), { recursive: true });
  await mkdir(join(home, "project"), { recursive: true });
  await writeFile(join(configDir, ".claude.json"), JSON.stringify({
    customApiKeyResponses: {
      approved: [DUMMY_ANTHROPIC_KEY.slice(-20)],
      rejected: [],
    },
  }, null, 2));
  return home;
}

async function captureCodex(query) {
  const home = await prepareCodexHome();
  const project = join(home, "project");
  const fullQuery = query.query + STOP_TAIL;

  log(`rendering Codex prompt input via codex debug prompt-input (${QUERY_ID})`);
  const debugResult = await runCommand("codex", ["debug", "prompt-input", fullQuery], {
    cwd: project,
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: join(home, ".codex"),
      TMPDIR: join(home, "tmp"),
    },
  });
  await writeFile(join(OUT_DIR, "codex-prompt-input.json"), debugResult.stdout);

  log("capturing Codex matching /v1/responses prompt request");
  const server = await startCaptureServer("codex", {
    select: requestHasCodexPrompt,
    respond: (_req, res) => respondWithCaptureError("codex", res),
  });
  try {
    const env = {
      ...process.env,
      HOME: home,
      CODEX_HOME: join(home, ".codex"),
      TMPDIR: join(home, "tmp"),
      CAPTURE_API_KEY: "not-a-real-key",
    };
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_BASE_URL;
    delete env.OPENAI_ORG_ID;
    delete env.SKILL_ROUTER_HOST;
    delete env.AGENTS_HOME;

    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-C", project,
      "-s", "danger-full-access",
      "--dangerously-bypass-approvals-and-sandbox",
      "-c", `model="${CODEX_MODEL}"`,
      "-c", `model_reasoning_effort="high"`,
      "-c", `model_provider="capture"`,
      "-c", `model_providers.capture.name="capture"`,
      "-c", `model_providers.capture.base_url="http://127.0.0.1:${server.port}/v1"`,
      "-c", `model_providers.capture.env_key="CAPTURE_API_KEY"`,
      "-c", `model_providers.capture.wire_api="responses"`,
      fullQuery,
    ];
    const result = await spawnUntilCaptured({ label: "codex", command: "codex", args, env, cwd: project, server });
    await writeCapture("codex-request.json", result);
    await writeAllCaptures("codex-requests.json", result);
    return { home, request: result.capture, debugPromptInput: debugResult.stdout };
  } finally {
    await server.close();
  }
}

async function captureClaude(query) {
  const home = await prepareClaudeHome();
  const configDir = join(home, ".claude");
  const project = join(home, "project");
  const fullQuery = query.query + STOP_TAIL;

  log("capturing Claude Code main Skill-tool prompt request");
  const server = await startCaptureServer("claude", {
    select: requestHasClaudeSkills,
    respond: (_req, res, capture) => {
      if (capture && requestHasClaudeSkills(capture)) {
        respondWithCaptureError("claude", res);
        return;
      }
      const body = capture ? parseBody(capture.bodyText).json : null;
      if (body?.stream) {
        sendAnthropicText(res, '{"title":"Capture native prompt"}', body.model);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_capture",
          type: "message",
          role: "assistant",
          model: body?.model || "claude-haiku-4-5-20251001",
          content: [{ type: "text", text: '{"title":"Capture native prompt"}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 10 },
        }));
      }
    },
  });
  try {
    const env = {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: configDir,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`,
      ANTHROPIC_API_KEY: DUMMY_ANTHROPIC_KEY,
      DISABLE_AUTOUPDATER: "1",
    };
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.SKILL_ROUTER_HOST;
    delete env.AGENTS_HOME;

    const args = [
      "-p", fullQuery,
      "--output-format=stream-json",
      "--verbose",
      "--permission-mode=bypassPermissions",
      "--no-session-persistence",
    ];
    const result = await spawnUntilCaptured({ label: "claude", command: "claude", args, env, cwd: project, server });
    await writeCapture("claude-request.json", result);
    await writeAllCaptures("claude-requests.json", result);
    return { home, request: result.capture };
  } finally {
    await server.close();
  }
}

async function runCommand(command, args, { cwd, env }) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolve) => child.once("close", resolve));
  const result = { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} exited ${exitCode}\n${result.stderr.slice(-4000)}`);
  }
  return result;
}

async function writeCapture(filename, result) {
  const capture = {
    ...result.capture,
    body: sanitizeParsedBody(parseBody(result.capture.bodyText)),
    bodyText: undefined,
    child: {
      exitCode: result.child.exitCode,
      signalCode: result.child.signalCode,
    },
  };
  await writeFile(join(OUT_DIR, filename), JSON.stringify(capture, null, 2));
}

async function writeAllCaptures(filename, result) {
  const captures = result.allCaptures.map((capture) => ({
    ...capture,
    body: sanitizeParsedBody(parseBody(capture.bodyText)),
    bodyText: undefined,
  }));
  await writeFile(join(OUT_DIR, filename), JSON.stringify(captures, null, 2));
}

function sanitizeParsedBody(parsed) {
  if (parsed.json) {
    return { json: sanitizeRequestBody(parsed.json) };
  }
  return parsed;
}

function sanitizeRequestBody(value, path = []) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRequestBody(item, path));
  }
  if (!value || typeof value !== "object") return value;

  const inMetadata = path.some((part) => part === "metadata" || part === "client_metadata");
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (isAlwaysSensitiveKey(key) || (inMetadata && isMetadataSensitiveKey(key))) {
      out[key] = "[REDACTED]";
    } else if (inMetadata && typeof item === "string" && looksLikeMetadataIdentifier(item)) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = sanitizeRequestBody(item, [...path, key]);
    }
  }
  return out;
}

function isAlwaysSensitiveKey(key) {
  return /authorization|api[-_]?key|cookie|token|secret|prompt_cache_key/i.test(key);
}

function isMetadataSensitiveKey(key) {
  return /device|session|thread|conversation|account|user|installation|organization|org|uuid|(^|[-_])id($|[-_])/i.test(key);
}

function looksLikeMetadataIdentifier(value) {
  return /device_id|session_id|account_uuid|installation|[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(value);
}

function collectStrings(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function extractSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return "";
  const fromStart = text.slice(start);
  if (!endMarker) return fromStart;
  const end = fromStart.indexOf(endMarker);
  return end >= 0 ? fromStart.slice(0, end) : fromStart;
}

function skillLineStats(section) {
  const lines = section.split(/\r?\n/).filter((line) => /^- (?:user:)?skill-\d{3}\b/.test(line.trim()));
  const descriptionLengths = lines.map((line) => {
    const trimmed = line.trim();
    const withoutPrefix = trimmed.replace(/^- (?:user:)?skill-\d{3}:?\s*/, "");
    return withoutPrefix.replace(/\s*\(file:.*$/, "").length;
  });
  return {
    skillLines: lines.length,
    chars: section.length,
    bytes: Buffer.byteLength(section, "utf8"),
    maxDescriptionChars: descriptionLengths.length ? Math.max(...descriptionLengths) : 0,
    minDescriptionChars: descriptionLengths.length ? Math.min(...descriptionLengths) : 0,
    avgDescriptionChars: descriptionLengths.length
      ? Math.round(descriptionLengths.reduce((a, b) => a + b, 0) / descriptionLengths.length)
      : 0,
    firstSkillLines: lines.slice(0, 5),
    skill026Line: lines.find((line) => line.includes("skill-026")) || null,
    skill105Line: lines.find((line) => line.includes("skill-105")) || null,
  };
}

function bodyJson(capture) {
  return parseBody(capture.bodyText).json;
}

function analyzeCodex(codex) {
  const promptInput = JSON.parse(codex.debugPromptInput);
  const promptStrings = collectStrings(promptInput);
  const allText = promptStrings.join("\n");
  const debugSkillsSection = extractSection(allText, "### Available skills", "### How to use skills");
  const body = bodyJson(codex.request);
  const requestStrings = collectStrings(body);
  const requestText = requestStrings.join("\n");
  const requestSkillsSection = extractSection(requestText, "### Available skills", "### How to use skills");
  return {
    requestUrl: codex.request.url,
    requestBodyTopLevelKeys: body && typeof body === "object" ? Object.keys(body) : [],
    debugPromptInputMessages: Array.isArray(promptInput) ? promptInput.length : null,
    availableSkillsSection: skillLineStats(requestSkillsSection || debugSkillsSection),
    debugAvailableSkillsSection: skillLineStats(debugSkillsSection),
    requestContainsAvailableSkills: requestText.includes("### Available skills"),
    requestContainsSkillTool: Array.isArray(body?.tools)
      ? body.tools.some((tool) => tool.name === "Skill" || tool.type === "Skill")
      : false,
    requestContainsOpenSkillInstruction: requestText.includes("open its `SKILL.md`") || requestText.includes("open SKILL.md"),
  };
}

function analyzeClaude(claude) {
  const body = bodyJson(claude.request);
  const strings = collectStrings(body);
  const allText = strings.join("\n");
  const rawListing = extractSection(
    allText,
    "The following skills are available for use with the Skill tool:",
    "</system-reminder>",
  );
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const toolNames = tools.map((tool) => tool.name).filter(Boolean);
  const skillTool = tools.find((tool) => tool.name === "Skill" || /Skill/.test(tool.name || ""));
  const skillToolText = skillTool ? collectStrings(skillTool).join("\n") : "";
  return {
    requestUrl: claude.request.url,
    requestBodyTopLevelKeys: body && typeof body === "object" ? Object.keys(body) : [],
    model: body?.model || null,
    systemType: Array.isArray(body?.system) ? "array" : typeof body?.system,
    toolCount: tools.length,
    toolNames,
    hasSkillTool: Boolean(skillTool),
    skillToolDescriptionChars: skillToolText.length,
    skillToolRequiresLaunchBeforeAnswer: /invoke relevant Skill tool BEFORE|execute a skill/i.test(skillToolText),
    skillListingSection: skillLineStats(rawListing),
    requestContainsSkillListing: allText.includes("The following skills are available for use with the Skill tool:"),
    requestContainsSystemReminder: allText.includes("<system-reminder>"),
  };
}

async function writeAnalysis({ query, codex, claude }) {
  const analysis = {
    generatedAt: new Date().toISOString(),
    query: { id: query.id, expected: query.expected, domain: query.domain },
    codex: analyzeCodex(codex),
    claude: analyzeClaude(claude),
    files: {
      codexPromptInput: "codex-prompt-input.json",
      codexRequest: "codex-request.json",
      claudeRequest: "claude-request.json",
      analysisJson: "analysis.json",
      analysisMd: "analysis.md",
      codexRequests: "codex-requests.json",
      claudeRequests: "claude-requests.json",
    },
  };
  await writeFile(join(OUT_DIR, "analysis.json"), JSON.stringify(analysis, null, 2));
  await writeFile(join(OUT_DIR, "analysis.md"), renderMarkdown(analysis));
}

function renderMarkdown(analysis) {
  const c = analysis.codex.availableSkillsSection;
  const k = analysis.claude.skillListingSection;
  return `# Native Prompt Capture

Generated: ${analysis.generatedAt}

Query: ${analysis.query.id} (expected ${analysis.query.expected})

## Summary

| Host | Captured endpoint | Skill list lines | Skill list chars | Avg desc chars | Max desc chars | Skill execution mechanism |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Codex native | \`${analysis.codex.requestUrl}\` | ${c.skillLines} | ${c.chars} | ${c.avgDescriptionChars} | ${c.maxDescriptionChars} | Inline skills section + open \`SKILL.md\` instruction |
| Claude Code native | \`${analysis.claude.requestUrl}\` | ${k.skillLines} | ${k.chars} | ${k.avgDescriptionChars} | ${k.maxDescriptionChars} | \`Skill\` tool + budgeted skill listing |

## Codex Native

- Request top-level keys: ${analysis.codex.requestBodyTopLevelKeys.map((x) => `\`${x}\``).join(", ")}
- Prompt input messages: ${analysis.codex.debugPromptInputMessages}
- Request contains \`### Available skills\`: ${analysis.codex.requestContainsAvailableSkills}
- Request contains open-SKILL instruction: ${analysis.codex.requestContainsOpenSkillInstruction}
- \`skill-105\` line: ${c.skill105Line || "(not found)"}
- \`skill-026\` line: ${c.skill026Line || "(not found)"}

## Claude Code Native

- Model: ${analysis.claude.model}
- Request top-level keys: ${analysis.claude.requestBodyTopLevelKeys.map((x) => `\`${x}\``).join(", ")}
- Tool count: ${analysis.claude.toolCount}
- Has \`Skill\` tool: ${analysis.claude.hasSkillTool}
- Skill tool description chars: ${analysis.claude.skillToolDescriptionChars}
- Skill tool text contains launch-before-answer semantics: ${analysis.claude.skillToolRequiresLaunchBeforeAnswer}
- Request contains skill listing system-reminder: ${analysis.claude.requestContainsSkillListing}
- \`skill-105\` line: ${k.skill105Line || "(not found)"}
- \`skill-026\` line: ${k.skill026Line || "(not found)"}

Raw request bodies are stored next to this file for local inspection and are
ignored by git; auth-like headers and metadata identifiers are redacted.
`;
}

async function main() {
  if (!existsSync(CORPUS_DIR)) throw new Error(`missing corpus dir: ${CORPUS_DIR}`);
  await mkdir(OUT_DIR, { recursive: true });
  const queries = JSON.parse(await readFile(join(EXP_DIR, "queries.json"), "utf8")).queries;
  const query = queries.find((item) => item.id === QUERY_ID);
  if (!query) throw new Error(`unknown query id: ${QUERY_ID}`);

  log(`query=${query.id} expected=${query.expected}`);
  const [codex, claude] = await Promise.all([
    captureCodex(query),
    captureClaude(query),
  ]);
  await writeAnalysis({ query, codex, claude });
  log(`analysis -> ${join(OUT_DIR, "analysis.md")}`);
}

main().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
