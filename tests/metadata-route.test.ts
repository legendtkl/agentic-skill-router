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
    skillMdPath: `/tmp/${name}/SKILL.md.agentic-skill-router-disabled`,
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
  assert.ok(result.selected?.evidence?.some((e) => e.field === "alias" && /飞书邮箱/.test(e.text ?? "")));
});

test("metadata route does not promote short alias substrings to exact matches", () => {
  const ai = skill("ai-helper", "AI workflow helper", {
    metadata: {
      name: "ai-helper",
      description: "AI workflow helper",
      aliases: ["ai"],
      intents: ["summarize_report"],
    },
  });

  const result = routeDisabledSkillsMetadata([ai], "OpenAI workflow daily report paid ads aiops", { topK: 3 });

  assert.equal(result.selected, null);
  assert.notEqual(result.matches[0]?.confidence, "high");
  assert.ok(!result.matches[0]?.reason.includes("matched alias"));
});

test("metadata route keeps exact short alias queries high confidence", () => {
  const ai = skill("ai-helper", "AI workflow helper", {
    metadata: {
      name: "ai-helper",
      description: "AI workflow helper",
      aliases: ["ai"],
    },
  });

  const result = routeDisabledSkillsMetadata([ai], "ai", { topK: 3 });

  assert.equal(result.selected?.skill.id, "user:codex:ai-helper");
  assert.equal(result.selected?.confidence, "high");
  assert.ok(result.selected?.reason.includes("matched alias"));
});

test("metadata route keeps standalone short aliases selectable in longer queries", () => {
  const ai = skill("ai-helper", "AI workflow helper", {
    metadata: {
      name: "ai-helper",
      description: "AI workflow helper",
      aliases: ["ai"],
    },
  });

  const result = routeDisabledSkillsMetadata([ai], "use ai", { topK: 3 });

  assert.equal(result.selected?.skill.id, "user:codex:ai-helper");
  assert.equal(result.selected?.confidence, "high");
  assert.ok(result.selected?.reason.includes("matched alias phrase"));
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

test("metadata-route evidence isGeneric is computed on the normalized form (#152)", () => {
  // The whole-field evidence row uses `item.text` verbatim, which may
  // include casing/punctuation (e.g. an alias literally spelled `API`).
  // Without normalization, `isGenericTerm("API")` returns false even
  // though the canonical lowercase `api` is on the metadata stop list,
  // so the same logical match is flagged inconsistently depending on
  // how the source text happens to be cased.
  const apiSkill = skill("api-helper", "API helper", {
    metadata: {
      name: "api-helper",
      description: "API helper",
      aliases: ["API"],
    },
  });

  const result = routeDisabledSkillsMetadata([apiSkill], "api", { topK: 1 });
  const evidence = result.matches[0]?.evidence ?? [];
  for (const entry of evidence) {
    if (entry.matched === "API" || entry.matched === "api") {
      assert.equal(
        entry.isGeneric,
        true,
        `expected isGeneric=true for ${JSON.stringify(entry)}`,
      );
    }
  }
});
