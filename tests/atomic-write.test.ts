import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomicWriteFile, atomicWriteJson } from "../src/atomic-write.ts";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-atomic-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("atomicWriteFile writes target with the exact content", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "out.txt");
    await atomicWriteFile(target, "hello\nworld\n");
    const read = await readFile(target, "utf8");
    assert.equal(read, "hello\nworld\n");
  });
});

test("atomicWriteJson writes a pretty-printed JSON file by default", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "state.json");
    await atomicWriteJson(target, { a: 1, b: ["x", "y"] });
    const read = await readFile(target, "utf8");
    // Pretty default: 2-space indent and a trailing newline.
    assert.equal(read, '{\n  "a": 1,\n  "b": [\n    "x",\n    "y"\n  ]\n}\n');
  });
});

test("atomicWriteJson honors pretty: false", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "compact.json");
    await atomicWriteJson(target, { a: 1, b: 2 }, { pretty: false });
    const read = await readFile(target, "utf8");
    assert.equal(read, '{"a":1,"b":2}');
  });
});

test("concurrent writes within the same millisecond use distinct temp paths", async () => {
  await withTempDir(async (dir) => {
    // Pin Date.now so every call sees the exact same clock — without the
    // randomUUID() suffix added in #108 the two writers would race for the
    // same temp file and one would fail with EEXIST against the temp.
    const realNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      const a = join(dir, "a.json");
      const b = join(dir, "b.json");
      await Promise.all([atomicWriteJson(a, { which: "a" }), atomicWriteJson(b, { which: "b" })]);
      const ra = JSON.parse(await readFile(a, "utf8")) as { which: string };
      const rb = JSON.parse(await readFile(b, "utf8")) as { which: string };
      assert.equal(ra.which, "a");
      assert.equal(rb.which, "b");
    } finally {
      Date.now = realNow;
    }

    // No leftover temp files in the directory.
    const entries = await readdir(dir);
    const stragglers = entries.filter((n) => n.includes(".tmp."));
    assert.deepEqual(stragglers, [], `unexpected temp files: ${stragglers.join(", ")}`);
  });
});

test("two same-target writers serialize without leaving partial state", async () => {
  await withTempDir(async (dir) => {
    // Even though saveState callers serialize via withStateLock, the helper
    // itself must not corrupt the file when two concurrent writers race on the
    // same target. One of the two writes must win and the file must be valid
    // JSON matching one of the inputs.
    const target = join(dir, "race.json");
    await Promise.all([atomicWriteJson(target, { winner: "first" }), atomicWriteJson(target, { winner: "second" })]);
    const parsed = JSON.parse(await readFile(target, "utf8")) as { winner: string };
    assert.ok(parsed.winner === "first" || parsed.winner === "second");

    const entries = await readdir(dir);
    const stragglers = entries.filter((n) => n.includes(".tmp."));
    assert.deepEqual(stragglers, [], `unexpected temp files: ${stragglers.join(", ")}`);
  });
});

test("durable: true leaves the data on disk after the write resolves", async () => {
  await withTempDir(async (dir) => {
    // We can't actually pull the power, but we can verify two surrogate
    // signals that together would be necessary for crash durability:
    //   1. The file exists at the target path with the requested content.
    //   2. No temp file is left behind — the rename completed.
    // The internal fsync calls are exercised by code path; an fsync that
    // throws would surface as a rejection here.
    const target = join(dir, "durable.json");
    await atomicWriteJson(target, { ok: true }, { durable: true });
    const parsed = JSON.parse(await readFile(target, "utf8")) as { ok: boolean };
    assert.equal(parsed.ok, true);

    const entries = await readdir(dir);
    assert.deepEqual(entries, ["durable.json"]);
  });
});

test("durable: false skips fsync but still writes atomically", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "no-durable.json");
    await atomicWriteJson(target, { ok: true }, { durable: false });
    const parsed = JSON.parse(await readFile(target, "utf8")) as { ok: boolean };
    assert.equal(parsed.ok, true);
  });
});

test("mode is honored on the created file", async () => {
  if (process.platform === "win32") {
    // Windows POSIX mode bits do not map cleanly to NTFS ACLs; skip.
    return;
  }
  // Temporarily zero the umask so open(O_CREAT) applies the requested mode
  // exactly. Without this, a restrictive umask (e.g. 0o077) would mask out
  // bits from the requested mode and cause the assertions to fail.
  const savedUmask = process.umask(0);
  try {
    await withTempDir(async (dir) => {
      const target = join(dir, "mode-600.txt");
      await atomicWriteFile(target, "x", { mode: 0o600 });
      const s = await stat(target);
      assert.equal(s.mode & 0o777, 0o600);

      const target2 = join(dir, "mode-644.txt");
      await atomicWriteFile(target2, "x", { mode: 0o644 });
      const s2 = await stat(target2);
      assert.equal(s2.mode & 0o777, 0o644);
    });
  } finally {
    process.umask(savedUmask);
  }
});

test("on a serialization error, the temp file is cleaned up", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "broken.json");
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    await assert.rejects(atomicWriteJson(target, circular), /circular|JSON/i);

    const entries = await readdir(dir);
    assert.deepEqual(entries, [], `unexpected files left behind: ${entries.join(", ")}`);
  });
});

test("on a write error to a nonexistent directory, no temp file leaks", async () => {
  await withTempDir(async (dir) => {
    const missingDir = join(dir, "does-not-exist");
    const target = join(missingDir, "file.txt");
    await assert.rejects(atomicWriteFile(target, "x"));

    // Parent dir was never created, so nothing to inspect there. Confirm the
    // tempdir root is still clean.
    const entries = await readdir(dir);
    assert.deepEqual(entries, []);
  });
});
