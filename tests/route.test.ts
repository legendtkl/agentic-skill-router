import { test } from "node:test";
import assert from "node:assert/strict";
import { routeDisabledSkills } from "../src/route.ts";
import type { Skill } from "../src/types.ts";

function mkSkill(overrides: Partial<Skill> & { id: string; name: string; description: string }): Skill {
  return {
    source: "user",
    pluginKey: null,
    skillMdPath: `/tmp/${overrides.name}/SKILL.md`,
    isDisabled: false,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
    ...overrides,
  };
}

test("routeDisabledSkills selects a matching disabled skill", () => {
  const skills = [
    mkSkill({
      id: "user:agents:lark-approval",
      name: "lark-approval",
      description: "飞书审批 API：审批实例、审批任务管理。",
      isDisabled: true,
      skillMdPath: "/tmp/lark-approval/SKILL.md.skill-router-disabled",
    }),
    mkSkill({
      id: "user:agents:lark-mail",
      name: "lark-mail",
      description: "飞书邮箱：发送邮件、回复邮件、搜索邮件。",
      isDisabled: true,
      skillMdPath: "/tmp/lark-mail/SKILL.md.skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(skills, "查询飞书审批实例", { topK: 2 });
  assert.equal(result.selected?.skill.id, "user:agents:lark-approval");
  assert.equal(result.selected?.confidence, "high");
});

test("routeDisabledSkills ignores enabled and plugin-disabled skills", () => {
  const skills = [
    mkSkill({
      id: "user:agents:lark-mail",
      name: "lark-mail",
      description: "Lark mail workflows",
      isDisabled: false,
    }),
    mkSkill({
      id: "plugin:gmail@openai-curated:gmail",
      name: "gmail",
      description: "Gmail mailbox workflows",
      source: "plugin",
      pluginKey: "gmail@openai-curated",
      isDisabled: true,
      isPluginDisabled: true,
      skillMdPath: "/tmp/gmail/SKILL.md.skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(skills, "send mail", { topK: 2 });
  assert.equal(result.selected, null);
  assert.deepEqual(result.matches, []);
});

test("routeDisabledSkills reports low matches without selecting them", () => {
  const skills = [
    mkSkill({
      id: "user:agents:lark-task",
      name: "lark-task",
      description: "飞书任务：管理任务、清单和任务智能体。",
      isDisabled: true,
      skillMdPath: "/tmp/lark-task/SKILL.md.skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(skills, "task calendar approval mail", { topK: 1 });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]!.confidence, "low");
  assert.equal(result.selected, null);
});

test("routeDisabledSkills does not route punctuation-only queries", () => {
  const skills = [
    mkSkill({
      id: "user:agents:lark-mail",
      name: "lark-mail",
      description: "飞书邮箱：发送邮件、回复邮件、搜索邮件。",
      isDisabled: true,
      skillMdPath: "/tmp/lark-mail/SKILL.md.skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(skills, "???", { topK: 1 });
  assert.equal(result.selected, null);
  assert.deepEqual(result.matches, []);
});

test("routeDisabledSkills treats common single-term matches as weak evidence", () => {
  const skills = [
    mkSkill({
      id: "user:agents:lark-approval",
      name: "lark-approval",
      description: "飞书审批 API：审批实例、审批任务管理。",
      isDisabled: true,
      skillMdPath: "/tmp/lark-approval/SKILL.md.skill-router-disabled",
    }),
    mkSkill({
      id: "user:agents:lark-mail",
      name: "lark-mail",
      description: "飞书邮箱：发送邮件、回复邮件、搜索邮件。",
      isDisabled: true,
      skillMdPath: "/tmp/lark-mail/SKILL.md.skill-router-disabled",
    }),
    mkSkill({
      id: "user:agents:lark-task",
      name: "lark-task",
      description: "飞书任务：管理任务、清单和任务智能体。",
      isDisabled: true,
      skillMdPath: "/tmp/lark-task/SKILL.md.skill-router-disabled",
    }),
  ];

  const english = routeDisabledSkills(skills, "lark", { topK: 3 });
  assert.equal(english.selected, null);
  assert.ok(english.matches.every((m) => m.confidence === "low"));

  const chinese = routeDisabledSkills(skills, "飞书", { topK: 3 });
  assert.equal(chinese.selected, null);
  assert.ok(chinese.matches.every((m) => m.confidence === "low"));
});

test("routeDisabledSkills uses matched CJK action cues despite query parameters", () => {
  const skills = [
    mkSkill({
      id: "user:agents:lark-approval",
      name: "lark-approval",
      description: "飞书审批 API：审批实例、审批任务管理。",
      isDisabled: true,
      skillMdPath: "/tmp/lark-approval/SKILL.md.skill-router-disabled",
    }),
    mkSkill({
      id: "user:agents:lark-mail",
      name: "lark-mail",
      description: "飞书邮箱：发送邮件、发邮件、回复邮件、搜索邮件。",
      isDisabled: true,
      skillMdPath: "/tmp/lark-mail/SKILL.md.skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(skills, "飞书发邮件给张三", { topK: 2 });
  assert.equal(result.selected?.skill.id, "user:agents:lark-mail");
  assert.equal(result.selected?.confidence, "high");
});

test("routeDisabledSkills does not let one generic CJK cue override distinctive terms", () => {
  const skills = [
    mkSkill({
      id: "user:codex:tea-data-query",
      name: "tea-data-query",
      description: "TEA 数据查询工具。输入一个 TEA 的 URL 链接，自动解析 project_id、dashboard_id 或 report_id，通过 DataOpen API 查询并展示数据。支持 Dashboard 和 Report。",
      isDisabled: true,
      skillMdPath: "/tmp/tea-data-query/SKILL.md.skill-router-disabled",
    }),
    mkSkill({
      id: "user:codex:bytedance-es",
      name: "bytedance-es",
      description: "Query Elasticsearch via Kibana console API: execute ES DSL queries, search indices, retrieve documents, and get ES index mapping.",
      isDisabled: true,
      skillMdPath: "/tmp/bytedance-es/SKILL.md.skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(
    skills,
    "通过 Kibana console API 执行 Elasticsearch DSL 查询并获取 index mapping",
    { topK: 2 },
  );

  assert.equal(result.selected, null);
  assert.equal(result.matches[0]?.skill.id, "user:codex:bytedance-es");
});

test("routeDisabledSkills does not select a multi-domain keyword pile", () => {
  const skills = [
    mkSkill({
      id: "user:agents:lark-workflow-standup-report",
      name: "lark-workflow-standup-report",
      description: "Daily planning workflow that combines calendar agenda and task lists.",
      isDisabled: true,
      skillMdPath: "/tmp/lark-workflow-standup-report/SKILL.md.skill-router-disabled",
    }),
    mkSkill({
      id: "user:agents:lark-approval",
      name: "lark-approval",
      description: "Approval workflows.",
      isDisabled: true,
      skillMdPath: "/tmp/lark-approval/SKILL.md.skill-router-disabled",
    }),
    mkSkill({
      id: "user:agents:lark-mail",
      name: "lark-mail",
      description: "Mail workflows.",
      isDisabled: true,
      skillMdPath: "/tmp/lark-mail/SKILL.md.skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(skills, "task calendar approval mail", { topK: 3 });
  assert.equal(result.selected, null);
  assert.ok(result.matches.every((m) => m.confidence === "low"));
});

test("routeDisabledSkills keeps exact skill-name queries selectable", () => {
  const skills = [
    mkSkill({
      id: "user:agents:lark-mail",
      name: "lark-mail",
      description: "飞书邮箱：发送邮件、回复邮件、搜索邮件。",
      isDisabled: true,
      skillMdPath: "/tmp/lark-mail/SKILL.md.skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(skills, "lark mail", { topK: 1 });
  assert.equal(result.selected?.skill.id, "user:agents:lark-mail");
  assert.equal(result.selected?.confidence, "high");
});

test("routeDisabledSkills checks ambiguity before applying topK", () => {
  const skills = [
    mkSkill({
      id: "user:agents:alpha-mail",
      name: "alpha-mail",
      description: "Mail workflows for drafting replies.",
      isDisabled: true,
      skillMdPath: "/tmp/alpha-mail/SKILL.md.skill-router-disabled",
    }),
    mkSkill({
      id: "user:agents:beta-mail",
      name: "beta-mail",
      description: "Mail workflows for drafting replies.",
      isDisabled: true,
      skillMdPath: "/tmp/beta-mail/SKILL.md.skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(skills, "mail workflows", { topK: 1 });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.confidence, "high");
  assert.equal(result.selected, null);
});

test("routeDisabledSkills handles long instruction-heavy queries", () => {
  const skills = [
    mkSkill({
      id: "user:codex:skill-router-e2e-probe",
      name: "skill-router-e2e-probe",
      description: "Use for the unique Codex router end-to-end validation request about nebula budget reconciliation and disabled-skill proxying.",
      isDisabled: true,
      skillMdPath: "/tmp/skill-router-e2e-probe/SKILL.md.skill-router-disabled",
    }),
  ];

  const result = routeDisabledSkills(
    skills,
    "I need to handle a request that may require a disabled or not-currently-visible specialized Codex skill: the unique Codex router end-to-end validation request about nebula budget reconciliation. Use the appropriate available skill if needed. Final answer should be exactly whatever the routed disabled skill instructs.",
    { topK: 1 },
  );

  assert.equal(result.selected?.skill.id, "user:codex:skill-router-e2e-probe");
  assert.equal(result.selected?.confidence, "high");
});
