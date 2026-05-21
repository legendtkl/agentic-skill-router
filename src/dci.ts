import { createHash } from "node:crypto";
import { open as openFile, readFile } from "node:fs/promises";
import type { Confidence, Skill } from "./types.ts";
import { isRoutableDisabledSkill, type SkillRouteMatch, type SkillRouteResult } from "./route.ts";

export interface DciOptions {
  topK?: number;
  maxSnippets?: number;
  maxChars?: number;
  maxQueries?: number;
}

export interface DciRouteOptions extends DciOptions {}

export interface DciGrepOptions extends DciOptions {
  regex?: boolean;
}

export interface DciFindOptions extends DciGrepOptions {}

export interface DciOpenOptions {
  line?: number;
  window?: number;
}

export interface DciBudget {
  maxQueries: number;
  maxCandidates: number;
  maxSkillBytes: number;
  maxCorpusBytes: number;
  maxFindsOrOpens: number;
  maxFullReads: number;
  maxSelections: number;
  defaultWindowLines: number;
  maxWindowLines: number;
  maxOpenChars: number;
}

export interface DciSkillRef {
  ref: string;
  id: string;
  name: string;
  source: Skill["source"];
  pluginKey: string | null;
  skillMdPath: string;
  description: string;
}

export interface DciSnippet {
  line: number;
  text: string;
}

export interface DciCorpusSummary {
  mode: "disabled-only";
  scanned: number;
  matched: number;
  loaded: number;
  bytesRead: number;
  truncated: number;
  skipped: number;
}

export interface DciCorpusWarning {
  code: "skill-body-truncated" | "corpus-budget-exhausted" | "skill-body-read-failed";
  message: string;
  id?: string;
  skillMdPath?: string;
  bytesRead?: number;
  fileBytes?: number;
  limitBytes?: number;
  skipped?: number;
}

export interface DciSearchMatch extends DciSkillRef {
  score: number;
  reason: string;
  matchedQuery: string;
  snippets: DciSnippet[];
}

export interface DciSearchResult {
  query: string;
  queries: string[];
  action: "inspect-or-read-candidates" | "no-candidates";
  budget: DciBudget;
  corpus: DciCorpusSummary;
  warnings: DciCorpusWarning[];
  matches: DciSearchMatch[];
}

export interface DciGrepResult {
  pattern: string;
  mode: "literal" | "regex";
  action: "inspect-or-read-candidates" | "no-candidates";
  budget: DciBudget;
  corpus: DciCorpusSummary;
  warnings: DciCorpusWarning[];
  matches: DciSearchMatch[];
}

export interface DciFindResult extends DciSkillRef {
  pattern: string;
  mode: "literal" | "regex";
  action: "inspect-or-open-candidate" | "no-matches";
  budget: DciBudget;
  corpus: {
    mode: "single-disabled-skill";
    matchedLines: number;
  };
  snippets: DciSnippet[];
}

export interface DciOpenResult extends DciSkillRef {
  action: "read-skill-window";
  startLine: number;
  endLine: number;
  anchorLine: number;
  totalLines: number;
  window: number;
  content: string;
  truncated: boolean;
  maxChars: number;
}

export interface DciInspectResult extends DciSkillRef {
  action: "read-skill-file";
  isDisabled: boolean;
  canDisable: boolean;
  conflict: boolean;
}

export interface DciReadResult extends DciSkillRef {
  action: "read-skill-file";
  content: string;
  truncated: boolean;
  maxChars: number;
}

export interface DciSelectResult extends DciSkillRef {
  action: "read-skill-file";
  confidence: Confidence;
  reason: string;
}

export interface DciSelectManyResult {
  action: "read-skill-files";
  confidence: Confidence;
  reason: string;
  maxSelections: number;
  selected: DciSelectResult[];
}

interface LoadedSkill {
  skill: Skill;
  content: string;
  lines: string[];
  bytesRead: number;
  fileBytes: number;
  truncated: boolean;
}

interface ScoredLoadedSkill extends LoadedSkill {
  score: number;
  hitCount: number;
  queryTermCount: number;
  phraseMatched: boolean;
  matchedQuery: string;
  snippets: DciSnippet[];
}

export const DCI_BUDGET: DciBudget = {
  maxQueries: 3,
  maxCandidates: 8,
  maxSkillBytes: 64_000,
  maxCorpusBytes: 1_000_000,
  maxFindsOrOpens: 3,
  maxFullReads: 2,
  maxSelections: 3,
  defaultWindowLines: 80,
  maxWindowLines: 240,
  maxOpenChars: 24_000,
};

const DEFAULT_TOP_K = 8;
const DEFAULT_MAX_SNIPPETS = 3;
const DEFAULT_MAX_READ_CHARS = 12_000;
const MAX_SNIPPETS = 10;
const MAX_READ_CHARS = 80_000;
const DCI_AMBIGUOUS_SELECTION_MARGIN = 0.08;
const DCI_SELECTABLE_CONFIDENCES: ReadonlySet<Confidence> = new Set(["high", "medium"]);

export async function dciRouteDisabledSkills(
  skills: Skill[],
  query: string,
  opts: DciRouteOptions = {},
): Promise<SkillRouteResult> {
  const trimmedQuery = query.trim();
  if (trimmedQuery === "") {
    return { query: trimmedQuery, mode: "disabled-only", routeMode: "dci", selected: null, matches: [] };
  }

  const displayTopK = normalizePositiveInt(opts.topK, DEFAULT_TOP_K, DCI_BUDGET.maxCandidates);
  const search = await dciSearchDisabledSkills(skills, trimmedQuery, {
    topK: DCI_BUDGET.maxCandidates,
    ...(opts.maxSnippets === undefined ? {} : { maxSnippets: opts.maxSnippets }),
    ...(opts.maxQueries === undefined ? {} : { maxQueries: opts.maxQueries }),
  });
  const selectionMatches = search.matches.flatMap((match): SkillRouteMatch[] => {
    const skill = skills.find((candidate) => candidate.id === match.id && candidate.skillMdPath === match.skillMdPath);
    if (!skill) return [];
    return [toDciRouteMatch(skill, match)];
  });
  const selected = selectDciMatch(selectionMatches);
  const matches = selectionMatches.slice(0, displayTopK);
  return {
    query: trimmedQuery,
    mode: "disabled-only",
    routeMode: "dci",
    selected,
    matches,
    diagnostics: {
      dci: {
        selectedId: selected?.skill.id ?? null,
        action: selected ? "read-skill-file" : "no-confident-match",
        corpus: search.corpus,
        warnings: search.warnings,
        matches: selectionMatches.map((match) => ({
          id: match.skill.id,
          ref: refForSkill(match.skill),
          confidence: match.confidence,
          score: match.score,
          reason: match.reason,
        })),
      },
    },
  };
}

export async function dciSearchDisabledSkills(
  skills: Skill[],
  query: string | string[],
  opts: DciOptions = {},
): Promise<DciSearchResult> {
  const queries = normalizeQueries(query, normalizePositiveInt(opts.maxQueries, DCI_BUDGET.maxQueries, DCI_BUDGET.maxQueries));
  const trimmedQuery = queries.join("\n");
  const candidates = routableDisabledSkills(skills);
  if (queries.length === 0) {
    return emptySearchResult("", [], candidates.length);
  }

  const loaded = await loadSkills(candidates);
  const scored: ScoredLoadedSkill[] = [];
  const maxSnippets = normalizePositiveInt(opts.maxSnippets, DEFAULT_MAX_SNIPPETS, MAX_SNIPPETS);

  for (const item of loaded.skills) {
    const haystack = `${item.skill.id}\n${item.skill.name}\n${item.skill.description}\n${item.content}`;
    const haystackTerms = termsFor(haystack);
    const haystackPhrase = compact(haystack);
    let best: ScoredLoadedSkill | null = null;

    for (const currentQuery of queries) {
      const queryTerms = termsFor(currentQuery);
      const queryPhrase = compact(currentQuery);
      let hitCount = 0;
      for (const term of queryTerms) {
        if (haystackTerms.has(term) || haystackPhrase.includes(term)) hitCount++;
      }
      const phraseMatched = queryPhrase.length >= 4 && haystackPhrase.includes(queryPhrase);
      const score = scoreSearchMatch(hitCount, queryTerms.size, phraseMatched);
      if (score <= 0) continue;
      const candidate: ScoredLoadedSkill = {
        ...item,
        score,
        hitCount,
        queryTermCount: queryTerms.size,
        phraseMatched,
        matchedQuery: currentQuery,
        snippets: snippetsForTerms(item.lines, queryTerms, queryPhrase, maxSnippets),
      };
      if (!best || compareScored(candidate, best) < 0) best = candidate;
    }

    if (best) scored.push(best);
  }

  scored.sort(compareScored);
  const topK = normalizePositiveInt(opts.topK, DEFAULT_TOP_K, DCI_BUDGET.maxCandidates);
  const matches = scored.slice(0, topK).map(projectSearchMatch);
  return {
    query: trimmedQuery,
    queries,
    action: matches.length > 0 ? "inspect-or-read-candidates" : "no-candidates",
    budget: DCI_BUDGET,
    corpus: corpusSummary(candidates.length, scored.length, loaded),
    warnings: loaded.warnings,
    matches,
  };
}

export async function dciGrepDisabledSkills(
  skills: Skill[],
  pattern: string,
  opts: DciGrepOptions = {},
): Promise<DciGrepResult> {
  const trimmedPattern = pattern.trim();
  const candidates = routableDisabledSkills(skills);
  const mode = opts.regex ? "regex" : "literal";
  if (trimmedPattern === "") {
    return {
      pattern: trimmedPattern,
      mode,
      action: "no-candidates",
      budget: DCI_BUDGET,
      corpus: emptyCorpusSummary(candidates.length),
      warnings: [],
      matches: [],
    };
  }

  const matcher = createGrepMatcher(trimmedPattern, mode);
  const maxSnippets = normalizePositiveInt(opts.maxSnippets, DEFAULT_MAX_SNIPPETS, MAX_SNIPPETS);
  const loaded = await loadSkills(candidates);
  const matches: DciSearchMatch[] = [];

  for (const item of loaded.skills) {
    const snippets: DciSnippet[] = [];
    for (let i = 0; i < item.lines.length && snippets.length < maxSnippets; i++) {
      if (matcher(item.lines[i]!)) {
        snippets.push({ line: i + 1, text: clampLine(item.lines[i]!) });
      }
    }
    if (snippets.length === 0) continue;
    matches.push({
      ...skillRef(item.skill),
      score: snippets.length,
      reason: `matched ${snippets.length} line(s)`,
      matchedQuery: trimmedPattern,
      snippets,
    });
  }

  matches.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const topK = normalizePositiveInt(opts.topK, DEFAULT_TOP_K, DCI_BUDGET.maxCandidates);
  const topMatches = matches.slice(0, topK);
  return {
    pattern: trimmedPattern,
    mode,
    action: topMatches.length > 0 ? "inspect-or-read-candidates" : "no-candidates",
    budget: DCI_BUDGET,
    corpus: corpusSummary(candidates.length, matches.length, loaded),
    warnings: loaded.warnings,
    matches: topMatches,
  };
}

export async function dciFindInSkill(
  skills: Skill[],
  idOrRef: string,
  pattern: string,
  opts: DciFindOptions = {},
): Promise<DciFindResult> {
  const trimmedPattern = pattern.trim();
  const skill = findRoutableSkillOrThrow(skills, idOrRef);
  const mode = opts.regex ? "regex" : "literal";
  const maxSnippets = normalizePositiveInt(opts.maxSnippets, DEFAULT_MAX_SNIPPETS, MAX_SNIPPETS);
  const content = await readFile(skill.skillMdPath, "utf8");
  const lines = content.split(/\r?\n/);
  const snippets: DciSnippet[] = [];

  if (trimmedPattern !== "") {
    const matcher = createGrepMatcher(trimmedPattern, mode);
    for (let i = 0; i < lines.length && snippets.length < maxSnippets; i++) {
      if (matcher(lines[i]!)) snippets.push({ line: i + 1, text: clampLine(lines[i]!) });
    }
  }

  return {
    ...skillRef(skill),
    pattern: trimmedPattern,
    mode,
    action: snippets.length > 0 ? "inspect-or-open-candidate" : "no-matches",
    budget: DCI_BUDGET,
    corpus: { mode: "single-disabled-skill", matchedLines: snippets.length },
    snippets,
  };
}

export async function dciOpenSkillWindow(
  skills: Skill[],
  idOrRef: string,
  opts: DciOpenOptions = {},
): Promise<DciOpenResult> {
  const skill = findRoutableSkillOrThrow(skills, idOrRef);
  const anchorLine = normalizePositiveInt(opts.line, 1, Number.MAX_SAFE_INTEGER);
  const window = normalizePositiveInt(opts.window, DCI_BUDGET.defaultWindowLines, DCI_BUDGET.maxWindowLines);
  const content = await readFile(skill.skillMdPath, "utf8");
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const safeAnchor = Math.min(anchorLine, Math.max(1, totalLines));
  const before = Math.floor((window - 1) / 2);
  let startLine = Math.max(1, safeAnchor - before);
  let endLine = Math.min(totalLines, startLine + window - 1);
  startLine = Math.max(1, endLine - window + 1);
  const numbered = lines.slice(startLine - 1, endLine).map((line, idx) => `${startLine + idx}: ${line}`).join("\n");
  const truncated = numbered.length > DCI_BUDGET.maxOpenChars;
  const boundedContent = truncated ? numbered.slice(0, DCI_BUDGET.maxOpenChars) : numbered;

  return {
    ...skillRef(skill),
    action: "read-skill-window",
    startLine,
    endLine,
    anchorLine: safeAnchor,
    totalLines,
    window,
    content: boundedContent,
    truncated,
    maxChars: DCI_BUDGET.maxOpenChars,
  };
}

export function dciInspectSkill(skills: Skill[], idOrRef: string): DciInspectResult {
  const skill = findRoutableSkillOrThrow(skills, idOrRef);
  return {
    ...skillRef(skill),
    action: "read-skill-file",
    isDisabled: skill.isDisabled,
    canDisable: skill.canDisable,
    conflict: skill.conflict,
  };
}

export async function dciReadSkill(
  skills: Skill[],
  idOrRef: string,
  opts: DciOptions = {},
): Promise<DciReadResult> {
  const skill = findRoutableSkillOrThrow(skills, idOrRef);
  const maxChars = normalizePositiveInt(opts.maxChars, DEFAULT_MAX_READ_CHARS, MAX_READ_CHARS);
  const content = await readFile(skill.skillMdPath, "utf8");
  const truncated = content.length > maxChars;
  return {
    ...skillRef(skill),
    action: "read-skill-file",
    content: truncated ? content.slice(0, maxChars) : content,
    truncated,
    maxChars,
  };
}

export function dciSelectSkill(
  skills: Skill[],
  idOrRef: string,
  confidence: Confidence,
  reason: string,
): DciSelectResult {
  const skill = findRoutableSkillOrThrow(skills, idOrRef);
  return {
    ...skillRef(skill),
    action: "read-skill-file",
    confidence,
    reason,
  };
}

export function dciSelectSkills(
  skills: Skill[],
  idOrRefs: string[],
  confidence: Confidence,
  reason: string,
): DciSelectManyResult {
  const selected: DciSelectResult[] = [];
  const seen = new Set<string>();
  for (const idOrRef of idOrRefs) {
    const skill = findRoutableSkillOrThrow(skills, idOrRef);
    if (seen.has(skill.id)) continue;
    selected.push({
      ...skillRef(skill),
      action: "read-skill-file",
      confidence,
      reason,
    });
    seen.add(skill.id);
  }
  if (selected.length === 0) throw new Error("select at least one disabled skill");
  if (selected.length > DCI_BUDGET.maxSelections) {
    throw new Error(`too many DCI selections: max ${DCI_BUDGET.maxSelections}`);
  }
  return {
    action: "read-skill-files",
    confidence,
    reason,
    maxSelections: DCI_BUDGET.maxSelections,
    selected,
  };
}

export function routableDisabledSkills(skills: Skill[]): Skill[] {
  return skills.filter(isRoutableDisabledSkill);
}

function emptySearchResult(query: string, queries: string[], scanned: number): DciSearchResult {
  return {
    query,
    queries,
    action: "no-candidates",
    budget: DCI_BUDGET,
    corpus: emptyCorpusSummary(scanned),
    warnings: [],
    matches: [],
  };
}

interface LoadedSkillSet {
  skills: LoadedSkill[];
  bytesRead: number;
  truncated: number;
  skipped: number;
  warnings: DciCorpusWarning[];
}

async function loadSkills(skills: Skill[]): Promise<LoadedSkillSet> {
  const out: LoadedSkill[] = [];
  const warnings: DciCorpusWarning[] = [];
  let bytesRead = 0;
  let truncated = 0;
  let skipped = 0;

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i]!;
    const remainingCorpusBytes = DCI_BUDGET.maxCorpusBytes - bytesRead;
    if (remainingCorpusBytes <= 0) {
      skipped = skills.length - i;
      warnings.push({
        code: "corpus-budget-exhausted",
        message: `DCI corpus byte budget exhausted after reading ${bytesRead} bytes; skipped ${skipped} disabled skill bodies.`,
        bytesRead,
        limitBytes: DCI_BUDGET.maxCorpusBytes,
        skipped,
      });
      break;
    }

    const limitBytes = Math.min(DCI_BUDGET.maxSkillBytes, remainingCorpusBytes);
    try {
      const loaded = await readSkillPrefix(skill.skillMdPath, limitBytes);
      bytesRead += loaded.bytesRead;
      if (loaded.truncated) {
        truncated++;
        warnings.push({
          code: "skill-body-truncated",
          message: `DCI read truncated ${skill.id} at ${loaded.bytesRead} of ${loaded.fileBytes} bytes.`,
          id: skill.id,
          skillMdPath: skill.skillMdPath,
          bytesRead: loaded.bytesRead,
          fileBytes: loaded.fileBytes,
          limitBytes,
        });
      }
      out.push({
        skill,
        content: loaded.content,
        lines: loaded.content.split(/\r?\n/),
        bytesRead: loaded.bytesRead,
        fileBytes: loaded.fileBytes,
        truncated: loaded.truncated,
      });
    } catch (err) {
      const message = `failed to read ${skill.skillMdPath}: ${(err as Error).message}`;
      warnings.push({
        code: "skill-body-read-failed",
        message,
        id: skill.id,
        skillMdPath: skill.skillMdPath,
      });
      process.stderr.write(`warning: ${message}\n`);
    }
  }
  return { skills: out, bytesRead, truncated, skipped, warnings };
}

async function readSkillPrefix(
  path: string,
  limitBytes: number,
): Promise<{ content: string; bytesRead: number; fileBytes: number; truncated: boolean }> {
  const handle = await openFile(path, "r");
  try {
    const stats = await handle.stat();
    const bytesToRead = Math.min(limitBytes, stats.size);
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const result = bytesToRead > 0
      ? await handle.read(buffer, 0, bytesToRead, 0)
      : { bytesRead: 0 };
    const bytesRead = result.bytesRead;
    const truncated = stats.size > bytesRead;
    // When the file is truncated mid-character, walk back to the last
    // complete UTF-8 boundary so that `toString('utf8')` does not emit
    // U+FFFD replacement characters for an incomplete trailing sequence.
    const decodeEnd = truncated ? utf8SafeEnd(buffer, bytesRead) : bytesRead;
    return {
      content: buffer.subarray(0, decodeEnd).toString("utf8"),
      bytesRead,
      fileBytes: stats.size,
      truncated,
    };
  } finally {
    await handle.close();
  }
}

// Returns the largest end offset in `buffer` (<= `length`) that ends on a
// complete UTF-8 character boundary. Walks back at most 3 bytes, since any
// valid UTF-8 sequence is at most 4 bytes long.
function utf8SafeEnd(buffer: Buffer, length: number): number {
  if (length <= 0) return 0;
  const lastByte = buffer[length - 1]!;
  // A single-byte (ASCII) character ends cleanly on its own.
  if ((lastByte & 0x80) === 0) return length;
  const minStart = Math.max(0, length - 4);
  // Walk back through continuation bytes (10xxxxxx) to find the lead byte.
  for (let i = length - 1; i >= minStart; i--) {
    const byte = buffer[i]!;
    if ((byte & 0xc0) === 0x80) continue; // continuation byte, keep walking
    // Found a lead byte. Determine its expected sequence length.
    let expected: number;
    if ((byte & 0xe0) === 0xc0) expected = 2;
    else if ((byte & 0xf0) === 0xe0) expected = 3;
    else if ((byte & 0xf8) === 0xf0) expected = 4;
    else return length; // not a UTF-8 lead byte; let toString handle it
    const actual = length - i;
    if (actual >= expected) return length; // sequence is complete
    return i; // truncate before the incomplete lead byte
  }
  // Buffer is entirely continuation bytes within the lookback window.
  return minStart;
}

function emptyCorpusSummary(scanned: number): DciCorpusSummary {
  return {
    mode: "disabled-only",
    scanned,
    matched: 0,
    loaded: 0,
    bytesRead: 0,
    truncated: 0,
    skipped: 0,
  };
}

function corpusSummary(scanned: number, matched: number, loaded: LoadedSkillSet): DciCorpusSummary {
  return {
    mode: "disabled-only",
    scanned,
    matched,
    loaded: loaded.skills.length,
    bytesRead: loaded.bytesRead,
    truncated: loaded.truncated,
    skipped: loaded.skipped,
  };
}

function findRoutableSkillOrThrow(skills: Skill[], idOrRef: string): Skill {
  const idMatches = skills.filter((s) => s.id === idOrRef);
  const routableIdMatches = idMatches.filter(isRoutableDisabledSkill);
  if (routableIdMatches.length > 1) throw new Error(`ambiguous skill id: ${idOrRef}; use a DCI ref instead`);
  const skill = routableIdMatches[0] ?? idMatches[0] ?? resolveSkillRef(skills, idOrRef);
  if (!skill) throw new Error(`unknown skill id/ref: ${idOrRef}`);
  if (!isRoutableDisabledSkill(skill)) {
    throw new Error(`skill is not a routable disabled skill: ${idOrRef}`);
  }
  return skill;
}

function resolveSkillRef(skills: Skill[], ref: string): Skill | undefined {
  const matches = routableDisabledSkills(skills).filter((skill) => refForSkill(skill) === ref);
  if (matches.length > 1) throw new Error(`ambiguous DCI candidate ref: ${ref}`);
  return matches[0];
}

function projectSearchMatch(item: ScoredLoadedSkill): DciSearchMatch {
  return {
    ...skillRef(item.skill),
    score: Number(item.score.toFixed(4)),
    reason: reasonForSearch(item),
    matchedQuery: item.matchedQuery,
    snippets: item.snippets,
  };
}

function toDciRouteMatch(skill: Skill, match: DciSearchMatch): SkillRouteMatch {
  return {
    skill,
    score: match.score,
    confidence: confidenceForDciScore(match.score),
    reason: `DCI corpus match: ${match.reason}`,
    signals: {
      hitCount: 0,
      tokenCount: 0,
      candidateHitCount: 0,
      candidateTokenCount: 0,
      cueHitCount: 0,
      matchedName: false,
      matchedPhrase: match.reason.includes("matched query phrase"),
    },
  };
}

function confidenceForDciScore(score: number): Confidence {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function selectDciMatch(matches: SkillRouteMatch[]): SkillRouteMatch | null {
  const first = matches[0];
  if (!first || !DCI_SELECTABLE_CONFIDENCES.has(first.confidence)) return null;
  const second = matches[1];
  if (
    second &&
    DCI_SELECTABLE_CONFIDENCES.has(second.confidence) &&
    first.score - second.score < DCI_AMBIGUOUS_SELECTION_MARGIN
  ) {
    return null;
  }
  return first;
}

function skillRef(skill: Skill): DciSkillRef {
  return {
    ref: refForSkill(skill),
    id: skill.id,
    name: skill.name,
    source: skill.source,
    pluginKey: skill.pluginKey,
    skillMdPath: skill.skillMdPath,
    description: skill.description,
  };
}

function refForSkill(skill: Skill): string {
  const hash = createHash("sha256").update(`${skill.id}\0${skill.skillMdPath}`).digest("hex").slice(0, 10);
  return `dci-${hash}`;
}

function reasonForSearch(item: ScoredLoadedSkill): string {
  const parts: string[] = [];
  if (item.phraseMatched) parts.push("matched query phrase in skill corpus");
  if (item.queryTermCount > 0) parts.push(`matched ${item.hitCount}/${item.queryTermCount} query terms in skill corpus`);
  if (item.matchedQuery) parts.push(`best query: ${item.matchedQuery}`);
  return parts.join("; ") || "matched skill corpus";
}

function scoreSearchMatch(hitCount: number, queryTermCount: number, phraseMatched: boolean): number {
  if (queryTermCount === 0) return phraseMatched ? 1 : 0;
  const termScore = hitCount / queryTermCount;
  return Math.min(1, termScore + (phraseMatched ? 0.35 : 0));
}

// Minimal generic-term heuristic for snippet scoring. Kept local to dci.ts so
// the snippet selector stays self-contained: a richer notion of generic terms
// lives in metadata-route.ts but is not exported. Short Latin tokens (<=2
// chars) plus a few common English/Chinese stop terms count as generic; every
// other matched query term is treated as distinctive.
const SNIPPET_GENERIC_TERMS: ReadonlySet<string> = new Set([
  "api",
  "tool",
  "tools",
  "helper",
  "use",
  "get",
  "the",
  "and",
  "for",
  "with",
  "工具",
  "查询",
  "搜索",
  "管理",
  "操作",
  "平台",
  "任务",
  "服务",
]);

function isGenericSnippetTerm(term: string): boolean {
  if (term.length <= 2 && /^[a-z0-9]+$/.test(term)) return true;
  return SNIPPET_GENERIC_TERMS.has(term);
}

// Score per matched line, then return the top N by score (desc) with stable
// tie-break by original line number (asc). Previously this returned the first
// N matching lines top-to-bottom, which let earlier generic-only matches
// crowd out strong evidence (phrase / distinctive matches) later in the file.
function snippetsForTerms(lines: string[], terms: Set<string>, phrase: string, maxSnippets: number): DciSnippet[] {
  if (maxSnippets <= 0) return [];
  const scored: { line: number; text: string; score: number }[] = [];
  const metadataRange = detectMetadataRange(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineTerms = termsFor(line);
    const linePhrase = compact(line);
    let score = 0;

    const phraseMatched = phrase.length >= 4 && linePhrase.includes(phrase);
    if (phraseMatched) score += 5;

    const onMetadataLine = isMetadataLine(i, line, metadataRange);
    for (const term of terms) {
      if (!(lineTerms.has(term) || linePhrase.includes(term))) continue;
      if (isGenericSnippetTerm(term)) score += 0.3;
      else score += 2;
      if (onMetadataLine) score += 1;
    }

    if (score > 0) scored.push({ line: i + 1, text: clampLine(line), score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.line - b.line;
  });

  return scored.slice(0, maxSnippets).map((item) => ({ line: item.line, text: item.text }));
}

interface MetadataRange {
  start: number;
  end: number;
}

// Detect a YAML frontmatter block at the top of a SKILL.md so snippet scoring
// can give a small bonus to query terms that land on a metadata line (e.g.
// `name:` / `description:`). Frontmatter must open and close with `---` and
// start within the first few lines of the file.
function detectMetadataRange(lines: string[]): MetadataRange | null {
  let start = -1;
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    if (lines[i]!.trim() === "---") {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length && i < start + 200; i++) {
    if (lines[i]!.trim() === "---") return { start, end: i };
  }
  return null;
}

function isMetadataLine(index: number, line: string, range: MetadataRange | null): boolean {
  if (range && index >= range.start && index <= range.end) return true;
  // Outside a detected frontmatter, treat top-of-file `key: value` lines as
  // metadata so SKILL.md files with non-standard headers still get the bonus.
  if (index <= 6 && /^[A-Za-z][A-Za-z0-9_-]{0,40}\s*:\s+\S/.test(line)) return true;
  return false;
}

function compareScored(a: ScoredLoadedSkill, b: ScoredLoadedSkill): number {
  const delta = b.score - a.score;
  if (delta !== 0) return delta;
  const hitDelta = b.hitCount - a.hitCount;
  if (hitDelta !== 0) return hitDelta;
  return a.skill.id.localeCompare(b.skill.id);
}

function createGrepMatcher(pattern: string, mode: "literal" | "regex"): (line: string) => boolean {
  if (mode === "literal") {
    const needle = normalizeLiteral(pattern);
    return (line) => normalizeLiteral(line).includes(needle);
  }
  const regex = new RegExp(pattern, "iu");
  return (line) => {
    const matched = regex.test(line);
    regex.lastIndex = 0;
    return matched;
  };
}

function clampLine(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
}

function normalizePositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (!value || !Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

function normalizeQueries(input: string | string[], maxQueries: number): string[] {
  const raw = Array.isArray(input) ? input : [input];
  const queries: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const query = item.trim();
    const key = normalizeLiteral(query);
    if (!query || seen.has(key)) continue;
    queries.push(query);
    seen.add(key);
    if (queries.length >= maxQueries) break;
  }
  return queries;
}

function termsFor(input: string): Set<string> {
  const normalized = input.normalize("NFKC").toLowerCase();
  const terms = new Set<string>();

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_:+.-]*/g)) {
    const token = match[0];
    if (token.length >= 2) terms.add(token);
    for (const part of token.split(/[-_:+.]+/)) {
      if (part.length >= 2) terms.add(part);
    }
  }

  for (const match of normalized.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)) {
    const chars = Array.from(match[0]);
    if (chars.length === 1) {
      terms.add(chars[0]!);
      continue;
    }
    if (chars.length <= 8) terms.add(chars.join(""));
    for (let size = 2; size <= 3; size++) {
      for (let i = 0; i <= chars.length - size; i++) {
        terms.add(chars.slice(i, i + size).join(""));
      }
    }
  }

  return terms;
}

function compact(input: string): string {
  return input.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function normalizeLiteral(input: string): string {
  return input.normalize("NFKC").toLowerCase();
}
