#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachManagedMarker } from "./prompt-marker.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const check = process.argv.includes("--check");

await writeGeneratedFile(
  resolve(root, "plugins/codex/prompts/skill-router-skills.md"),
  attachManagedMarker(renderSlashPrompt({
    description: "Use the skill-router-skills skill with optional arguments.",
    argumentHint: "[route <query>|list|suggest|status|enable <id...>|disable <id...> --yes]",
  })),
);

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

function renderSlashPrompt(prompt) {
  const description = prompt.description;
  const argumentHint = prompt.argumentHint;
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

function yamlQuote(value) {
  return JSON.stringify(value);
}
