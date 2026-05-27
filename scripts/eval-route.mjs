#!/usr/bin/env node
// Route evaluation harness.
//
// Reads tests/fixtures/route-cases.json, runs each case through the requested
// route mode (default: auto), and prints a markdown summary plus a JSON block
// covering top1 accuracy, top3 recall, no-select precision, ambiguous-reject
// rate, and metadata-hit / dci-escalation ratios.
//
// `metadataHitRate` is reported in `auto` and `metadata` modes only (in
// `lexical` and `dci` every hit is from that mode by definition, so the rate
// is `n/a`). `dciEscalationRate` is meaningful only in `auto` mode, where
// metadata can escalate to DCI; it is `n/a` in every other mode. The
// per-case `routedSource` column attributes hits to the mode that produced
// them, using `diagnostics.auto.selectedSource` for `auto` and the mode name
// itself for `metadata` / `lexical` / `dci`.
//
// Exit code is 0 unless the script itself errors (e.g. bad fixture or unknown
// mode). Failing metrics do not fail the command — the eval is informational,
// not a CI gate (see issue #34 acceptance criteria).
//
// Invocation:
//   node --import tsx scripts/eval-route.mjs              # mode=auto
//   node --import tsx scripts/eval-route.mjs --mode=metadata
//   node --import tsx scripts/eval-route.mjs --json       # JSON-only output
//   node --import tsx scripts/eval-route.mjs --fixture=path/to/cases.json
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { routeDisabledSkillsAuto } from "../src/auto-route.ts";
import { routeDisabledSkillsMetadata } from "../src/metadata-route.ts";
import { routeDisabledSkills } from "../src/route.ts";
import { dciRouteDisabledSkills } from "../src/dci.ts";

const SUPPORTED_MODES = new Set(["auto", "metadata", "lexical", "dci"]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function parseArgs(argv) {
  const opts = { mode: "auto", json: false, fixture: null, topK: 3 };
  for (const arg of argv) {
    if (arg === "--json") {
      opts.json = true;
    } else if (arg.startsWith("--mode=")) {
      opts.mode = arg.slice("--mode=".length);
    } else if (arg.startsWith("--fixture=")) {
      opts.fixture = arg.slice("--fixture=".length);
    } else if (arg.startsWith("--topK=")) {
      const value = Number(arg.slice("--topK=".length));
      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`invalid --topK value: ${arg}`);
      }
      opts.topK = Math.floor(value);
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!opts.help && !SUPPORTED_MODES.has(opts.mode)) {
    throw new Error(`unsupported --mode=${opts.mode}; expected one of ${[...SUPPORTED_MODES].join(", ")}`);
  }
  return opts;
}

function buildSkill(spec, skillMdPath) {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    metadata: spec.metadata ?? { name: spec.name, description: spec.description },
    source: "user",
    pluginKey: null,
    skillMdPath,
    isDisabled: true,
    isPluginDisabled: false,
    canDisable: true,
    conflict: false,
  };
}

// Auto mode escalates to DCI (body search) for ambiguous queries, which reads
// each candidate's SKILL.md from disk. Materialize a small SKILL.md per
// fixture skill so DCI sees a real corpus instead of ENOENT warnings.
async function materializeSkillFiles(root, specs) {
  await mkdir(root, { recursive: true });
  const out = [];
  for (const spec of specs) {
    const dir = join(root, spec.name);
    await mkdir(dir, { recursive: true });
    const skillMdPath = join(dir, "SKILL.md.agentic-skill-router-disabled");
    const metadata = spec.metadata ?? { name: spec.name, description: spec.description };
    const yamlSafe = (text) => text.replace(/"/g, '\\"').replace(/\r?\n/g, " ");
    const body = [
      "---",
      `name: ${spec.name}`,
      `description: ${yamlSafe(spec.description)}`,
      "---",
      "",
      `# ${spec.name}`,
      "",
      spec.description,
      "",
      "## Metadata",
      "",
      `- aliases: ${JSON.stringify(metadata.aliases ?? [])}`,
      `- domains: ${JSON.stringify(metadata.domains ?? [])}`,
      `- intents: ${JSON.stringify(metadata.intents ?? [])}`,
      `- tools: ${JSON.stringify(metadata.tools ?? [])}`,
      "",
    ].join("\n");
    await writeFile(skillMdPath, body, "utf8");
    out.push(buildSkill(spec, skillMdPath));
  }
  return out;
}

async function routeOnce(mode, skills, query, opts) {
  if (mode === "auto") return routeDisabledSkillsAuto(skills, query, opts);
  if (mode === "metadata") return routeDisabledSkillsMetadata(skills, query, opts);
  if (mode === "lexical") return routeDisabledSkills(skills, query, opts);
  if (mode === "dci") return dciRouteDisabledSkills(skills, query, opts);
  throw new Error(`unreachable mode ${mode}`);
}

// Each non-auto mode is, by definition, the source of any hit it produces.
// Auto mode is the only one that picks between sources at runtime, so it is
// the only mode that exposes `escalated` (metadata escalated to DCI).
//
// Returns:
//   routedSource: which source produced the selection ("metadata" | "lexical" |
//                 "dci" | "body" | null when nothing was selected)
//   escalated:    boolean for auto mode (did metadata escalate to DCI); null
//                 for the other modes because the concept doesn't apply.
function attributeSource(mode, result) {
  const selected = result.selected ?? null;
  if (mode === "auto") {
    return {
      routedSource: result.diagnostics?.auto?.selectedSource ?? null,
      escalated: result.diagnostics?.auto?.escalated === true,
    };
  }
  // Non-auto modes always attribute hits to themselves; misses have no source.
  return {
    routedSource: selected ? mode : null,
    escalated: null,
  };
}

function classify(testCase, result) {
  const selectedId = result.selected?.skill.id ?? null;
  const topIds = result.matches.map((m) => m.skill.id);
  const top1 = topIds[0] ?? null;
  const expected = testCase.expected;
  const expectsSelect = testCase.shouldSelect === true;

  // Top-1 accuracy is meaningful only for positive cases. Negative cases score
  // top-1 by matching the "no selection" outcome.
  const top1Hit = expectsSelect ? selectedId !== null && selectedId === expected : selectedId === null;

  // Top-3 recall is the named metric, so it must ALWAYS measure the first
  // three returned matches regardless of the route call's --topK. The route
  // is invoked with topK = max(userArg, 3) so the underlying list always
  // contains at least three candidates when available; here we slice to 3 so
  // the metric stays "true top-3" even if the user passed --topK=1 or 5.
  // For negative cases we don't credit recall (it would be meaningless).
  const top3Ids = topIds.slice(0, 3);
  const top3Hit = expectsSelect ? expected !== null && top3Ids.includes(expected) : null;

  // Ambiguous reject: positive case where top-1 is correct but selected was
  // null (router saw the candidate but refused to commit). Useful to see how
  // often the ambiguity margins cost us a selection.
  const ambiguousReject = expectsSelect && selectedId === null && expected !== null && top1 === expected;

  // No-select precision tracks the negative cases — did we correctly refrain
  // from selecting?
  const noSelectCorrect = !expectsSelect && selectedId === null;
  const noSelectFalsePositive = !expectsSelect && selectedId !== null;

  return {
    selectedId,
    top1,
    top1Hit,
    top3Hit,
    ambiguousReject,
    noSelectCorrect,
    noSelectFalsePositive,
  };
}

function pct(numerator, denominator) {
  if (denominator === 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function summarize(mode, rows) {
  const positive = rows.filter((r) => r.expectsSelect);
  const negative = rows.filter((r) => !r.expectsSelect);

  const top1Hits = rows.filter((r) => r.top1Hit).length;
  const top3HitsPositive = positive.filter((r) => r.top3Hit === true).length;
  const ambiguousRejects = rows.filter((r) => r.ambiguousReject).length;
  const noSelectCorrect = negative.filter((r) => r.noSelectCorrect).length;
  const noSelectFalsePositives = negative.filter((r) => r.noSelectFalsePositive).length;

  // metadataHitRate is only meaningful in modes where some hits can come from
  // metadata and others can come from a different source. That is true in
  // `auto` (metadata vs escalated DCI) and trivially true in `metadata`
  // (every hit is a metadata hit). For `lexical` and `dci`, every hit is from
  // that mode by definition, so the rate carries no information — report n/a.
  const metadataExposed = mode === "auto" || mode === "metadata";
  const metadataHits = metadataExposed ? rows.filter((r) => r.routedSource === "metadata").length : 0;

  // dciEscalationRate only applies to `auto`, where metadata can escalate to
  // DCI. The other modes have no escalation concept — report n/a.
  const dciEscalationExposed = mode === "auto";
  const dciEscalations = dciEscalationExposed ? rows.filter((r) => r.escalated === true).length : 0;

  return {
    cases: rows.length,
    positiveCases: positive.length,
    negativeCases: negative.length,
    top1Accuracy: pct(top1Hits, rows.length),
    top3RecallPositive: pct(top3HitsPositive, positive.length),
    noSelectPrecision: pct(noSelectCorrect, negative.length),
    noSelectFalsePositiveRate: pct(noSelectFalsePositives, negative.length),
    ambiguousRejectRate: pct(ambiguousRejects, positive.length),
    metadataHitRate: metadataExposed ? pct(metadataHits, rows.length) : null,
    dciEscalationRate: dciEscalationExposed ? pct(dciEscalations, rows.length) : null,
  };
}

function renderMarkdown(mode, fixtureRelPath, rows, summary, opts) {
  const lines = [];
  lines.push(`# Route evaluation (mode=${mode})`);
  lines.push("");
  lines.push(`Fixture: \`${fixtureRelPath}\``);
  lines.push(`Cases: ${summary.cases} (positive=${summary.positiveCases}, negative=${summary.negativeCases})`);
  // Surface both knobs: the user-requested --topK (route call width) and the
  // effective top-3 slice used for the recall metric. They are intentionally
  // decoupled so the metric remains "true top-3" regardless of --topK.
  lines.push(
    `Route topK: ${opts.routeTopK} (--topK=${opts.userTopK}; top-3 recall always measures the first 3 matches)`,
  );
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Top-1 accuracy (all cases) | ${formatPct(summary.top1Accuracy)} |`);
  lines.push(`| Top-3 recall (positive cases) | ${formatPct(summary.top3RecallPositive)} |`);
  lines.push(`| No-select precision (negative cases) | ${formatPct(summary.noSelectPrecision)} |`);
  lines.push(`| No-select false-positive rate | ${formatPct(summary.noSelectFalsePositiveRate)} |`);
  lines.push(`| Ambiguous reject rate (positive cases) | ${formatPct(summary.ambiguousRejectRate)} |`);
  lines.push(`| Metadata hit ratio | ${formatPct(summary.metadataHitRate)} |`);
  lines.push(`| DCI escalation ratio | ${formatPct(summary.dciEscalationRate)} |`);
  lines.push("");
  lines.push("## Cases");
  lines.push("");
  lines.push("| # | Name | Category | Outcome | Expected | Selected | Top-1 | Top-3 | Source | Escalated |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  rows.forEach((row, idx) => {
    const outcome = outcomeLabel(row);
    lines.push(
      `| ${idx + 1} | ${row.name} | ${row.category} | ${outcome} | ${formatId(row.expected)} | ${formatId(row.selectedId)} | ${formatBool(row.top1Hit)} | ${formatTriBool(row.top3Hit)} | ${row.routedSource ?? "-"} | ${formatEscalated(row.escalated)} |`,
    );
  });
  lines.push("");
  return lines.join("\n");
}

function formatPct(value) {
  if (value === null) return "n/a";
  return `${value}%`;
}

function formatId(id) {
  if (id === null || id === undefined) return "(none)";
  return `\`${id}\``;
}

function formatBool(value) {
  if (value === true) return "hit";
  if (value === false) return "miss";
  return "-";
}

function formatTriBool(value) {
  if (value === null) return "-";
  return formatBool(value);
}

function formatEscalated(value) {
  if (value === null) return "n/a";
  return value ? "yes" : "no";
}

function outcomeLabel(row) {
  if (row.expectsSelect) {
    if (row.top1Hit) return "correct";
    if (row.ambiguousReject) return "ambiguous";
    return "wrong";
  }
  return row.noSelectCorrect ? "correct" : "false-positive";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(usage());
    return;
  }

  const fixturePath = opts.fixture
    ? resolve(process.cwd(), opts.fixture)
    : resolve(repoRoot, "tests/fixtures/route-cases.json");
  const fixtureRelPath = pathRelativeToRepo(fixturePath);
  const raw = await readFile(fixturePath, "utf8");
  const fixture = JSON.parse(raw);

  if (!Array.isArray(fixture?.skills) || !Array.isArray(fixture?.cases)) {
    throw new Error(`fixture must contain skills[] and cases[]: ${fixturePath}`);
  }

  // Decouple the route call's topK from the top-3 recall metric: the metric
  // ALWAYS slices the first three matches (see classify()), so we request at
  // least 3 from the route regardless of --topK. The user-requested value is
  // surfaced in the report header and JSON payload so the output remains
  // meaningful.
  const routeTopK = Math.max(opts.topK, 3);

  const workDir = await mkdtemp(join(tmpdir(), "agentic-skill-router-eval-"));
  const rows = [];
  try {
    const skills = await materializeSkillFiles(join(workDir, "skills"), fixture.skills);

    for (const testCase of fixture.cases) {
      const result = await routeOnce(opts.mode, skills, testCase.query, { topK: routeTopK });
      const classification = classify(testCase, result);
      const { routedSource, escalated } = attributeSource(opts.mode, result);
      rows.push({
        name: testCase.name ?? testCase.query,
        query: testCase.query,
        category: testCase.category ?? "uncategorized",
        expected: testCase.expected ?? null,
        expectsSelect: testCase.shouldSelect === true,
        routedSource,
        escalated,
        ...classification,
      });
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const summary = summarize(opts.mode, rows);
  const payload = {
    mode: opts.mode,
    fixture: fixtureRelPath,
    // userTopK is the value the caller passed via --topK (may be < or > 3).
    // routeTopK is what we actually requested from the route (>= 3) so the
    // top-3 recall metric always has at least three candidates to slice from.
    userTopK: opts.topK,
    routeTopK,
    summary,
    cases: rows,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `${renderMarkdown(opts.mode, fixtureRelPath, rows, summary, { userTopK: opts.topK, routeTopK })}\n`,
  );
  process.stdout.write("\n## JSON summary\n\n");
  process.stdout.write("```json\n");
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write("```\n");
}

function pathRelativeToRepo(absolute) {
  const prefix = `${repoRoot}/`;
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute;
}

function usage() {
  return `usage: node --import tsx scripts/eval-route.mjs [options]

Options:
  --mode=<auto|metadata|lexical|dci>   route mode under test (default: auto)
  --fixture=<path>                     route-cases fixture (default: tests/fixtures/route-cases.json)
  --topK=<n>                           top-K for the route call (default: 3)
  --json                               JSON-only output
  --help, -h                           show this help

Notes:
  Exit code is 0 unless the script itself errors. Metric thresholds are not
  enforced; the eval is informational.
`;
}

main().catch((err) => {
  process.stderr.write(`eval-route failed: ${err.stack ?? err.message ?? err}\n`);
  process.exit(2);
});
