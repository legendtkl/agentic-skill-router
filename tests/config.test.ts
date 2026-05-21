import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_CONFIG,
  DEFAULT_UNUSED_FOR_DAYS,
  loadConfig,
  parseDuration,
  parseRouteMode,
  resolveUnusedForDays,
} from "../src/config.ts";

test("parseDuration: bare number is days", () => {
  assert.equal(parseDuration("30"), 30);
  assert.equal(parseDuration("0"), 0);
});

test("parseDuration: explicit units", () => {
  assert.equal(parseDuration("30d"), 30);
  assert.equal(parseDuration("2w"), 14);
  assert.equal(parseDuration("3m"), 90);
  assert.equal(parseDuration("1y"), 365);
});

test("parseDuration: tolerates whitespace and case", () => {
  assert.equal(parseDuration("  30D  "), 30);
});

test("parseDuration: rejects garbage", () => {
  assert.throws(() => parseDuration(""));
  assert.throws(() => parseDuration("abc"));
  assert.throws(() => parseDuration("30x"));
  assert.throws(() => parseDuration("-5d"));
});

test("loadConfig returns default when file missing", async () => {
  const cfg = await loadConfig(join(tmpdir(), "skill-router-no-such-file-" + Math.random()));
  assert.equal(cfg.unusedForDays, DEFAULT_UNUSED_FOR_DAYS);
  assert.equal(cfg.routeMode, DEFAULT_CONFIG.routeMode);
});

test("loadConfig honours unusedForDays", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skill-router-config-"));
  const path = join(dir, "config.json");
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ unusedForDays: 90 }));
    const cfg = await loadConfig(path);
    assert.equal(cfg.unusedForDays, 90);
    assert.equal(cfg.routeMode, DEFAULT_CONFIG.routeMode);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig honours routeMode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skill-router-config-"));
  const path = join(dir, "config.json");
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ routeMode: "dci" }));
    const cfg = await loadConfig(path);
    assert.equal(cfg.routeMode, "dci");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig honours keepNames and keepIds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skill-router-config-"));
  const path = join(dir, "config.json");
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ keepNames: ["foo", "bar"], keepIds: ["user:baz"] }),
    );
    const cfg = await loadConfig(path);
    assert.deepEqual(cfg.keepNames, ["foo", "bar"]);
    assert.deepEqual(cfg.keepIds, ["user:baz"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig ignores non-string entries in keepNames / keepIds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skill-router-config-"));
  const path = join(dir, "config.json");
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ keepNames: ["foo", 123, "", null], keepIds: "not-an-array" }),
    );
    const cfg = await loadConfig(path);
    assert.deepEqual(cfg.keepNames, ["foo"]);
    assert.equal(cfg.keepIds, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseRouteMode accepts only supported modes", () => {
  assert.equal(parseRouteMode("lexical"), "lexical");
  assert.equal(parseRouteMode("metadata"), "metadata");
  assert.equal(parseRouteMode("body"), "body");
  assert.equal(parseRouteMode("dci"), "dci");
  assert.equal(parseRouteMode("auto"), "auto");
  assert.equal(parseRouteMode("unknown"), null);
});

test("resolveUnusedForDays: CLI flag overrides config", () => {
  assert.equal(
    resolveUnusedForDays({ cliFlag: "60", config: { unusedForDays: 30, routeMode: "auto" } }),
    60,
  );
});

test("resolveUnusedForDays: missing CLI flag falls back to config", () => {
  assert.equal(
    resolveUnusedForDays({ config: { unusedForDays: 45, routeMode: "auto" } }),
    45,
  );
});

test("resolveUnusedForDays: CLI flag with units", () => {
  assert.equal(
    resolveUnusedForDays({ cliFlag: "2w", config: { unusedForDays: 30, routeMode: "auto" } }),
    14,
  );
});
