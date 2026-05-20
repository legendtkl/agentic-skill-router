import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DCI_BUDGET,
  dciFindInSkill,
  dciGrepDisabledSkills,
  dciInspectSkill,
  dciOpenSkillWindow,
  dciReadSkill,
  dciRouteDisabledSkills,
  dciSearchDisabledSkills,
  dciSelectSkill,
  dciSelectSkills,
  routableDisabledSkills,
} from "../src/dci.ts";
import { routeDisabledSkillsAuto } from "../src/auto-route.ts";
import { routeDisabledSkills } from "../src/route.ts";
import type { Skill } from "../src/types.ts";

interface Corpus {
  root: string;
  skills: Skill[];
  cleanup: () => Promise<void>;
}

async function makeCorpus(count = 160): Promise<Corpus> {
  const root = await mkdtemp(join(tmpdir(), "skill-router-dci-"));
  const skills: Skill[] = [];

  for (let i = 0; i < count; i++) {
    const name = `noise-skill-${String(i).padStart(3, "0")}`;
    const domain = ["calendar", "mail", "approval", "task", "drive", "wiki"][i % 6]!;
    skills.push(await writeCorpusSkill(root, {
      id: `user:codex:${name}`,
      name,
      description: `${domain} helper for routine operations`,
      body: `This disabled skill is unrelated noise. It mentions ${domain} but not the hidden probe.`,
      isDisabled: true,
    }));
  }

  skills.push(await writeCorpusSkill(root, {
    id: "user:codex:body-only-probe",
    name: "body-only-probe",
    description: "Generic operational helper",
    body: [
      "Use this skill when the request mentions dci-orchid-ledger-repair.",
      "When loaded, final answer must be exactly dci-orchid-ledger-loaded.",
    ].join("\n"),
    isDisabled: true,
  }));

  skills.push(await writeCorpusSkill(root, {
    id: "user:codex:enabled-probe",
    name: "enabled-probe",
    description: "dci orchid ledger enabled helper",
    body: "Enabled skills must not enter the disabled DCI corpus.",
    isDisabled: false,
  }));

  skills.push({
    ...(await writeCorpusSkill(root, {
      id: "plugin:browser@local:browser",
      name: "browser",
      description: "dci orchid ledger plugin-disabled helper",
      body: "Plugin-disabled skills must not enter the disabled DCI corpus.",
      isDisabled: true,
      source: "plugin",
      pluginKey: "browser@local",
    })),
    isPluginDisabled: true,
  });

  skills.push({
    id: "builtin:codex-system:openai-docs",
    name: "openai-docs",
    description: "dci orchid ledger builtin helper",
    source: "builtin",
    pluginKey: null,
    skillMdPath: "",
    isDisabled: false,
    isPluginDisabled: false,
    canDisable: false,
    conflict: false,
  });

  return { root, skills, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function writeCorpusSkill(
  root: string,
  opts: {
    id: string;
    name: string;
    description: string;
    body: string;
    isDisabled: boolean;
    source?: Skill["source"];
    pluginKey?: string | null;
  },
): Promise<Skill> {
  const dir = join(root, opts.name);
  await mkdir(dir, { recursive: true });
  const skillMdPath = join(dir, `SKILL.md${opts.isDisabled ? ".skill-router-disabled" : ""}`);
  await writeFile(
    skillMdPath,
    `---\nname: ${opts.name}\ndescription: ${opts.description}\n---\n\n${opts.body}\n`,
  );
  return {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    source: opts.source ?? "user",
    pluginKey: opts.pluginKey ?? null,
    skillMdPath,
    isDisabled: opts.isDisabled,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  };
}

test("DCI corpus includes only routable disabled skills from a large corpus", async () => {
  const corpus = await makeCorpus();
  try {
    const routable = routableDisabledSkills(corpus.skills);
    assert.equal(routable.length, 161);
    assert.ok(routable.some((s) => s.id === "user:codex:body-only-probe"));
    assert.ok(!routable.some((s) => s.id === "user:codex:enabled-probe"));
    assert.ok(!routable.some((s) => s.id === "plugin:browser@local:browser"));
    assert.ok(!routable.some((s) => s.id === "builtin:codex-system:openai-docs"));
  } finally {
    await corpus.cleanup();
  }
});

test("DCI search finds body-only evidence that lexical route cannot select", async () => {
  const corpus = await makeCorpus();
  try {
    const query = "Please handle dci-orchid-ledger-repair now.";
    const lexical = routeDisabledSkills(corpus.skills, query, { topK: 5 });
    assert.notEqual(lexical.selected?.skill.id, "user:codex:body-only-probe");

    const result = await dciSearchDisabledSkills(corpus.skills, query, { topK: 5, maxSnippets: 2 });
    assert.equal(result.action, "inspect-or-read-candidates");
    assert.deepEqual(result.queries, [query]);
    assert.equal(result.budget.maxSelections, DCI_BUDGET.maxSelections);
    assert.equal(result.corpus.scanned, 161);
    assert.match(result.matches[0]?.ref ?? "", /^dci-[a-f0-9]{10}$/);
    assert.equal(result.matches[0]?.id, "user:codex:body-only-probe");
    assert.equal(result.matches[0]?.matchedQuery, query);
    assert.match(result.matches[0]?.snippets[0]?.text ?? "", /dci-orchid-ledger-repair/);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI search supports bounded multi-query retrieval with stable candidate refs", async () => {
  const corpus = await makeCorpus();
  try {
    const result = await dciSearchDisabledSkills(
      corpus.skills,
      ["unrelated request", "dci-orchid-ledger-repair", "dci-orchid-ledger-repair", "ignored extra query"],
      { topK: 5, maxQueries: 3 },
    );
    assert.deepEqual(result.queries, ["unrelated request", "dci-orchid-ledger-repair", "ignored extra query"]);
    assert.equal(result.matches[0]?.id, "user:codex:body-only-probe");
    assert.equal(result.matches[0]?.matchedQuery, "dci-orchid-ledger-repair");

    const inspectedByRef = dciInspectSkill(corpus.skills, result.matches[0]!.ref);
    assert.equal(inspectedByRef.id, "user:codex:body-only-probe");
  } finally {
    await corpus.cleanup();
  }
});

test("DCI search and grep enforce the candidate budget even with large topK", async () => {
  const corpus = await makeCorpus();
  try {
    const search = await dciSearchDisabledSkills(corpus.skills, "helper", { topK: 50 });
    assert.equal(search.budget.maxCandidates, DCI_BUDGET.maxCandidates);
    assert.equal(search.matches.length, DCI_BUDGET.maxCandidates);

    const grep = await dciGrepDisabledSkills(corpus.skills, "helper", { topK: 50 });
    assert.equal(grep.budget.maxCandidates, DCI_BUDGET.maxCandidates);
    assert.equal(grep.matches.length, DCI_BUDGET.maxCandidates);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI route checks ambiguity before applying topK", async () => {
  const corpus = await makeCorpus(0);
  try {
    const body = "Use this skill when the request mentions dci-pearl-ledger-repair.";
    corpus.skills.push(await writeCorpusSkill(corpus.root, {
      id: "user:codex:alpha-pearl",
      name: "alpha-pearl",
      description: "Generic disabled helper",
      body,
      isDisabled: true,
    }));
    corpus.skills.push(await writeCorpusSkill(corpus.root, {
      id: "user:codex:beta-pearl",
      name: "beta-pearl",
      description: "Generic disabled helper",
      body,
      isDisabled: true,
    }));

    const result = await dciRouteDisabledSkills(corpus.skills, "please handle dci-pearl-ledger-repair", { topK: 1 });
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.confidence, "medium");
    assert.equal(result.selected, null);
    assert.deepEqual(
      result.diagnostics?.dci?.matches.slice(0, 2).map((match) => match.id),
      ["user:codex:alpha-pearl", "user:codex:beta-pearl"],
    );
  } finally {
    await corpus.cleanup();
  }
});

test("DCI grep returns bounded snippets from disabled skills", async () => {
  const corpus = await makeCorpus();
  try {
    const result = await dciGrepDisabledSkills(corpus.skills, "orchid-ledger", { topK: 3, maxSnippets: 1 });
    assert.equal(result.mode, "literal");
    assert.equal(result.matches[0]?.id, "user:codex:body-only-probe");
    assert.equal(result.matches[0]?.snippets.length, 1);
    assert.match(result.matches[0]?.snippets[0]?.text ?? "", /orchid-ledger/);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI grep treats patterns literally unless regex is explicit", async () => {
  const corpus = await makeCorpus();
  try {
    const literal = await dciGrepDisabledSkills(corpus.skills, "dci-.*-repair", { topK: 3 });
    assert.equal(literal.mode, "literal");
    assert.equal(literal.matches.length, 0);

    const regex = await dciGrepDisabledSkills(corpus.skills, "dci-.*-repair", { regex: true, topK: 3 });
    assert.equal(regex.mode, "regex");
    assert.equal(regex.matches[0]?.id, "user:codex:body-only-probe");
    assert.match(regex.matches[0]?.snippets[0]?.text ?? "", /dci-orchid-ledger-repair/);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI find and open operate on a single disabled candidate ref", async () => {
  const corpus = await makeCorpus();
  try {
    const search = await dciSearchDisabledSkills(corpus.skills, "dci-orchid-ledger-repair");
    const ref = search.matches[0]!.ref;

    const found = await dciFindInSkill(corpus.skills, ref, "final answer", { maxSnippets: 1 });
    assert.equal(found.id, "user:codex:body-only-probe");
    assert.equal(found.action, "inspect-or-open-candidate");
    assert.equal(found.snippets.length, 1);
    assert.match(found.snippets[0]?.text ?? "", /final answer/);

    const opened = await dciOpenSkillWindow(corpus.skills, ref, { line: found.snippets[0]!.line, window: 3 });
    assert.equal(opened.action, "read-skill-window");
    assert.equal(opened.id, "user:codex:body-only-probe");
    assert.ok(opened.endLine - opened.startLine + 1 <= 3);
    assert.match(opened.content, /\d+: .*final answer/);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI open enforces a total character budget for long lines", async () => {
  const corpus = await makeCorpus(0);
  try {
    const longSkill = await writeCorpusSkill(corpus.root, {
      id: "user:codex:long-line-probe",
      name: "long-line-probe",
      description: "Long line disabled helper",
      body: "x".repeat(40_000),
      isDisabled: true,
    });
    corpus.skills.push(longSkill);

    const opened = await dciOpenSkillWindow(corpus.skills, "user:codex:long-line-probe", { line: 6, window: 1 });
    assert.equal(opened.truncated, true);
    assert.equal(opened.maxChars, DCI_BUDGET.maxOpenChars);
    assert.equal(opened.content.length, DCI_BUDGET.maxOpenChars);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI inspect and read reject non-routable skills", async () => {
  const corpus = await makeCorpus();
  try {
    const inspected = dciInspectSkill(corpus.skills, "user:codex:body-only-probe");
    assert.equal(inspected.action, "read-skill-file");
    assert.match(inspected.skillMdPath, /SKILL\.md\.skill-router-disabled$/);

    await assert.rejects(() => dciReadSkill(corpus.skills, "user:codex:enabled-probe"), /not a routable disabled skill/);
    assert.throws(() => dciInspectSkill(corpus.skills, "plugin:browser@local:browser"), /not a routable disabled skill/);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI read truncates content and select returns a read action", async () => {
  const corpus = await makeCorpus();
  try {
    const read = await dciReadSkill(corpus.skills, "user:codex:body-only-probe", { maxChars: 40 });
    assert.equal(read.action, "read-skill-file");
    assert.equal(read.truncated, true);
    assert.equal(read.content.length, 40);

    const selected = dciSelectSkill(corpus.skills, "user:codex:body-only-probe", "high", "body matched unique probe");
    assert.equal(selected.action, "read-skill-file");
    assert.equal(selected.confidence, "high");
    assert.match(selected.skillMdPath, /SKILL\.md\.skill-router-disabled$/);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI multi-select records a bounded set of disabled skills", async () => {
  const corpus = await makeCorpus();
  try {
    const search = await dciSearchDisabledSkills(corpus.skills, ["dci-orchid-ledger-repair", "helper"], { topK: 4 });
    const selected = dciSelectSkills(
      corpus.skills,
      [search.matches[0]!.ref, search.matches[1]!.id, search.matches[2]!.ref],
      "medium",
      "bounded multi-selection",
    );
    assert.equal(selected.action, "read-skill-files");
    assert.equal(selected.maxSelections, DCI_BUDGET.maxSelections);
    assert.equal(selected.selected.length, 3);
    assert.equal(selected.selected[0]?.id, "user:codex:body-only-probe");

    assert.throws(
      () => dciSelectSkills(corpus.skills, search.matches.slice(0, 4).map((m) => m.ref), "medium", "too many"),
      /too many DCI selections/,
    );
  } finally {
    await corpus.cleanup();
  }
});

test("auto route upgrades a suspicious lexical winner to DCI evidence", async () => {
  const corpus = await makeCorpus(0);
  try {
    corpus.skills.push(await writeCorpusSkill(corpus.root, {
      id: "user:codex:bytedance-devflow",
      name: "bytedance-devflow",
      description: "面向 DevFlow 任务创建/查看/关闭、Meego 绑定、资源查询、服务部署/删除部署/开启 debug，以及 TCC key 查询/创建/修改/删除的统一入口。当用户提到 DevFlow、服务信息、部署情况、泳道信息、服务MR信息、服务部署、在 DevFlow 上开启或重启 debug、Meego 关联任务查询、将 Meego 绑定到 DevFlow task 或 TCC 配置管理时使用。",
      body: "DevFlow task and service deployment entrypoint.",
      isDisabled: true,
    }));
    corpus.skills.push(await writeCorpusSkill(corpus.root, {
      id: "user:codex:bytedance-env",
      name: "bytedance-env",
      description: "Operate ENV platform via bytedcli: list/search env, baseline create flow, deploy TCE/TCC, manage devices, deploy bytefaas (ByteCloud FaaS) services to PPE swimlanes, and inspect tickets.",
      body: "Use for ENV platform baseline create flow, bytefaas FaaS deployment to PPE swimlane, ticket inspection, 把 bytefaas/FaaS 服务部署到 PPE swimlane 并检查 ticket.",
      isDisabled: true,
    }));

    const query = "用 ENV platform 做 baseline create flow，把 bytefaas/FaaS 服务部署到 PPE swimlane 并检查 ticket";
    const lexical = routeDisabledSkills(corpus.skills, query, { topK: 3 });
    assert.equal(lexical.selected?.skill.id, "user:codex:bytedance-devflow");

    const auto = await routeDisabledSkillsAuto(corpus.skills, query, { topK: 3 });
    assert.equal(auto.routeMode, "auto");
    assert.equal(auto.diagnostics?.auto?.escalated, true);
    assert.equal(auto.selected?.skill.id, "user:codex:bytedance-env");

    const topOne = await routeDisabledSkillsAuto(corpus.skills, query, { topK: 1 });
    assert.equal(topOne.matches.length, 1);
    assert.equal(topOne.diagnostics?.auto?.escalated, true);
    assert.equal(topOne.selected?.skill.id, "user:codex:bytedance-env");
  } finally {
    await corpus.cleanup();
  }
});

test("auto route upgrades umbrella skills to DCI evidence", async () => {
  const corpus = await makeCorpus(0);
  try {
    corpus.skills.push(await writeCorpusSkill(corpus.root, {
      id: "user:codex:bytedcli",
      name: "bytedcli",
      description: "Unified skill for the bytedcli command surface. Covers auth/tokens, TCE, TCC, ENV, TOS, RDS, Hive, Dorado, ES, Cache, BMQ, Log, APM, and many internal platforms.",
      body: "Generic bytedcli umbrella command surface.",
      isDisabled: true,
    }));
    corpus.skills.push(await writeCorpusSkill(corpus.root, {
      id: "user:codex:bytedance-auth",
      name: "bytedance-auth",
      description: "Operate bytedcli authentication flows. Use when user asks to login/logout, check auth status, fetch user info, prepare SSO JWT, or prepare ByteCloud Auth tokens.",
      body: "Use for bytedcli auth login logout status user info SSO JWT ByteCloud Auth token workflows.",
      isDisabled: true,
    }));

    const query = "操作 bytedcli auth：login/logout/status，获取当前 user info，准备 SSO JWT 或 ByteCloud Auth token";
    const lexical = routeDisabledSkills(corpus.skills, query, { topK: 3 });
    assert.equal(lexical.selected?.skill.id, "user:codex:bytedcli");

    const auto = await routeDisabledSkillsAuto(corpus.skills, query, { topK: 3 });
    assert.equal(auto.diagnostics?.auto?.reason, "lexical-selected-umbrella-skill");
    assert.equal(auto.selected?.skill.id, "user:codex:bytedance-auth");
  } finally {
    await corpus.cleanup();
  }
});
