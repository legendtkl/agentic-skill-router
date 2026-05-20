import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);

test("Codex router assets document the CLI file path consistently", async () => {
  const skill = await readFile(join(REPO_ROOT, "plugins", "codex", "skills", "skill-router-skills", "SKILL.md"), "utf8");
  const prompt = await readFile(join(REPO_ROOT, "plugins", "codex", "prompts", "skill-router-skills.md"), "utf8");

  for (const content of [skill, prompt]) {
    assert.match(content, /printf '%s\\n' "\$PWD\/plugins\/codex\/lib\/skill-router\.mjs"/);
    assert.match(content, /node "<abs-path-to-skill-router\.mjs>"/);
    assert.doesNotMatch(content, /node "<abs-path>\/skill-router\.mjs"/);
  }
});
