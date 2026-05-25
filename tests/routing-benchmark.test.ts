import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeDisabledSkillsMetadata } from "../src/metadata-route.ts";
import type { Skill } from "../src/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BenchmarkCase {
  query: string;
  expected: string[];
  shouldRoute: boolean;
  type: string;
}

function fixtureSkill(name: string, description: string, metadata: Skill["metadata"] = { name, description }): Skill {
  return {
    id: `user:codex:${name}`,
    name,
    description,
    metadata,
    source: "user",
    pluginKey: null,
    skillMdPath: `/tmp/${name}/SKILL.md.agentic-skill-router-disabled`,
    isDisabled: true,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  };
}

test("metadata router benchmark smoke test", async () => {
  const raw = await readFile(join(__dirname, "fixtures", "routing-benchmark.json"), "utf8");
  const cases = JSON.parse(raw) as BenchmarkCase[];
  const skills: Skill[] = [
    fixtureSkill("lark-mail", "发送、回复、搜索飞书邮件", {
      name: "lark-mail",
      description: "发送、回复、搜索飞书邮件",
      aliases: ["飞书邮箱", "飞书邮件", "lark mail", "feishu mail"],
      domains: ["lark", "feishu", "email"],
      intents: ["send_mail", "reply_mail", "search_mail"],
    }),
    fixtureSkill("lark-task", "管理飞书任务和待办", {
      name: "lark-task",
      description: "管理飞书任务和待办",
      aliases: ["飞书任务"],
    }),
    fixtureSkill("bytedance-es", "Query Elasticsearch via Kibana console API, execute ES DSL queries, and get ES index mapping.", {
      name: "bytedance-es",
      description: "Query Elasticsearch via Kibana console API, execute ES DSL queries, and get ES index mapping.",
      aliases: ["Elasticsearch", "ES"],
      tools: ["Kibana console API", "Elasticsearch DSL"],
      intents: ["execute_es_dsl", "get_index_mapping"],
    }),
    fixtureSkill("bytedcli", "Unified skill for the bytedcli command surface. Covers auth/tokens, ES, Cache, BMQ, Log, APM, and many internal platforms."),
    fixtureSkill("bytedance-auth", "Operate bytedcli authentication flows: login, logout, status, user info, SSO JWT, and ByteCloud Auth token.", {
      name: "bytedance-auth",
      description: "Operate bytedcli authentication flows: login, logout, status, user info, SSO JWT, and ByteCloud Auth token.",
      aliases: ["bytedcli auth"],
      tools: ["bytedcli auth"],
      intents: ["login", "logout", "status", "get_user_info", "prepare_sso_jwt"],
    }),
  ];

  for (const item of cases) {
    const result = routeDisabledSkillsMetadata(skills, item.query, { topK: 3 });
    if (!item.shouldRoute) {
      assert.equal(result.selected, null, `${item.type} should not route`);
      continue;
    }
    assert.ok(result.selected, `${item.type} should route`);
    assert.equal(result.selected!.skill.id, item.expected[0], `${item.type} selected wrong skill`);
  }
});
