import { test } from "node:test";
import assert from "node:assert/strict";
import { suggest } from "../src/policy.ts";
import type { Skill, UsageStat } from "../src/types.ts";

function mkSkill(overrides: Partial<Skill> & { name: string }): Skill {
  const { name, ...rest } = overrides;
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
    ...rest,
  };
}

const NOW = new Date("2026-04-30T00:00:00Z");

test("never-used skill returns high-confidence suggestion", () => {
  const s = mkSkill({ name: "foo" });
  const out = suggest([s], new Map(), { unusedForDays: 30, now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.reason, "never-used");
  assert.equal(out[0]!.confidence, "high");
});

test("recently-used skill is not suggested", () => {
  const s = mkSkill({ name: "foo" });
  const usage = new Map<string, UsageStat>([
    ["foo", { skillId: "foo", lastUsed: new Date("2026-04-20T00:00:00Z"), callCount: 3, firstSeen: null }],
  ]);
  const out = suggest([s], usage, { unusedForDays: 30, now: NOW });
  assert.equal(out.length, 0);
});

test("stale skill (older than threshold) returns medium-confidence suggestion", () => {
  const s = mkSkill({ name: "foo" });
  const usage = new Map<string, UsageStat>([
    ["foo", { skillId: "foo", lastUsed: new Date("2026-01-01T00:00:00Z"), callCount: 1, firstSeen: null }],
  ]);
  const out = suggest([s], usage, { unusedForDays: 30, now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.reason, "stale");
  assert.equal(out[0]!.confidence, "medium");
  assert.match(out[0]!.details, /\d+ days ago/);
});

test("ALWAYS_KEEP allowlist excludes init / review / etc", () => {
  const skills = [
    mkSkill({ name: "init" }),
    mkSkill({ name: "review" }),
    mkSkill({ name: "security-review" }),
    mkSkill({ name: "update-config" }),
    mkSkill({ name: "skill-router-skills" }),
  ];
  const out = suggest(skills, new Map(), { unusedForDays: 30, now: NOW });
  assert.equal(out.length, 0);
});

test("builtins (canDisable=false) are excluded", () => {
  const s = mkSkill({ name: "claude-api", canDisable: false, source: "builtin" });
  const out = suggest([s], new Map(), { unusedForDays: 30, now: NOW });
  assert.equal(out.length, 0);
});

test("already-disabled skills are excluded", () => {
  const s = mkSkill({ name: "foo", isDisabled: true });
  const out = suggest([s], new Map(), { unusedForDays: 30, now: NOW });
  assert.equal(out.length, 0);
});

test("plugin-disabled skills are excluded", () => {
  const s = mkSkill({ name: "foo", source: "plugin", isPluginDisabled: true, pluginKey: "p@m" });
  const out = suggest([s], new Map(), { unusedForDays: 30, now: NOW });
  assert.equal(out.length, 0);
});

test("conflict skills are excluded from suggestions", () => {
  const s = mkSkill({ name: "foo", conflict: true });
  const out = suggest([s], new Map(), { unusedForDays: 30, now: NOW });
  assert.equal(out.length, 0);
});

test("ambiguous bare-name match does NOT mask never-used", () => {
  // Two skills both named "shared", from different sources. Only one used.
  const a = mkSkill({ name: "shared", id: "user:shared" });
  const b = mkSkill({ name: "shared", id: "plugin:p@m:shared", source: "plugin", pluginKey: "p@m" });
  const usage = new Map<string, UsageStat>([
    // bare-name usage record: ambiguous, could belong to either
    ["shared", { skillId: "shared", lastUsed: new Date("2026-04-25"), callCount: 1, firstSeen: null }],
  ]);
  const out = suggest([a, b], usage, { unusedForDays: 30, now: NOW });
  // Both should be flagged as never-used (strict lookup refuses ambiguous match)
  assert.equal(out.length, 2);
  for (const s of out) assert.equal(s.reason, "never-used");
});

test("plugin-namespaced usage attributes correctly to that plugin's skill", () => {
  const a = mkSkill({ name: "rescue", id: "user:rescue" });
  const b = mkSkill({
    name: "rescue", id: "plugin:codex@openai-codex:rescue",
    source: "plugin", pluginKey: "codex@openai-codex",
  });
  const usage = new Map<string, UsageStat>([
    ["codex:rescue", { skillId: "codex:rescue", lastUsed: new Date("2026-04-25"), callCount: 5, firstSeen: null }],
  ]);
  const out = suggest([a, b], usage, { unusedForDays: 30, now: NOW });
  // user:rescue is never-used (no namespaced match for it, and ambiguity blocks bare); plugin one gets the attribution and is fresh
  const ids = out.map((s) => s.skill.id);
  assert.ok(ids.includes("user:rescue"));
  assert.ok(!ids.includes("plugin:codex@openai-codex:rescue"));
});

test("output sorted by confidence desc, then oldest-first", () => {
  const skills = [
    mkSkill({ name: "stale-newer" }),
    mkSkill({ name: "never-used" }),
    mkSkill({ name: "stale-older" }),
  ];
  const usage = new Map<string, UsageStat>([
    ["stale-newer", { skillId: "stale-newer", lastUsed: new Date("2026-02-15"), callCount: 1, firstSeen: null }],
    ["stale-older", { skillId: "stale-older", lastUsed: new Date("2026-01-01"), callCount: 1, firstSeen: null }],
  ]);
  const out = suggest(skills, usage, { unusedForDays: 30, now: NOW });
  assert.equal(out.length, 3);
  assert.equal(out[0]!.skill.name, "never-used");      // high
  assert.equal(out[1]!.skill.name, "stale-older");     // medium, older first
  assert.equal(out[2]!.skill.name, "stale-newer");
});
