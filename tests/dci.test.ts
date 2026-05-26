import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  DCI_BUDGET,
  DCI_REGEX_LINE_TIMEOUT_MS,
  DCI_REGEX_MAX_DOT_WILDCARDS,
  DCI_REGEX_MAX_LENGTH,
  DciRegexComplexityError,
  DciRegexTimeoutError,
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
  validateRegexPattern,
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
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-dci-"));
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
  const skillMdPath = join(dir, `SKILL.md${opts.isDisabled ? ".agentic-skill-router-disabled" : ""}`);
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

test("DCI metadata-only search does not read or match skill body content", async () => {
  const corpus = await makeCorpus();
  try {
    const bodyOnly = await dciSearchDisabledSkills(
      corpus.skills,
      "Please handle dci-orchid-ledger-repair now.",
      { topK: 5, maxSnippets: 2, metadataOnly: true },
    );
    assert.equal(bodyOnly.metadataOnly, true);
    assert.equal(bodyOnly.action, "no-candidates");
    assert.equal(bodyOnly.budget.maxSkillBytes, 0);
    assert.equal(bodyOnly.budget.maxCorpusBytes, 0);
    assert.equal(bodyOnly.corpus.bytesRead, 0);
    assert.equal(bodyOnly.corpus.truncated, 0);
    assert.equal(bodyOnly.warnings.length, 0);
    assert.equal(bodyOnly.matches.length, 0);

    const described = await writeCorpusSkill(corpus.root, {
      id: "user:codex:metadata-only-probe",
      name: "metadata-only-probe",
      description: "dci magnolia invoice metadata helper",
      body: "The body is intentionally irrelevant.",
      isDisabled: true,
    });
    const metadata = await dciSearchDisabledSkills(
      [described],
      "dci magnolia invoice",
      { topK: 1, maxSnippets: 2, metadataOnly: true },
    );
    assert.equal(metadata.metadataOnly, true);
    assert.equal(metadata.action, "inspect-candidates");
    assert.equal(metadata.budget.maxSkillBytes, 0);
    assert.equal(metadata.budget.maxCorpusBytes, 0);
    assert.equal(metadata.corpus.bytesRead, 0);
    assert.equal(metadata.matches[0]?.id, "user:codex:metadata-only-probe");
    assert.match(metadata.matches[0]?.snippets[0]?.text ?? "", /description: dci magnolia invoice metadata helper/);
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

test("DCI refs include skill path so duplicate logical ids stay addressable", async () => {
  const corpus = await makeCorpus(0);
  try {
    const first = await writeCorpusSkill(corpus.root, {
      id: "plugin:dup@local:tool",
      name: "dup-v1",
      description: "duplicate logical skill",
      body: "Use this skill for dci-duplicate-v1.",
      isDisabled: true,
      source: "plugin",
      pluginKey: "dup@local",
    });
    const second = await writeCorpusSkill(corpus.root, {
      id: "plugin:dup@local:tool",
      name: "dup-v2",
      description: "duplicate logical skill",
      body: "Use this skill for dci-duplicate-v2.",
      isDisabled: true,
      source: "plugin",
      pluginKey: "dup@local",
    });
    const skills = [first, second];

    const result = await dciSearchDisabledSkills(skills, "dci-duplicate", { topK: 2 });
    assert.equal(result.matches.length, 2);
    assert.notEqual(result.matches[0]!.ref, result.matches[1]!.ref);
    assert.equal(dciInspectSkill(skills, result.matches[0]!.ref).skillMdPath, result.matches[0]!.skillMdPath);
    assert.equal(dciInspectSkill(skills, result.matches[1]!.ref).skillMdPath, result.matches[1]!.skillMdPath);
    assert.throws(() => dciInspectSkill(skills, "plugin:dup@local:tool"), /ambiguous skill id/);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI id lookup prefers the single routable duplicate over enabled duplicates", async () => {
  const corpus = await makeCorpus(0);
  try {
    const enabled = await writeCorpusSkill(corpus.root, {
      id: "plugin:dup@local:tool",
      name: "dup-enabled",
      description: "enabled duplicate logical skill",
      body: "Enabled duplicate must not shadow a disabled candidate.",
      isDisabled: false,
      source: "plugin",
      pluginKey: "dup@local",
    });
    const disabled = await writeCorpusSkill(corpus.root, {
      id: "plugin:dup@local:tool",
      name: "dup-disabled",
      description: "disabled duplicate logical skill",
      body: "Use this skill for dci-duplicate-disabled.",
      isDisabled: true,
      source: "plugin",
      pluginKey: "dup@local",
    });
    const skills = [enabled, disabled];

    const inspected = dciInspectSkill(skills, "plugin:dup@local:tool");
    assert.equal(inspected.skillMdPath, disabled.skillMdPath);
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

test("DCI search truncates oversized skill bodies at the per-skill byte budget", async () => {
  const corpus = await makeCorpus(0);
  try {
    const huge = await writeCorpusSkill(corpus.root, {
      id: "user:codex:huge-body-probe",
      name: "huge-body-probe",
      description: "Generic disabled helper",
      body: `${"x".repeat(DCI_BUDGET.maxSkillBytes + 512)}\nunseenzephyrmarker`,
      isDisabled: true,
    });
    corpus.skills.push(huge);

    const result = await dciSearchDisabledSkills([huge], "unseenzephyrmarker", { topK: 3 });
    assert.equal(result.matches.length, 0);
    assert.equal(result.corpus.loaded, 1);
    assert.equal(result.corpus.truncated, 1);
    assert.ok(result.corpus.bytesRead <= DCI_BUDGET.maxSkillBytes);
    assert.equal(result.warnings[0]?.code, "skill-body-truncated");
    assert.equal(result.warnings[0]?.id, "user:codex:huge-body-probe");
    assert.equal(result.warnings[0]?.limitBytes, DCI_BUDGET.maxSkillBytes);

    const route = await dciRouteDisabledSkills([huge], "unseenzephyrmarker", { topK: 3 });
    assert.equal(route.selected, null);
    assert.equal(route.diagnostics?.dci?.warnings?.[0]?.code, "skill-body-truncated");
  } finally {
    await corpus.cleanup();
  }
});

test("DCI search truncation respects UTF-8 multibyte character boundaries", async () => {
  const corpus = await makeCorpus(0);
  try {
    // Build a SKILL.md whose byte length exceeds the per-skill budget, with a
    // 3-byte Chinese character straddling the byte limit. The lead byte sits
    // at offset (maxSkillBytes - 1), so a naive byte-cut decode would emit a
    // U+FFFD replacement character for the dangling lead byte.
    const limit = DCI_BUDGET.maxSkillBytes;
    const frontmatter = "---\nname: utf8-boundary-probe\ndescription: Chinese disabled helper for boundary truncation\n---\n\n";
    const frontmatterBytes = Buffer.byteLength(frontmatter, "utf8");
    // First block of complete Chinese characters that fit before the boundary
    // straddle, leaving room for the straddling character. Each Chinese char
    // is 3 bytes in UTF-8.
    const headerChar = "中"; // 中
    const straddleChar = "文"; // 文 (3 bytes: e6 96 87) — lead byte lands inside limit
    const tailChar = "语"; // 语
    const padBytes = limit - frontmatterBytes - 1; // leave 1 byte for the straddling char's lead byte
    if (padBytes <= 0 || padBytes % 3 !== 0) {
      // The fixture math assumes the limit and frontmatter align on a 3-byte
      // multiple; adjust the frontmatter padding here if upstream constants
      // change so the straddle is always lead-byte-aligned at `limit - 1`.
      const adjust = padBytes <= 0 ? 0 : padBytes % 3;
      assert.fail(`utf8 boundary fixture misaligned: padBytes=${padBytes}, adjust=${adjust}`);
    }
    const head = headerChar.repeat(padBytes / 3);
    const tail = tailChar.repeat(64); // body continues well past the limit
    const body = `${head}${straddleChar}${tail}\n`;
    const fileContent = `${frontmatter}${body}`;
    const fileBytes = Buffer.byteLength(fileContent, "utf8");
    assert.ok(fileBytes > limit, "fixture must exceed the per-skill byte limit");

    const dir = join(corpus.root, "utf8-boundary-probe");
    await mkdir(dir, { recursive: true });
    const skillMdPath = join(dir, "SKILL.md.agentic-skill-router-disabled");
    await writeFile(skillMdPath, fileContent);
    const skill: Skill = {
      id: "user:codex:utf8-boundary-probe",
      name: "utf8-boundary-probe",
      description: "Chinese disabled helper for boundary truncation",
      source: "user",
      pluginKey: null,
      skillMdPath,
      isDisabled: true,
      isPluginDisabled: false,
      canDisable: true,
      conflict: false,
    };
    corpus.skills.push(skill);

    const result = await dciSearchDisabledSkills([skill], headerChar.repeat(3), { topK: 3 });
    assert.equal(result.corpus.loaded, 1);
    assert.equal(result.corpus.truncated, 1);
    assert.equal(result.warnings[0]?.code, "skill-body-truncated");
    assert.equal(result.warnings[0]?.bytesRead, limit);
    assert.equal(result.warnings[0]?.fileBytes, fileBytes);
    // The matched snippet must contain only complete characters: no U+FFFD
    // replacement character must appear anywhere in the loaded body.
    assert.equal(result.matches.length, 1);
    const snippetText = result.matches[0]?.snippets[0]?.text ?? "";
    assert.ok(snippetText.length > 0, "expected a snippet for the Chinese header content");
    assert.ok(!snippetText.includes("�"), `snippet must not contain U+FFFD: ${JSON.stringify(snippetText)}`);

    // Also verify the straddling and tail characters were dropped cleanly:
    // the loaded body should contain every header character and end before
    // the incomplete straddle byte, so neither the straddle nor any tail char
    // should appear.
    const grep = await dciGrepDisabledSkills([skill], straddleChar, { topK: 3 });
    assert.equal(grep.matches.length, 0, "straddling character must not survive truncation");
    const tailGrep = await dciGrepDisabledSkills([skill], tailChar, { topK: 3 });
    assert.equal(tailGrep.matches.length, 0, "tail content past the byte limit must not survive truncation");
    const headGrep = await dciGrepDisabledSkills([skill], headerChar.repeat(2), { topK: 3 });
    assert.equal(headGrep.matches.length, 1, "complete leading characters must be preserved");
    assert.ok(!(headGrep.matches[0]?.snippets[0]?.text ?? "").includes("�"));
  } finally {
    await corpus.cleanup();
  }
});

test("DCI search stops reading when the total corpus byte budget is exhausted", async () => {
  const corpus = await makeCorpus(0);
  try {
    const skillCount = Math.ceil(DCI_BUDGET.maxCorpusBytes / DCI_BUDGET.maxSkillBytes) + 3;
    for (let i = 0; i < skillCount; i++) {
      corpus.skills.push(await writeCorpusSkill(corpus.root, {
        id: `user:codex:corpus-budget-${i}`,
        name: `corpus-budget-${i}`,
        description: "Generic disabled helper",
        body: `${"x".repeat(DCI_BUDGET.maxSkillBytes + 512)}${i === skillCount - 1 ? "\nunseencorpusmarker" : ""}`,
        isDisabled: true,
      }));
    }

    const result = await dciSearchDisabledSkills(corpus.skills, "unseencorpusmarker", { topK: 3 });
    assert.equal(result.matches.length, 0);
    assert.equal(result.corpus.bytesRead, DCI_BUDGET.maxCorpusBytes);
    assert.ok(result.corpus.loaded < skillCount);
    assert.ok(result.corpus.skipped > 0);
    assert.ok(result.warnings.some((warning) => warning.code === "corpus-budget-exhausted"));
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

test("DCI snippet scoring prefers strong evidence over earlier generic-only matches", async () => {
  const corpus = await makeCorpus(0);
  try {
    // Construct a body where many generic-only matches appear EARLIER than
    // the distinctive evidence line. With first-match selection, those
    // earlier generic lines fill the maxSnippets=2 budget and the strong
    // evidence line never makes it into the returned snippets.
    const bodyLines: string[] = [];
    for (let i = 0; i < 5; i++) bodyLines.push(`Helper tool for the workflow round ${i}.`); // generic-only
    bodyLines.push("Distinctive evidence: dci-snippet-score-zephyr-marker appears here.");
    bodyLines.push("Trailing prose unrelated to the probe.");
    const body = bodyLines.join("\n");
    const skill = await writeCorpusSkill(corpus.root, {
      id: "user:codex:snippet-score-probe",
      name: "snippet-score-probe",
      description: "neutral disabled skill body for scoring tests",
      body,
      isDisabled: true,
    });

    const result = await dciSearchDisabledSkills(
      [skill],
      "dci-snippet-score-zephyr-marker helper workflow",
      { topK: 1, maxSnippets: 2 },
    );
    assert.equal(result.matches.length, 1);
    const snippets = result.matches[0]!.snippets;
    assert.equal(snippets.length, 2);

    // The distinctive-evidence line must appear in the bounded snippet
    // window. Before this change the five earlier generic-only matches
    // crowded it out entirely.
    const evidenceSnippet = snippets.find((s) => s.text.includes("dci-snippet-score-zephyr-marker"));
    assert.ok(evidenceSnippet, `expected evidence snippet in ${JSON.stringify(snippets)}`);

    // Distinctive evidence outranks generic-only matches, so the evidence
    // line is the highest-scoring snippet despite appearing later in the
    // file.
    assert.equal(snippets[0]!.text.includes("dci-snippet-score-zephyr-marker"), true);

    // At most one of the five generic-only lines can occupy the remaining
    // snippet slot; deterministic tie-break uses the earliest line number.
    const genericOnly = snippets.filter((s) => !s.text.includes("dci-snippet-score-zephyr-marker"));
    assert.equal(genericOnly.length, 1);

    // Original line numbers from the file are preserved verbatim in the
    // returned snippets; evidence sits below the first generic line.
    assert.ok(evidenceSnippet.line > genericOnly[0]!.line);
    assert.ok(genericOnly[0]!.line >= 1);
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

test("DCI regex validator rejects over-length patterns with a clear error", () => {
  assert.doesNotThrow(() => validateRegexPattern("a".repeat(DCI_REGEX_MAX_LENGTH)));
  const tooLong = "a".repeat(DCI_REGEX_MAX_LENGTH + 1);
  assert.throws(
    () => validateRegexPattern(tooLong),
    (err: unknown) => {
      if (!(err instanceof DciRegexComplexityError)) return false;
      return err.message.includes(String(DCI_REGEX_MAX_LENGTH));
    },
  );
});

test("DCI regex validator rejects nested-quantifier ReDoS shapes", () => {
  // Codex P1 follow-up: every pattern below must be flagged by the static
  // heuristic. The first set is from the original issue; the second set is
  // from the codex follow-up that broke the narrow first-pass heuristic.
  const original = ["(a+)+$", "(.*)*", "(.+)+", "(\\d+)+$", "(ab+)+x"];
  const codexFollowUp = [
    "(a+){2,}$",
    "([a-z]+){2,}$",
    "(a{1,})+$",
    "(a?)+$",
    "^(a|aa)+$",
  ];
  for (const pattern of [...original, ...codexFollowUp]) {
    assert.throws(
      () => validateRegexPattern(pattern),
      DciRegexComplexityError,
      `expected ${pattern} to be flagged as ReDoS-shaped`,
    );
  }
  // Safe patterns must continue to pass the heuristic.
  for (const pattern of ["^foo", "dci-.*-repair", "[a-z]+", "orchid|ledger"]) {
    assert.doesNotThrow(() => validateRegexPattern(pattern), `expected ${pattern} to pass`);
  }
});

test("DCI regex validator rejects open or oversized group bounds", () => {
  // `{n,}` directly on a group is rejected even when the inner body is tame.
  assert.throws(() => validateRegexPattern("(a){2,}"), DciRegexComplexityError);
  // `{n,m}` with `m` larger than the small allowed bound is rejected.
  assert.throws(() => validateRegexPattern("(a){2,50}"), DciRegexComplexityError);
  // Small bounded repetition on a plain group is fine.
  assert.doesNotThrow(() => validateRegexPattern("(abc){3}"));
  assert.doesNotThrow(() => validateRegexPattern("(abc){1,5}"));
});

test("DCI regex validator open-bound check inspects only THIS group's quantifier (P2)", () => {
  // Regression for chatgpt-codex inline review on PR #141: the previous
  // implementation re-scanned `pattern.slice(group.end)` for `{n,}` and
  // wrongly rejected patterns where an EARLIER group was quantified with
  // `+`/`*` and any LATER unrelated atom happened to use `{n,}`. The
  // attached quantifier is `+`, not `{n,}`, so this pattern must validate.
  assert.doesNotThrow(() => validateRegexPattern("(foo)+bar{2,}"));
  // Also: a `*` group followed by an unrelated `{n,}` on a non-group atom.
  assert.doesNotThrow(() => validateRegexPattern("(foo)*baz{3,}"));
  // And the same shape with a large bounded later atom — the group's `+`
  // is not `{n,m>10}`, so this must validate.
  assert.doesNotThrow(() => validateRegexPattern("(foo)+bar{0,100}"));
  // Counter-checks: the actual quantifier on the group is `{n,}` /
  // large-bounded → still correctly rejected.
  assert.throws(() => validateRegexPattern("(foo){2,}"), DciRegexComplexityError);
  assert.throws(() => validateRegexPattern("(foo){0,100}"), DciRegexComplexityError);
  // A non-group atom with a small in-range bound must remain accepted.
  assert.doesNotThrow(() => validateRegexPattern("(foo)+bar{0,3}"));
});

test("DCI regex validator does not flag non-capturing group prefix as inner quantifier", () => {
  // `(?:...)` inside an outer quantified group must not be treated as a
  // nested quantifier just because of the leading `?`.
  assert.doesNotThrow(() => validateRegexPattern("((?:foo)bar)+"));
  assert.doesNotThrow(() => validateRegexPattern("((?:foo))"));
});

test("DCI regex validator rejects consecutive overlapping quantified atoms", () => {
  // Codex P1 follow-up #3: long runs of `a*a*a*…` style atoms have no
  // groups so they slip past every earlier rule but produce exponential
  // backtracking. They must be rejected statically and fast — before the
  // regex is compiled, never mind matched.
  const cases: Array<{ pattern: string; label: string }> = [
    { pattern: "a*".repeat(24) + "b", label: "a* x24 + b" },
    { pattern: "\\d*".repeat(10), label: "\\d* x10" },
    { pattern: "[a-z]*".repeat(8), label: "[a-z]* x8" },
    { pattern: "a+".repeat(6), label: "a+ x6" },
    { pattern: "a?".repeat(6), label: "a? x6" },
    { pattern: ".*".repeat(6), label: ".* x6" },
    { pattern: "a{0,3}".repeat(6), label: "a{0,3} x6" },
  ];
  for (const { pattern, label } of cases) {
    const startedAt = Date.now();
    assert.throws(
      () => validateRegexPattern(pattern),
      DciRegexComplexityError,
      `expected ${label} (${pattern}) to be flagged as overlapping streak`,
    );
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 50, `expected ${label} to reject in <50ms, took ${elapsed}ms`);
  }
});

test("DCI regex validator does not flag normal patterns with a few quantified atoms", () => {
  // Regression set: each pattern is below the overlap-streak cap and must
  // validate. Different signatures in a row are also fine — only same-
  // signature runs trigger the rule.
  for (const pattern of [
    "a*b*c?",
    "^\\d+\\.\\d+$",
    "https?://[\\w.-]+",
    "[a-z][0-9][a-z]",
    "a*b*c*d*",
    "\\d\\d\\d\\d\\d", // five unquantified atoms — must not trigger
    "a*a*a*a*",        // exactly at the streak cap — still allowed
  ]) {
    assert.doesNotThrow(() => validateRegexPattern(pattern), `expected ${pattern} to pass`);
  }
});

test("DCI regex validator rejects excessive top-level dot-wildcards (Rule 6)", () => {
  // `.*` and `.+` interleaved with literals produce O(n^k) backtracking when
  // the literal appears many times in the subject. The streak rule misses
  // these because each wildcard's streak resets on the literal in between.
  // More than DCI_REGEX_MAX_DOT_WILDCARDS unbounded dot-wildcards is rejected.
  const tooMany = DCI_REGEX_MAX_DOT_WILDCARDS + 1;
  const badPatterns = [
    ".*a.*a.*a.*a.*c",                         // 4 .* interleaved → caught
    ".+".repeat(tooMany) + "x",               // chain of .+ → caught
    ".*foo.*bar.*baz.*qux",                    // 4 .* → caught
    // Mixed unbounded + literal sandwich
    [...Array(tooMany)].map(() => ".*x").join("") + "c",
  ];
  for (const pattern of badPatterns) {
    assert.throws(
      () => validateRegexPattern(pattern),
      DciRegexComplexityError,
      `expected "${pattern}" to be flagged by the dot-wildcard rule`,
    );
  }

  // ≤ DCI_REGEX_MAX_DOT_WILDCARDS unbounded dot-wildcards must pass.
  const goodPatterns = [
    ".*keyword.*",                             // 2 .*  — very common
    ".*foo.*bar",                              // 2 .*
    ".*foo.*bar.*baz",                         // 3 .* — at the limit
    ".+foo.+bar",                              // 2 .+
    // Bounded .? does NOT count toward the dot-wildcard limit.
    ".?a.?a.?a.?a.?c",                        // 5 .? — bounded, allowed
    "a.?b.?c.?d.?e.?f",                       // 6 .? — bounded, allowed
  ];
  for (const pattern of goodPatterns) {
    assert.doesNotThrow(
      () => validateRegexPattern(pattern),
      `expected "${pattern}" to pass the dot-wildcard rule`,
    );
  }
});

test("DCI grep rejects the codex consecutive-overlap pattern at the API in under 50ms", async () => {
  // Stronger guarantee than the validator-only test: the public API path
  // must also reject the pattern before any compile-or-match work happens.
  const corpus = await makeCorpus(0);
  try {
    const pattern = "a*".repeat(24) + "b";
    const startedAt = Date.now();
    await assert.rejects(
      () => dciGrepDisabledSkills(corpus.skills, pattern, { regex: true }),
      DciRegexComplexityError,
    );
    const elapsed = Date.now() - startedAt;
    assert.ok(
      elapsed < 50,
      `expected API to reject codex overlap pattern in <50ms, took ${elapsed}ms`,
    );
  } finally {
    await corpus.cleanup();
  }
});

test("DCI grep surfaces complexity errors through DciRegexComplexityError, not crashes", async () => {
  const corpus = await makeCorpus(0);
  try {
    // Literal mode is unaffected by the regex guard, including for patterns
    // that would be flagged when --regex is set.
    const literal = await dciGrepDisabledSkills(corpus.skills, "(a+)+$");
    assert.equal(literal.mode, "literal");
    assert.equal(literal.matches.length, 0);

    // A safe regex still works (regression guard).
    const safe = await dciGrepDisabledSkills(corpus.skills, "^anything", { regex: true });
    assert.equal(safe.mode, "regex");

    // Dangerous regex is rejected synchronously at the API boundary.
    await assert.rejects(
      () => dciGrepDisabledSkills(corpus.skills, "(a+)+$", { regex: true }),
      DciRegexComplexityError,
    );
    await assert.rejects(
      () => dciGrepDisabledSkills(corpus.skills, "a".repeat(DCI_REGEX_MAX_LENGTH + 1), { regex: true }),
      DciRegexComplexityError,
    );
  } finally {
    await corpus.cleanup();
  }
});

test("DCI grep rejects every codex-named pathological pattern via the API in under 100ms", async () => {
  const corpus = await makeCorpus(0);
  try {
    const patterns = [
      "(a+){2,}$",
      "([a-z]+){2,}$",
      "(a{1,})+$",
      "(a?)+$",
      "^(a|aa)+$",
    ];
    for (const pattern of patterns) {
      const startedAt = Date.now();
      await assert.rejects(
        () => dciGrepDisabledSkills(corpus.skills, pattern, { regex: true }),
        DciRegexComplexityError,
        `expected ${pattern} to be rejected at the API boundary`,
      );
      const elapsed = Date.now() - startedAt;
      assert.ok(
        elapsed < 100,
        `expected ${pattern} to reject quickly without hanging, took ${elapsed}ms`,
      );
    }
  } finally {
    await corpus.cleanup();
  }
});

test("DCI grep per-line wall-clock deadline catches a pattern that slips the heuristic", async () => {
  // Two interleaved signatures (`a?b?a?b?…`) defeat the consecutive-overlap
  // streak rule — each streak resets after every atom — and the dot-wildcard
  // rule (no `.*`/`.+`) — but still produce catastrophic backtracking on V8
  // against an `abab…` line. The deadline must fire and surface a
  // DciRegexTimeoutError instead of hanging the corpus walker.
  //
  // N=14 produces ~800ms per call on a typical developer machine (well above
  // the 50ms deadline) while staying below the 15s upper bound even on slow
  // CI hardware. The deadline is post-hoc — regex.test() runs to completion
  // before we check the clock — so the single catastrophic call dominates
  // the elapsed time.
  const N = 14;
  const slowPattern = "a?b?".repeat(N) + "ab".repeat(N) + "c";

  // Sanity: validator must accept the pattern (otherwise we are not testing
  // the deadline path).
  assert.doesNotThrow(() => validateRegexPattern(slowPattern));

  // Build a single-skill corpus whose body line forces the backtracking path.
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-dci-timeout-"));
  try {
    const skill = await writeCorpusSkill(root, {
      id: "user:codex:timeout-probe",
      name: "timeout-probe",
      description: "regex deadline probe",
      body: "ab".repeat(N),
      isDisabled: true,
    });

    const startedAt = Date.now();
    await assert.rejects(
      () => dciGrepDisabledSkills([skill], slowPattern, { regex: true }),
      DciRegexTimeoutError,
    );
    const elapsed = Date.now() - startedAt;
    // The deadline is post-hoc: the engine completes one catastrophic call
    // before we abort. The 15s upper bound accommodates up to ~20× hardware
    // variance; the lower bound confirms the deadline actually fired.
    assert.ok(elapsed < 15000, `expected deadline to abort within 15s, took ${elapsed}ms`);
    assert.ok(
      elapsed >= DCI_REGEX_LINE_TIMEOUT_MS,
      `expected at least one slow line (>=${DCI_REGEX_LINE_TIMEOUT_MS}ms), took ${elapsed}ms`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
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
    assert.equal(inspected.action, "inspect-skill");
    assert.match(inspected.skillMdPath, /SKILL\.md\.agentic-skill-router-disabled$/);

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
    assert.match(selected.skillMdPath, /SKILL\.md\.agentic-skill-router-disabled$/);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI read honors the byte budget at the read syscall, not after a full readFile", async () => {
  const corpus = await makeCorpus(0);
  try {
    // 100 KB body (well past a 4 KB read budget) to prove the helper does
    // not materialize the full file in memory. The body is plain ASCII so
    // each character maps to one byte.
    const bigBody = "a".repeat(100_000);
    const huge = await writeCorpusSkill(corpus.root, {
      id: "user:codex:read-budget-probe",
      name: "read-budget-probe",
      description: "Bounded-read fixture",
      body: bigBody,
      isDisabled: true,
    });
    corpus.skills.push(huge);

    const budget = 4096;
    const read = await dciReadSkill(corpus.skills, "user:codex:read-budget-probe", { maxChars: budget });
    assert.equal(read.action, "read-skill-file");
    assert.equal(read.truncated, true);
    assert.equal(read.maxChars, budget);
    assert.equal(read.content.length, budget);
    // The +1 detection byte is allowed but we must not pull the whole file.
    assert.ok(read.bytesRead <= budget + 1, `bytesRead should be <= budget+1, got ${read.bytesRead}`);
    // Sanity: content really came from the file — frontmatter sits at the
    // top of every SKILL.md the corpus helper writes.
    assert.ok(read.content.startsWith("---\nname: read-budget-probe"));
  } finally {
    await corpus.cleanup();
  }
});

test("DCI read on a small file still returns the same content as before", async () => {
  const corpus = await makeCorpus(0);
  try {
    const body = "hello world\nsecond line\n";
    const small = await writeCorpusSkill(corpus.root, {
      id: "user:codex:small-read-probe",
      name: "small-read-probe",
      description: "Small read fixture",
      body,
      isDisabled: true,
    });
    corpus.skills.push(small);

    const read = await dciReadSkill(corpus.skills, "user:codex:small-read-probe");
    assert.equal(read.action, "read-skill-file");
    assert.equal(read.truncated, false);
    // The full SKILL.md contents (frontmatter + body) survive the round trip.
    assert.match(read.content, /name: small-read-probe/);
    assert.match(read.content, /hello world/);
    assert.match(read.content, /second line/);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI find stops at the byte budget and reports truncation for matches past the cap", async () => {
  const corpus = await makeCorpus(0);
  try {
    const cap = DCI_BUDGET.maxSkillBytes;
    // Build a body whose only match for `zephyrfindmarker` sits well past
    // the byte cap. Strict semantics: find must NOT scan past the cap.
    const padding = "x".repeat(cap + 8_192);
    const big = await writeCorpusSkill(corpus.root, {
      id: "user:codex:find-budget-probe",
      name: "find-budget-probe",
      description: "Find byte-budget fixture",
      body: `${padding}\nzephyrfindmarker on a line near EOF`,
      isDisabled: true,
    });
    corpus.skills.push(big);

    const found = await dciFindInSkill(
      corpus.skills,
      "user:codex:find-budget-probe",
      "zephyrfindmarker",
      { maxSnippets: 1 },
    );
    assert.equal(found.snippets.length, 0, "match past the byte cap must not be returned");
    assert.equal(found.action, "no-matches");
    assert.equal(found.truncated, true);
    assert.equal(found.maxBytes, cap);
    // We must have actually scanned bytes — we just stopped before the match.
    assert.ok(found.bytesRead > 0);
    assert.ok(found.bytesRead <= cap + 64_000, `bytesRead should be near the cap, got ${found.bytesRead}`);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI find on a small file still returns the same snippets and is not flagged truncated", async () => {
  const corpus = await makeCorpus();
  try {
    const search = await dciSearchDisabledSkills(corpus.skills, "dci-orchid-ledger-repair");
    const ref = search.matches[0]!.ref;
    const found = await dciFindInSkill(corpus.skills, ref, "final answer", { maxSnippets: 1 });
    assert.equal(found.id, "user:codex:body-only-probe");
    assert.equal(found.snippets.length, 1);
    assert.equal(found.truncated, false);
    assert.ok(found.bytesRead > 0);
    assert.equal(found.maxBytes, DCI_BUDGET.maxSkillBytes);
  } finally {
    await corpus.cleanup();
  }
});

test("DCI open streams the file and reports bytesRead for the window scan", async () => {
  const corpus = await makeCorpus();
  try {
    const search = await dciSearchDisabledSkills(corpus.skills, "dci-orchid-ledger-repair");
    const ref = search.matches[0]!.ref;
    const found = await dciFindInSkill(corpus.skills, ref, "final answer", { maxSnippets: 1 });
    const opened = await dciOpenSkillWindow(corpus.skills, ref, { line: found.snippets[0]!.line, window: 3 });
    assert.equal(opened.action, "read-skill-window");
    assert.ok(opened.bytesRead > 0, "open should report streamed bytes");
    assert.match(opened.content, /\d+: .*final answer/);
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

test("DCI multi-select dedups by instance key so duplicate-id skills both appear", async () => {
  const corpus = await makeCorpus(0);
  try {
    const first = await writeCorpusSkill(corpus.root, {
      id: "plugin:dup@local:tool",
      name: "dup-instance-v1",
      description: "duplicate logical skill instance one",
      body: "Use this skill for dci-instance-key-v1.",
      isDisabled: true,
      source: "plugin",
      pluginKey: "dup@local",
    });
    const second = await writeCorpusSkill(corpus.root, {
      id: "plugin:dup@local:tool",
      name: "dup-instance-v2",
      description: "duplicate logical skill instance two",
      body: "Use this skill for dci-instance-key-v2.",
      isDisabled: true,
      source: "plugin",
      pluginKey: "dup@local",
    });
    const skills = [first, second];

    const search = await dciSearchDisabledSkills(skills, "dci-instance-key", { topK: 2 });
    assert.equal(search.matches.length, 2);

    const selected = dciSelectSkills(
      skills,
      [search.matches[0]!.ref, search.matches[1]!.ref],
      "medium",
      "both duplicate-id instances must be preserved",
    );
    assert.equal(selected.selected.length, 2);
    const selectedPaths = selected.selected.map((s) => s.skillMdPath).sort();
    assert.deepEqual(selectedPaths, [first.skillMdPath, second.skillMdPath].sort());
    // Both share the same logical id, but instance-key dedup must keep both.
    assert.equal(selected.selected[0]!.id, "plugin:dup@local:tool");
    assert.equal(selected.selected[1]!.id, "plugin:dup@local:tool");
    assert.notEqual(selected.selected[0]!.skillMdPath, selected.selected[1]!.skillMdPath);

    // Still dedup when the SAME instance ref is passed twice.
    const dedupSame = dciSelectSkills(
      skills,
      [search.matches[0]!.ref, search.matches[0]!.ref],
      "medium",
      "identical refs collapse",
    );
    assert.equal(dedupSame.selected.length, 1);
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
    assert.equal(auto.diagnostics?.auto?.escalated, true);
    assert.equal(auto.diagnostics?.auto?.reason, "metadata-no-confident-match");
    assert.equal(auto.selected?.skill.id, "user:codex:bytedance-auth");
  } finally {
    await corpus.cleanup();
  }
});

// ────────────────── CLI-level regex guard tests ──────────────────

const execFileAsync = promisify(execFile);
const DCI_TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DCI_REPO_ROOT = dirname(DCI_TEST_DIR);
const DCI_CLI_PATH = join(DCI_REPO_ROOT, "src", "cli.ts");

async function makeDciCliEnv(): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-dci-cli-"));
  const codexHome = join(root, ".codex");
  const stateDir = join(root, ".agentic-skill-router");
  const disabledDir = join(codexHome, "skills", "probe");
  await mkdir(disabledDir, { recursive: true });
  await writeFile(
    join(disabledDir, "SKILL.md.agentic-skill-router-disabled"),
    "---\nname: probe\ndescription: dci regex guard probe skill\n---\n\nfoo bar baz\n",
  );
  await mkdir(stateDir, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTIC_SKILL_ROUTER_HOST: "codex",
    CODEX_HOME: codexHome,
    AGENTS_HOME: join(root, ".agents"),
    AGENTIC_SKILL_ROUTER_CWD: root,
    AGENTIC_SKILL_ROUTER_STATE_DIR: stateDir,
  };
  return { env, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function runDciCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const ok = await execFileAsync(process.execPath, ["--import", "tsx", DCI_CLI_PATH, ...args], { env });
    return { code: 0, stdout: ok.stdout ?? "", stderr: ok.stderr ?? "" };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("CLI: skills dci grep --regex with invalid regex exits 2 without crashing", async () => {
  const fake = await makeDciCliEnv();
  try {
    const r = await runDciCli(["skills", "dci", "grep", "--regex", "--pattern", "[unclosed"], fake.env);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, /invalid --regex pattern/);
  } finally {
    await fake.cleanup();
  }
});

test("CLI: skills dci grep --regex rejects over-length pattern with complexity error", async () => {
  const fake = await makeDciCliEnv();
  try {
    const longPattern = "a".repeat(DCI_REGEX_MAX_LENGTH + 1);
    const r = await runDciCli(["skills", "dci", "grep", "--regex", "--pattern", longPattern], fake.env);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, new RegExp(String(DCI_REGEX_MAX_LENGTH)));
    assert.match(r.stderr, /chars/);
  } finally {
    await fake.cleanup();
  }
});

test("CLI: skills dci grep --regex rejects (a+)+$ nested-quantifier shape", async () => {
  const fake = await makeDciCliEnv();
  try {
    const r = await runDciCli(["skills", "dci", "grep", "--regex", "--pattern", "(a+)+$"], fake.env);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, /catastrophic-backtracking|nested quantifier/i);
  } finally {
    await fake.cleanup();
  }
});

test("CLI: skills dci grep without --regex is unaffected by the guard", async () => {
  const fake = await makeDciCliEnv();
  try {
    // Literal mode must accept the same pattern the guard would reject in regex
    // mode. It will simply find no matches in the probe skill body.
    const r = await runDciCli(["skills", "dci", "grep", "--pattern", "(a+)+$", "--json"], fake.env);
    // Exit 1 means "no matches" — that is the unaffected literal behavior.
    assert.ok(r.code === 0 || r.code === 1, `expected exit 0/1, got ${r.code}; stderr=${r.stderr}`);
    assert.doesNotMatch(r.stderr, /catastrophic|complexity|chars/i);
    const parsed = JSON.parse(r.stdout) as { mode: string };
    assert.equal(parsed.mode, "literal");
  } finally {
    await fake.cleanup();
  }
});

test("CLI: skills dci grep --regex with a safe pattern still routes (regression)", async () => {
  const fake = await makeDciCliEnv();
  try {
    const r = await runDciCli(["skills", "dci", "grep", "--regex", "--pattern", "^foo", "--json"], fake.env);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    const parsed = JSON.parse(r.stdout) as { mode: string; matches: Array<{ id: string }> };
    assert.equal(parsed.mode, "regex");
    assert.ok(parsed.matches.some((m) => m.id === "user:codex:probe"));
  } finally {
    await fake.cleanup();
  }
});

test("CLI: skills dci grep --regex rejects every codex-named pathological pattern with exit 2", async () => {
  const fake = await makeDciCliEnv();
  try {
    const patterns = [
      "(a+){2,}$",
      "([a-z]+){2,}$",
      "(a{1,})+$",
      "(a?)+$",
      "^(a|aa)+$",
    ];
    for (const pattern of patterns) {
      const r = await runDciCli(["skills", "dci", "grep", "--regex", "--pattern", pattern], fake.env);
      assert.equal(r.code, 2, `expected exit 2 for ${pattern}, got ${r.code}; stderr=${r.stderr}`);
      assert.match(r.stderr, /catastrophic|overlapping|open-ended|large \{n,m\} bound/);
    }
  } finally {
    await fake.cleanup();
  }
});

test("CLI: skills dci grep --regex rejects the codex consecutive-overlap pattern with exit 2", async () => {
  const fake = await makeDciCliEnv();
  try {
    const pattern = "a*".repeat(24) + "b";
    const startedAt = Date.now();
    const r = await runDciCli(["skills", "dci", "grep", "--regex", "--pattern", pattern], fake.env);
    const elapsed = Date.now() - startedAt;
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, /consecutive overlapping/);
    // The CLI spawns node + tsx, so allow a generous bound, but it must
    // nowhere near approach the ~75s the unguarded engine would burn.
    assert.ok(elapsed < 5000, `expected fast reject, took ${elapsed}ms`);
  } finally {
    await fake.cleanup();
  }
});

test("CLI: skills dci grep --regex deadline catches a heuristic-bypassing slow pattern", async () => {
  const fake = await makeDciCliEnv();
  try {
    // Rewrite the probe skill body so its single line forces catastrophic
    // backtracking on the deadline test pattern below.
    const probeDir = join(fake.env.CODEX_HOME as string, "skills", "probe");
    const N = 14;
    await writeFile(
      join(probeDir, "SKILL.md.agentic-skill-router-disabled"),
      `---\nname: probe\ndescription: dci regex deadline probe skill\n---\n\n${"ab".repeat(N)}\n`,
    );

    // Interleaved signatures defeat the static streak rule and the dot-wildcard
    // rule but still trip the per-line deadline.
    const slowPattern = "a?b?".repeat(N) + "ab".repeat(N) + "c";
    const startedAt = Date.now();
    const r = await runDciCli(
      ["skills", "dci", "grep", "--regex", "--pattern", slowPattern, "--json"],
      fake.env,
    );
    const elapsed = Date.now() - startedAt;
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}; stderr=${r.stderr}`);
    assert.match(r.stderr, /deadline|>.*ms on a single line/);
    // The deadline is post-hoc: spawning + one catastrophic match + abort.
    // 20s accommodates up to ~25× hardware variance over the ~800ms baseline.
    assert.ok(elapsed < 20000, `expected deadline path to abort within 20s, took ${elapsed}ms`);
  } finally {
    await fake.cleanup();
  }
});
