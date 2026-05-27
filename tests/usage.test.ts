import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectUsageStats,
  collectUsageStatsDetailed,
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
  const stats = await collectUsageStats("/nonexistent/path/agentic-skill-router-test");
  assert.equal(stats.size, 0);
});

test("collectUsageStats skips unreadable transcript files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-usage-read-error-"));
  const projectsDir = join(root, "projects");
  const sessionDir = join(projectsDir, "proj");
  const readable = join(sessionDir, "readable.jsonl");
  const unreadable = join(sessionDir, "unreadable.jsonl");
  const mkLine = (skill: string) =>
    `${JSON.stringify({
      timestamp: "2026-04-10T08:00:00.000Z",
      message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
    })}\n`;
  await mkdir(sessionDir, { recursive: true });
  await writeFile(readable, mkLine("foo"), "utf8");
  await writeFile(unreadable, mkLine("bar"), "utf8");
  await chmod(unreadable, 0o000);
  try {
    const stats = await collectUsageStats(projectsDir);
    assert.equal(stats.get("foo")?.callCount, 1);
    assert.equal(stats.get("bar"), undefined);
  } finally {
    await chmod(unreadable, 0o600).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("collectUsageStats skips unreadable transcript subdirs and warns", async (t) => {
  if (process.platform === "win32") {
    t.skip("chmod-based unreadable dir test is unreliable on Windows");
    return;
  }
  if (process.getuid && process.getuid() === 0) {
    t.skip("root bypasses POSIX directory permission checks");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-usage-dir-eacces-"));
  const projectsDir = join(root, "projects");
  const readableDir = join(projectsDir, "readable");
  const unreadableDir = join(projectsDir, "unreadable");
  const readableSession = join(readableDir, "session.jsonl");
  const buriedSession = join(unreadableDir, "session.jsonl");
  const mkLine = (skill: string) =>
    `${JSON.stringify({
      timestamp: "2026-04-10T08:00:00.000Z",
      message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
    })}\n`;
  await mkdir(readableDir, { recursive: true });
  await mkdir(unreadableDir, { recursive: true });
  await writeFile(readableSession, mkLine("foo"), "utf8");
  await writeFile(buriedSession, mkLine("bar"), "utf8");
  await chmod(unreadableDir, 0o000);

  // Verify the OS actually rejects readdir for the test user; some
  // filesystems / sandboxes silently grant access despite chmod 000.
  let dirIsActuallyBlocked = false;
  try {
    const { readdir } = await import("node:fs/promises");
    await readdir(unreadableDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    dirIsActuallyBlocked = code === "EACCES" || code === "EPERM";
  }
  if (!dirIsActuallyBlocked) {
    await chmod(unreadableDir, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    t.skip("filesystem did not honor chmod 0o000 (likely overlay/sandbox FS)");
    return;
  }

  const errors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const stats = await collectUsageStats(projectsDir);
    assert.equal(stats.get("foo")?.callCount, 1, "readable subtree must still be scanned");
    assert.equal(stats.get("bar"), undefined, "unreadable subtree must not contribute");
    const matched = errors.find((m) => m.includes(unreadableDir) && /EACCES|EPERM/.test(m));
    assert.ok(matched, `expected a stderr warning naming ${unreadableDir}; got ${JSON.stringify(errors)}`);
  } finally {
    console.error = origError;
    await chmod(unreadableDir, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("collectUsageStats propagates unexpected directory errors", async () => {
  // readdir on a regular file produces ENOTDIR — that is not in the
  // EACCES/EPERM/ENOENT allowlist and must still surface as a thrown error
  // rather than being silently swallowed.
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-usage-enotdir-"));
  const notADir = join(root, "not-a-dir");
  await writeFile(notADir, "ignored", "utf8");
  try {
    await assert.rejects(
      () => collectUsageStats(notADir),
      (err: NodeJS.ErrnoException) => err.code === "ENOTDIR",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
  const usage = new Map<string, UsageStat>([["codex:rescue", mkUsage("codex:rescue", "2026-04-20T00:00:00Z", 7)]]);
  assert.equal(lookupUsage(a, usage, [a, b]), undefined);
  assert.equal(lookupUsage(b, usage, [a, b]), undefined);
});

test("lookupUsageStrict: short-name conflict yields no attribution for either skill", () => {
  const a = mkPlugin("rescue", "codex@market-a");
  const b = mkPlugin("rescue", "codex@market-b");
  const usage = new Map<string, UsageStat>([["codex:rescue", mkUsage("codex:rescue", "2026-04-20T00:00:00Z", 7)]]);
  assert.equal(lookupUsageStrict(a, usage, [a, b]), undefined);
  assert.equal(lookupUsageStrict(b, usage, [a, b]), undefined);
});

test("lookupUsage: full plugin-key form attributes only to the matching skill", () => {
  const a = mkPlugin("rescue", "codex@market-a");
  const b = mkPlugin("rescue", "codex@market-b");
  // Transcript carried the full id, so attribution is unambiguous.
  const usage = new Map<string, UsageStat>([[a.id, mkUsage(a.id, "2026-04-20T00:00:00Z", 3)]]);
  const ua = lookupUsage(a, usage, [a, b]);
  const ub = lookupUsage(b, usage, [a, b]);
  assert.ok(ua, "a should be attributed via full key");
  assert.equal(ua!.callCount, 3);
  assert.equal(ub, undefined, "b must not steal a's usage");
});

test("lookupUsageStrict: full plugin-key form attributes only to the matching skill", () => {
  const a = mkPlugin("rescue", "codex@market-a");
  const b = mkPlugin("rescue", "codex@market-b");
  const usage = new Map<string, UsageStat>([[a.id, mkUsage(a.id, "2026-04-20T00:00:00Z", 3)]]);
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
  const usage = new Map<string, UsageStat>([["codex:rescue", mkUsage("codex:rescue", "2026-04-20T00:00:00Z", 4)]]);
  const ua = lookupUsage(a, usage, [a]);
  assert.ok(ua);
  assert.equal(ua!.callCount, 4);
});

// ─── usage cache (issue #37) ─────────────────────────────────────────────────

async function mkTmpProjects(): Promise<{ projectsDir: string; cacheDir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-usage-cache-"));
  const projectsDir = join(root, "projects");
  const cacheDir = join(root, "cache");
  await mkdir(projectsDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  return {
    projectsDir,
    cacheDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function writeTranscript(path: string, lines: string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, lines.map((l) => l + "\n").join(""));
}

const FOO_TOOLUSE = JSON.stringify({
  timestamp: "2026-05-01T08:00:00.000Z",
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "foo" } }] },
});

const BAR_TOOLUSE = JSON.stringify({
  timestamp: "2026-05-02T08:00:00.000Z",
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "bar" } }] },
});

test("collectUsageStats writes a cache file when host is provided", async () => {
  const { projectsDir, cacheDir, cleanup } = await mkTmpProjects();
  try {
    const session = join(projectsDir, "proj-a", "session.jsonl");
    await writeTranscript(session, [FOO_TOOLUSE, BAR_TOOLUSE]);
    const cachePath = join(cacheDir, "usage-cache-codex.json");

    delete process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"];
    const stats = await collectUsageStats(projectsDir, { cachePath });
    assert.equal(stats.get("foo")?.callCount, 1);
    assert.equal(stats.get("bar")?.callCount, 1);

    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 1);
    const entry = parsed.files[session];
    assert.ok(entry, "cache should contain entry for the scanned session file");
    const st = await stat(session);
    assert.equal(entry.size, st.size);
    assert.equal(entry.mtimeMs, st.mtimeMs);
    const skills = (entry.stats as Array<{ skillName: string }>).map((s) => s.skillName).sort();
    assert.deepEqual(skills, ["bar", "foo"]);
  } finally {
    await cleanup();
  }
});

test("collectUsageStats reuses cached stats when size+mtime are unchanged", async () => {
  const { projectsDir, cacheDir, cleanup } = await mkTmpProjects();
  try {
    const session = join(projectsDir, "proj-a", "session.jsonl");
    await writeTranscript(session, [FOO_TOOLUSE]);
    const cachePath = join(cacheDir, "usage-cache-codex.json");
    delete process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"];

    // First scan: real read populates the cache.
    await collectUsageStats(projectsDir, { cachePath });

    // Mutate the file contents on disk to add a second skill, but force the
    // mtime back to what the cache recorded. On the second scan the cache
    // should be trusted (size differs, so this also exercises invalidation
    // below). To prove the cache is consulted, we hand-edit the cache to
    // report a synthetic skill name that does not exist in the file itself.
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    const entry = parsed.files[session];
    entry.stats = [{ skillName: "synthetic-from-cache", callCount: 42, lastUsed: null, firstSeen: null }];
    await writeFile(cachePath, JSON.stringify(parsed));

    const stats = await collectUsageStats(projectsDir, { cachePath });
    assert.equal(stats.get("synthetic-from-cache")?.callCount, 42, "cache hit should be reused as-is");
    assert.equal(stats.get("foo"), undefined, "real file should not be re-scanned when cache matches");
  } finally {
    await cleanup();
  }
});

test("collectUsageStats invalidates the cache entry when mtime changes", async () => {
  const { projectsDir, cacheDir, cleanup } = await mkTmpProjects();
  try {
    const session = join(projectsDir, "proj-a", "session.jsonl");
    await writeTranscript(session, [FOO_TOOLUSE]);
    const cachePath = join(cacheDir, "usage-cache-codex.json");
    delete process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"];

    await collectUsageStats(projectsDir, { cachePath });

    // Append a new call and bump mtime forward — must invalidate.
    await writeTranscript(session, [FOO_TOOLUSE, BAR_TOOLUSE]);
    const future = new Date(Date.now() + 60_000);
    await utimes(session, future, future);

    const stats = await collectUsageStats(projectsDir, { cachePath });
    assert.equal(stats.get("foo")?.callCount, 1);
    assert.equal(stats.get("bar")?.callCount, 1, "re-scanned file picks up the new skill");
  } finally {
    await cleanup();
  }
});

test("collectUsageStats prunes cache entries for deleted transcript files", async () => {
  const { projectsDir, cacheDir, cleanup } = await mkTmpProjects();
  try {
    const sessionA = join(projectsDir, "proj-a", "session.jsonl");
    const sessionB = join(projectsDir, "proj-b", "session.jsonl");
    await writeTranscript(sessionA, [FOO_TOOLUSE]);
    await writeTranscript(sessionB, [BAR_TOOLUSE]);
    const cachePath = join(cacheDir, "usage-cache-codex.json");
    delete process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"];

    await collectUsageStats(projectsDir, { cachePath });
    let parsed = JSON.parse(await readFile(cachePath, "utf8"));
    assert.ok(parsed.files[sessionA]);
    assert.ok(parsed.files[sessionB]);

    await rm(sessionB);

    await collectUsageStats(projectsDir, { cachePath });
    parsed = JSON.parse(await readFile(cachePath, "utf8"));
    assert.ok(parsed.files[sessionA], "surviving file remains cached");
    assert.equal(parsed.files[sessionB], undefined, "deleted file is pruned from cache");
  } finally {
    await cleanup();
  }
});

test("collectUsageStats: AGENTIC_SKILL_ROUTER_USAGE_CACHE=0 disables read and write", async () => {
  const { projectsDir, cacheDir, cleanup } = await mkTmpProjects();
  try {
    const session = join(projectsDir, "proj-a", "session.jsonl");
    await writeTranscript(session, [FOO_TOOLUSE]);
    const cachePath = join(cacheDir, "usage-cache-codex.json");

    process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"] = "0";
    try {
      const stats = await collectUsageStats(projectsDir, { cachePath });
      assert.equal(stats.get("foo")?.callCount, 1);

      // Cache file must not have been created.
      await assert.rejects(() => readFile(cachePath, "utf8"), /ENOENT/);
    } finally {
      delete process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"];
    }
  } finally {
    await cleanup();
  }
});

test("collectUsageStats: no host and no cachePath skips caching entirely", async () => {
  const { projectsDir, cleanup } = await mkTmpProjects();
  try {
    const session = join(projectsDir, "proj-a", "session.jsonl");
    await writeTranscript(session, [FOO_TOOLUSE]);

    delete process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"];
    // Backwards-compatible single-arg form must still work and must not
    // create any side-effect cache file.
    const stats = await collectUsageStats(projectsDir);
    assert.equal(stats.get("foo")?.callCount, 1);
  } finally {
    await cleanup();
  }
});

// ─── diagnostics + since cutoff (issue #112) ────────────────────────────────

test("collectUsageStatsDetailed returns diagnostics with sensible counts", async () => {
  const { projectsDir, cleanup } = await mkTmpProjects();
  try {
    const sessionA = join(projectsDir, "proj-a", "session.jsonl");
    const sessionB = join(projectsDir, "proj-b", "session.jsonl");
    await writeTranscript(sessionA, [FOO_TOOLUSE]);
    await writeTranscript(sessionB, [BAR_TOOLUSE]);

    delete process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"];
    const { usage, diagnostics } = await collectUsageStatsDetailed(projectsDir);

    assert.equal(usage.get("foo")?.callCount, 1);
    assert.equal(usage.get("bar")?.callCount, 1);
    assert.equal(diagnostics.scannedFiles, 2);
    assert.equal(diagnostics.parsedFiles, 2, "fresh scan with no cache parses every file");
    assert.equal(diagnostics.cachedFiles, 0);
    assert.equal(diagnostics.skippedDirs, 0);
    assert.equal(typeof diagnostics.durationMs, "number");
    assert.ok(diagnostics.durationMs >= 0, "durationMs must be non-negative");
  } finally {
    await cleanup();
  }
});

test("collectUsageStatsDetailed reports cache hits as cachedFiles, not parsedFiles", async () => {
  const { projectsDir, cacheDir, cleanup } = await mkTmpProjects();
  try {
    const session = join(projectsDir, "proj-a", "session.jsonl");
    await writeTranscript(session, [FOO_TOOLUSE]);
    const cachePath = join(cacheDir, "usage-cache-codex.json");
    delete process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"];

    // First scan populates the cache.
    const first = await collectUsageStatsDetailed(projectsDir, { cachePath });
    assert.equal(first.diagnostics.parsedFiles, 1);
    assert.equal(first.diagnostics.cachedFiles, 0);

    // Second scan should hit the cache.
    const second = await collectUsageStatsDetailed(projectsDir, { cachePath });
    assert.equal(second.diagnostics.parsedFiles, 0);
    assert.equal(second.diagnostics.cachedFiles, 1);
    assert.equal(second.diagnostics.scannedFiles, 1);
  } finally {
    await cleanup();
  }
});

test("collectUsageStatsDetailed.skippedDirs counts EACCES/EPERM directory skips", async (t) => {
  if (process.platform === "win32") {
    t.skip("chmod-based unreadable dir test is unreliable on Windows");
    return;
  }
  if (process.getuid && process.getuid() === 0) {
    t.skip("root bypasses POSIX directory permission checks");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-usage-skipdir-diag-"));
  const projectsDir = join(root, "projects");
  const readableDir = join(projectsDir, "readable");
  const unreadableDir = join(projectsDir, "unreadable");
  await mkdir(readableDir, { recursive: true });
  await mkdir(unreadableDir, { recursive: true });
  await writeFile(join(readableDir, "session.jsonl"), FOO_TOOLUSE + "\n");
  await writeFile(join(unreadableDir, "session.jsonl"), BAR_TOOLUSE + "\n");
  await chmod(unreadableDir, 0o000);

  let dirIsActuallyBlocked = false;
  try {
    const { readdir } = await import("node:fs/promises");
    await readdir(unreadableDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    dirIsActuallyBlocked = code === "EACCES" || code === "EPERM";
  }
  if (!dirIsActuallyBlocked) {
    await chmod(unreadableDir, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    t.skip("filesystem did not honor chmod 0o000 (likely overlay/sandbox FS)");
    return;
  }

  const origError = console.error;
  console.error = () => undefined;
  try {
    const { diagnostics } = await collectUsageStatsDetailed(projectsDir);
    assert.equal(diagnostics.skippedDirs, 1, "unreadable subtree must be counted exactly once");
    assert.equal(diagnostics.scannedFiles, 1, "only the readable session should count as scanned");
    assert.equal(diagnostics.parsedFiles, 1);
  } finally {
    console.error = origError;
    await chmod(unreadableDir, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("collectUsageStatsDetailed: `since` skips files older than the cutoff", async () => {
  const { projectsDir, cleanup } = await mkTmpProjects();
  try {
    const oldSession = join(projectsDir, "proj-old", "session.jsonl");
    const newSession = join(projectsDir, "proj-new", "session.jsonl");
    await writeTranscript(oldSession, [FOO_TOOLUSE]);
    await writeTranscript(newSession, [BAR_TOOLUSE]);
    // Force the old session's mtime back well before any reasonable cutoff.
    const longAgo = new Date(Date.now() - 365 * 86_400_000);
    await utimes(oldSession, longAgo, longAgo);

    delete process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"];
    const since = new Date(Date.now() - 7 * 86_400_000);
    const { usage, diagnostics } = await collectUsageStatsDetailed(projectsDir, { since });

    assert.equal(usage.get("bar")?.callCount, 1, "recent session must still be parsed");
    assert.equal(usage.get("foo"), undefined, "old session must not be parsed");
    assert.equal(diagnostics.scannedFiles, 2, "both files are enumerated even when skipped by date");
    assert.equal(diagnostics.parsedFiles, 1);
    assert.equal(diagnostics.cachedFiles, 1, "since-skipped files are counted as cached");
  } finally {
    await cleanup();
  }
});

test("collectUsageStatsDetailed: `since` reuses old cache entries for skipped files", async () => {
  const { projectsDir, cacheDir, cleanup } = await mkTmpProjects();
  try {
    const session = join(projectsDir, "proj-old", "session.jsonl");
    await writeTranscript(session, [FOO_TOOLUSE]);
    const cachePath = join(cacheDir, "usage-cache-codex.json");
    delete process.env["AGENTIC_SKILL_ROUTER_USAGE_CACHE"];

    // Seed the cache while no cutoff is set.
    await collectUsageStatsDetailed(projectsDir, { cachePath });

    // Now backdate the file and re-scan with a 7-day cutoff. The file is now
    // older than the cutoff, but the cache still knows about it — coverage of
    // historical attribution must not regress.
    const longAgo = new Date(Date.now() - 365 * 86_400_000);
    await utimes(session, longAgo, longAgo);

    const since = new Date(Date.now() - 7 * 86_400_000);
    const { usage, diagnostics } = await collectUsageStatsDetailed(projectsDir, { cachePath, since });
    assert.equal(usage.get("foo")?.callCount, 1, "stale cache must still contribute to the merged result");
    assert.equal(diagnostics.parsedFiles, 0);
    assert.equal(diagnostics.cachedFiles, 1);
  } finally {
    await cleanup();
  }
});
