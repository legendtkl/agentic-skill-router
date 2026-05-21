import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../src/frontmatter.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const execFileAsync = promisify(execFile);
const NPM_TEST_CACHE = join(tmpdir(), `skill-router-npm-cache-${process.pid}`);

test("shared router skill uses Agent Skills frontmatter as the source of truth", async () => {
  const shared = await readFile(join(REPO_ROOT, "skills", "skill-router-skills", "SKILL.md"), "utf8");
  const fm = parseFrontmatter(shared);
  const frontmatter = shared.slice(0, shared.indexOf("---", 4));
  const topLevelKeys = [...frontmatter.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((match) => match[1]);

  assert.equal(fm.name, "skill-router-skills");
  const description = fm.description;
  assert.ok(typeof description === "string");
  assert.match(description, /audit, slim, disable, restore, or route/);
  assert.doesNotMatch(description, /For Codex/);
  assert.deepEqual(topLevelKeys, ["name", "description", "metadata"]);
  assert.match(frontmatter, /metadata:\n  skill-router\.version: "1"\n  skill-router\.hosts: "claude-code,codex"/);
});

test("plugin packages assemble from one unified skill source", async () => {
  const skillDir = join(REPO_ROOT, "skills", "skill-router-skills");
  assert.ok(await pathExists(join(skillDir, "SKILL.md")));
  assert.deepEqual((await readdir(join(skillDir, "references"))).sort(), [
    "cli-location.md",
    "disabled-routing.md",
    "safety.md",
    "slimming.md",
  ]);

  assert.equal(await pathExists(join(REPO_ROOT, "plugins", "claude-code", "skills")), false);
  assert.equal(await pathExists(join(REPO_ROOT, "plugins", "codex", "skills")), false);
  assert.equal(await pathExists(join(REPO_ROOT, "shared", "host-overlays")), false);

  const claudeManifest = JSON.parse(await readFile(join(REPO_ROOT, "plugins", "claude-code", ".claude-plugin", "plugin.json"), "utf8"));
  const codexManifest = JSON.parse(await readFile(join(REPO_ROOT, "plugins", "codex", ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(claudeManifest.skills, "../../skills/");
  assert.equal(codexManifest.skills, "../../skills/");
  assert.ok(await pathExists(resolve(REPO_ROOT, "plugins", "claude-code", claudeManifest.skills, "skill-router-skills", "SKILL.md")));
  assert.ok(await pathExists(resolve(REPO_ROOT, "plugins", "codex", codexManifest.skills, "skill-router-skills", "SKILL.md")));

  await execFileAsync(process.execPath, ["scripts/generate-assets.mjs", "--check"], { cwd: REPO_ROOT });
});

test("Codex slash command is a thin compatibility shim", async () => {
  const prompt = await readFile(join(REPO_ROOT, "plugins", "codex", "prompts", "skill-router-skills.md"), "utf8");
  const fm = parseFrontmatter(prompt);

  assert.equal(fm.description, "Use the skill-router-skills skill with optional arguments.");
  assert.equal(fm["argument-hint"], "[route <query>|list|suggest|status|enable <id...>|disable <id...> --yes]");
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
      join(REPO_ROOT, "bin", "skill-router"),
      join(packageBin, "skill-router"),
    );
    await chmod(join(packageBin, "skill-router"), 0o755);
    await writeFile(
      join(packageLib, "skill-router.mjs"),
      "console.log(JSON.stringify({ argv: process.argv.slice(2) }));\n",
    );
    await symlink("../../pkg/bin/skill-router", join(npmBin, "skill-router"));

    const { stdout } = await execFileAsync(join(npmBin, "skill-router"), ["skills", "list"]);
    assert.deepEqual(JSON.parse(stdout), { argv: ["skills", "list"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("built bin auto-detects installed Codex plugin host from its bundle", async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: REPO_ROOT, env: npmTestEnv(), maxBuffer: 1024 * 1024 });

  const root = await mkdtemp(join(tmpdir(), "skill-router-realpath-bin-"));
  try {
    const packageRoot = join(root, "pkg");
    const packageBin = join(packageRoot, "bin");
    const packageLib = join(packageRoot, "lib");
    const codexHome = join(root, ".codex");
    const agentsHome = join(root, ".agents");
    const stateDir = join(root, "state");
    await mkdir(packageBin, { recursive: true });
    await mkdir(packageLib, { recursive: true });
    await mkdir(join(packageRoot, ".codex-plugin"), { recursive: true });
    await mkdir(join(codexHome, "skills", "marker-priority"), { recursive: true });
    await mkdir(agentsHome, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(packageRoot, ".codex-plugin", "plugin.json"), "{}\n");
    await writeFile(
      join(codexHome, "skills", "marker-priority", "SKILL.md"),
      "---\nname: marker-priority\ndescription: Codex marker priority probe\n---\n",
    );

    await copyFile(
      join(REPO_ROOT, "bin", "skill-router"),
      join(packageBin, "skill-router"),
    );
    await chmod(join(packageBin, "skill-router"), 0o755);
    await copyFile(
      join(REPO_ROOT, "lib", "skill-router.mjs"),
      join(packageLib, "skill-router.mjs"),
    );

    const { stdout } = await execFileAsync(
      join(packageBin, "skill-router"),
      ["skills", "list", "--json"],
      {
        env: {
          ...process.env,
          HOME: root,
          CODEX_HOME: undefined,
          AGENTS_HOME: undefined,
          SKILL_ROUTER_HOST: "claude-code",
          SKILL_ROUTER_STATE_DIR: stateDir,
        },
      },
    );
    const listed = JSON.parse(stdout) as Array<{ id: string }>;
    assert.deepEqual(listed.map((item) => item.id), ["user:codex:marker-priority"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("built bin flushes large JSON output before exit", async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: REPO_ROOT, env: npmTestEnv(), maxBuffer: 1024 * 1024 });

  const root = await mkdtemp(join(tmpdir(), "skill-router-large-json-"));
  try {
    const codexHome = join(root, "codex-home");
    const agentsHome = join(root, "agents-home");
    const stateDir = join(root, "state");
    await mkdir(join(codexHome, "skills"), { recursive: true });
    await mkdir(agentsHome, { recursive: true });
    await mkdir(stateDir, { recursive: true });

    const longDescription = "large output flush probe ".repeat(80);
    for (let i = 0; i < 90; i++) {
      const name = `large-json-${String(i).padStart(3, "0")}`;
      await mkdir(join(codexHome, "skills", name), { recursive: true });
      await writeFile(
        join(codexHome, "skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${longDescription}${name}\n---\n\n# ${name}\n`,
      );
    }

    const { stdout } = await execFileAsync(
      join(REPO_ROOT, "bin", "skill-router"),
      ["skills", "list", "--json"],
      {
        env: {
          ...process.env,
          SKILL_ROUTER_HOST: "codex",
          CODEX_HOME: codexHome,
          AGENTS_HOME: agentsHome,
          SKILL_ROUTER_STATE_DIR: stateDir,
        },
        maxBuffer: 5 * 1024 * 1024,
      },
    );
    const listed = JSON.parse(stdout) as Array<{ id: string }>;
    assert.equal(listed.length, 90);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("npm package includes the bin runtime bundle", async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: REPO_ROOT, env: npmTestEnv(), maxBuffer: 1024 * 1024 });
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: REPO_ROOT, env: npmTestEnv(), maxBuffer: 1024 * 1024 },
  );
  const packed = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
  const files = new Set(packed[0]?.files.map((f) => f.path) ?? []);
  assert.ok(files.has("bin/skill-router"));
  assert.ok(files.has("lib/skill-router.mjs"));
  assert.ok(files.has("skills/skill-router-skills/SKILL.md"));
  assert.ok(files.has("plugins/claude-code/.claude-plugin/plugin.json"));
  assert.ok(files.has("plugins/codex/.codex-plugin/plugin.json"));
  assert.ok(!files.has("plugins/codex/skills/skill-router-skills/SKILL.md"));
  assert.ok(!files.has("plugins/claude-code/skills/skill-router-skills/SKILL.md"));
});

test("install scripts assemble self-contained plugin caches from unified assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-router-install-"));
  try {
    const claudeHome = join(root, "claude-home");
    const codexHome = join(root, "codex-home");
    const version = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")).version;
    const claudeInstallPath = join(claudeHome, "plugins", "cache", "local", "skill-router", version);
    const codexInstallPath = join(codexHome, "plugins", "cache", "local", "skill-router", version);

    await execFileAsync(process.execPath, ["scripts/install.mjs"], {
      cwd: REPO_ROOT,
      env: { ...process.env, CLAUDE_HOME: claudeHome },
      maxBuffer: 1024 * 1024,
    });
    await assertInstalledPlugin(claudeInstallPath, ".claude-plugin/plugin.json");

    const installed = JSON.parse(await readFile(join(claudeHome, "plugins", "installed_plugins.json"), "utf8"));
    assert.equal(installed.plugins["skill-router@local"][0].installPath, claudeInstallPath);

    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: { ...process.env, CODEX_HOME: codexHome },
      maxBuffer: 1024 * 1024,
    });
    await assertInstalledPlugin(codexInstallPath, ".codex-plugin/plugin.json");
    assert.match(await readFile(join(codexHome, "config.toml"), "utf8"), /\[plugins\."skill-router@local"\]\nenabled = true/);
    assert.ok(await pathExists(join(codexHome, "prompts", "skill-router-skills.md")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install scripts always rebuild before copying plugin assets", async () => {
  const codexInstall = await readFile(join(REPO_ROOT, "scripts", "install-codex.mjs"), "utf8");
  const claudeInstall = await readFile(join(REPO_ROOT, "scripts", "install.mjs"), "utf8");
  const sharedLib = await readFile(join(REPO_ROOT, "scripts", "lib", "plugin-install.mjs"), "utf8");
  const commonLib = await readFile(join(REPO_ROOT, "scripts", "lib", "common.mjs"), "utf8");
  for (const content of [codexInstall, claudeInstall]) {
    assert.match(content, /ensureBuild\(/);
    assert.match(content, /copyPluginAssets\(/);
    assert.match(content, /normalizeManifestSkills/);
    assert.doesNotMatch(content, /skipping build/);
    assert.doesNotMatch(content, /existsSync/);
  }
  assert.match(commonLib, /building bundle \(npm run build\)/);
  assert.match(sharedLib, /SHARED_ASSET_DIRS = \["bin", "lib", "skills"\]/);
});

async function assertInstalledPlugin(pluginRoot: string, manifestRelativePath: string): Promise<void> {
  assert.ok(await pathExists(join(pluginRoot, "bin", "skill-router")));
  assert.ok(await pathExists(join(pluginRoot, "lib", "skill-router.mjs")));
  assert.ok(await pathExists(join(pluginRoot, "skills", "skill-router-skills", "SKILL.md")));

  const manifest = JSON.parse(await readFile(join(pluginRoot, manifestRelativePath), "utf8"));
  assert.equal(manifest.skills, "./skills/");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function npmTestEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    npm_config_cache: NPM_TEST_CACHE,
  };
}
