import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  loadState,
  saveState,
  addDisableRecord,
  removeDisableRecord,
  findDisableRecord,
  recordRoutedSkill,
  skillInstanceKey,
  withStateLock,
} from "../src/state.ts";
import type { DisableRecord } from "../src/types.ts";

async function tempPath(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "skill-router-state-"));
  return {
    path: join(dir, "state.json"),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("loadState returns empty state when file does not exist", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const state = await loadState(path);
    assert.equal(state.schema, 1);
    assert.equal(state.host, "claude-code");
    assert.deepEqual(state.disabledSkills, []);
  } finally {
    await cleanup();
  }
});

test("save -> load round-trip preserves records", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const rec: DisableRecord = {
      instanceKey: skillInstanceKey("user:lark-mail", "/tmp/lark-mail/SKILL.md"),
      id: "user:lark-mail",
      pluginKey: null,
      skillMdPath: "/tmp/lark-mail/SKILL.md",
      disabledAt: "2026-04-30T11:30:00.000Z",
      reason: "manual",
    };
    const saved = addDisableRecord({ schema: 1, host: "claude-code", disabledSkills: [] }, rec);
    await saveState(saved, path);
    const loaded = await loadState(path);
    assert.deepEqual(loaded.disabledSkills, [rec]);
  } finally {
    await cleanup();
  }
});

test("addDisableRecord deduplicates by instanceKey (replaces existing)", () => {
  const initial = { schema: 1 as const, host: "claude-code" as const, disabledSkills: [] };
  const a: DisableRecord = {
    instanceKey: skillInstanceKey("user:foo", "/p/SKILL.md"),
    id: "user:foo",
    pluginKey: null,
    skillMdPath: "/p/SKILL.md",
    disabledAt: "2026-01-01T00:00:00Z",
    reason: "first",
  };
  const b: DisableRecord = { ...a, disabledAt: "2026-02-01T00:00:00Z", reason: "second" };
  const after = addDisableRecord(addDisableRecord(initial, a), b);
  assert.equal(after.disabledSkills.length, 1);
  assert.equal(findDisableRecord(after, a.instanceKey)?.reason, "second");
});

test("addDisableRecord keeps both records when id is shared but skillMdPath differs", () => {
  const initial = { schema: 1 as const, host: "claude-code" as const, disabledSkills: [] };
  const a: DisableRecord = {
    instanceKey: skillInstanceKey("user:foo", "/a/SKILL.md"),
    id: "user:foo",
    pluginKey: null,
    skillMdPath: "/a/SKILL.md",
    disabledAt: "2026-01-01T00:00:00Z",
    reason: "first",
  };
  const b: DisableRecord = {
    instanceKey: skillInstanceKey("user:foo", "/b/SKILL.md"),
    id: "user:foo",
    pluginKey: null,
    skillMdPath: "/b/SKILL.md",
    disabledAt: "2026-02-01T00:00:00Z",
    reason: "second",
  };
  const after = addDisableRecord(addDisableRecord(initial, a), b);
  assert.equal(after.disabledSkills.length, 2);
  assert.notEqual(a.instanceKey, b.instanceKey);
  assert.equal(findDisableRecord(after, a.instanceKey)?.skillMdPath, "/a/SKILL.md");
  assert.equal(findDisableRecord(after, b.instanceKey)?.skillMdPath, "/b/SKILL.md");
});

test("removeDisableRecord drops the matching entry by instanceKey", () => {
  const a: DisableRecord = {
    instanceKey: skillInstanceKey("user:foo", "/p/SKILL.md"),
    id: "user:foo",
    pluginKey: null,
    skillMdPath: "/p/SKILL.md",
    disabledAt: "2026-01-01T00:00:00Z",
    reason: "x",
  };
  const after = removeDisableRecord(
    { schema: 1, host: "claude-code", disabledSkills: [a] },
    a.instanceKey,
  );
  assert.equal(after.disabledSkills.length, 0);
});

test("skillInstanceKey canonicalizes around the disabled marker suffix", () => {
  const live = skillInstanceKey("user:foo", "/skills/foo/SKILL.md");
  const disabled = skillInstanceKey("user:foo", "/skills/foo/SKILL.md.skill-router-disabled");
  assert.equal(live, disabled);
});

test("recordRoutedSkill increments routed usage by instanceKey", () => {
  const initial = { schema: 1 as const, host: "codex" as const, disabledSkills: [] };
  const first = recordRoutedSkill(initial, {
    id: "user:agents:lark-mail",
    pluginKey: null,
    skillMdPath: "/tmp/lark-mail/SKILL.md.skill-router-disabled",
    name: "lark-mail",
    query: "draft mail",
    confidence: "high",
    routedAt: "2026-05-20T00:00:00.000Z",
  });
  const second = recordRoutedSkill(first, {
    id: "user:agents:lark-mail",
    pluginKey: null,
    skillMdPath: "/tmp/lark-mail/SKILL.md.skill-router-disabled",
    name: "lark-mail",
    query: "reply mail",
    confidence: "medium",
    routedAt: "2026-05-21T00:00:00.000Z",
  });

  assert.equal(second.routedSkills?.length, 1);
  assert.equal(second.routedSkills?.[0]?.routeCount, 2);
  assert.equal(
    second.routedSkills?.[0]?.instanceKey,
    skillInstanceKey("user:agents:lark-mail", "/tmp/lark-mail/SKILL.md.skill-router-disabled"),
  );
  assert.equal(second.routedSkills?.[0]?.firstRoutedAt, "2026-05-20T00:00:00.000Z");
  assert.equal(second.routedSkills?.[0]?.lastRoutedAt, "2026-05-21T00:00:00.000Z");
  assert.equal(second.routedSkills?.[0]?.lastQuery, "reply mail");
});

test("recordRoutedSkill tracks two instances of the same id independently", () => {
  const initial = { schema: 1 as const, host: "codex" as const, disabledSkills: [] };
  const a = recordRoutedSkill(initial, {
    id: "user:agents:lark-mail",
    pluginKey: null,
    skillMdPath: "/tmp/lark-mail-a/SKILL.md.skill-router-disabled",
    name: "lark-mail",
    query: "draft mail",
    confidence: "high",
    routedAt: "2026-05-20T00:00:00.000Z",
  });
  const b = recordRoutedSkill(a, {
    id: "user:agents:lark-mail",
    pluginKey: null,
    skillMdPath: "/tmp/lark-mail-b/SKILL.md.skill-router-disabled",
    name: "lark-mail",
    query: "reply mail",
    confidence: "medium",
    routedAt: "2026-05-21T00:00:00.000Z",
  });

  // Both instances coexist; counts are independent.
  assert.equal(b.routedSkills?.length, 2);
  const byPath = new Map((b.routedSkills ?? []).map((r) => [r.skillMdPath, r]));
  assert.equal(byPath.get("/tmp/lark-mail-a/SKILL.md.skill-router-disabled")?.routeCount, 1);
  assert.equal(byPath.get("/tmp/lark-mail-b/SKILL.md.skill-router-disabled")?.routeCount, 1);
});

test("withStateLock serializes concurrent read-modify-write mutations", async () => {
  const { path, cleanup } = await tempPath();
  try {
    await saveState({ schema: 1, host: "codex", disabledSkills: [] }, path);
    await Promise.all([0, 1].map((idx) => withStateLock(path, async () => {
      const state = await loadState(path, "codex");
      await new Promise((resolve) => setTimeout(resolve, idx === 0 ? 25 : 0));
      await saveState(recordRoutedSkill(state, {
        id: "user:codex:mail",
        pluginKey: null,
        skillMdPath: "/tmp/mail/SKILL.md.skill-router-disabled",
        name: "mail",
        query: `q${idx}`,
        confidence: "high",
        routedAt: `2026-05-21T00:00:0${idx}.000Z`,
      }), path);
    })));

    const state = await loadState(path, "codex");
    assert.equal(state.routedSkills?.[0]?.routeCount, 2);
  } finally {
    await cleanup();
  }
});

test("withStateLock recovers expired legacy lock directories", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const lockPath = `${path}.lock`;
    await mkdir(lockPath);
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);

    let ran = false;
    await withStateLock(path, async () => {
      ran = true;
    }, { timeoutMs: 500, staleMs: 1 });

    assert.equal(ran, true);
    await assert.rejects(() => stat(lockPath), /ENOENT/);
  } finally {
    await cleanup();
  }
});

test("withStateLock recovers lock metadata from a dead owner process", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const lockPath = `${path}.lock`;
    await mkdir(lockPath);
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({
      pid: 99_999_999,
      createdAt: new Date().toISOString(),
      host: "codex",
      token: "dead-owner",
    }) + "\n");

    let ran = false;
    await withStateLock(path, async () => {
      ran = true;
    }, { timeoutMs: 500, staleMs: 60_000 });

    assert.equal(ran, true);
    await assert.rejects(() => stat(lockPath), /ENOENT/);
  } finally {
    await cleanup();
  }
});

test("withStateLock recovers an orphaned stale-recovery lock", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const lockPath = `${path}.lock`;
    const recoveryLockPath = `${lockPath}.recovering`;
    await mkdir(lockPath);
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({
      pid: 99_999_999,
      createdAt: new Date().toISOString(),
      host: "codex",
      token: "dead-owner",
    }) + "\n");
    await mkdir(recoveryLockPath);
    await writeFile(join(recoveryLockPath, "owner.json"), JSON.stringify({
      pid: 99_999_999,
      createdAt: new Date().toISOString(),
      host: "state-lock-recovery",
      token: "dead-recovery",
    }) + "\n");

    let ran = false;
    await withStateLock(path, async () => {
      ran = true;
    }, { timeoutMs: 500, staleMs: 60_000 });

    assert.equal(ran, true);
    await assert.rejects(() => stat(lockPath), /ENOENT/);
    await assert.rejects(() => stat(recoveryLockPath), /ENOENT/);
    const files = await readdir(dirname(path));
    assert.equal(files.some((file) => file.includes(".reaped.")), false);
  } finally {
    await cleanup();
  }
});

test("withStateLock preserves stale locks while another recovery owner is live", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const lockPath = `${path}.lock`;
    const recoveryLockPath = `${lockPath}.recovering`;
    await mkdir(lockPath);
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    await mkdir(recoveryLockPath);
    await writeFile(join(recoveryLockPath, "owner.json"), JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      host: "state-lock-recovery",
      token: "live-recovery",
    }) + "\n");

    await assert.rejects(
      () => withStateLock(path, async () => {}, { timeoutMs: 100, staleMs: 1 }),
      /timed out waiting for state lock/,
    );
    await stat(lockPath);
    await stat(recoveryLockPath);
  } finally {
    await cleanup();
  }
});

test("withStateLock preserves live-owner locks and keeps timeout behavior", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const lockPath = `${path}.lock`;
    await mkdir(lockPath);
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({
      pid: process.pid,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      host: "codex",
      token: "live-owner",
    }) + "\n");

    await assert.rejects(
      () => withStateLock(path, async () => {}, { timeoutMs: 100, staleMs: 1 }),
      /timed out waiting for state lock/,
    );
    await stat(lockPath);
  } finally {
    await cleanup();
  }
});

test("loadState rejects malformed schema", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ schema: 99, host: "x", disabledSkills: [] }));
    await assert.rejects(() => loadState(path), /unexpected schema/);
  } finally {
    await cleanup();
  }
});

test("loadState drops malformed records and snapshots original to .bak", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const { writeFile, mkdir, readdir, readFile: rf } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(path), { recursive: true });
    const original = JSON.stringify({
      schema: 1,
      host: "claude-code",
      disabledSkills: [
        {
          id: "user:foo",
          pluginKey: null,
          skillMdPath: "/tmp/foo/SKILL.md",
          disabledAt: "2026-01-01T00:00:00Z",
          reason: "manual",
        },
        { id: "broken" },
        { id: "", pluginKey: null, skillMdPath: "/x", disabledAt: "y", reason: "z" },
        ["not", "a", "record"],
      ],
    });
    await writeFile(path, original);
    const state = await loadState(path);
    assert.equal(state.disabledSkills.length, 1);
    assert.equal(state.disabledSkills[0]!.id, "user:foo");

    // A `.malformed.<ts>.bak` sibling should now exist with original content
    const dir = dirname(path);
    const siblings = await readdir(dir);
    const bak = siblings.find((f) => f.startsWith("state.json.malformed.") && f.endsWith(".bak"));
    assert.ok(bak, `expected a .malformed.*.bak sibling, got ${siblings.join(", ")}`);
    const bakContent = await rf(`${dir}/${bak}`, "utf8");
    assert.equal(bakContent, original);
  } finally {
    await cleanup();
  }
});

test("loadState synthesizes instanceKey for legacy records that lack one", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(path), { recursive: true });
    // Legacy state file written by an older release: no `instanceKey` field
    // anywhere, two records that share `id` but live at different paths.
    const legacy = JSON.stringify({
      schema: 1,
      host: "claude-code",
      disabledSkills: [
        {
          id: "user:foo",
          pluginKey: null,
          skillMdPath: "/skills/a/SKILL.md.skill-router-disabled",
          disabledAt: "2026-01-01T00:00:00Z",
          reason: "manual",
        },
        {
          id: "user:foo",
          pluginKey: null,
          skillMdPath: "/skills/b/SKILL.md.skill-router-disabled",
          disabledAt: "2026-01-02T00:00:00Z",
          reason: "manual",
        },
      ],
      routedSkills: [
        {
          id: "user:foo",
          pluginKey: null,
          skillMdPath: "/skills/a/SKILL.md.skill-router-disabled",
          name: "foo",
          routeCount: 3,
          firstRoutedAt: "2026-01-01T00:00:00Z",
          lastRoutedAt: "2026-01-05T00:00:00Z",
          lastQuery: "do thing",
          lastConfidence: "high",
        },
      ],
    });
    await writeFile(path, legacy);
    const state = await loadState(path);
    assert.equal(state.disabledSkills.length, 2);
    const keys = state.disabledSkills.map((r) => r.instanceKey);
    assert.equal(keys[0], skillInstanceKey("user:foo", "/skills/a/SKILL.md.skill-router-disabled"));
    assert.equal(keys[1], skillInstanceKey("user:foo", "/skills/b/SKILL.md.skill-router-disabled"));
    assert.notEqual(keys[0], keys[1]);
    assert.equal(state.routedSkills?.[0]?.instanceKey, keys[0]);
    // After saveState, the synthesized instanceKey persists.
    await saveState(state, path);
    const reread = await loadState(path);
    assert.deepEqual(reread, state);
  } finally {
    await cleanup();
  }
});

test("saveState writes per-process unique tmp file (no shared .tmp)", async () => {
  const { path, cleanup } = await tempPath();
  try {
    const { saveState } = await import("../src/state.ts");
    await saveState({ schema: 1, host: "claude-code", disabledSkills: [] }, path);
    const { readdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const files = await readdir(dirname(path));
    // Only the final state.json should remain — no leftover tmp file
    assert.equal(files.includes("state.json"), true);
    assert.equal(files.some((f) => f.endsWith(".tmp")), false);
  } finally {
    await cleanup();
  }
});
