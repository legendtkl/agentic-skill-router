import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dciGrepDisabledSkills,
  dciInspectSkill,
  dciReadSkill,
  dciSearchDisabledSkills,
  dciSelectSkill,
  routableDisabledSkills,
} from "../src/dci.ts";
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
    assert.equal(result.corpus.scanned, 161);
    assert.equal(result.matches[0]?.id, "user:codex:body-only-probe");
    assert.match(result.matches[0]?.snippets[0]?.text ?? "", /dci-orchid-ledger-repair/);
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
