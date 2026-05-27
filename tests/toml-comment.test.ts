import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodexPluginSettings, stripTomlComment } from "../src/scan.ts";

test("stripTomlComment leaves lines without comments unchanged (minus trailing ws)", () => {
  assert.equal(stripTomlComment("enabled = true"), "enabled = true");
  assert.equal(stripTomlComment("  enabled = true  "), "  enabled = true");
  assert.equal(stripTomlComment(""), "");
});

test("stripTomlComment strips a trailing whole-line comment", () => {
  assert.equal(stripTomlComment("# only a comment"), "");
  assert.equal(stripTomlComment("   # indented comment"), "");
});

test("stripTomlComment strips a trailing inline comment and surrounding ws", () => {
  assert.equal(stripTomlComment("enabled = true   # toggle"), "enabled = true");
  assert.equal(stripTomlComment('name = "x"# tight'), 'name = "x"');
});

test("stripTomlComment treats `#` inside double-quoted strings as a literal char", () => {
  assert.equal(stripTomlComment('name = "skill#1"'), 'name = "skill#1"');
  assert.equal(stripTomlComment('name = "skill#1" # real comment'), 'name = "skill#1"');
  // Multiple `#` inside one string must all stay.
  assert.equal(stripTomlComment('hash = "a#b#c"'), 'hash = "a#b#c"');
});

test("stripTomlComment treats `#` inside single-quoted (literal) strings as a literal char", () => {
  assert.equal(stripTomlComment("name = 'x#y'"), "name = 'x#y'");
  assert.equal(stripTomlComment("name = 'x#y' # real comment"), "name = 'x#y'");
});

test("stripTomlComment respects backslash-escaped quote inside basic strings", () => {
  // The escaped \" must not close the string, so the trailing # stays inside.
  assert.equal(stripTomlComment('name = "a\\"b#c"'), 'name = "a\\"b#c"');
  // Same line with an actual comment after the real closing quote.
  assert.equal(stripTomlComment('name = "a\\"b#c" # tail'), 'name = "a\\"b#c"');
});

test("stripTomlComment does NOT honor escapes inside literal (single-quoted) strings", () => {
  // In TOML literal strings, backslash is literal. So `'a\'` closes at the
  // second `'`, and the trailing `b#c'` becomes a stray sequence outside any
  // string. After the closing quote, `#` is a comment marker.
  assert.equal(stripTomlComment("name = 'a\\'b#c'"), "name = 'a\\'b");
});

test("stripTomlComment handles triple-quoted basic strings", () => {
  assert.equal(stripTomlComment('blob = """a#b"""'), 'blob = """a#b"""');
  assert.equal(stripTomlComment('blob = """a#b""" # tail'), 'blob = """a#b"""');
});

test("stripTomlComment handles triple-quoted literal strings", () => {
  assert.equal(stripTomlComment("blob = '''a#b'''"), "blob = '''a#b'''");
  assert.equal(stripTomlComment("blob = '''a#b''' # tail"), "blob = '''a#b'''");
});

test("stripTomlComment keeps section headers with `#` inside quoted names", () => {
  assert.equal(stripTomlComment('[plugins."weird#name"]'), '[plugins."weird#name"]');
  assert.equal(stripTomlComment('[plugins."weird#name"] # comment'), '[plugins."weird#name"]');
});

async function withCodexConfig<T>(contents: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-toml-"));
  try {
    await mkdir(dir, { recursive: true });
    const p = join(dir, "config.toml");
    await writeFile(p, contents);
    return await fn(p);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readCodexPluginSettings accepts quoted plugin names containing `#`", async () => {
  await withCodexConfig(
    [
      '[plugins."weird#name"]',
      "enabled = true",
      "",
      '[plugins."other@scope"]',
      "enabled = false # turned off",
      "",
    ].join("\n"),
    async (path) => {
      const settings = await readCodexPluginSettings(path);
      assert.deepEqual(settings.enabledPlugins, {
        "weird#name": true,
        "other@scope": false,
      });
    },
  );
});

test("readCodexPluginSettings ignores `#` inside string values when matching `enabled`", async () => {
  // `enabled` is the only key we read, but make sure an unrelated key with a
  // `#` in its value does not corrupt the section-following `enabled` line.
  await withCodexConfig(
    ['[plugins."gmail@openai-curated"]', 'name = "gmail#alpha"', "enabled = true", ""].join("\n"),
    async (path) => {
      const settings = await readCodexPluginSettings(path);
      assert.deepEqual(settings.enabledPlugins, {
        "gmail@openai-curated": true,
      });
    },
  );
});

test("readCodexPluginSettings preserves prior behavior on canonical Codex config", async () => {
  // Regression guard: the exact shape produced by tests/codex.test.ts.
  await withCodexConfig(
    [
      '[plugins."gmail@openai-curated"]',
      "enabled = true",
      "",
      '[plugins."browser-use@openai-bundled"]',
      "enabled = false",
      "",
    ].join("\n"),
    async (path) => {
      const settings = await readCodexPluginSettings(path);
      assert.deepEqual(settings.enabledPlugins, {
        "gmail@openai-curated": true,
        "browser-use@openai-bundled": false,
      });
    },
  );
});

test("readCodexPluginSettings returns {} for missing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentic-skill-router-toml-missing-"));
  try {
    const result = await readCodexPluginSettings(join(dir, "nope.toml"));
    assert.deepEqual(result, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
