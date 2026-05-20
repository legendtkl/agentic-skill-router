import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter } from "../src/frontmatter.ts";

test("parses simple key:value pairs", () => {
  const src = `---
name: lark-mail
description: Feishu email management
---
# body`;
  const fm = parseFrontmatter(src);
  assert.equal(fm["name"], "lark-mail");
  assert.equal(fm["description"], "Feishu email management");
});

test("returns empty object when no frontmatter delimiters", () => {
  assert.deepEqual(parseFrontmatter("# just a heading\nnothing here"), {});
});

test("strips quotes and preserves Chinese description", () => {
  const src = `---
name: lark-im
description: "飞书即时通讯 — 收发消息和管理群聊"
version: '1.0.0'
---`;
  const fm = parseFrontmatter(src);
  assert.equal(fm["name"], "lark-im");
  assert.equal(fm["description"], "飞书即时通讯 — 收发消息和管理群聊");
  assert.equal(fm["version"], "1.0.0");
});

test("ignores nested mappings (e.g. metadata: with indented children)", () => {
  const src = `---
name: lark-cli
description: A CLI
metadata:
  requires:
    bins: ["lark-cli"]
  cliHelp: "lark-cli mail --help"
license: MIT
---`;
  const fm = parseFrontmatter(src);
  assert.equal(fm["name"], "lark-cli");
  assert.equal(fm["description"], "A CLI");
  assert.equal(fm["license"], "MIT");
  assert.equal(fm["metadata"], undefined);
});

test("handles tolerable whitespace around colons and values", () => {
  const src = `---
name :    spaced-out
description:   trimmed
---`;
  const fm = parseFrontmatter(src);
  assert.equal(fm["name"], "spaced-out");
  assert.equal(fm["description"], "trimmed");
});

test("returns {} when frontmatter delimiters are missing", () => {
  const src = `name: looks-like-yaml-but-no-delim
description: foo`;
  assert.deepEqual(parseFrontmatter(src), {});
});

test("handles license URL with colons", () => {
  const src = `---
name: x
license: https://example.com/license
---`;
  const fm = parseFrontmatter(src);
  assert.equal(fm["license"], "https://example.com/license");
});
