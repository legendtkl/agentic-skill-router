import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const execFileAsync = promisify(execFile);

test("Codex router assets document the CLI file path consistently", async () => {
  const skill = await readFile(join(REPO_ROOT, "plugins", "codex", "skills", "skill-router-skills", "SKILL.md"), "utf8");
  const prompt = await readFile(join(REPO_ROOT, "plugins", "codex", "prompts", "skill-router-skills.md"), "utf8");

  for (const content of [skill, prompt]) {
    assert.match(content, /printf '%s\\n' "\$PWD\/plugins\/codex\/bin\/skill-router"/);
    assert.match(content, /"<abs-path-to-skill-router>" --host=codex skills/);
    assert.match(content, /--mode=(?:auto\|lexical\|dci|lexical\|dci\|auto)/);
    assert.match(content, /skills dci search/);
    assert.match(content, /skills dci find/);
    assert.match(content, /skills dci open/);
    assert.match(content, /skills dci read/);
    assert.match(content, /skills dci select/);
    assert.match(content, /max selections/i);
    assert.doesNotMatch(content, /node "<abs-path-to-skill-router/);
    assert.doesNotMatch(content, /node "<abs-path>\/skill-router\.mjs"/);
  }
});

test("Codex router skill description is a closed last-resort resolver", async () => {
  const skill = await readFile(join(REPO_ROOT, "plugins", "codex", "skills", "skill-router-skills", "SKILL.md"), "utf8");

  assert.match(skill, /Last-resort resolver/);
  assert.match(skill, /no available skill clearly matches/);
  assert.match(skill, /general knowledge or web search/);
  assert.match(skill, /looks skill-shaped/);
  assert.match(skill, /close the router path/);
  assert.match(skill, /Do not hard-code a product list/);
  assert.doesNotMatch(skill, /Kibana Console API/);
  assert.doesNotMatch(skill, /Elasticsearch\/ES DSL\/index mapping/);
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
