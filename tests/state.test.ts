import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadState,
  saveState,
  addDisableRecord,
  removeDisableRecord,
  findDisableRecord,
  recordRoutedSkill,
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

test("addDisableRecord deduplicates by id (replaces existing)", () => {
  const initial = { schema: 1 as const, host: "claude-code" as const, disabledSkills: [] };
  const a: DisableRecord = {
    id: "user:foo",
    pluginKey: null,
    skillMdPath: "/p/SKILL.md",
    disabledAt: "2026-01-01T00:00:00Z",
    reason: "first",
  };
  const b: DisableRecord = { ...a, disabledAt: "2026-02-01T00:00:00Z", reason: "second" };
  const after = addDisableRecord(addDisableRecord(initial, a), b);
  assert.equal(after.disabledSkills.length, 1);
  assert.equal(findDisableRecord(after, "user:foo")?.reason, "second");
});

test("removeDisableRecord drops the matching entry", () => {
  const a: DisableRecord = {
    id: "user:foo",
    pluginKey: null,
    skillMdPath: "/p/SKILL.md",
    disabledAt: "2026-01-01T00:00:00Z",
    reason: "x",
  };
  const after = removeDisableRecord(
    { schema: 1, host: "claude-code", disabledSkills: [a] },
    "user:foo",
  );
  assert.equal(after.disabledSkills.length, 0);
});

test("recordRoutedSkill increments routed usage by skill id", () => {
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
  assert.equal(second.routedSkills?.[0]?.firstRoutedAt, "2026-05-20T00:00:00.000Z");
  assert.equal(second.routedSkills?.[0]?.lastRoutedAt, "2026-05-21T00:00:00.000Z");
  assert.equal(second.routedSkills?.[0]?.lastQuery, "reply mail");
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
