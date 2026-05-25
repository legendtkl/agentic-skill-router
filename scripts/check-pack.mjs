#!/usr/bin/env node
// Smoke check for the published package surface.
// - Runs `bin/agentic-skill-router --help` and asserts exit 0 + non-empty stdout.
// - Runs `npm pack --dry-run --json` and asserts the required entries are present.
// Intended to run after `npm run build` (locally and in CI).
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const REQUIRED_FILES = [
  "bin/agentic-skill-router",
  "lib/agentic-skill-router.mjs",
  "skills/agentic-skill-router-skills/SKILL.md",
  "plugins/claude-code/.claude-plugin/plugin.json",
  "plugins/codex/.codex-plugin/plugin.json",
  "plugins/codex/prompts/agentic-skill-router-skills.md",
];

const REQUIRED_DIRS = ["bin/", "lib/", "skills/", "plugins/codex/prompts/"];

const FORBIDDEN_PACK_ENTRIES = [
  "bin/skill-router",
  "lib/skill-router.mjs",
  "plugins/codex/prompts/skill-router-skills.md",
  "skills/skill-router-skills/",
  "experiments/",
];

async function fail(message) {
  console.error(`check:pack failed: ${message}`);
  process.exit(1);
}

async function assertBundleExists() {
  const bundle = resolve(root, "lib/agentic-skill-router.mjs");
  try {
    await access(bundle);
  } catch {
    await fail(`expected built bundle at ${bundle}; run \`npm run build\` first`);
  }
}

async function checkBinHelp() {
  const bin = resolve(root, "bin/agentic-skill-router");
  try {
    const { stdout } = await execFileAsync(bin, ["--help"], {
      cwd: root,
      maxBuffer: 1024 * 1024,
    });
    if (!stdout || stdout.trim().length === 0) {
      await fail("`bin/agentic-skill-router --help` produced empty stdout");
    }
    if (!/agentic-skill-router/.test(stdout)) {
      await fail("`bin/agentic-skill-router --help` stdout did not mention agentic-skill-router");
    }
    console.log("ok: bin/agentic-skill-router --help exited 0 with non-empty output");
  } catch (err) {
    const status = err?.code ?? err?.status ?? "unknown";
    const stderr = typeof err?.stderr === "string" ? err.stderr : "";
    await fail(`\`bin/agentic-skill-router --help\` exited with status ${status}: ${stderr || err?.message || ""}`);
  }
}

async function checkPackContents() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: root, maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch (err) {
    const stderr = typeof err?.stderr === "string" ? err.stderr : "";
    await fail(`\`npm pack --dry-run --json\` failed: ${stderr || err?.message || err}`);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    await fail(`could not parse \`npm pack --dry-run --json\` output: ${err?.message ?? err}`);
    return;
  }

  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = new Set((entry?.files ?? []).map((f) => f.path));
  if (files.size === 0) {
    await fail("npm pack reported zero files");
    return;
  }

  const missingFiles = REQUIRED_FILES.filter((path) => !files.has(path));
  if (missingFiles.length > 0) {
    await fail(`missing required file entries in pack: ${missingFiles.join(", ")}`);
    return;
  }

  const missingDirs = REQUIRED_DIRS.filter((dir) => {
    for (const file of files) {
      if (file.startsWith(dir)) return false;
    }
    return true;
  });
  if (missingDirs.length > 0) {
    await fail(`missing required directories in pack: ${missingDirs.join(", ")}`);
    return;
  }

  const forbiddenFiles = [...files].filter((file) =>
    FORBIDDEN_PACK_ENTRIES.some((entry) => file === entry || file.startsWith(entry)),
  );
  if (forbiddenFiles.length > 0) {
    await fail(`forbidden entries in pack: ${forbiddenFiles.join(", ")}`);
    return;
  }

  console.log(`ok: npm pack --dry-run lists ${files.size} files including required entries`);
}

await assertBundleExists();
await checkBinHelp();
await checkPackContents();
console.log("check:pack passed");
