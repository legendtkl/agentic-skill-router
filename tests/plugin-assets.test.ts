import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../src/frontmatter.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const execFileAsync = promisify(execFile);

test("shared router skill uses Agent Skills frontmatter as the source of truth", async () => {
  const shared = await readFile(join(REPO_ROOT, "shared", "skills", "skill-router-skills", "SKILL.md"), "utf8");
  const fm = parseFrontmatter(shared);
  const frontmatter = shared.slice(0, shared.indexOf("---", 4));
  const topLevelKeys = [...frontmatter.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((match) => match[1]);

  assert.equal(fm.name, "skill-router-skills");
  const description = fm.description;
  assert.ok(typeof description === "string");
  assert.match(description, /audit, slim, disable, restore, or route/);
  assert.deepEqual(topLevelKeys, ["name", "description", "metadata"]);
  assert.match(frontmatter, /metadata:\n  skill-router\.version: "1"\n  skill-router\.hosts: "claude-code,codex"/);
});

test("Claude and Codex plugin skills are generated from the shared skill", async () => {
  const sharedDir = join(REPO_ROOT, "shared", "skills", "skill-router-skills");
  const shared = await readFile(join(sharedDir, "SKILL.md"), "utf8");
  const sharedRefs = await readdir(join(sharedDir, "references"));

  for (const host of ["claude-code", "codex"]) {
    const generatedDir = join(REPO_ROOT, "plugins", host, "skills", "skill-router-skills");
    assert.equal(await readFile(join(generatedDir, "SKILL.md"), "utf8"), shared);
    for (const ref of sharedRefs) {
      assert.equal(
        await readFile(join(generatedDir, "references", ref), "utf8"),
        await readFile(join(sharedDir, "references", ref), "utf8"),
      );
    }
  }

  const codexAgent = await readFile(
    join(REPO_ROOT, "plugins", "codex", "skills", "skill-router-skills", "agents", "openai.yaml"),
    "utf8",
  );
  assert.match(codexAgent, /display_name: "Skill Router"/);
  assert.match(codexAgent, /default_prompt: "Use \$skill-router-skills/);

  await execFileAsync(process.execPath, ["scripts/generate-assets.mjs", "--check"], { cwd: REPO_ROOT });
});

test("Codex slash command is a thin compatibility shim", async () => {
  const prompt = await readFile(join(REPO_ROOT, "plugins", "codex", "prompts", "skill-router-skills.md"), "utf8");
  const fm = parseFrontmatter(prompt);

  assert.equal(fm.description, "Use the skill-router-skills skill with optional arguments.");
  assert.equal(fm["argument-hint"], "[route <query>|list|suggest|status|enable <id...>|disable <id...>]");
  assert.match(prompt, /Invoke\/use the installed `skill-router-skills` skill/);
  assert.ok(prompt.length < 500);
  assert.doesNotMatch(prompt, /Locate CLI/);
  assert.doesNotMatch(prompt, /skills dci search/);
  assert.doesNotMatch(prompt, /printf '%s\\n'/);
  assert.doesNotMatch(prompt, /Never disable/);
});

test("package bin wrapper resolves npm-style symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-router-bin-"));
  try {
    const packageRoot = join(root, "pkg");
    const packageBin = join(packageRoot, "bin");
    const packageLib = join(packageRoot, "lib");
    const npmBin = join(root, "node_modules", ".bin");
    await mkdir(packageBin, { recursive: true });
    await mkdir(packageLib, { recursive: true });
    await mkdir(npmBin, { recursive: true });

    await copyFile(
      join(REPO_ROOT, "plugins", "codex", "bin", "skill-router"),
      join(packageBin, "skill-router"),
    );
    await chmod(join(packageBin, "skill-router"), 0o755);
    await writeFile(
      join(packageLib, "skill-router.mjs"),
      "console.log(JSON.stringify({ argv: process.argv.slice(2) }));\n",
    );
    await symlink("../../pkg/bin/skill-router", join(npmBin, "skill-router"));

    const { stdout } = await execFileAsync(join(npmBin, "skill-router"), ["--host=codex", "skills", "list"]);
    assert.deepEqual(JSON.parse(stdout), { argv: ["--host=codex", "skills", "list"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("built bin runs when bundle lives under a realpath-normalized temp directory", async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 });

  const root = await mkdtemp(join(tmpdir(), "skill-router-realpath-bin-"));
  try {
    const packageRoot = join(root, "pkg");
    const packageBin = join(packageRoot, "bin");
    const packageLib = join(packageRoot, "lib");
    const codexHome = join(root, "codex-home");
    const agentsHome = join(root, "agents-home");
    const stateDir = join(root, "state");
    await mkdir(packageBin, { recursive: true });
    await mkdir(packageLib, { recursive: true });
    await mkdir(codexHome, { recursive: true });
    await mkdir(agentsHome, { recursive: true });
    await mkdir(stateDir, { recursive: true });

    await copyFile(
      join(REPO_ROOT, "plugins", "codex", "bin", "skill-router"),
      join(packageBin, "skill-router"),
    );
    await chmod(join(packageBin, "skill-router"), 0o755);
    await copyFile(
      join(REPO_ROOT, "plugins", "codex", "lib", "skill-router.mjs"),
      join(packageLib, "skill-router.mjs"),
    );

    const { stdout } = await execFileAsync(
      join(packageBin, "skill-router"),
      ["--host=codex", "skills", "list", "--json"],
      {
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          AGENTS_HOME: agentsHome,
          SKILL_ROUTER_STATE_DIR: stateDir,
        },
      },
    );
    assert.deepEqual(JSON.parse(stdout), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("npm package includes the bin runtime bundle", async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 });
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 },
  );
  const packed = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
  const files = new Set(packed[0]?.files.map((f) => f.path) ?? []);
  assert.ok(files.has("plugins/codex/bin/skill-router"));
  assert.ok(files.has("plugins/codex/lib/skill-router.mjs"));
});

test("install scripts always rebuild before copying plugin assets", async () => {
  const codexInstall = await readFile(join(REPO_ROOT, "scripts", "install-codex.mjs"), "utf8");
  const claudeInstall = await readFile(join(REPO_ROOT, "scripts", "install.mjs"), "utf8");
  for (const content of [codexInstall, claudeInstall]) {
    assert.match(content, /building bundle \(npm run build\)/);
    assert.doesNotMatch(content, /skipping build/);
    assert.doesNotMatch(content, /existsSync/);
  }
});
