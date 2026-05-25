import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSkillCorpusBm25Index, inspectSkillCorpus, searchSkillCorpus, searchSkillCorpusBm25Index } from "../src/corpus.ts";
import type { Skill } from "../src/types.ts";

function skill(opts: {
  id: string;
  name?: string;
  description: string;
  metadata?: Skill["metadata"];
  disabled?: boolean;
}): Skill {
  const name = opts.name ?? opts.id.split(":").at(-1)!;
  return {
    id: opts.id,
    name,
    description: opts.description,
    ...(opts.metadata === undefined ? {} : { metadata: opts.metadata }),
    source: "user",
    pluginKey: null,
    skillMdPath: `/tmp/${name}/SKILL.md.skill-router-disabled`,
    isDisabled: opts.disabled ?? true,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  };
}

test("corpus search composes --all and --any terms over metadata only", () => {
  const skills = [
    skill({
      id: "user:codex:skill-079",
      description: "Analyzes 3D mesh files (STL) to calculate geometric volume and components.",
    }),
    skill({
      id: "user:codex:skill-118",
      description: "A comprehensive skill for processing 3D mesh data and visualization.",
    }),
    skill({
      id: "user:codex:body-only",
      description: "Generic operational helper",
    }),
  ];

  const result = searchSkillCorpus(skills, {
    all: ["stl"],
    any: ["volume", "mesh"],
    limit: 10,
  });

  assert.equal(result.mode, "disabled-skill-metadata");
  assert.equal(result.ranker, "weighted");
  assert.equal(result.budget.readsBody, false);
  assert.equal(result.corpus.scanned, 3);
  assert.equal(result.corpus.totalMatches, 1);
  assert.equal(result.corpus.truncated, false);
  assert.equal(result.matches[0]?.shortId, "skill-079");
  assert.deepEqual(result.matches[0]?.matchedTerms.all, ["stl"]);
  assert.ok(result.matches[0]?.matchedTerms.any.includes("volume"));
});

test("corpus search returns bounded matches with truncation diagnostics", () => {
  const skills = Array.from({ length: 5 }, (_, i) =>
    skill({
      id: `user:codex:mail-${i}`,
      description: `Lark mail workflow helper ${i}`,
    }),
  );

  const result = searchSkillCorpus(skills, { any: ["mail"], limit: 2 });

  assert.equal(result.action, "narrow-or-broaden");
  assert.equal(result.corpus.totalMatches, 5);
  assert.equal(result.corpus.returned, 2);
  assert.equal(result.corpus.truncated, true);
  assert.equal(result.matches.length, 2);
});

test("corpus search does not treat short Latin substrings as matches", () => {
  const skills = [
    skill({
      id: "user:codex:lark-mail",
      description: "Lark mail workflow helper",
    }),
    skill({
      id: "user:codex:ai-helper",
      description: "AI workflow helper",
      metadata: {
        name: "ai-helper",
        description: "AI workflow helper",
        aliases: ["ai"],
      },
    }),
  ];

  const broad = searchSkillCorpus(skills, { any: ["ai"], limit: 10 });
  assert.deepEqual(broad.matches.map((match) => match.shortId), ["ai-helper"]);

  const singleChar = searchSkillCorpus(skills, { any: ["r"], limit: 10 });
  assert.equal(singleChar.matches.length, 0);
});

test("corpus --all multi-word terms require the full phrase or all tokens", () => {
  const skills = [
    skill({
      id: "user:codex:court-filing",
      description: "Court filing workflow helper",
    }),
    skill({
      id: "user:codex:court-form",
      description: "Court form filling workflow helper",
    }),
  ];

  const result = searchSkillCorpus(skills, { all: ["court form"], limit: 10 });

  assert.deepEqual(result.matches.map((match) => match.shortId), ["court-form"]);
});

test("corpus no-match diagnostics distinguish all-term and any-term filters", () => {
  const skills = [
    skill({
      id: "user:codex:lark-mail",
      description: "Lark mail workflow helper",
    }),
  ];

  const result = searchSkillCorpus(skills, { all: ["mail"], any: ["calendar"], limit: 10 });

  assert.equal(result.action, "no-candidates");
  assert.equal(result.corpus.totalMatches, 0);
  assert.equal(result.diagnostics.skillsMatchingAllTerms, 1);
  assert.equal(result.diagnostics.skillsMatchingAnyTerms, 0);
  assert.equal(result.diagnostics.filteredByAnyTerms, 1);
});

test("corpus bm25 ranker prefers rare distinctive metadata terms", () => {
  const skills = [
    skill({
      id: "user:codex:generic-planning",
      description: "Planning workflow for data reports and project operations.",
    }),
    skill({
      id: "user:codex:pddl-tpp",
      description: "Build PDDL travel planning problem instances for TPP solvers.",
      metadata: {
        name: "pddl-tpp",
        description: "Build PDDL travel planning problem instances for TPP solvers.",
        aliases: ["pddl", "tpp"],
        tools: ["pddl"],
      },
    }),
  ];

  const result = searchSkillCorpus(skills, {
    any: ["planning", "pddl", "tpp"],
    ranker: "bm25",
    limit: 10,
  });

  assert.equal(result.ranker, "bm25");
  assert.equal(result.matches[0]?.shortId, "pddl-tpp");
  assert.ok(result.matches[0]!.score > result.matches[1]!.score);
});

test("corpus bm25 index preserves substring candidate recall", () => {
  const skills = [
    skill({
      id: "user:codex:dialogues",
      description: "Parse multi-speaker dialogues into structured scenes.",
    }),
    skill({
      id: "user:codex:generic-dialogue",
      description: "Generic dialogue style writing helper.",
    }),
  ];
  const opts = { all: ["dialogue"], any: ["parse"], ranker: "bm25" as const, limit: 10 };

  const scan = searchSkillCorpus(skills, opts);
  const indexed = searchSkillCorpusBm25Index(buildSkillCorpusBm25Index(skills), opts);

  assert.deepEqual(
    indexed.matches.map((match) => match.shortId),
    scan.matches.map((match) => match.shortId),
  );
});

test("corpus bm25 index preserves camelCase and compact candidate recall", () => {
  const skills = [
    skill({
      id: "user:codex:powerpoint",
      description: "Powerpoint reference formatting helper.",
    }),
    skill({
      id: "user:codex:power-point",
      description: "PowerPoint presentation reference formatting helper.",
    }),
  ];
  const opts = { all: ["powerpoint"], any: ["reference"], ranker: "bm25" as const, limit: 10 };

  const scan = searchSkillCorpus(skills, opts);
  const indexed = searchSkillCorpusBm25Index(buildSkillCorpusBm25Index(skills), opts);

  assert.deepEqual(
    indexed.matches.map((match) => match.shortId),
    scan.matches.map((match) => match.shortId),
  );
});

test("corpus search and inspect do not expose skill file paths", () => {
  const skills = [
    skill({
      id: "user:codex:skill-079",
      description: "STL volume helper",
    }),
  ];

  const search = searchSkillCorpus(skills, { any: ["stl"] });
  assert.equal("skillMdPath" in search.matches[0]!, false);

  const inspect = inspectSkillCorpus(skills, [search.matches[0]!.ref]);
  assert.equal("skillMdPath" in inspect.inspected[0]!, false);
});

test("corpus search uses frontmatter metadata fields beyond description", () => {
  const skills = [
    skill({
      id: "user:codex:slides",
      description: "Office file helper",
      metadata: {
        name: "slides",
        description: "Office file helper",
        tools: ["pptx"],
        domains: ["presentation"],
      },
    }),
  ];

  const result = searchSkillCorpus(skills, { all: ["pptx"], any: ["presentation"] });

  assert.equal(result.matches[0]?.shortId, "slides");
  assert.ok(result.matches[0]?.snippets.some((snippet) => snippet.field === "tools"));
});

test("corpus inspect resolves short skill ids and rejects enabled skills", () => {
  const disabled = skill({
    id: "user:codex:skill-079",
    description: "STL volume helper",
  });
  const enabled = skill({
    id: "user:codex:enabled-skill",
    description: "Enabled helper",
    disabled: false,
  });

  const result = inspectSkillCorpus([disabled, enabled], ["skill-079"]);
  assert.equal(result.inspected[0]?.id, "user:codex:skill-079");

  assert.throws(
    () => inspectSkillCorpus([disabled, enabled], ["enabled-skill"]),
    /unknown disabled skill id\/name\/ref/,
  );
});
