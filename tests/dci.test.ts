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
