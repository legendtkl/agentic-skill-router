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
const NPM_TEST_CACHE = join(tmpdir(), `agentic-skill-router-npm-cache-${process.pid}`);

test("shared router skill uses Agent Skills frontmatter as the source of truth", async () => {
  const shared = await readFile(join(REPO_ROOT, "skills", "agentic-skill-router", "SKILL.md"), "utf8");
  const fm = parseFrontmatter(shared);
  const frontmatter = shared.slice(0, shared.indexOf("---", 4));
  const topLevelKeys = [...frontmatter.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((match) => match[1]);

  assert.equal(fm.name, "agentic-skill-router");
  const description = fm.description;
  assert.ok(typeof description === "string");
  assert.match(description, /First use any clearly matching enabled local\/user Agent Skill/);
  assert.match(description, /generic built-in skill such as browser, Chrome, or web search/);
  assert.match(description, /Examples include Vercel, Netlify, Cloudflare, Render/);
  assert.match(description, /audit, slim, disable, restore, or route/);
  assert.doesNotMatch(description, /MUST be used FIRST|before any other tool/);
  assert.doesNotMatch(description, /For Codex/);
  assert.match(shared, /first use any enabled\s+local Agent Skill that clearly matches/);
  assert.match(shared, /Use this fallback router after enabled local Agent Skills/);
  assert.doesNotMatch(shared, /MUST be used FIRST|before any other tool/);
  assert.deepEqual(topLevelKeys, ["name", "description", "metadata"]);
  assert.match(frontmatter, /metadata:\n  agentic-skill-router\.version: "1"\n  agentic-skill-router\.variant: "L-agentic"\n  agentic-skill-router\.hosts: "claude-code,codex"/);
});

test("plugin packages assemble from one unified skill source", async () => {
  const skillDir = join(REPO_ROOT, "skills", "agentic-skill-router");
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
  assert.match(codexManifest.description, /Route skill-shaped requests to disabled Agent Skills/);
  assert.match(codexManifest.interface.shortDescription, /Route disabled Agent Skills/);
  assert.match(codexManifest.interface.longDescription, /named tools, APIs, services, CLIs, platforms, file formats, datasets, or domain workflows/);
  assert.ok(await pathExists(resolve(REPO_ROOT, "plugins", "claude-code", claudeManifest.skills, "agentic-skill-router", "SKILL.md")));
  assert.ok(await pathExists(resolve(REPO_ROOT, "plugins", "codex", codexManifest.skills, "agentic-skill-router", "SKILL.md")));

  await execFileAsync(process.execPath, ["scripts/generate-assets.mjs", "--check"], { cwd: REPO_ROOT });
});

test("Codex slash command is a thin compatibility shim", async () => {
  const prompt = await readFile(join(REPO_ROOT, "plugins", "codex", "prompts", "agentic-skill-router.md"), "utf8");
  const fm = parseFrontmatter(prompt);

  assert.equal(fm.description, "Use the agentic-skill-router skill with optional arguments.");
  assert.equal(fm["argument-hint"], "[route <query>|list|suggest|status|enable <id...>|disable <id...> --yes]");
  assert.match(prompt, /Invoke\/use the installed `agentic-skill-router` skill/);
  assert.ok(prompt.length < 500);
  assert.doesNotMatch(prompt, /Locate CLI/);
  assert.doesNotMatch(prompt, /skills dci search/);
  assert.doesNotMatch(prompt, /printf '%s\\n'/);
  assert.doesNotMatch(prompt, /Never disable/);
});

test("package bin wrapper resolves npm-style symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-bin-"));
  try {
    const packageRoot = join(root, "pkg");
    const packageBin = join(packageRoot, "bin");
    const packageLib = join(packageRoot, "lib");
    const npmBin = join(root, "node_modules", ".bin");
    await mkdir(packageBin, { recursive: true });
    await mkdir(packageLib, { recursive: true });
    await mkdir(npmBin, { recursive: true });

    await copyFile(
      join(REPO_ROOT, "bin", "agentic-skill-router"),
      join(packageBin, "agentic-skill-router"),
    );
    await chmod(join(packageBin, "agentic-skill-router"), 0o755);
    await writeFile(
      join(packageLib, "agentic-skill-router.mjs"),
      "console.log(JSON.stringify({ argv: process.argv.slice(2) }));\n",
    );
    await symlink("../../pkg/bin/agentic-skill-router", join(npmBin, "agentic-skill-router"));

    const { stdout } = await execFileAsync(join(npmBin, "agentic-skill-router"), ["skills", "list"]);
    assert.deepEqual(JSON.parse(stdout), { argv: ["skills", "list"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("built bin auto-detects installed Codex plugin host from its bundle", async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: REPO_ROOT, env: npmTestEnv(), maxBuffer: 1024 * 1024 });

  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-realpath-bin-"));
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
      join(REPO_ROOT, "bin", "agentic-skill-router"),
      join(packageBin, "agentic-skill-router"),
    );
    await chmod(join(packageBin, "agentic-skill-router"), 0o755);
    await copyFile(
      join(REPO_ROOT, "lib", "agentic-skill-router.mjs"),
      join(packageLib, "agentic-skill-router.mjs"),
    );

    const { stdout } = await execFileAsync(
      join(packageBin, "agentic-skill-router"),
      ["skills", "list", "--json"],
      {
        env: {
          ...process.env,
          HOME: root,
          CODEX_HOME: undefined,
          AGENTS_HOME: undefined,
          AGENTIC_SKILL_ROUTER_HOST: "claude-code",
          AGENTIC_SKILL_ROUTER_STATE_DIR: stateDir,
        },
      },
    );
    const listed = (JSON.parse(stdout) as { skills: Array<{ id: string }> }).skills;
    assert.deepEqual(listed.map((item) => item.id), ["user:codex:marker-priority"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("built bin flushes large JSON output before exit", async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: REPO_ROOT, env: npmTestEnv(), maxBuffer: 1024 * 1024 });

  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-large-json-"));
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
      join(REPO_ROOT, "bin", "agentic-skill-router"),
      ["skills", "list", "--json"],
      {
        env: {
          ...process.env,
          AGENTIC_SKILL_ROUTER_HOST: "codex",
          CODEX_HOME: codexHome,
          AGENTS_HOME: agentsHome,
          AGENTIC_SKILL_ROUTER_STATE_DIR: stateDir,
        },
        maxBuffer: 5 * 1024 * 1024,
      },
    );
    const listed = (JSON.parse(stdout) as { skills: Array<{ id: string }> }).skills;
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
  assert.ok(files.has("bin/agentic-skill-router"));
  assert.ok(files.has("lib/agentic-skill-router.mjs"));
  assert.ok(files.has("skills/agentic-skill-router/SKILL.md"));
  assert.ok(files.has("plugins/codex/prompts/agentic-skill-router.md"));
  assert.ok(files.has("plugins/claude-code/.claude-plugin/plugin.json"));
  assert.ok(files.has("plugins/codex/.codex-plugin/plugin.json"));
  assert.ok(!files.has("bin/agentic-skill-router-skills"));
  assert.ok(!files.has("plugins/codex/prompts/agentic-skill-router-skills.md"));
  assert.ok(!files.has("skills/agentic-skill-router-skills/SKILL.md"));
  assert.ok(!files.has("plugins/codex/skills/agentic-skill-router/SKILL.md"));
  assert.ok(!files.has("plugins/claude-code/skills/agentic-skill-router/SKILL.md"));
});

test("install scripts assemble host entries and shared runtime from unified assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-install-"));
  try {
    const claudeHome = join(root, "claude-home");
    const codexHome = join(root, "codex-home");
    const version = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")).version;
    const claudeInstallPath = join(claudeHome, "plugins", "cache", "local", "agentic-skill-router", version);
    const codexInstallPath = join(codexHome, "plugins", "cache", "local", "agentic-skill-router", version);
    const runtimePath = join(root, ".agentic-skill-router", "runtime", version);

    await execFileAsync(process.execPath, ["scripts/install.mjs"], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: root, CLAUDE_HOME: claudeHome, AGENTIC_SKILL_ROUTER_RUNTIME_ROOT: join(root, ".agentic-skill-router", "runtime") },
      maxBuffer: 1024 * 1024,
    });
    await assertInstalledPlugin(claudeInstallPath, ".claude-plugin/plugin.json");

    const installed = JSON.parse(await readFile(join(claudeHome, "plugins", "installed_plugins.json"), "utf8"));
    assert.equal(installed.plugins["agentic-skill-router@local"][0].installPath, claudeInstallPath);
    await assertInstalledRuntime(runtimePath);

    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: root, CODEX_HOME: codexHome, AGENTIC_SKILL_ROUTER_RUNTIME_ROOT: join(root, ".agentic-skill-router", "runtime") },
      maxBuffer: 1024 * 1024,
    });
    await assertInstalledPlugin(codexInstallPath, ".codex-plugin/plugin.json");
    await assertInstalledRuntime(runtimePath);
    assert.match(await readFile(join(codexHome, "config.toml"), "utf8"), /\[plugins\."agentic-skill-router@local"\]\nenabled = true/);
    assert.ok(await pathExists(join(codexHome, "prompts", "agentic-skill-router.md")));
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
    assert.match(content, /copyRuntimeAssets\(/);
    assert.match(content, /copyPluginAssets\(/);
    assert.match(content, /normalizeManifestSkills/);
    assert.match(content, /writeHostWrapper/);
    assert.doesNotMatch(content, /skipping build/);
    assert.doesNotMatch(content, /existsSync/);
  }
  assert.match(commonLib, /building bundle \(npm run build\)/);
  assert.match(sharedLib, /RUNTIME_ASSET_DIRS = \["bin", "lib"\]/);
  assert.match(sharedLib, /HOST_ENTRY_ASSET_DIRS = \["skills"\]/);
});

async function assertInstalledPlugin(pluginRoot: string, manifestRelativePath: string): Promise<void> {
  assert.ok(await pathExists(join(pluginRoot, "bin", "agentic-skill-router")));
  assert.equal(await pathExists(join(pluginRoot, "lib", "agentic-skill-router.mjs")), false);
  assert.ok(await pathExists(join(pluginRoot, "skills", "agentic-skill-router", "SKILL.md")));

  const manifest = JSON.parse(await readFile(join(pluginRoot, manifestRelativePath), "utf8"));
  assert.equal(manifest.skills, "./skills/");
}

async function assertInstalledRuntime(runtimeRoot: string): Promise<void> {
  assert.ok(await pathExists(join(runtimeRoot, "bin", "agentic-skill-router")));
  assert.ok(await pathExists(join(runtimeRoot, "lib", "agentic-skill-router.mjs")));
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
