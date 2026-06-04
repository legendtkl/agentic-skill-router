import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { CodexHost } from "../src/hosts/codex.ts";
import { skillInstanceKey } from "../src/state.ts";
import { disableSkill, enableSkill } from "../src/apply.ts";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);

async function makeFakeCodexUser(): Promise<{
  root: string;
  codexHome: string;
  agentsHome: string;
  cwd: string;
  adminSkillsRoot: string;
  stateDir: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-codex-"));
  const codexHome = join(root, ".codex");
  const agentsHome = join(root, ".agents");
  const projectRoot = join(root, "project");
  const cwd = join(projectRoot, "packages", "app");
  const adminSkillsRoot = join(root, "etc", "codex", "skills");
  const stateDir = join(root, ".agentic-skill-router");

  await writeSkill(join(codexHome, "skills", "brand"), "ckm:brand", "Brand voice and identity");
  await writeSkill(join(codexHome, "skills", "unused-local"), "unused-local", "Never called");
  await writeSkill(join(codexHome, "skills", ".system", "openai-docs"), "openai-docs", "Official OpenAI docs");
  await writeSkill(join(agentsHome, "skills", "lark-mail"), "lark-mail", "Lark mail workflows");
  await mkdir(join(projectRoot, ".git"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeSkill(join(projectRoot, ".agents", "skills", "project-root"), "project-root", "Project root skill");
  await writeSkill(join(projectRoot, "packages", ".agents", "skills", "project-package"), "project-package", "Project package skill");
  await writeSkill(join(adminSkillsRoot, "admin-policy"), "admin-policy", "Admin-managed Codex policy");

  const pluginRoot = join(codexHome, "plugins", "cache", "openai-curated", "gmail", "3c463363");
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
  await writeFile(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "gmail", version: "0.1.0", skills: "./skills/" }),
  );
  await writeSkill(join(pluginRoot, "skills", "gmail"), "gmail", "Gmail mailbox workflows");
  await writeSkill(join(pluginRoot, "skills", "gmail-inbox-triage"), "gmail-inbox-triage", "Gmail inbox triage");

  const disabledPluginRoot = join(codexHome, "plugins", "cache", "openai-bundled", "browser-use", "0.1.0");
  await mkdir(join(disabledPluginRoot, ".codex-plugin"), { recursive: true });
  await writeFile(
    join(disabledPluginRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "browser-use", version: "0.1.0", skills: "./skills/" }),
  );
  await writeSkill(join(disabledPluginRoot, "skills", "browser"), "browser", "Browser automation");

  await mkdir(codexHome, { recursive: true });
  await writeFile(
    join(codexHome, "config.toml"),
    [
      '[plugins."gmail@openai-curated"]',
      "enabled = true",
      "",
      '[plugins."browser-use@openai-bundled"]',
      "enabled = false",
      "",
    ].join("\n"),
  );

  const sessionDir = join(codexHome, "sessions", "2026", "04", "20");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "rollout.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-04-20T09:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Using <command-name>ckm:brand</command-name>." },
          ],
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-21T10:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Using <command-name>gmail:gmail</command-name>." },
          ],
        },
      }),
    ].join("\n") + "\n",
  );

  return {
    root,
    codexHome,
    agentsHome,
    cwd,
    adminSkillsRoot,
    stateDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function writeSkill(skillDir: string, name: string, description: string, body = "", disabled = false): Promise<void> {
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, `SKILL.md${disabled ? ".agentic-skill-router-disabled" : ""}`), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
}

async function writeCodexPluginInstall(
  installPath: string,
  opts: { name: string; version?: string; skillName: string; skillDescription: string },
): Promise<void> {
  await mkdir(join(installPath, ".codex-plugin"), { recursive: true });
  const manifest: { name: string; version?: string; skills: string } = { name: opts.name, skills: "./skills/" };
  if (opts.version !== undefined) manifest.version = opts.version;
  await writeFile(
    join(installPath, ".codex-plugin", "plugin.json"),
    JSON.stringify(manifest),
  );
  await writeSkill(join(installPath, "skills", opts.skillName), opts.skillName, opts.skillDescription);
}

async function fileExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

test("CodexHost enumerates codex, agents, system, and plugin skills", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const host = new CodexHost({
      codexHome: fake.codexHome,
      agentsHome: fake.agentsHome,
      cwd: fake.cwd,
      adminSkillsRoot: fake.adminSkillsRoot,
    });
    const skills = await host.listSkills();
    const byId = new Map(skills.map((s) => [s.id, s]));

    assert.equal(byId.get("user:codex:brand")?.name, "ckm:brand");
    assert.equal(byId.get("user:agents:lark-mail")?.description, "Lark mail workflows");
    assert.equal(byId.get("builtin:codex-system:openai-docs")?.canDisable, false);
    assert.equal(byId.get("builtin:codex-admin:admin-policy")?.canDisable, false);
    assert.equal(byId.get("project:codex:.:project-root")?.description, "Project root skill");
    assert.equal(byId.get("project:codex:.:project-root")?.source, "project");
    assert.equal(byId.get("project:codex:packages:project-package")?.description, "Project package skill");
    assert.equal(byId.get("project:codex:packages:project-package")?.source, "project");
    assert.equal(byId.get("plugin:gmail@openai-curated:gmail")?.isPluginDisabled, false);
    assert.equal(byId.get("plugin:browser-use@openai-bundled:browser")?.isPluginDisabled, true);

    const roots = await host.skillRoots();
    assert.ok(roots.includes(fake.adminSkillsRoot));
    assert.ok(roots.some((root) => root.endsWith("project/.agents/skills")));
    assert.ok(roots.some((root) => root.endsWith("project/packages/.agents/skills")));
  } finally {
    await fake.cleanup();
  }
});

test("CodexHost deduplicates cached plugin versions by plugin key", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-codex-cache-"));
  const codexHome = join(root, ".codex");
  const agentsHome = join(root, ".agents");
  const stateDir = join(root, ".agentic-skill-router");
  const oldInstall = join(codexHome, "plugins", "cache", "openai-curated", "gmail", "old-cache");
  const newInstall = join(codexHome, "plugins", "cache", "openai-curated", "gmail", "new-cache");
  const fallbackOldInstall = join(codexHome, "plugins", "cache", "openai-curated", "calendar", "1.0.0");
  const fallbackNewInstall = join(codexHome, "plugins", "cache", "openai-curated", "calendar", "2.0.0");
  try {
    await writeCodexPluginInstall(oldInstall, {
      name: "gmail",
      version: "1.0.0",
      skillName: "gmail",
      skillDescription: "old Gmail workflows",
    });
    await writeCodexPluginInstall(newInstall, {
      name: "gmail",
      version: "2.0.0",
      skillName: "gmail",
      skillDescription: "new Gmail workflows",
    });
    await writeCodexPluginInstall(fallbackOldInstall, {
      name: "calendar",
      version: "1.0.0",
      skillName: "calendar",
      skillDescription: "old Calendar workflows",
    });
    await writeCodexPluginInstall(fallbackNewInstall, {
      name: "calendar",
      skillName: "calendar",
      skillDescription: "new Calendar workflows",
    });

    const host = new CodexHost({
      codexHome,
      agentsHome,
      cwd: root,
      adminSkillsRoot: join(root, "etc", "codex", "skills"),
    });
    const skills = await host.listSkills();
    const gmailSkills = skills.filter((s) => s.id === "plugin:gmail@openai-curated:gmail");
    assert.equal(gmailSkills.length, 1);
    assert.equal(gmailSkills[0]!.description, "new Gmail workflows");
    assert.match(gmailSkills[0]!.skillMdPath, /new-cache/);
    const calendarSkills = skills.filter((s) => s.id === "plugin:calendar@openai-curated:calendar");
    assert.equal(calendarSkills.length, 1);
    assert.equal(calendarSkills[0]!.description, "new Calendar workflows");
    assert.match(calendarSkills[0]!.skillMdPath, /2\.0\.0/);

    const roots = await host.skillRoots();
    assert.ok(roots.includes(join(newInstall, "skills")));
    assert.ok(!roots.includes(join(oldInstall, "skills")));
    assert.ok(roots.includes(join(fallbackNewInstall, "skills")));
    assert.ok(!roots.includes(join(fallbackOldInstall, "skills")));

    const env = {
      ...process.env,
      CODEX_HOME: codexHome,
      AGENTS_HOME: agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: root,
      CODEX_ADMIN_SKILLS_ROOT: join(root, "etc", "codex", "skills"),
      AGENTIC_SKILL_ROUTER_STATE_DIR: stateDir,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");
    const list = await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "list", "--json"], { env });
    const listed = (JSON.parse(list.stdout) as { skills: Array<{ id: string; description: string }> }).skills;
    const listedGmailSkills = listed.filter((s) => s.id === "plugin:gmail@openai-curated:gmail");
    assert.equal(listedGmailSkills.length, 1);
    assert.equal(listedGmailSkills[0]!.description, "new Gmail workflows");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexHost usage stats read recursive Codex sessions", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const host = new CodexHost({ codexHome: fake.codexHome, agentsHome: fake.agentsHome });
    const stats = await host.usageStats();
    assert.equal(stats.get("ckm:brand")?.lastUsed?.toISOString(), "2026-04-20T09:00:00.000Z");
    assert.equal(stats.get("gmail:gmail")?.callCount, 1);
  } finally {
    await fake.cleanup();
  }
});

test("apply.ts disable + enable round-trip on a codex user skill", async () => {
  const fake = await makeFakeCodexUser();
  const statePath = join(fake.stateDir, "state.json");
  try {
    const host = new CodexHost({ codexHome: fake.codexHome, agentsHome: fake.agentsHome });
    const brand = (await host.listSkills()).find((s) => s.id === "user:codex:brand");
    assert.ok(brand);

    await disableSkill(brand!, "test", { statePath, host: host.name });
    assert.equal(await fileExists(brand!.skillMdPath), false);
    assert.equal(await fileExists(brand!.skillMdPath + ".agentic-skill-router-disabled"), true);

    const disabledBrand = (await host.listSkills()).find((s) => s.id === "user:codex:brand");
    assert.ok(disabledBrand);
    assert.equal(disabledBrand!.isDisabled, true);

    await enableSkill(disabledBrand!, { statePath, host: host.name });
    assert.equal(await fileExists(brand!.skillMdPath), true);
  } finally {
    await fake.cleanup();
  }
});

test("CodexHost flags out-of-root symlink skills as canDisable=false across user, plugin, and project roots", async () => {
  const fake = await makeFakeCodexUser();
  const outside = await mkdtemp(join(tmpdir(), "agentic-skill-router-codex-outside-"));
  try {
    // Real skill directories placed entirely outside any Codex skills root.
    // Each is fully valid as a skill, but their SKILL.md must NOT be
    // renamed by agentic-skill-router when reached through an in-root symlink.
    const externUserDir = join(outside, "ext-user");
    await mkdir(externUserDir, { recursive: true });
    await writeFile(join(externUserDir, "SKILL.md"), "---\nname: ext-user\ndescription: outside codex user root\n---\n");
    await symlink(externUserDir, join(fake.codexHome, "skills", "ext-user-link"));

    const externAgentsDir = join(outside, "ext-agents");
    await mkdir(externAgentsDir, { recursive: true });
    await writeFile(join(externAgentsDir, "SKILL.md"), "---\nname: ext-agents\ndescription: outside agents root\n---\n");
    await symlink(externAgentsDir, join(fake.agentsHome, "skills", "ext-agents-link"));

    const externProjectDir = join(outside, "ext-project");
    await mkdir(externProjectDir, { recursive: true });
    await writeFile(join(externProjectDir, "SKILL.md"), "---\nname: ext-project\ndescription: outside project root\n---\n");
    const projectAgentsSkills = join(fake.root, "project", ".agents", "skills");
    await mkdir(projectAgentsSkills, { recursive: true });
    await symlink(externProjectDir, join(projectAgentsSkills, "ext-project-link"));

    const externPluginDir = join(outside, "ext-plugin");
    await mkdir(externPluginDir, { recursive: true });
    await writeFile(join(externPluginDir, "SKILL.md"), "---\nname: ext-plugin\ndescription: outside plugin root\n---\n");
    const pluginSkillsRoot = join(fake.codexHome, "plugins", "cache", "openai-curated", "gmail", "3c463363", "skills");
    await symlink(externPluginDir, join(pluginSkillsRoot, "ext-plugin-link"));

    const host = new CodexHost({
      codexHome: fake.codexHome,
      agentsHome: fake.agentsHome,
      cwd: fake.cwd,
      adminSkillsRoot: fake.adminSkillsRoot,
    });
    const byId = new Map((await host.listSkills()).map((s) => [s.id, s]));

    const checks = [
      "user:codex:ext-user-link",
      "user:agents:ext-agents-link",
      "project:codex:.:ext-project-link",
      "plugin:gmail@openai-curated:ext-plugin-link",
    ];
    for (const id of checks) {
      const s = byId.get(id);
      assert.ok(s, `expected out-of-root symlink skill listed: ${id}`);
      assert.equal(s!.outOfRoot, true, `${id} should be flagged outOfRoot`);
      // The whole point of this fix: bulk policy/suggest paths must not
      // pick these up. canDisable=false is how they get skipped.
      assert.equal(s!.canDisable, false, `${id} must report canDisable=false`);
      const statePath = join(fake.stateDir, `state-${id.replace(/[^a-zA-Z0-9]/g, "_")}.json`);
      await assert.rejects(
        () => disableSkill(s!, "test", { statePath, host: host.name }),
        /resolves outside the skills root/i,
      );
    }
  } finally {
    await rm(outside, { recursive: true, force: true });
    await fake.cleanup();
  }
});

test("CLI e2e disables, reports, and enables a Codex skill", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    const list = await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "list", "--json"], { env });
    const listed = (JSON.parse(list.stdout) as {
      skills: Array<{
        id: string;
        canDisable: boolean;
        description: string;
        lastUsed: string | null;
      }>;
    }).skills;
    assert.ok(listed.some((s) => s.id === "user:codex:brand" && s.lastUsed === "2026-04-20T09:00:00.000Z"));
    assert.ok(listed.some((s) => s.id === "project:codex:.:project-root" && s.description === "Project root skill"));
    assert.ok(
      listed.some((s) => s.id === "project:codex:packages:project-package" && s.description === "Project package skill"),
    );
    assert.ok(listed.some((s) => s.id === "builtin:codex-admin:admin-policy" && s.canDisable === false));

    const suggest = await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "suggest", "--unused-for=365d", "--json"], { env });
    const suggestions = (JSON.parse(suggest.stdout) as { suggestions: Array<{ id: string }> }).suggestions;
    assert.ok(suggestions.some((s) => s.id === "user:codex:unused-local"));
    assert.ok(!suggestions.some((s) => s.id === "builtin:codex-system:openai-docs"));
    assert.ok(!suggestions.some((s) => s.id === "plugin:browser-use@openai-bundled:browser"));

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "disable", "user:codex:unused-local", "--yes"], { env });
    assert.equal(await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md")), false);
    assert.equal(await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md.agentic-skill-router-disabled")), true);

    const status = await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "status", "--json"], { env });
    const parsedStatus = JSON.parse(status.stdout) as { disabledCount: number; disabled: Array<{ id: string }> };
    assert.equal(parsedStatus.disabledCount, 1);
    assert.equal(parsedStatus.disabled[0]!.id, "user:codex:unused-local");

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "enable", "user:codex:unused-local"], { env });
    assert.equal(await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md")), true);
  } finally {
    await fake.cleanup();
  }
});

test("CLI enable refuses to silently pick when two disabled instances share an id", async () => {
  const fake = await makeFakeCodexUser();
  try {
    // Disable the live codex-home instance first via the CLI so we exercise
    // the real disable path and state writer.
    const env = {
      ...process.env,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");
    await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "skills", "disable", "user:codex:unused-local", "--yes"],
      { env },
    );

    // Forge a SECOND disabled record sharing the same id at a different path
    // (the path-shifting upgrade scenario). The state-only resolver should
    // refuse to pick when bare id is passed.
    const statePath = join(fake.stateDir, "state-codex.json");
    const raw = JSON.parse(await readFile(statePath, "utf8")) as {
      schema: number;
      host: string;
      disabledSkills: Array<{
        instanceKey: string;
        id: string;
        pluginKey: string | null;
        skillMdPath: string;
        disabledAt: string;
        reason: string;
      }>;
    };
    assert.equal(raw.disabledSkills.length, 1);
    const original = raw.disabledSkills[0]!;
    const ghostPath = join(fake.codexHome, "skills", "unused-local-stale", "SKILL.md.agentic-skill-router-disabled");
    raw.disabledSkills.push({
      ...original,
      instanceKey: skillInstanceKey("user:codex:unused-local", ghostPath),
      skillMdPath: ghostPath,
      disabledAt: original.disabledAt,
    });
    await writeFile(statePath, JSON.stringify(raw, null, 2) + "\n");

    let err: unknown;
    try {
      await execFileAsync(
        process.execPath,
        ["--import", "tsx", cli, "skills", "enable", "user:codex:unused-local"],
        { env },
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err, "expected ambiguous enable to fail");
    const e = err as { code?: number; stderr?: string };
    assert.equal(e.code, 2);
    const stderr = e.stderr ?? "";
    assert.match(stderr, /ambiguous skill id/i);
    // The remediation hint MUST be the actual supported CLI syntax — a
    // positional instanceKey, NOT a non-existent `--instance-key` flag.
    assert.match(stderr, /agentic-skill-router skills enable /);
    assert.doesNotMatch(stderr, /--instance-key/);

    // Both records survive: nothing was renamed silently.
    const after = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{ id: string }>;
    };
    assert.equal(after.disabledSkills.length, 2);
    assert.equal(
      await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md.agentic-skill-router-disabled")),
      true,
    );
    assert.equal(
      await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md")),
      false,
    );
  } finally {
    await fake.cleanup();
  }
});

test("CLI enable by instanceKey resolves the correct disabled instance", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");
    await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "skills", "disable", "user:codex:unused-local", "--yes"],
      { env },
    );

    const statePath = join(fake.stateDir, "state-codex.json");
    const raw = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{
        instanceKey: string;
        id: string;
        pluginKey: string | null;
        skillMdPath: string;
        disabledAt: string;
        reason: string;
      }>;
    };
    const realKey = raw.disabledSkills[0]!.instanceKey;
    const ghostPath = join(fake.codexHome, "skills", "unused-local-stale", "SKILL.md.agentic-skill-router-disabled");
    // loadState re-derives instanceKey from `(id, skillMdPath)`, so the
    // canonical ghost key is computed from the ghost path.
    const ghostKey = skillInstanceKey("user:codex:unused-local", ghostPath);
    raw.disabledSkills.push({
      ...raw.disabledSkills[0]!,
      instanceKey: ghostKey,
      skillMdPath: ghostPath,
    });
    await writeFile(statePath, JSON.stringify(raw, null, 2) + "\n");

    // Enable via the real instanceKey -> the live skill comes back, and the
    // ghost record survives untouched.
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "skills", "enable", realKey, "--json"],
      { env },
    );
    const result = JSON.parse(stdout) as Array<{ id: string; instanceKey: string; alreadyEnabled: boolean }>;
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, "user:codex:unused-local");
    assert.equal(result[0]!.instanceKey, realKey);
    assert.equal(result[0]!.alreadyEnabled, false);

    assert.equal(
      await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md")),
      true,
    );
    const after = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{ instanceKey: string }>;
    };
    assert.equal(after.disabledSkills.length, 1);
    assert.equal(after.disabledSkills[0]!.instanceKey, ghostKey);
  } finally {
    await fake.cleanup();
  }
});

test("CLI enable JSON reports resolved id and instanceKey on state-only recovery", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");
    await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "skills", "disable", "user:codex:unused-local", "--yes"],
      { env },
    );

    // Simulate "plugin uninstalled, state record left behind": delete both
    // the disabled marker and the skill directory entirely so inventory has
    // no match and cmdEnable must take the state-only recovery path.
    await rm(join(fake.codexHome, "skills", "unused-local"), { recursive: true, force: true });

    const statePath = join(fake.stateDir, "state-codex.json");
    const raw = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<{ instanceKey: string; id: string }>;
    };
    const expectedInstanceKey = raw.disabledSkills[0]!.instanceKey;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "skills", "enable", "user:codex:unused-local", "--json"],
      { env },
    );
    const result = JSON.parse(stdout) as Array<{ id: string; instanceKey: string; alreadyEnabled: boolean }>;
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, "user:codex:unused-local");
    // The critical contract: instanceKey is the resolved record's key, NOT
    // the raw `target` echoed back. With the old code this would have been
    // the literal string "user:codex:unused-local".
    assert.equal(result[0]!.instanceKey, expectedInstanceKey);
    assert.notEqual(result[0]!.instanceKey, "user:codex:unused-local");

    const after = JSON.parse(await readFile(statePath, "utf8")) as {
      disabledSkills: Array<unknown>;
    };
    assert.equal(after.disabledSkills.length, 0);
  } finally {
    await fake.cleanup();
  }
});

test("CLI rejects removed --host flag anywhere in the command", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    delete env.AGENTIC_SKILL_ROUTER_HOST;
    const cli = join(REPO_ROOT, "src", "cli.ts");

    await assert.rejects(
      execFileAsync(
        process.execPath,
        ["--import", "tsx", cli, "skills", "disable", "user:codex:unused-local", "--host=codex"],
        { env },
      ),
      (err: unknown) => {
        const e = err as { code?: number; stderr?: string };
        assert.equal(e.code, 2);
        assert.match(e.stderr ?? "", /--host has been removed/);
        assert.doesNotMatch(e.stderr ?? "", /AGENTIC_SKILL_ROUTER_HOST=codex/);
        return true;
      },
    );
    assert.equal(await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md")), true);
    assert.equal(await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md.agentic-skill-router-disabled")), false);
  } finally {
    await fake.cleanup();
  }
});

test("CLI disable of specific ids requires --yes and does not rename", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");
    const livePath = join(fake.codexHome, "skills", "unused-local", "SKILL.md");
    const disabledPath = `${livePath}.agentic-skill-router-disabled`;

    let err: unknown;
    try {
      await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "disable", "user:codex:unused-local"], { env });
    } catch (caught) {
      err = caught;
    }

    assert.ok(err);
    assert.equal((err as { code?: number }).code, 1);
    assert.match((err as { stderr?: string }).stderr ?? "", /pass --yes to apply/);
    assert.equal(await fileExists(livePath), true);
    assert.equal(await fileExists(disabledPath), false);
  } finally {
    await fake.cleanup();
  }
});

test("CLI refuses to disable Codex admin skills", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    await assert.rejects(
      () => execFileAsync(
        process.execPath,
        ["--import", "tsx", cli, "skills", "disable", "builtin:codex-admin:admin-policy", "--yes"],
        { env },
      ),
      (err: unknown) => {
        assert.match((err as { stderr?: string }).stderr ?? "", /Cannot disable builtin skill/);
        return true;
      },
    );
    assert.equal(await fileExists(join(fake.adminSkillsRoot, "admin-policy", "SKILL.md")), true);
    assert.equal(await fileExists(join(fake.adminSkillsRoot, "admin-policy", "SKILL.md.agentic-skill-router-disabled")), false);
  } finally {
    await fake.cleanup();
  }
});

test("CLI status scans Codex project and admin roots for orphan disabled markers", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const projectRoot = join(fake.root, "project");
    await writeSkill(
      join(projectRoot, ".agents", "skills", "orphan-project"),
      "orphan-project",
      "Project orphan marker",
      "",
      true,
    );
    await writeSkill(
      join(fake.adminSkillsRoot, "orphan-admin"),
      "orphan-admin",
      "Admin orphan marker",
      "",
      true,
    );

    const env = {
      ...process.env,
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    const status = await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "status", "--json"], { env });
    const parsedStatus = JSON.parse(status.stdout) as { orphanMarkers: string[] };
    assert.ok(
      parsedStatus.orphanMarkers.some((p) => p.endsWith("project/.agents/skills/orphan-project/SKILL.md.agentic-skill-router-disabled")),
    );
    assert.ok(
      parsedStatus.orphanMarkers.some((p) => p.endsWith("etc/codex/skills/orphan-admin/SKILL.md.agentic-skill-router-disabled")),
    );
  } finally {
    await fake.cleanup();
  }
});

test("CLI enable cleans disabled state even when skill files disappeared", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "disable", "user:codex:unused-local", "--yes"], { env });
    await rm(join(fake.codexHome, "skills", "unused-local", "SKILL.md.agentic-skill-router-disabled"));

    const enabled = await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "skills", "enable", "user:codex:unused-local", "--json"],
      { env },
    );
    const parsed = JSON.parse(enabled.stdout) as Array<{ id: string }>;
    assert.equal(parsed[0]?.id, "user:codex:unused-local");

    const status = await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "status", "--json"], { env });
    const parsedStatus = JSON.parse(status.stdout) as { disabledCount: number };
    assert.equal(parsedStatus.disabledCount, 0);
  } finally {
    await fake.cleanup();
  }
});


test("CLI e2e routes to a disabled Codex skill and records routed usage", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "disable", "user:agents:lark-mail", "--yes"], { env });

    const route = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "route",
        "--query",
        "draft a Lark mail reply",
        "--json",
      ],
      { env },
    );
    const parsed = JSON.parse(route.stdout) as {
      action: string;
      recorded: boolean;
      selected: { id: string; skillMdPath: string; confidence: string } | null;
    };

    assert.equal(parsed.action, "read-skill-file");
    assert.equal(parsed.recorded, true);
    assert.equal(parsed.selected?.id, "user:agents:lark-mail");
    assert.match(parsed.selected?.skillMdPath ?? "", /SKILL\.md\.agentic-skill-router-disabled$/);
    assert.ok(Array.isArray((parsed.selected as { evidence?: unknown[] } | null)?.evidence));

    const rawState = await readFile(join(fake.stateDir, "state-codex.json"), "utf8");
    const state = JSON.parse(rawState) as { routedSkills: Array<{ id: string; routeCount: number; lastQuery: string }> };
    assert.equal(state.routedSkills[0]!.id, "user:agents:lark-mail");
    assert.equal(state.routedSkills[0]!.routeCount, 1);
    assert.equal(state.routedSkills[0]!.lastQuery, "draft a Lark mail reply");
  } finally {
    await fake.cleanup();
  }
});

test("CLI JSON route reports weak matches without failing or read actions", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "disable", "user:agents:lark-mail", "--yes"], { env });
    const route = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "route",
        "--query",
        "task calendar approval mail",
        "--json",
      ],
      { env },
    );
    const parsed = JSON.parse(route.stdout) as {
      action: string;
      selected: unknown;
      matches: Array<{ id: string; confidence: string; action?: string }>;
    };

    assert.equal(parsed.action, "no-confident-match");
    assert.equal(parsed.selected, null);
    assert.equal(parsed.matches[0]?.id, "user:agents:lark-mail");
    assert.equal(parsed.matches[0]?.confidence, "low");
    assert.equal(parsed.matches[0]?.action, undefined);
  } finally {
    await fake.cleanup();
  }
});

test("CLI route still returns a selected skill when routed usage cannot be recorded", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "skills", "disable", "user:agents:lark-mail", "--yes"], { env });
    const badStateDir = join(fake.root, "state-dir-is-a-file");
    await writeFile(badStateDir, "not a directory");

    const route = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "route",
        "--query",
        "draft a Lark mail reply",
        "--json",
      ],
      { env: { ...env, AGENTIC_SKILL_ROUTER_STATE_DIR: badStateDir } },
    );
    const parsed = JSON.parse(route.stdout) as {
      action: string;
      recorded: boolean;
      warnings: string[];
      selected: { id: string; action: string } | null;
    };

    assert.equal(parsed.action, "read-skill-file");
    assert.equal(parsed.recorded, false);
    assert.equal(parsed.selected?.id, "user:agents:lark-mail");
    assert.equal(parsed.selected?.action, "read-skill-file");
    assert.match(route.stderr, /warning: routed usage was not recorded/);
    assert.match(parsed.warnings[0] ?? "", /routed usage was not recorded/);
  } finally {
    await fake.cleanup();
  }
});

test("CLI e2e DCI searches, reads, and selects a disabled Codex skill from a larger corpus", async () => {
  const fake = await makeFakeCodexUser();
  try {
    for (let i = 0; i < 120; i++) {
      await writeSkill(
        join(fake.codexHome, "skills", `dci-noise-${String(i).padStart(3, "0")}`),
        `dci-noise-${String(i).padStart(3, "0")}`,
        `Generic disabled ${["mail", "calendar", "task", "approval"][i % 4]} helper`,
        "This disabled skill is corpus noise for DCI routing tests.",
        true,
      );
    }
    await writeSkill(
      join(fake.codexHome, "skills", "dci-body-probe"),
      "dci-body-probe",
      "Generic disabled helper",
      [
        "Use this skill only when the request mentions dci-amber-invoice-cascade.",
        "When loaded, final answer must be exactly dci-amber-invoice-loaded.",
      ].join("\n"),
      true,
    );

    const env = {
      ...process.env,
      AGENTIC_SKILL_ROUTER_HOST: "codex",
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      AGENTIC_SKILL_ROUTER_CWD: fake.cwd,
      CODEX_ADMIN_SKILLS_ROOT: fake.adminSkillsRoot,
      AGENTIC_SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    const budget = await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "skills", "dci", "budget", "--json"],
      { env },
    );
    const parsedBudget = JSON.parse(budget.stdout) as {
      maxQueries: number;
      maxSelections: number;
      maxOpenChars: number;
      maxSkillBytes: number;
      maxCorpusBytes: number;
    };
    assert.equal(parsedBudget.maxQueries, 3);
    assert.equal(parsedBudget.maxSelections, 3);
    assert.equal(parsedBudget.maxOpenChars, 24_000);
    assert.equal(parsedBudget.maxSkillBytes, 64_000);
    assert.equal(parsedBudget.maxCorpusBytes, 1_000_000);

    const route = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "route",
        "--mode=lexical",
        "--query",
        "please handle dci-amber-invoice-cascade",
        "--json",
      ],
      { env: { ...env, AGENTIC_SKILL_ROUTER_ROUTE_MODE: "dci" } },
    );
    const parsedLexicalRoute = JSON.parse(route.stdout) as { action: string; routeMode: string };
    assert.equal(parsedLexicalRoute.action, "no-confident-match");
    assert.equal(parsedLexicalRoute.routeMode, "lexical");

    const envDciRoute = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "route",
        "--query",
        "please handle dci-amber-invoice-cascade",
        "--no-record",
        "--json",
      ],
      { env: { ...env, AGENTIC_SKILL_ROUTER_ROUTE_MODE: "dci" } },
    );
    const parsedEnvDciRoute = JSON.parse(envDciRoute.stdout) as {
      action: string;
      routeMode: string;
      selected: { id: string } | null;
    };
    assert.equal(parsedEnvDciRoute.action, "read-skill-file");
    assert.equal(parsedEnvDciRoute.routeMode, "dci");
    assert.equal(parsedEnvDciRoute.selected?.id, "user:codex:dci-body-probe");

    const metadataRoute = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "route",
        "--mode=metadata",
        "--query",
        "generic disabled invoice helper",
        "--no-record",
        "--json",
      ],
      { env },
    );
    const parsedMetadataRoute = JSON.parse(metadataRoute.stdout) as {
      action: string;
      routeMode: string;
      matches: Array<{ id: string; evidence: unknown[] }>;
    };
    assert.equal(parsedMetadataRoute.routeMode, "metadata");
    assert.equal(parsedMetadataRoute.matches[0]?.id, "user:codex:dci-body-probe");
    assert.ok(Array.isArray(parsedMetadataRoute.matches[0]?.evidence));

    const dciRoute = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "route",
        "--mode=dci",
        "--query",
        "please handle dci-amber-invoice-cascade",
        "--no-record",
        "--json",
      ],
      { env },
    );
    const parsedDciRoute = JSON.parse(dciRoute.stdout) as {
      action: string;
      routeMode: string;
      selected: { id: string } | null;
    };
    assert.equal(parsedDciRoute.action, "read-skill-file");
    assert.equal(parsedDciRoute.routeMode, "dci");
    assert.equal(parsedDciRoute.selected?.id, "user:codex:dci-body-probe");

    const bodyRoute = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "route",
        "--mode=body",
        "--query",
        "please handle dci-amber-invoice-cascade",
        "--no-record",
        "--json",
      ],
      { env },
    );
    const parsedBodyRoute = JSON.parse(bodyRoute.stdout) as {
      action: string;
      routeMode: string;
      selected: { id: string } | null;
    };
    assert.equal(parsedBodyRoute.action, "read-skill-file");
    assert.equal(parsedBodyRoute.routeMode, "body");
    assert.equal(parsedBodyRoute.selected?.id, "user:codex:dci-body-probe");

    const search = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "dci",
        "search",
        "--query",
        "generic disabled invoice helper",
        "--query",
        "please handle dci-amber-invoice-cascade",
        "--json",
      ],
      { env },
    );
    const parsedSearch = JSON.parse(search.stdout) as {
      action: string;
      queries: string[];
      corpus: { scanned: number };
      matches: Array<{ ref: string; id: string; snippets: Array<{ line: number; text: string }> }>;
    };
    assert.equal(parsedSearch.action, "inspect-or-read-candidates");
    assert.deepEqual(parsedSearch.queries, ["generic disabled invoice helper", "please handle dci-amber-invoice-cascade"]);
    assert.ok(parsedSearch.corpus.scanned >= 121);
    assert.equal(parsedSearch.matches[0]?.id, "user:codex:dci-body-probe");
    assert.match(parsedSearch.matches[0]?.ref ?? "", /^dci-[a-f0-9]{10}$/);
    assert.ok(parsedSearch.matches[0]?.snippets.some((s) => /dci-amber-invoice-cascade/.test(s.text)));
    const bodyProbeRef = parsedSearch.matches[0]!.ref;

    const literalGrep = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "dci",
        "grep",
        "--pattern",
        "dci-.*-cascade",
        "--json",
      ],
      { env },
    );
    const parsedLiteralGrep = JSON.parse(literalGrep.stdout) as { mode: string; matches: unknown[] };
    assert.equal(parsedLiteralGrep.mode, "literal");
    assert.equal(parsedLiteralGrep.matches.length, 0);

    const regexGrep = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "dci",
        "grep",
        "--pattern",
        "dci-.*-cascade",
        "--regex",
        "--json",
      ],
      { env },
    );
    const parsedRegexGrep = JSON.parse(regexGrep.stdout) as { mode: string; matches: Array<{ id: string }> };
    assert.equal(parsedRegexGrep.mode, "regex");
    assert.equal(parsedRegexGrep.matches[0]?.id, "user:codex:dci-body-probe");

    const find = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "dci",
        "find",
        bodyProbeRef,
        "--pattern",
        "final answer",
        "--json",
      ],
      { env },
    );
    const parsedFind = JSON.parse(find.stdout) as { id: string; snippets: Array<{ line: number; text: string }> };
    assert.equal(parsedFind.id, "user:codex:dci-body-probe");
    assert.match(parsedFind.snippets[0]?.text ?? "", /final answer/);

    const open = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "dci",
        "open",
        bodyProbeRef,
        "--line",
        String(parsedFind.snippets[0]!.line),
        "--window=4",
        "--json",
      ],
      { env },
    );
    const parsedOpen = JSON.parse(open.stdout) as { id: string; action: string; content: string };
    assert.equal(parsedOpen.action, "read-skill-window");
    assert.equal(parsedOpen.id, "user:codex:dci-body-probe");
    assert.match(parsedOpen.content, /dci-amber-invoice-loaded/);

    const read = await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "skills", "dci", "read", bodyProbeRef, "--json"],
      { env },
    );
    const parsedRead = JSON.parse(read.stdout) as { action: string; content: string };
    assert.equal(parsedRead.action, "read-skill-file");
    assert.match(parsedRead.content, /dci-amber-invoice-loaded/);

    const select = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "skills",
        "dci",
        "select",
        bodyProbeRef,
        "--query",
        "please handle dci-amber-invoice-cascade",
        "--confidence=high",
        "--reason",
        "DCI search and read matched the unique probe instruction",
        "--json",
      ],
      { env },
    );
    const parsedSelect = JSON.parse(select.stdout) as {
      action: string;
      recorded: boolean;
      id: string;
      selected: Array<{ id: string }>;
      skillMdPath: string;
    };
    assert.equal(parsedSelect.action, "read-skill-file");
    assert.equal(parsedSelect.recorded, true);
    assert.equal(parsedSelect.id, "user:codex:dci-body-probe");
    assert.equal(parsedSelect.selected[0]?.id, "user:codex:dci-body-probe");
    assert.match(parsedSelect.skillMdPath, /SKILL\.md\.agentic-skill-router-disabled$/);

    const rawState = await readFile(join(fake.stateDir, "state-codex.json"), "utf8");
    const state = JSON.parse(rawState) as { routedSkills: Array<{ id: string; routeCount: number; lastQuery: string }> };
    assert.equal(state.routedSkills[0]!.id, "user:codex:dci-body-probe");
    assert.equal(state.routedSkills[0]!.routeCount, 1);
  } finally {
    await fake.cleanup();
  }
});

test("CodexHost does not expose disable/enable", async () => {
  // Mirror of the ClaudeCodeHost guard: keep disable/enable funneled through
  // apply.ts so the state machine (journal, lock, conflict/reapply) cannot be
  // bypassed by renaming SKILL.md directly through a host method.
  const fake = await makeFakeCodexUser();
  try {
    const host = new CodexHost({ codexHome: fake.codexHome, agentsHome: fake.agentsHome });
    assert.equal("disable" in host, false, "CodexHost must not expose `disable`");
    assert.equal("enable" in host, false, "CodexHost must not expose `enable`");
    assert.equal(
      typeof (host as unknown as { disable?: unknown }).disable,
      "undefined",
      "CodexHost.disable must not be a function",
    );
    assert.equal(
      typeof (host as unknown as { enable?: unknown }).enable,
      "undefined",
      "CodexHost.enable must not be a function",
    );
  } finally {
    await fake.cleanup();
  }
});

test("CodexHost memoizes plugin marketplace enumeration within a single host", async () => {
  // Regression for issue #113: every host.listSkills() call used to re-walk
  // ~/.codex/plugins/cache/*/*/*. We now cache the installed-plugins result
  // per host instance, keyed by the marketplace cache root's mtime+size, and
  // only re-scan when that key changes (i.e. a top-level marketplace or
  // plugin dir was added/removed).
  const fake = await makeFakeCodexUser();
  try {
    // Pin the cache root mtime to a known whole-second value so we can later
    // restore it exactly (utimes() rounds to seconds on most filesystems,
    // which would otherwise drift the cache key off the original fractional
    // mtimeMs the host saw on the first listSkills call).
    const cacheRoot = join(fake.codexHome, "plugins", "cache");
    const pinned = new Date(Math.floor(Date.now() / 1000) * 1000);
    await utimes(cacheRoot, pinned, pinned);

    const host = new CodexHost({
      codexHome: fake.codexHome,
      agentsHome: fake.agentsHome,
      cwd: fake.cwd,
      adminSkillsRoot: fake.adminSkillsRoot,
    });

    const first = await host.listSkills();
    const firstGmail = first.find((s) => s.id === "plugin:gmail@openai-curated:gmail");
    assert.ok(firstGmail, "expected gmail plugin skill on the first listSkills call");
    assert.equal(firstGmail!.description, "Gmail mailbox workflows");

    // Mutate the manifest deep inside the cache. The cache root's own
    // mtime should NOT change from a nested file write, so the memoized
    // installed-plugins result must be reused. To make the test robust to
    // filesystems where the parent mtime could drift, we explicitly restore
    // the pinned cache root mtime after the manifest write.
    const manifestPath = join(
      fake.codexHome,
      "plugins",
      "cache",
      "openai-curated",
      "gmail",
      "3c463363",
      ".codex-plugin",
      "plugin.json",
    );
    const originalManifest = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({ name: "gmail", version: "0.1.0", skills: "./other-skills/" }),
    );
    try {
      await utimes(cacheRoot, pinned, pinned);

      const second = await host.listSkills();
      const secondGmail = second.find((s) => s.id === "plugin:gmail@openai-curated:gmail");
      assert.ok(secondGmail, "memoized scan must still resolve the gmail plugin");
      // If the cache were bypassed, the new manifest would point at
      // ./other-skills/ and the gmail skill would no longer be enumerated
      // under the old skillMdPath.
      assert.equal(secondGmail!.skillMdPath, firstGmail!.skillMdPath);
    } finally {
      await writeFile(manifestPath, originalManifest);
    }

    // Now add a brand new marketplace at the top level. That changes the
    // cache root's mtime+size, which MUST invalidate the memo and let the
    // newly installed plugin surface on the next listSkills call.
    const newPluginRoot = join(
      fake.codexHome,
      "plugins",
      "cache",
      "openai-curated-extra",
      "calendar",
      "1.2.3",
    );
    await writeCodexPluginInstall(newPluginRoot, {
      name: "calendar",
      version: "1.2.3",
      skillName: "calendar",
      skillDescription: "Calendar workflows installed after the first scan",
    });

    const third = await host.listSkills();
    const thirdCalendar = third.find((s) => s.id === "plugin:calendar@openai-curated-extra:calendar");
    assert.ok(
      thirdCalendar,
      "mtime change on the marketplace cache root must invalidate the memo and surface the new plugin",
    );
    assert.equal(thirdCalendar!.description, "Calendar workflows installed after the first scan");
  } finally {
    await fake.cleanup();
  }
});

test("CodexHost memo invalidates when a new plugin appears under an existing marketplace", async () => {
  // Regression for the P1 follow-up on issue #113: a plugin installed under
  // an existing marketplace directory (e.g. `openai-curated/calendar/1.2.3`
  // when `openai-curated/gmail/...` already exists) only bumps THAT
  // marketplace dir's mtime, not the cache root's. The composite cache key
  // must fold each marketplace child's mtime+size in so we detect the new
  // plugin on the next listSkills() call.
  const fake = await makeFakeCodexUser();
  try {
    const host = new CodexHost({
      codexHome: fake.codexHome,
      agentsHome: fake.agentsHome,
      cwd: fake.cwd,
      adminSkillsRoot: fake.adminSkillsRoot,
    });

    const first = await host.listSkills();
    assert.ok(
      first.some((s) => s.id === "plugin:gmail@openai-curated:gmail"),
      "expected the prefab gmail plugin to be present on the first call",
    );
    assert.equal(
      first.some((s) => s.id === "plugin:calendar@openai-curated:calendar"),
      false,
      "calendar plugin should not exist yet",
    );

    // Drop the new plugin under the SAME `openai-curated` marketplace that
    // already exists. The cache root's own mtime does not change here on a
    // typical filesystem (we only created a deeper child), so the per-
    // marketplace stat is what must carry the signal.
    const newPluginRoot = join(
      fake.codexHome,
      "plugins",
      "cache",
      "openai-curated",
      "calendar",
      "1.2.3",
    );
    await writeCodexPluginInstall(newPluginRoot, {
      name: "calendar",
      version: "1.2.3",
      skillName: "calendar",
      skillDescription: "Calendar workflows added under an existing marketplace",
    });

    const second = await host.listSkills();
    const newCalendar = second.find((s) => s.id === "plugin:calendar@openai-curated:calendar");
    assert.ok(
      newCalendar,
      "memo must invalidate when a marketplace child's mtime changes from a new plugin install",
    );
    assert.equal(
      newCalendar!.description,
      "Calendar workflows added under an existing marketplace",
    );
  } finally {
    await fake.cleanup();
  }
});
