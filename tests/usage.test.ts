import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectUsageStats,
  isPluginShortAmbiguous,
  lookupUsage,
  lookupUsageStrict,
} from "../src/usage.ts";
import type { Skill, UsageStat } from "../src/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PROJECTS = join(__dirname, "fixtures/projects");

function mkPlugin(name: string, pluginKey: string): Skill {
  return {
    id: `plugin:${pluginKey}:${name}`,
    name,
    description: "",
    source: "plugin",
    pluginKey,
    skillMdPath: `/tmp/${pluginKey}/${name}/SKILL.md`,
    isDisabled: false,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  };
}

function mkUser(name: string): Skill {
  return {
    id: `user:${name}`,
    name,
    description: "",
    source: "user",
    pluginKey: null,
    skillMdPath: `/tmp/${name}/SKILL.md`,
    isDisabled: false,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  };
}

function mkUsage(skillId: string, lastUsed: string, callCount = 1): UsageStat {
  return {
    skillId,
    lastUsed: new Date(lastUsed),
    callCount,
    firstSeen: new Date(lastUsed),
  };
}

test("collectUsageStats aggregates Skill tool_use calls", async () => {
  const stats = await collectUsageStats(FIXTURE_PROJECTS);
  const foo = stats.get("foo");
  assert.ok(foo, "foo should be tracked");
  // foo has 1 tool_use (2026-04-10) + 1 <command-name> (2026-04-20) = 2 calls
  assert.equal(foo!.callCount, 2);
  assert.equal(foo!.firstSeen?.toISOString(), "2026-04-10T08:00:00.000Z");
  assert.equal(foo!.lastUsed?.toISOString(), "2026-04-20T09:00:00.000Z");
});

test("collectUsageStats picks up <command-name> tags from string content", async () => {
  const stats = await collectUsageStats(FIXTURE_PROJECTS);
  const codexRescue = stats.get("codex:rescue");
  assert.ok(codexRescue, "codex:rescue should be tracked from string content");
  assert.equal(codexRescue!.callCount, 1);
});

test("collectUsageStats returns empty map when projectsDir does not exist", async () => {
  const stats = await collectUsageStats("/nonexistent/path/skill-router-test");
  assert.equal(stats.size, 0);
});

test("collectUsageStats: bar is tracked once", async () => {
  const stats = await collectUsageStats(FIXTURE_PROJECTS);
  const bar = stats.get("bar");
  assert.ok(bar);
  assert.equal(bar!.callCount, 1);
});

// ─── plugin-short attribution conflict (issue #38) ─────────────────────────

test("isPluginShortAmbiguous flags two plugins sharing pluginShort+name", () => {
  const a = mkPlugin("rescue", "codex@market-a");
  const b = mkPlugin("rescue", "codex@market-b");
  assert.equal(isPluginShortAmbiguous(a, [a, b]), true);
  assert.equal(isPluginShortAmbiguous(b, [a, b]), true);
});

test("isPluginShortAmbiguous is false when pluginShort+name is unique", () => {
  const a = mkPlugin("rescue", "codex@market-a");
  const b = mkPlugin("scout", "codex@market-b");
  assert.equal(isPluginShortAmbiguous(a, [a, b]), false);
});

test("isPluginShortAmbiguous is false for user/builtin skills", () => {
  const u = mkUser("rescue");
  const p = mkPlugin("rescue", "codex@market-a");
  assert.equal(isPluginShortAmbiguous(u, [u, p]), false);
});

test("lookupUsage: short-name conflict yields no attribution for either skill", () => {
  // Two plugin skills with the same pluginShort ("codex") but different
  // marketplaces should not share the bare "codex:rescue" transcript record.
  const a = mkPlugin("rescue", "codex@market-a");
  const b = mkPlugin("rescue", "codex@market-b");
  const usage = new Map<string, UsageStat>([
    ["codex:rescue", mkUsage("codex:rescue", "2026-04-20T00:00:00Z", 7)],
  ]);
  assert.equal(lookupUsage(a, usage, [a, b]), undefined);
  assert.equal(lookupUsage(b, usage, [a, b]), undefined);
});

test("lookupUsageStrict: short-name conflict yields no attribution for either skill", () => {
  const a = mkPlugin("rescue", "codex@market-a");
  const b = mkPlugin("rescue", "codex@market-b");
  const usage = new Map<string, UsageStat>([
    ["codex:rescue", mkUsage("codex:rescue", "2026-04-20T00:00:00Z", 7)],
  ]);
  assert.equal(lookupUsageStrict(a, usage, [a, b]), undefined);
  assert.equal(lookupUsageStrict(b, usage, [a, b]), undefined);
});

test("lookupUsage: full plugin-key form attributes only to the matching skill", () => {
  const a = mkPlugin("rescue", "codex@market-a");
  const b = mkPlugin("rescue", "codex@market-b");
  // Transcript carried the full id, so attribution is unambiguous.
  const usage = new Map<string, UsageStat>([
    [a.id, mkUsage(a.id, "2026-04-20T00:00:00Z", 3)],
  ]);
  const ua = lookupUsage(a, usage, [a, b]);
  const ub = lookupUsage(b, usage, [a, b]);
  assert.ok(ua, "a should be attributed via full key");
  assert.equal(ua!.callCount, 3);
  assert.equal(ub, undefined, "b must not steal a's usage");
});

test("lookupUsageStrict: full plugin-key form attributes only to the matching skill", () => {
  const a = mkPlugin("rescue", "codex@market-a");
  const b = mkPlugin("rescue", "codex@market-b");
  const usage = new Map<string, UsageStat>([
    [a.id, mkUsage(a.id, "2026-04-20T00:00:00Z", 3)],
  ]);
  const ua = lookupUsageStrict(a, usage, [a, b]);
  const ub = lookupUsageStrict(b, usage, [a, b]);
  assert.ok(ua);
  assert.equal(ua!.callCount, 3);
  assert.equal(ub, undefined);
});

test("lookupUsage: full key beats short-name when both are present", () => {
  const a = mkPlugin("rescue", "codex@market-a");
  const b = mkPlugin("rescue", "codex@market-b");
  // Short-form is ambiguous, but full key is decisive — full should win.
  const usage = new Map<string, UsageStat>([
    ["codex:rescue", mkUsage("codex:rescue", "2026-04-10T00:00:00Z", 9)],
    [a.id, mkUsage(a.id, "2026-04-25T00:00:00Z", 2)],
  ]);
  const ua = lookupUsage(a, usage, [a, b]);
  assert.ok(ua);
  assert.equal(ua!.callCount, 2);
  assert.equal(ua!.lastUsed?.toISOString(), "2026-04-25T00:00:00.000Z");
  assert.equal(lookupUsage(b, usage, [a, b]), undefined);
});

test("lookupUsage: non-conflicting plugin still uses short-form attribution", () => {
  const a = mkPlugin("rescue", "codex@market-a");
  // No sibling under "codex@*" with same name, so "codex:rescue" is safe.
  const usage = new Map<string, UsageStat>([
    ["codex:rescue", mkUsage("codex:rescue", "2026-04-20T00:00:00Z", 4)],
  ]);
  const ua = lookupUsage(a, usage, [a]);
  assert.ok(ua);
  assert.equal(ua!.callCount, 4);
});
