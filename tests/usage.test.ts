import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectUsageStats } from "../src/usage.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PROJECTS = join(__dirname, "fixtures/projects");

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
