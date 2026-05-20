import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

async function writeSkill(skillDir: string, name: string, description: string, body = "", disabled = false): Promise<void> {
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, `SKILL.md${disabled ? ".skill-router-disabled" : ""}`), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
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

test("CLI e2e routes to a disabled Codex skill and records routed usage", async () => {
  const fake = await makeFakeCodexUser();
  try {
    const env = {
      ...process.env,
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "--host=codex", "skills", "disable", "user:agents:lark-mail"], { env });

    const route = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "--host=codex",
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
    assert.match(parsed.selected?.skillMdPath ?? "", /SKILL\.md\.skill-router-disabled$/);

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
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "--host=codex", "skills", "disable", "user:agents:lark-mail"], { env });
    const route = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "--host=codex",
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
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    await execFileAsync(process.execPath, ["--import", "tsx", cli, "--host=codex", "skills", "disable", "user:agents:lark-mail"], { env });
    const badStateDir = join(fake.root, "state-dir-is-a-file");
    await writeFile(badStateDir, "not a directory");

    const route = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "--host=codex",
        "skills",
        "route",
        "--query",
        "draft a Lark mail reply",
        "--json",
      ],
      { env: { ...env, SKILL_ROUTER_STATE_DIR: badStateDir } },
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
      CODEX_HOME: fake.codexHome,
      AGENTS_HOME: fake.agentsHome,
      SKILL_ROUTER_STATE_DIR: fake.stateDir,
    };
    const cli = join(REPO_ROOT, "src", "cli.ts");

    const budget = await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "--host=codex", "skills", "dci", "budget", "--json"],
      { env },
    );
    const parsedBudget = JSON.parse(budget.stdout) as { maxQueries: number; maxSelections: number; maxOpenChars: number };
    assert.equal(parsedBudget.maxQueries, 3);
    assert.equal(parsedBudget.maxSelections, 3);
    assert.equal(parsedBudget.maxOpenChars, 24_000);

    const route = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "--host=codex",
        "skills",
        "route",
        "--mode=lexical",
        "--query",
        "please handle dci-amber-invoice-cascade",
        "--json",
      ],
      { env: { ...env, SKILL_ROUTER_ROUTE_MODE: "dci" } },
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
        "--host=codex",
        "skills",
        "route",
        "--query",
        "please handle dci-amber-invoice-cascade",
        "--no-record",
        "--json",
      ],
      { env: { ...env, SKILL_ROUTER_ROUTE_MODE: "dci" } },
    );
    const parsedEnvDciRoute = JSON.parse(envDciRoute.stdout) as {
      action: string;
      routeMode: string;
      selected: { id: string } | null;
    };
    assert.equal(parsedEnvDciRoute.action, "read-skill-file");
    assert.equal(parsedEnvDciRoute.routeMode, "dci");
    assert.equal(parsedEnvDciRoute.selected?.id, "user:codex:dci-body-probe");

    const dciRoute = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "--host=codex",
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

    const search = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "--host=codex",
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
        "--host=codex",
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
        "--host=codex",
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
        "--host=codex",
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
        "--host=codex",
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
      ["--import", "tsx", cli, "--host=codex", "skills", "dci", "read", bodyProbeRef, "--json"],
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
        "--host=codex",
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
    assert.match(parsedSelect.skillMdPath, /SKILL\.md\.skill-router-disabled$/);

    const rawState = await readFile(join(fake.stateDir, "state-codex.json"), "utf8");
    const state = JSON.parse(rawState) as { routedSkills: Array<{ id: string; routeCount: number; lastQuery: string }> };
    assert.equal(state.routedSkills[0]!.id, "user:codex:dci-body-probe");
    assert.equal(state.routedSkills[0]!.routeCount, 1);
  } finally {
    await fake.cleanup();
  }
});
