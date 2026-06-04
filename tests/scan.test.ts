import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, cp, realpath, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ClaudeCodeHost } from "../src/hosts/claude-code.ts";
import { disableSkill, enableSkill } from "../src/apply.ts";
import { readSkillFrontmatterBlock, readSkillFrontmatterDetailed, walkSkillsDir } from "../src/scan.ts";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const FIXTURE_SKILLS = join(__dirname, "fixtures/skills");

async function makeFakeClaudeHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "agentic-skill-router-home-"));
  // Fake user-level skills root
  await mkdir(join(home, "skills"), { recursive: true });
  await cp(FIXTURE_SKILLS, join(home, "skills"), { recursive: true });

  // Fake plugin install: one plugin "myplugin@official" with two skills:
  //  - keep      (enabled)
  //  - drop      (disabled by us)
  const pluginPath = join(home, "plugins/cache/official/myplugin/1.0.0");
  await mkdir(join(pluginPath, "skills/keep"), { recursive: true });
  await writeFile(
    join(pluginPath, "skills/keep/SKILL.md"),
    "---\nname: keep\ndescription: should appear\n---\n",
  );
  await mkdir(join(pluginPath, "skills/drop"), { recursive: true });
  await writeFile(
    join(pluginPath, "skills/drop/SKILL.md.agentic-skill-router-disabled"),
    "---\nname: drop\ndescription: should appear as disabled\n---\n",
  );

  // installed_plugins.json
  await mkdir(join(home, "plugins"), { recursive: true });
  await writeFile(
    join(home, "plugins/installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "myplugin@official": [
          { scope: "user", installPath: pluginPath, version: "1.0.0", installedAt: "2026-01-01T00:00:00Z" },
        ],
      },
    }),
  );

  // settings.json with the plugin enabled
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({ enabledPlugins: { "myplugin@official": true } }),
  );

  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

async function makeFakeProject(): Promise<{ root: string; cwd: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-project-"));
  const cwd = join(root, "packages", "app");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(join(root, ".claude", "skills", "root-skill"), { recursive: true });
  await writeFile(
    join(root, ".claude", "skills", "root-skill", "SKILL.md"),
    "---\nname: root-skill\ndescription: root project skill\n---\n",
  );
  await mkdir(join(root, "packages", ".claude", "skills", "package-skill"), { recursive: true });
  await writeFile(
    join(root, "packages", ".claude", "skills", "package-skill", "SKILL.md"),
    "---\nname: package-skill\ndescription: nested project skill\n---\n",
  );
  return { root, cwd, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("listSkills enumerates user, plugin, and builtin sources", async () => {
  const { home, cleanup } = await makeFakeClaudeHome();
  try {
    const host = new ClaudeCodeHost({ claudeHome: home });
    const skills = await host.listSkills();
    const byId = new Map(skills.map((s) => [s.id, s]));

    // User-level fixtures: foo (live), bar (live), zap-disabled (disabled)
    assert.equal(byId.get("user:foo")?.isDisabled, false);
    assert.equal(byId.get("user:foo")?.description, "A test skill named foo");
    assert.equal(byId.get("user:bar")?.description, "飞书 — bar with quoted Chinese");
    const zap = byId.get("user:zap-disabled");
    assert.ok(zap, "zap-disabled skill should be listed");
    assert.equal(zap!.isDisabled, true);
    assert.match(zap!.skillMdPath, /SKILL\.md\.agentic-skill-router-disabled$/);

    // Plugin skills
    const keep = byId.get("plugin:myplugin@official:keep");
    assert.ok(keep);
    assert.equal(keep!.source, "plugin");
    assert.equal(keep!.pluginKey, "myplugin@official");
    assert.equal(keep!.isDisabled, false);
    assert.equal(keep!.isPluginDisabled, false);

    const drop = byId.get("plugin:myplugin@official:drop");
    assert.ok(drop);
    assert.equal(drop!.isDisabled, true);

    // Built-ins are present and not disable-able
    const init = byId.get("builtin:init");
    assert.ok(init);
    assert.equal(init!.canDisable, false);
    assert.equal(init!.source, "builtin");
  } finally {
    await cleanup();
  }
});

test("listSkills enumerates Claude project skill roots from cwd to repo root", async () => {
  const { home, cleanup: cleanupHome } = await makeFakeClaudeHome();
  const { cwd, cleanup: cleanupProject } = await makeFakeProject();
  try {
    const host = new ClaudeCodeHost({ claudeHome: home, cwd });
    const skills = await host.listSkills();
    const byId = new Map(skills.map((s) => [s.id, s]));

    assert.equal(byId.get("project:claude:.:root-skill")?.description, "root project skill");
    assert.equal(byId.get("project:claude:.:root-skill")?.source, "project");
    assert.equal(byId.get("project:claude:packages:package-skill")?.description, "nested project skill");
    assert.equal(byId.get("project:claude:packages:package-skill")?.source, "project");

    const roots = await host.skillRoots();
    assert.ok(roots.some((root) => root.endsWith(".claude/skills")));
  } finally {
    await cleanupProject();
    await cleanupHome();
  }
});

test("CLI list --json discovers Claude project skill roots from AGENTIC_SKILL_ROUTER_CWD", async () => {
  const { home, cleanup: cleanupHome } = await makeFakeClaudeHome();
  const { cwd, cleanup: cleanupProject } = await makeFakeProject();
  try {
    const cli = join(REPO_ROOT, "src", "cli.ts");
    const result = await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "skills", "list", "--json"],
      {
        env: {
          ...process.env,
          CLAUDE_HOME: home,
          AGENTIC_SKILL_ROUTER_CWD: cwd,
        },
      },
    );
    const listed = (JSON.parse(result.stdout) as { skills: Array<{ id: string; description: string; source: string }> }).skills;

    assert.ok(
      listed.some(
        (s) => s.id === "project:claude:.:root-skill" && s.description === "root project skill" && s.source === "project",
      ),
    );
    assert.ok(
      listed.some(
        (s) =>
          s.id === "project:claude:packages:package-skill" &&
          s.description === "nested project skill" &&
          s.source === "project",
      ),
    );
  } finally {
    await cleanupProject();
    await cleanupHome();
  }
});

test("plugin disabled in enabledPlugins surfaces as isPluginDisabled", async () => {
  const { home, cleanup } = await makeFakeClaudeHome();
  try {
    // Override settings to disable the plugin
    await writeFile(
      join(home, "settings.json"),
      JSON.stringify({ enabledPlugins: { "myplugin@official": false } }),
    );
    const host = new ClaudeCodeHost({ claudeHome: home });
    const skills = await host.listSkills();
    const keep = skills.find((s) => s.id === "plugin:myplugin@official:keep");
    assert.ok(keep);
    assert.equal(keep!.isPluginDisabled, true);
  } finally {
    await cleanup();
  }
});

test("disable + enable round-trip on a user skill", async () => {
  const { home, cleanup } = await makeFakeClaudeHome();
  const statePath = join(home, "agentic-skill-router-state.json");
  try {
    const host = new ClaudeCodeHost({ claudeHome: home });
    const skills = await host.listSkills();
    const foo = skills.find((s) => s.id === "user:foo");
    assert.ok(foo);
    await disableSkill(foo!, "test", { statePath, host: host.name });

    const after = await host.listSkills();
    const fooAfter = after.find((s) => s.id === "user:foo");
    assert.ok(fooAfter);
    assert.equal(fooAfter!.isDisabled, true);

    await enableSkill(fooAfter!, { statePath, host: host.name });
    const final = await host.listSkills();
    const fooFinal = final.find((s) => s.id === "user:foo");
    assert.equal(fooFinal!.isDisabled, false);
  } finally {
    await cleanup();
  }
});

test("disable on builtin skill throws", async () => {
  const { home, cleanup } = await makeFakeClaudeHome();
  const statePath = join(home, "agentic-skill-router-state.json");
  try {
    const host = new ClaudeCodeHost({ claudeHome: home });
    const skills = await host.listSkills();
    const init = skills.find((s) => s.id === "builtin:init");
    assert.ok(init);
    await assert.rejects(
      () => disableSkill(init!, "x", { statePath, host: host.name }),
      /Cannot disable builtin/,
    );
  } finally {
    await cleanup();
  }
});

test("symlink skill whose target is outside the skills root is marked outOfRoot and cannot be disabled", async () => {
  const { home, cleanup } = await makeFakeClaudeHome();
  // Build a directory entirely outside the skills root to host the link
  // target. The skill directory under the link target is a fully valid
  // skill, but it lives outside the user's ~/.claude/skills tree, so
  // agentic-skill-router must refuse to rename SKILL.md through it.
  const outside = await mkdtemp(join(tmpdir(), "agentic-skill-router-outside-"));
  try {
    const externalSkill = join(outside, "external-skill");
    await mkdir(externalSkill, { recursive: true });
    const externalMd = join(externalSkill, "SKILL.md");
    await writeFile(externalMd, "---\nname: external\ndescription: outside the root\n---\n");

    // Place a symlink inside the user skills root that points to the
    // external skill directory.
    await symlink(externalSkill, join(home, "skills", "external"));

    const host = new ClaudeCodeHost({ claudeHome: home });
    const skills = await host.listSkills();
    const external = skills.find((s) => s.id === "user:external");
    assert.ok(external, "external symlink skill should still be listed for visibility");
    assert.equal(external!.outOfRoot, true, "out-of-root symlink should be flagged");
    assert.equal(external!.isDisabled, false);
    // Out-of-root symlinks must also report canDisable === false so that
    // policy/suggestion bulk paths skip them instead of attempting a rename
    // that the host would reject mid-batch.
    assert.equal(external!.canDisable, false, "out-of-root symlink must report canDisable=false");

    const statePath = join(home, "agentic-skill-router-state.json");
    // apply.ts disable refuses with a clear error
    await assert.rejects(
      () => disableSkill(external!, "test", { statePath, host: host.name }),
      /resolves outside the skills root/i,
    );
    // apply.ts enable also refuses
    await assert.rejects(
      () => enableSkill(external!, { statePath, host: host.name }),
      /resolves outside the skills root/i,
    );

    // The external SKILL.md is still untouched on disk.
    assert.equal((await readFile(externalMd, "utf8")).startsWith("---"), true);
  } finally {
    await rm(outside, { recursive: true, force: true });
    await cleanup();
  }
});

test("symlink skill whose target is inside the same skills root remains disable-able", async () => {
  const { home, cleanup } = await makeFakeClaudeHome();
  const statePath = join(home, "agentic-skill-router-state.json");
  try {
    // Create a real skill directory under the user skills root, then symlink
    // it under a second name. The symlink target IS inside the skills root,
    // so disable should be allowed (renaming the underlying SKILL.md is a
    // user-scoped mutation, not an escape).
    const realDir = join(home, "skills", "inside-real");
    await mkdir(realDir, { recursive: true });
    const realMd = join(realDir, "SKILL.md");
    await writeFile(realMd, "---\nname: inside-real\ndescription: inside the root\n---\n");
    await symlink(realDir, join(home, "skills", "inside-link"));

    const host = new ClaudeCodeHost({ claudeHome: home });
    const skills = await host.listSkills();
    const linked = skills.find((s) => s.id === "user:inside-link");
    assert.ok(linked, "in-root symlink skill should be listed");
    assert.notEqual(linked!.outOfRoot, true, "in-root symlink should NOT be flagged out-of-root");
    assert.equal(linked!.canDisable, true, "in-root symlink should remain disable-able");

    // apply.ts can still disable a regular in-root skill the normal way.
    const real = skills.find((s) => s.id === "user:inside-real");
    assert.ok(real);
    await disableSkill(real!, "test", { statePath, host: host.name });
  } finally {
    await cleanup();
  }
});

test("Host interface does not expose disable/enable", async () => {
  // Guard against accidentally re-introducing a host-level rename path that
  // bypasses apply.ts's state machine (journal, lock, conflict/reapply).
  // Disable/enable must funnel through src/apply.ts so the state file stays
  // the single source of truth and safety checks cannot be sidestepped.
  const { home, cleanup } = await makeFakeClaudeHome();
  try {
    const host = new ClaudeCodeHost({ claudeHome: home });
    assert.equal("disable" in host, false, "Host must not expose `disable`");
    assert.equal("enable" in host, false, "Host must not expose `enable`");
    assert.equal(
      typeof (host as unknown as { disable?: unknown }).disable,
      "undefined",
      "Host.disable must not be a function",
    );
    assert.equal(
      typeof (host as unknown as { enable?: unknown }).enable,
      "undefined",
      "Host.enable must not be a function",
    );
  } finally {
    await cleanup();
  }
});

test("listSkills attaches frontmatterWarnings for nested mappings", async () => {
  const home = await mkdtemp(join(tmpdir(), "agentic-skill-router-nested-fm-"));
  try {
    await mkdir(join(home, "skills", "nested-meta"), { recursive: true });
    await writeFile(
      join(home, "skills", "nested-meta", "SKILL.md"),
      [
        "---",
        "name: nested-meta",
        "description: has unsupported nested mapping",
        "metadata:",
        "  routing:",
        "    aliases:",
        "      -飞书邮箱",
        "tags: [feishu]",
        "---",
        "",
      ].join("\n"),
    );
    await mkdir(join(home, "skills", "clean-meta"), { recursive: true });
    await writeFile(
      join(home, "skills", "clean-meta", "SKILL.md"),
      "---\nname: clean-meta\ndescription: no nested mapping\n---\n",
    );

    const host = new ClaudeCodeHost({ claudeHome: home });
    const skills = await host.listSkills();
    const nested = skills.find((s) => s.id === "user:nested-meta");
    const clean = skills.find((s) => s.id === "user:clean-meta");
    assert.ok(nested);
    assert.ok(clean);
    assert.ok(nested!.frontmatterWarnings && nested!.frontmatterWarnings.length === 1);
    assert.match(nested!.frontmatterWarnings![0]!, /skipped nested mapping under `metadata`/);
    assert.equal(clean!.frontmatterWarnings, undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("readSkillFrontmatterDetailed stops after closed frontmatter", async () => {
  const home = await mkdtemp(join(tmpdir(), "agentic-skill-router-frontmatter-prefix-"));
  try {
    const skillDir = join(home, "skills", "frontmatter-prefix");
    await mkdir(skillDir, { recursive: true });
    const skillPath = join(skillDir, "SKILL.md");
    await writeFile(
      skillPath,
      [
        "---",
        "name: frontmatter-prefix",
        "description: metadata only",
        "---",
        "",
        "BODY_SENTINEL_SHOULD_NOT_BE_READ",
        "x".repeat(256_000),
      ].join("\n"),
    );

    const block = await readSkillFrontmatterBlock(skillPath);
    assert.match(block, /description: metadata only/);
    assert.doesNotMatch(block, /BODY_SENTINEL_SHOULD_NOT_BE_READ/);

    const { metadata } = await readSkillFrontmatterDetailed(skillPath);
    assert.equal(metadata.name, "frontmatter-prefix");
    assert.equal(metadata.description, "metadata only");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("CLI list --json surfaces frontmatterWarnings only when non-empty", async () => {
  const home = await mkdtemp(join(tmpdir(), "agentic-skill-router-nested-fm-cli-"));
  try {
    await mkdir(join(home, "skills", "nested-cli"), { recursive: true });
    await writeFile(
      join(home, "skills", "nested-cli", "SKILL.md"),
      [
        "---",
        "name: nested-cli",
        "description: nested mapping warning probe",
        "metadata:",
        "  routing:",
        "    aliases: [飞书]",
        "---",
        "",
      ].join("\n"),
    );
    await mkdir(join(home, "skills", "clean-cli"), { recursive: true });
    await writeFile(
      join(home, "skills", "clean-cli", "SKILL.md"),
      "---\nname: clean-cli\ndescription: ok\n---\n",
    );

    const cli = join(REPO_ROOT, "src", "cli.ts");
    const result = await execFileAsync(
      process.execPath,
      ["--import", "tsx", cli, "skills", "list", "--json"],
      { env: { ...process.env, CLAUDE_HOME: home, AGENTIC_SKILL_ROUTER_CWD: home } },
    );
    const listed = (JSON.parse(result.stdout) as { skills: Array<{ id: string; frontmatterWarnings?: string[] }> }).skills;
    const nested = listed.find((s) => s.id === "user:nested-cli");
    const clean = listed.find((s) => s.id === "user:clean-cli");
    assert.ok(nested);
    assert.ok(clean);
    assert.ok(nested!.frontmatterWarnings && nested!.frontmatterWarnings.length === 1);
    assert.match(nested!.frontmatterWarnings![0]!, /skipped nested mapping/);
    assert.equal(clean!.frontmatterWarnings, undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("walkSkillsDir with escaped sink skips out-of-root symlink children and records them", async () => {
  // TOCTOU narrowing (#133): when a caller (e.g. the web allowlist) supplies
  // an `escaped` array, walkSkillsDir must DROP entries whose realpath
  // escapes the validated `rootCanonical` and report the original in-root
  // path through the sink. This is the "static" case for the race: the
  // escape is already true at scan time. We cannot make the actual swap
  // race deterministic from JS, but the post-realpath skip-and-report path
  // is what closes most of the residual window.
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-walk-root-"));
  const outside = await mkdtemp(join(tmpdir(), "agentic-skill-router-walk-outside-"));
  try {
    // In-root, real skill: must be found.
    const inRoot = join(root, "inroot");
    await mkdir(inRoot, { recursive: true });
    await writeFile(join(inRoot, "SKILL.md"), "---\nname: inroot\ndescription: in-root real\n---\n");

    // Out-of-root target with a valid SKILL.md, surfaced via a symlink under
    // the scan root. With `escaped` provided we expect this entry to be
    // skipped, not surfaced as `outOfRoot=true`.
    const externalSkill = join(outside, "escaped-skill");
    await mkdir(externalSkill, { recursive: true });
    await writeFile(
      join(externalSkill, "SKILL.md"),
      "---\nname: escaped\ndescription: must be skipped\n---\n",
    );
    const escapedLink = join(root, "escaped");
    await symlink(externalSkill, escapedLink);

    const rootCanonical = await realpath(root);
    const escaped: string[] = [];
    const built: Array<{ name: string; outOfRoot: boolean }> = [];
    const skills = await walkSkillsDir(
      root,
      async (skillName, _skillMdPath, _isDisabled, _conflict, outOfRoot) => {
        built.push({ name: skillName, outOfRoot });
        return {
          id: `t:${skillName}`,
          name: skillName,
          description: "",
          metadata: { name: skillName, description: "" },
          source: "user",
          pluginKey: null,
          skillMdPath: _skillMdPath,
          isDisabled: _isDisabled,
          isPluginDisabled: false,
          canDisable: !outOfRoot,
          conflict: _conflict,
          outOfRoot,
        };
      },
      { rootCanonical, escaped },
    );

    // The in-root real skill must be present; the escaping symlink must NOT
    // have been passed to `build` (so no SKILL.md open happened on the
    // escaped target inside the loop).
    const names = skills.map((s) => s.name).sort();
    assert.deepEqual(names, ["inroot"], "escaped symlink should be dropped from results");
    assert.deepEqual(built.map((b) => b.name).sort(), ["inroot"], "build callback must not see escaped entries");

    // The escape must be reported with the in-root path the caller can use
    // to surface a warning or audit log entry.
    assert.equal(escaped.length, 1, "escaped sink should record exactly one entry");
    assert.equal(escaped[0], escapedLink);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("walkSkillsDir without escaped sink keeps the legacy outOfRoot surface", async () => {
  // Backward-compat guard: when the caller does NOT pass `escaped`, the
  // legacy "surface symlink with outOfRoot=true" behavior must remain so
  // CLI flows that show out-of-root skills with canDisable=false keep
  // working. This pairs with the strict-mode test above to pin both modes.
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-walk-legacy-"));
  const outside = await mkdtemp(join(tmpdir(), "agentic-skill-router-walk-legacy-outside-"));
  try {
    const externalSkill = join(outside, "external");
    await mkdir(externalSkill, { recursive: true });
    await writeFile(
      join(externalSkill, "SKILL.md"),
      "---\nname: external\ndescription: surfaced as outOfRoot\n---\n",
    );
    await symlink(externalSkill, join(root, "external"));

    const skills = await walkSkillsDir(
      root,
      async (skillName, skillMdPath, isDisabled, conflict, outOfRoot) => ({
        id: `t:${skillName}`,
        name: skillName,
        description: "",
        metadata: { name: skillName, description: "" },
        source: "user",
        pluginKey: null,
        skillMdPath,
        isDisabled,
        isPluginDisabled: false,
        canDisable: !outOfRoot,
        conflict,
        outOfRoot,
      }),
    );

    assert.equal(skills.length, 1);
    assert.equal(skills[0]!.name, "external");
    assert.equal(skills[0]!.outOfRoot, true, "legacy mode must still surface outOfRoot");
    assert.equal(skills[0]!.canDisable, false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
