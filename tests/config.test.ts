import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CONFIG_KEYS,
  ConfigValueError,
  DEFAULT_CONFIG,
  DEFAULT_UNUSED_FOR_DAYS,
  isConfigKey,
  loadConfig,
  parseConfigValue,
  parseDuration,
  parseRouteMode,
  resolveUnusedForDays,
  resolveUsageSince,
  saveRawConfigObject,
  setConfigValue,
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
  const cfg = await loadConfig(join(tmpdir(), "agentic-skill-router-no-such-file-" + Math.random()));
  assert.equal(cfg.unusedForDays, DEFAULT_UNUSED_FOR_DAYS);
  assert.equal(cfg.routeMode, DEFAULT_CONFIG.routeMode);
});

test("loadConfig honours unusedForDays", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-config-"));
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
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-config-"));
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
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-config-"));
  const path = join(dir, "config.json");
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ keepNames: ["foo", "bar"], keepIds: ["user:baz"] }));
    const cfg = await loadConfig(path);
    assert.deepEqual(cfg.keepNames, ["foo", "bar"]);
    assert.deepEqual(cfg.keepIds, ["user:baz"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig ignores non-string entries in keepNames / keepIds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-config-"));
  const path = join(dir, "config.json");
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ keepNames: ["foo", 123, "", null], keepIds: "not-an-array" }));
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
  assert.equal(resolveUnusedForDays({ cliFlag: "60", config: { unusedForDays: 30, routeMode: "auto" } }), 60);
});

test("resolveUnusedForDays: missing CLI flag falls back to config", () => {
  assert.equal(resolveUnusedForDays({ config: { unusedForDays: 45, routeMode: "auto" } }), 45);
});

test("resolveUnusedForDays: CLI flag with units", () => {
  assert.equal(resolveUnusedForDays({ cliFlag: "2w", config: { unusedForDays: 30, routeMode: "auto" } }), 14);
});

test("isConfigKey accepts known keys and rejects others", () => {
  for (const k of CONFIG_KEYS) assert.equal(isConfigKey(k), true);
  assert.equal(isConfigKey("nope"), false);
  assert.equal(isConfigKey(""), false);
});

test("parseConfigValue: unusedForDays accepts non-negative integers", () => {
  assert.equal(parseConfigValue("unusedForDays", "0"), 0);
  assert.equal(parseConfigValue("unusedForDays", "60"), 60);
});

test("parseConfigValue: unusedForDays rejects junk", () => {
  assert.throws(() => parseConfigValue("unusedForDays", "abc"), ConfigValueError);
  assert.throws(() => parseConfigValue("unusedForDays", "-1"), ConfigValueError);
  assert.throws(() => parseConfigValue("unusedForDays", "1.5"), ConfigValueError);
  assert.throws(() => parseConfigValue("unusedForDays", ""), ConfigValueError);
});

test("parseConfigValue: routeMode accepts only the supported set", () => {
  for (const mode of ["auto", "metadata", "body", "lexical", "dci"]) {
    assert.equal(parseConfigValue("routeMode", mode), mode);
  }
  assert.throws(() => parseConfigValue("routeMode", "wat"), ConfigValueError);
});

test("parseConfigValue: keepNames / keepIds accept JSON arrays of strings", () => {
  assert.deepEqual(parseConfigValue("keepNames", '["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseConfigValue("keepIds", '["user:foo"]'), ["user:foo"]);
  assert.deepEqual(parseConfigValue("keepNames", "[]"), []);
});

test("parseConfigValue: keepNames rejects non-array and non-string entries", () => {
  assert.throws(() => parseConfigValue("keepNames", "user:foo"), ConfigValueError);
  assert.throws(() => parseConfigValue("keepNames", '"just a string"'), ConfigValueError);
  assert.throws(() => parseConfigValue("keepNames", '["a", 1]'), ConfigValueError);
});

test("setConfigValue writes file atomically and preserves unknown sibling keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-set-"));
  const path = join(dir, "config.json");
  try {
    await writeFile(path, JSON.stringify({ unusedForDays: 30, futureKey: "keep" }) + "\n");
    await setConfigValue("routeMode", "metadata", path);
    const cfg = await loadConfig(path);
    assert.equal(cfg.routeMode, "metadata");
    assert.equal(cfg.unusedForDays, 30);

    const raw = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(raw.futureKey, "keep");
    assert.equal(raw.routeMode, "metadata");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setConfigValue rejects invalid value without touching disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-set-bad-"));
  const path = join(dir, "config.json");
  try {
    await writeFile(path, JSON.stringify({ unusedForDays: 45 }) + "\n");
    const before = await (await import("node:fs/promises")).readFile(path, "utf8");
    await assert.rejects(() => setConfigValue("routeMode", "bogus", path), ConfigValueError);
    const after = await (await import("node:fs/promises")).readFile(path, "utf8");
    assert.equal(after, before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setConfigValue serializes concurrent writes so neither key is dropped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-set-concurrent-"));
  const path = join(dir, "config.json");
  try {
    // Start from a known baseline so we can assert both writers preserve it.
    await writeFile(path, JSON.stringify({ futureKey: "keep" }) + "\n");
    await Promise.all([setConfigValue("routeMode", "metadata", path), setConfigValue("unusedForDays", "42", path)]);
    const cfg = await loadConfig(path);
    assert.equal(cfg.routeMode, "metadata");
    assert.equal(cfg.unusedForDays, 42);
    const raw = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")) as Record<string, unknown>;
    // Unknown sibling key survives both writers.
    assert.equal(raw.futureKey, "keep");
    // Lock sibling file is cleaned up on success.
    const lockExists = await (await import("node:fs/promises"))
      .stat(`${path}.lock`)
      .then(() => true)
      .catch(() => false);
    assert.equal(lockExists, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setConfigValue reaps stale lock from a dead PID and succeeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-stale-lock-"));
  const path = join(dir, "config.json");
  const lockPath = `${path}.lock`;
  try {
    await writeFile(path, JSON.stringify({ unusedForDays: 30 }) + "\n");
    // Pick a PID that is overwhelmingly unlikely to exist on this host so
    // process.kill(pid, 0) reports ESRCH. Pair it with a fresh `startedAt`
    // so success proves the PID-liveness branch (not the age fallback).
    const fakePid = process.pid + 100000;
    await writeFile(lockPath, JSON.stringify({ pid: fakePid, startedAt: Date.now() }));
    await setConfigValue("routeMode", "metadata", path);
    const cfg = await loadConfig(path);
    assert.equal(cfg.routeMode, "metadata");
    // Lock is cleaned up after a successful write.
    const lockExists = await (await import("node:fs/promises"))
      .stat(lockPath)
      .then(() => true)
      .catch(() => false);
    assert.equal(lockExists, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setConfigValue does not reap an empty lock file (atomic acquisition invariant)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-empty-lock-"));
  const path = join(dir, "config.json");
  const lockPath = `${path}.lock`;
  try {
    await writeFile(path, JSON.stringify({ unusedForDays: 30 }) + "\n");
    // Simulate the window between `open(..., 'wx')` and writing the owner
    // record under the old implementation — an attacker could plant an
    // empty lock file and have a contender hijack it. With atomic
    // tmp-file + link() acquisition this must never reap; the contender
    // must wait until the overall lock timeout surfaces a loud error
    // instead of silently stealing the lock.
    await writeFile(lockPath, "");
    const started = Date.now();
    await assert.rejects(() => setConfigValue("routeMode", "metadata", path), /timed out waiting for config lock/);
    // Sanity: the call actually waited rather than returning immediately
    // after stealing the lock. The lock timeout is 5s, so anything >=1s
    // proves we backed off through the retry loop instead of hijacking.
    assert.ok(Date.now() - started >= 1000, "expected to wait for timeout, not hijack empty lock");
    // The empty lock we planted is still there — we did not unlink it.
    const stat = await (await import("node:fs/promises")).readFile(lockPath, "utf8");
    assert.equal(stat, "");
    // And the config file was not touched.
    const cfg = await loadConfig(path);
    assert.equal(cfg.unusedForDays, 30);
    assert.equal(cfg.routeMode, "auto");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setConfigValue reaps stale lock older than the age threshold and succeeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-stale-age-"));
  const path = join(dir, "config.json");
  const lockPath = `${path}.lock`;
  try {
    await writeFile(path, JSON.stringify({ unusedForDays: 30 }) + "\n");
    // Use the live test process PID so the liveness check passes; rely on
    // the age fallback (startedAt > 60s ago) to declare the lock stale.
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() - 120_000 }));
    await setConfigValue("routeMode", "body", path);
    const cfg = await loadConfig(path);
    assert.equal(cfg.routeMode, "body");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveRawConfigObject creates parent directory and writes JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-save-"));
  const path = join(dir, "nested", "config.json");
  try {
    await saveRawConfigObject({ unusedForDays: 7, routeMode: "auto" }, path);
    const cfg = await loadConfig(path);
    assert.equal(cfg.unusedForDays, 7);
    assert.equal(cfg.routeMode, "auto");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ─── usageSinceDays (issue #112) ────────────────────────────────────────────

test("CONFIG_KEYS includes usageSinceDays", () => {
  assert.ok((CONFIG_KEYS as readonly string[]).includes("usageSinceDays"));
});

test("loadConfig parses usageSinceDays from JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-usage-since-"));
  const path = join(dir, "config.json");
  try {
    await writeFile(path, JSON.stringify({ usageSinceDays: 14 }) + "\n");
    const cfg = await loadConfig(path);
    assert.equal(cfg.usageSinceDays, 14);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig ignores non-positive usageSinceDays", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-usage-since-bad-"));
  const path = join(dir, "config.json");
  try {
    await writeFile(path, JSON.stringify({ usageSinceDays: 0 }) + "\n");
    const cfg = await loadConfig(path);
    assert.equal(cfg.usageSinceDays, undefined);

    await writeFile(path, JSON.stringify({ usageSinceDays: -5 }) + "\n");
    const cfg2 = await loadConfig(path);
    assert.equal(cfg2.usageSinceDays, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseConfigValue('usageSinceDays', ...) accepts non-negative integers", () => {
  assert.equal(parseConfigValue("usageSinceDays", "30"), 30);
  assert.equal(parseConfigValue("usageSinceDays", "0"), 0);
  assert.throws(() => parseConfigValue("usageSinceDays", "abc"), ConfigValueError);
  assert.throws(() => parseConfigValue("usageSinceDays", "-1"), ConfigValueError);
  assert.throws(() => parseConfigValue("usageSinceDays", ""), ConfigValueError);
});

test("resolveUsageSince returns null when no config and no env", () => {
  const since = resolveUsageSince({ config: { ...DEFAULT_CONFIG }, env: {} });
  assert.equal(since, null);
});

test("resolveUsageSince computes cutoff from config.usageSinceDays", () => {
  const now = new Date("2026-05-01T00:00:00Z");
  const since = resolveUsageSince({
    config: { ...DEFAULT_CONFIG, usageSinceDays: 7 },
    env: {},
    now,
  });
  assert.ok(since instanceof Date);
  assert.equal(since!.toISOString(), "2026-04-24T00:00:00.000Z");
});

test("resolveUsageSince env override beats config value", () => {
  const now = new Date("2026-05-01T00:00:00Z");
  const since = resolveUsageSince({
    config: { ...DEFAULT_CONFIG, usageSinceDays: 30 },
    env: { AGENTIC_SKILL_ROUTER_USAGE_SINCE: "3" },
    now,
  });
  assert.equal(since!.toISOString(), "2026-04-28T00:00:00.000Z");
});

test("resolveUsageSince env=0 disables the cutoff even when config sets one", () => {
  const since = resolveUsageSince({
    config: { ...DEFAULT_CONFIG, usageSinceDays: 30 },
    env: { AGENTIC_SKILL_ROUTER_USAGE_SINCE: "0" },
  });
  assert.equal(since, null);
});
