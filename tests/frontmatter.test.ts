import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, parseFrontmatterWithWarnings } from "../src/frontmatter.ts";

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

test("returns empty object when opening frontmatter delimiter is not closed", () => {
  const src = `---
# Notes

name: body-text
description: this line looks like metadata but is not closed frontmatter`;
  assert.deepEqual(parseFrontmatter(src), {});
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

test("ignores nested mappings and keeps adjacent scalars", () => {
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

test("parses multiline description and top-level arrays", () => {
  const src = `---
name: lark-mail
description: |
  发送、回复、搜索飞书邮件
  支持附件和草稿。
aliases:
  - 飞书邮箱
  - lark mail
tags: [feishu, email]
---
# body`;
  const fm = parseFrontmatter(src);
  assert.equal(fm["name"], "lark-mail");
  assert.equal(fm["description"], "发送、回复、搜索飞书邮件\n支持附件和草稿。");
  assert.deepEqual(fm["aliases"], ["飞书邮箱", "lark mail"]);
  assert.deepEqual(fm["tags"], ["feishu", "email"]);
});

test("parses folded block scalars", () => {
  const src = `---
name: folded
description: >
  one line
  two line
---`;
  const fm = parseFrontmatter(src);
  assert.equal(fm["description"], "one line two line");
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

test("parseFrontmatterWithWarnings reports nested mappings", () => {
  const src = `---
name: lark-cli
description: A CLI
metadata:
  requires:
    bins: ["lark-cli"]
  cliHelp: "lark-cli mail --help"
license: MIT
---`;
  const { data, warnings } = parseFrontmatterWithWarnings(src);
  assert.equal(data["name"], "lark-cli");
  assert.equal(data["description"], "A CLI");
  assert.equal(data["license"], "MIT");
  assert.equal(data["metadata"], undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /skipped nested mapping under `metadata`/);
  assert.match(warnings[0]!, /line 5/);
});

test("parseFrontmatterWithWarnings warns on snake_case key with nested mapping", () => {
  // Regression: snake_case top-level keys with an indented mapping below them
  // used to be silently dropped. Now they must produce a warning so authors
  // can spot the missing routing metadata.
  const src = `---
name: lark-mail
description: A CLI
routing_metadata:
  aliases:
    - 飞书邮箱
tags: [feishu]
---`;
  const { data, warnings } = parseFrontmatterWithWarnings(src);
  assert.equal(data["name"], "lark-mail");
  assert.equal(data["routing_metadata"], undefined);
  assert.deepEqual(data["tags"], ["feishu"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /routing_metadata/);
  assert.match(warnings[0]!, /line 5/);
});

test("parseFrontmatterWithWarnings emits no warnings for supported forms", () => {
  const src = `---
name: lark-mail
description: |
  发送、回复、搜索飞书邮件
  支持附件和草稿。
aliases:
  - 飞书邮箱
  - lark mail
tags: [feishu, email]
license: "MIT"
---`;
  const { data, warnings } = parseFrontmatterWithWarnings(src);
  assert.deepEqual(warnings, []);
  assert.equal(data["name"], "lark-mail");
  assert.equal(data["description"], "发送、回复、搜索飞书邮件\n支持附件和草稿。");
  assert.deepEqual(data["aliases"], ["飞书邮箱", "lark mail"]);
  assert.deepEqual(data["tags"], ["feishu", "email"]);
  assert.equal(data["license"], "MIT");
});

test("parseFrontmatterWithWarnings returns empty when frontmatter is not closed", () => {
  const src = `---
name: unclosed
metadata:
  nested: value`;
  const { data, warnings } = parseFrontmatterWithWarnings(src);
  assert.deepEqual(data, {});
  assert.deepEqual(warnings, []);
});

test("parseFrontmatterWithWarnings drops block list-of-mapping with child lines and warns", () => {
  // Regression for #101: previously the parser silently stored each `- key: value`
  // line as a raw string (e.g. `["input: send email"]`), producing bogus
  // routing metadata. It must now drop the key and warn with the line number
  // of the first mapping item.
  const src = `---
name: lark-mail
description: A CLI
examples:
  - input: send email
    output: email body
license: MIT
---`;
  const { data, warnings } = parseFrontmatterWithWarnings(src);
  assert.equal(data["name"], "lark-mail");
  assert.equal(data["description"], "A CLI");
  assert.equal(data["license"], "MIT");
  assert.equal(data["examples"], undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /skipped list-of-mapping under `examples`/);
  assert.match(warnings[0]!, /line 5/);
});

test("parseFrontmatterWithWarnings drops single-line block list-of-mapping and warns", () => {
  // A `- key: value` item without further indented child lines is still a
  // YAML mapping in a sequence, not a plain string. Treat it the same as the
  // multi-line case so we don't silently include `key: value` as text.
  const src = `---
name: lark-mail
examples:
  - input: send email
license: MIT
---`;
  const { data, warnings } = parseFrontmatterWithWarnings(src);
  assert.equal(data["name"], "lark-mail");
  assert.equal(data["license"], "MIT");
  assert.equal(data["examples"], undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /skipped list-of-mapping under `examples`/);
  assert.match(warnings[0]!, /line 4/);
});

test("parseFrontmatterWithWarnings drops inline list-of-mapping and warns", () => {
  // Inline `[{...}]` flow arrays are also list-of-mapping in disguise; the
  // parser cannot meaningfully turn them into a string array, so it drops
  // the key and warns at the line of the `key:` line.
  const src = `---
name: lark-mail
examples: [{input: send email, output: email body}]
license: MIT
---`;
  const { data, warnings } = parseFrontmatterWithWarnings(src);
  assert.equal(data["name"], "lark-mail");
  assert.equal(data["license"], "MIT");
  assert.equal(data["examples"], undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /skipped list-of-mapping under `examples`/);
  assert.match(warnings[0]!, /line 3/);
});

test("parseFrontmatterWithWarnings still parses plain `- foo` block string arrays", () => {
  // Regression guard: the list-of-mapping detection must not break the
  // existing string-array form.
  const src = `---
name: lark-mail
aliases:
  - 飞书邮箱
  - lark mail
---`;
  const { data, warnings } = parseFrontmatterWithWarnings(src);
  assert.deepEqual(data["aliases"], ["飞书邮箱", "lark mail"]);
  assert.deepEqual(warnings, []);
});
