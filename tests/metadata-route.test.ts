import { test } from "node:test";
import assert from "node:assert/strict";
import { routeDisabledSkillsMetadata } from "../src/metadata-route.ts";
import type { Skill } from "../src/types.ts";

function skill(name: string, description: string, overrides: Partial<Skill> = {}): Skill {
  return {
    id: `user:codex:${name}`,
    name,
    description,
    metadata: { name, description },
    source: "user",
    pluginKey: null,
    skillMdPath: `/tmp/${name}/SKILL.md.skill-router-disabled`,
    isDisabled: true,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
    ...overrides,
  };
}

test("metadata route uses aliases and emits field-level evidence", () => {
  const larkMail = skill("lark-mail", "Send, reply, and search Lark email", {
    metadata: {
      name: "lark-mail",
      description: "Send, reply, and search Lark email",
      aliases: ["飞书邮箱", "lark mail", "feishu mail"],
      domains: ["lark", "feishu", "email"],
      intents: ["send_mail", "reply_mail", "search_mail"],
    },
  });
  const larkTask = skill("lark-task", "Manage Lark tasks", {
    metadata: {
      name: "lark-task",
      description: "Manage Lark tasks",
      aliases: ["飞书任务"],
    },
  });

  const result = routeDisabledSkillsMetadata([larkMail, larkTask], "帮我用飞书邮箱回复邮件", { topK: 3 });

  assert.equal(result.routeMode, "metadata");
  assert.equal(result.selected?.skill.id, "user:codex:lark-mail");
  assert.equal(result.selected?.confidence, "high");
  assert.ok(result.selected?.evidence?.some((e) => e.field === "alias" && /飞书邮箱/.test(e.text)));
});

test("metadata route does not select generic-only requests", () => {
  const generic = skill("platform-helper", "API tool query helper for managing platform workflows");
  const result = routeDisabledSkillsMetadata([generic], "查询 API 工具", { topK: 3 });

  assert.equal(result.selected, null);
  assert.equal(result.matches[0]?.confidence, "low");
});

test("metadata route prefers specific metadata over umbrella skills", () => {
  const umbrella = skill(
    "bytedcli",
    "Unified skill for the bytedcli command surface. Covers ES, Cache, BMQ, TCC, RDS, Hive, Dorado, Aeolus, Codebase, Devflow, TOS, ENV, Neptune, Log, APM, and many internal platforms.",
  );
  const es = skill("bytedance-es", "Query Elasticsearch via Kibana console API, execute ES DSL queries, and get ES index mapping.", {
    metadata: {
      name: "bytedance-es",
      description: "Query Elasticsearch via Kibana console API, execute ES DSL queries, and get ES index mapping.",
      aliases: ["Elasticsearch", "ES"],
      tools: ["Kibana console API", "Elasticsearch DSL"],
      intents: ["get_index_mapping", "execute_es_dsl"],
    },
  });

  const result = routeDisabledSkillsMetadata([umbrella, es], "通过 Kibana console API 执行 Elasticsearch DSL 查询并获取 index mapping", { topK: 3 });

  assert.equal(result.selected?.skill.id, "user:codex:bytedance-es");
  assert.ok(result.matches[0]?.score ?? 0 > (result.matches[1]?.score ?? 0));
  assert.ok(result.selected?.evidence?.some((e) => e.field === "tool"));
});
