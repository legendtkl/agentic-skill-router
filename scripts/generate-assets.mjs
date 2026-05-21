#!/usr/bin/env node
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const check = process.argv.includes("--check");

const sharedSkillDir = resolve(root, "shared/skills/skill-router-skills");
const overlayDir = resolve(root, "shared/host-overlays");

const overlays = await Promise.all([
  readJson(resolve(overlayDir, "claude-code.json")),
  readJson(resolve(overlayDir, "codex.json")),
]);

for (const overlay of overlays) {
  const skillDir = resolve(root, expectString(overlay.skillDir, "skillDir"));
  await syncDir(sharedSkillDir, skillDir);

  const openaiAgent = overlay.openaiAgent;
  if (isPlainObject(openaiAgent)) {
    const relPath = expectString(openaiAgent.path, "openaiAgent.path");
    const content = renderOpenaiYaml(openaiAgent);
    await writeGeneratedFile(join(skillDir, relPath), content);
  }

  const slashPrompt = overlay.slashPrompt;
  if (isPlainObject(slashPrompt)) {
    const promptPath = resolve(root, expectString(slashPrompt.path, "slashPrompt.path"));
    await writeGeneratedFile(promptPath, renderSlashPrompt(slashPrompt));
  }
}

async function syncDir(sourceDir, targetDir) {
  if (check) {
    const sourceFiles = await listFiles(sourceDir);
    const targetFiles = await listFiles(targetDir);
    const generated = await expectedFilesForTarget(targetDir);
    const expected = new Set([...sourceFiles.map((file) => file.relative), ...generated]);
    for (const file of targetFiles) {
      if (!expected.has(file.relative)) {
        throw new Error(`${targetDir} has stale generated file ${file.relative}`);
      }
    }
    for (const file of sourceFiles) {
      const targetPath = join(targetDir, file.relative);
      await assertSameFile(file.absolute, targetPath);
    }
    return;
  }

  const tmpDir = `${targetDir}._tmp`;
  await rm(tmpDir, { recursive: true, force: true });
  for (const file of await listFiles(sourceDir)) {
    await writeGeneratedFile(join(tmpDir, file.relative), await readFile(file.absolute, "utf8"));
  }
  await rm(targetDir, { recursive: true, force: true });
  await rename(tmpDir, targetDir);
}

async function expectedFilesForTarget(targetDir) {
  const out = new Set();
  for (const overlay of overlays) {
    const skillDir = resolve(root, expectString(overlay.skillDir, "skillDir"));
    if (skillDir !== targetDir) continue;
    const openaiAgent = overlay.openaiAgent;
    if (isPlainObject(openaiAgent)) out.add(expectString(openaiAgent.path, "openaiAgent.path"));
  }
  return out;
}

async function writeGeneratedFile(path, content) {
  if (check) {
    let current;
    try {
      current = await readFile(path, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT") throw new Error(`${path} is missing generated content`);
      throw err;
    }
    if (current !== content) {
      throw new Error(`${path} is out of date; run npm run generate:assets`);
    }
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  console.log(`generated ${path}`);
}

async function assertSameFile(sourcePath, targetPath) {
  let source;
  let target;
  try {
    [source, target] = await Promise.all([
      readFile(sourcePath, "utf8"),
      readFile(targetPath, "utf8"),
    ]);
  } catch (err) {
    if (err?.code === "ENOENT") throw new Error(`${targetPath} is missing generated content`);
    throw err;
  }
  if (source !== target) {
    throw new Error(`${targetPath} is out of date; run npm run generate:assets`);
  }
}

async function listFiles(dir, prefix = "") {
  const currentDir = prefix ? join(dir, prefix) : dir;
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(dir, relative);
    if (entry.isDirectory()) {
      files.push(...await listFiles(dir, relative));
      continue;
    }
    if (!entry.isFile()) {
      const s = await stat(absolute).catch(() => null);
      if (!s?.isFile()) continue;
    }
    files.push({ relative, absolute });
  }
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  return files;
}

function renderSlashPrompt(prompt) {
  const description = expectString(prompt.description, "slashPrompt.description");
  const argumentHint = expectString(prompt.argumentHint, "slashPrompt.argumentHint");
  return [
    "---",
    `description: ${yamlQuote(description)}`,
    `argument-hint: ${yamlQuote(argumentHint)}`,
    "---",
    "",
    "Invoke/use the installed `skill-router-skills` skill. Treat the text after",
    "`/skill-router:skills` as arguments for that skill.",
    "",
  ].join("\n");
}

function renderOpenaiYaml(openaiAgent) {
  const iface = openaiAgent.interface;
  if (!isPlainObject(iface)) throw new Error("openaiAgent.interface must be an object");
  const lines = ["interface:"];
  for (const [key, value] of Object.entries(iface)) {
    if (typeof value !== "string") throw new Error(`openaiAgent.interface.${key} must be a string`);
    lines.push(`  ${key}: ${yamlQuote(value)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function yamlQuote(value) {
  return JSON.stringify(value);
}

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

function expectString(value, label) {
  if (typeof value !== "string" || value === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
