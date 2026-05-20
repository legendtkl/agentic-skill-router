import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { CodexHost } from "../src/hosts/codex.ts";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);

async function makeFakeCodexUser(): Promise<{
  root: string;
  codexHome: string;
  agentsHome: string;
  stateDir: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "skill-router-codex-"));
  const codexHome = join(root, ".codex");
  const agentsHome = join(root, ".agents");
  const stateDir = join(root, ".skill-router");

  await writeSkill(join(codexHome, "skills", "brand"), "ckm:brand", "Brand voice and identity");
  await writeSkill(join(codexHome, "skills", "unused-local"), "unused-local", "Never called");
  await writeSkill(join(codexHome, "skills", ".system", "openai-docs"), "openai-docs", "Official OpenAI docs");
  await writeSkill(join(agentsHome, "skills", "lark-mail"), "lark-mail", "Lark mail workflows");

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
    stateDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function writeSkill(skillDir: string, name: string, description: string): Promise<void> {
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`);
}

async function fileExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

test("CodexHost enumerates codex, agents, system, and plugin skills", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const host = new CodexHost({ codexHome: fake.codexHome, agentsHome: fake.agentsHome });
    const skills = await host.listSkills();
    const byId = new Map(skills.map((s) => [s.id, s]));

    assert.equal(byId.get("user:codex:brand")?.name, "ckm:brand");
    assert.equal(byId.get("user:agents:lark-mail")?.description, "Lark mail workflows");
    assert.equal(byId.get("builtin:codex-system:openai-docs")?.canDisable, false);
    assert.equal(byId.get("plugin:gmail@openai-curated:gmail")?.isPluginDisabled, false);
    assert.equal(byId.get("plugin:browser-use@openai-bundled:browser")?.isPluginDisabled, true);
  } finally {
    await fake.cleanup();
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

test("CodexHost disable + enable round-trip on a codex user skill", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const host = new CodexHost({ codexHome: fake.codexHome, agentsHome: fake.agentsHome });
    const brand = (await host.listSkills()).find((s) => s.id === "user:codex:brand");
    assert.ok(brand);

    await host.disable(brand!, "test");
    assert.equal(await fileExists(brand!.skillMdPath), false);
    assert.equal(await fileExists(brand!.skillMdPath + ".skill-router-disabled"), true);

    const disabledBrand = (await host.listSkills()).find((s) => s.id === "user:codex:brand");
    assert.ok(disabledBrand);
    assert.equal(disabledBrand!.isDisabled, true);

    await host.enable(disabledBrand!);
    assert.equal(await fileExists(brand!.skillMdPath), true);
  } finally {
    await fake.cleanup();
  }
});

test("CLI e2e disables, reports, and enables a Codex skill", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    const list = await execFileAsync(process.execPath, ["--import", "tsx", cli, "--host=codex", "skills", "list", "--json"], { env });
    const listed = JSON.parse(list.stdout) as Array<{ id: string; lastUsed: string | null }>;
    assert.ok(listed.some((s) => s.id === "user:codex:brand" && s.lastUsed === "2026-04-20T09:00:00.000Z"));

    const suggest = await execFileAsync(process.execPath, ["--import", "tsx", cli, "--host=codex", "skills", "suggest", "--unused-for=365d", "--json"], { env });
    const suggestions = JSON.parse(suggest.stdout) as Array<{ id: string }>;
    assert.ok(suggestions.some((s) => s.id === "user:codex:unused-local"));
    assert.ok(!suggestions.some((s) => s.id === "builtin:codex-system:openai-docs"));
    assert.ok(!suggestions.some((s) => s.id === "plugin:browser-use@openai-bundled:browser"));

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "--host=codex", "skills", "disable", "user:codex:unused-local"], { env });
    assert.equal(await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md")), false);
    assert.equal(await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md.skill-router-disabled")), true);

    const status = await execFileAsync(process.execPath, ["--import", "tsx", cli, "--host=codex", "skills", "status", "--json"], { env });
    const parsedStatus = JSON.parse(status.stdout) as { disabledCount: number; disabled: Array<{ id: string }> };
    assert.equal(parsedStatus.disabledCount, 1);
    assert.equal(parsedStatus.disabled[0]!.id, "user:codex:unused-local");

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "--host=codex", "skills", "enable", "user:codex:unused-local"], { env });
    assert.equal(await fileExists(join(fake.codexHome, "skills", "unused-local", "SKILL.md")), true);
  } finally {
    await fake.cleanup();
  }
});
