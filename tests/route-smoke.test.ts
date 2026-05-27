// Deterministic routing smoke test. This is intentionally narrow: a handful of
// hand-curated cases from tests/fixtures/route-cases.json are routed through
// the same auto-route entry point that `scripts/eval-route.mjs` uses, and we
// assert only that each case selects its expected skill id. The full eval
// remains informational (it does not fail CI); this file is the gate that
// catches obvious routing regressions before merge. See issue #115.
//
// Cases are copied inline rather than loaded from the fixture so the smoke
// test stays independent of fixture churn — when the full fixture grows or
// rebalances, this file should only need updates when the curated set itself
// is intentionally rebalanced.
import { test } from "node:test";
import assert from "node:assert/strict";

import { routeDisabledSkillsMetadata } from "../src/metadata-route.ts";
import type { Skill, SkillMetadata } from "../src/types.ts";

interface SmokeSkillSpec {
  id: string;
  name: string;
  description: string;
  metadata: SkillMetadata;
}

interface SmokeCase {
  name: string;
  query: string;
  expected: string;
}

// Skill catalog mirrors the high-value entries in
// tests/fixtures/route-cases.json. Keep this list small — the smoke test must
// stay fast and obvious. Add a new skill only when a new curated case requires
// it.
const SKILLS: readonly SmokeSkillSpec[] = [
  {
    id: "user:codex:lark-mail",
    name: "lark-mail",
    description: "发送、回复、搜索飞书邮件",
    metadata: {
      name: "lark-mail",
      description: "发送、回复、搜索飞书邮件",
      aliases: ["飞书邮箱", "飞书邮件", "lark mail", "feishu mail"],
      domains: ["lark", "feishu", "email"],
      intents: ["send_mail", "reply_mail", "search_mail"],
    },
  },
  {
    id: "user:codex:lark-task",
    name: "lark-task",
    description: "管理飞书任务和待办",
    metadata: {
      name: "lark-task",
      description: "管理飞书任务和待办",
      aliases: ["飞书任务"],
      domains: ["lark", "feishu"],
      intents: ["create_task", "update_task"],
    },
  },
  {
    id: "user:codex:lark-approval",
    name: "lark-approval",
    description: "飞书审批：审批实例、审批任务管理。",
    metadata: {
      name: "lark-approval",
      description: "飞书审批：审批实例、审批任务管理。",
      aliases: ["飞书审批", "lark approval"],
      domains: ["lark", "feishu"],
      intents: ["approve_instance", "list_approvals"],
    },
  },
  {
    id: "user:codex:bytedance-es",
    name: "bytedance-es",
    description:
      "Query Elasticsearch via Kibana console API: execute ES DSL queries, search indices, retrieve documents, and get ES index mapping.",
    metadata: {
      name: "bytedance-es",
      description:
        "Query Elasticsearch via Kibana console API: execute ES DSL queries, search indices, retrieve documents, and get ES index mapping.",
      aliases: ["Elasticsearch", "ES"],
      tools: ["Kibana console API", "Elasticsearch DSL"],
      domains: ["bytedance", "search"],
      intents: ["execute_es_dsl", "get_index_mapping"],
    },
  },
  {
    id: "user:codex:bytedance-auth",
    name: "bytedance-auth",
    description:
      "Operate bytedcli authentication flows: login, logout, status, user info, SSO JWT, and ByteCloud Auth token.",
    metadata: {
      name: "bytedance-auth",
      description:
        "Operate bytedcli authentication flows: login, logout, status, user info, SSO JWT, and ByteCloud Auth token.",
      aliases: ["bytedcli auth", "bytedance auth"],
      tools: ["bytedcli auth"],
      domains: ["bytedance"],
      intents: ["login", "logout", "status", "get_user_info", "prepare_sso_jwt"],
    },
  },
  {
    id: "user:codex:tea-data-query",
    name: "tea-data-query",
    description:
      "TEA 数据查询工具。输入一个 TEA 的 URL 链接，自动解析 project_id、dashboard_id 或 report_id，通过 DataOpen API 查询并展示数据。支持 Dashboard 和 Report。",
    metadata: {
      name: "tea-data-query",
      description:
        "TEA 数据查询工具。输入一个 TEA 的 URL 链接，自动解析 project_id、dashboard_id 或 report_id，通过 DataOpen API 查询并展示数据。支持 Dashboard 和 Report。",
      aliases: ["TEA"],
      tools: ["DataOpen API"],
      intents: ["query_dashboard", "query_report"],
    },
  },
  {
    id: "user:codex:bytedcli",
    name: "bytedcli",
    description:
      "Unified skill for the bytedcli command surface. Covers auth/tokens, ES, Cache, BMQ, TCC, RDS, Hive, Dorado, Aeolus, Codebase, Devflow, TOS, ENV, Neptune, Log, APM, and many internal platforms. Router skill that routes to subskills.",
    metadata: {
      name: "bytedcli",
      description:
        "Unified skill for the bytedcli command surface. Covers auth/tokens, ES, Cache, BMQ, TCC, RDS, Hive, Dorado, Aeolus, Codebase, Devflow, TOS, ENV, Neptune, Log, APM, and many internal platforms. Router skill that routes to subskills.",
    },
  },
  {
    id: "user:codex:agentic-skill-router-skills",
    name: "agentic-skill-router-skills",
    description:
      "Use when the user asks to audit, slim, disable, restore, or route locally installed Agent Skills across supported hosts.",
    metadata: {
      name: "agentic-skill-router-skills",
      description:
        "Use when the user asks to audit, slim, disable, restore, or route locally installed Agent Skills across supported hosts.",
      aliases: ["skill router", "agentic-skill-router"],
      domains: ["agent-skills"],
      intents: ["audit_skills", "disable_skill", "restore_skill", "route_skill"],
    },
  },
];

// Curated cases cover the dimensions called out in issue #115: Chinese query,
// English query, API/product name, and umbrella-vs-specific disambiguation.
// Each case is taken verbatim from tests/fixtures/route-cases.json and is one
// the current metadata route reliably selects (see `npm run eval:route -- --mode=metadata --json`).
// Cases the full eval flags as `ambiguous reject` are intentionally excluded
// — the smoke test is a regression gate for confidently-selected cases, not a
// quality bar for borderline ones.
const CASES: readonly SmokeCase[] = [
  { name: "exact-name-en", query: "lark mail", expected: "user:codex:lark-mail" },
  { name: "alias-cjk-paraphrase", query: "帮我用飞书邮箱回复邮件", expected: "user:codex:lark-mail" },
  { name: "approval-distinctive-cjk", query: "查询飞书审批实例", expected: "user:codex:lark-approval" },
  {
    name: "tool-api-multi-domain",
    query: "通过 Kibana console API 执行 Elasticsearch DSL 查询并获取 index mapping",
    expected: "user:codex:bytedance-es",
  },
  { name: "api-name-en", query: "use Kibana console API to get index mapping", expected: "user:codex:bytedance-es" },
  {
    name: "umbrella-vs-specific",
    query: "操作 bytedcli auth login status 获取 user info",
    expected: "user:codex:bytedance-auth",
  },
  {
    name: "product-name-agentic-skill-router",
    query: "audit installed skill router skills and disable unused ones",
    expected: "user:codex:agentic-skill-router-skills",
  },
];

function materializeSkills(specs: readonly SmokeSkillSpec[]): Skill[] {
  return specs.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    metadata: spec.metadata,
    source: "user",
    pluginKey: null,
    skillMdPath: `virtual://${spec.name}/SKILL.md.agentic-skill-router-disabled`,
    isDisabled: true,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  }));
}

test("route smoke: curated cases pick the expected skill via single-round metadata route", () => {
  const skills = materializeSkills(SKILLS);

  for (const testCase of CASES) {
    const result = routeDisabledSkillsMetadata(skills, testCase.query, { topK: 3 });
    assert.ok(
      result.selected !== null,
      `[${testCase.name}] expected a selection for query "${testCase.query}", got none`,
    );
    assert.equal(
      result.selected!.skill.id,
      testCase.expected,
      `[${testCase.name}] query "${testCase.query}" selected ${result.selected!.skill.id}, expected ${testCase.expected}`,
    );
  }
});
