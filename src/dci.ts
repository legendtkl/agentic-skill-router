import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open as openFile } from "node:fs/promises";
import { compact, GENERIC_TERM_WEIGHT, isGenericTerm, termsFor } from "./text-match.ts";
import type { Confidence, Skill } from "./types.ts";
import { isRoutableDisabledSkill, type SkillRouteMatch, type SkillRouteResult } from "./route.ts";
import type { MatchEvidence } from "./match-evidence.ts";
import { skillInstanceKey } from "./state.ts";

export interface DciOptions {
  topK?: number;
  maxSnippets?: number;
  maxChars?: number;
  maxQueries?: number;
  metadataOnly?: boolean;
}

export interface DciRouteOptions extends Omit<DciOptions, "metadataOnly"> {}

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
  evidence?: MatchEvidence[];
}

export interface DciSearchResult {
  query: string;
  queries: string[];
  metadataOnly: boolean;
  action: "inspect-candidates" | "inspect-or-read-candidates" | "no-candidates";
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
  /** Bytes streamed from the skill file before stopping. */
  bytesRead: number;
  /**
   * True when the find loop exhausted its byte budget before reaching EOF.
   * A match later in the file may exist but was not scanned.
   */
  truncated: boolean;
  /** Hard byte cap the find loop honored. */
  maxBytes: number;
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
  /** Bytes streamed from the skill file while collecting the window. */
  bytesRead: number;
}

export interface DciInspectResult extends DciSkillRef {
  action: "inspect-skill";
  isDisabled: boolean;
  canDisable: boolean;
  conflict: boolean;
}

export interface DciReadResult extends DciSkillRef {
  action: "read-skill-file";
  content: string;
  truncated: boolean;
  maxChars: number;
  /** Bytes actually read from disk while honoring the budget. */
  bytesRead: number;
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
  evidence: MatchEvidence[];
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
    return emptySearchResult("", [], candidates.length, Boolean(opts.metadataOnly));
  }

  const loaded = opts.metadataOnly ? loadSkillMetadata(candidates) : await loadSkills(candidates);
  const scored: ScoredLoadedSkill[] = [];
  const maxSnippets = normalizePositiveInt(opts.maxSnippets, DEFAULT_MAX_SNIPPETS, MAX_SNIPPETS);

  for (const item of loaded.skills) {
    const haystack = opts.metadataOnly
      ? skillMetadataText(item.skill)
      : `${item.skill.id}\n${item.skill.name}\n${item.skill.description}\n${item.content}`;
    const haystackTerms = termsFor(haystack);
    const haystackPhrase = compact(haystack);
    let best: ScoredLoadedSkill | null = null;

    for (const currentQuery of queries) {
      const queryTerms = termsFor(currentQuery);
      const queryPhrase = compact(currentQuery);
      let hitCount = 0;
      let weightedHit = 0;
      let weightedQueryWeight = 0;
      let distinctiveHit = 0;
      for (const term of queryTerms) {
        const generic = isGenericTerm(term, "dci");
        const weight = generic ? GENERIC_TERM_WEIGHT : 1;
        weightedQueryWeight += weight;
        if (haystackTerms.has(term) || haystackPhrase.includes(term)) {
          hitCount++;
          weightedHit += weight;
          if (!generic) distinctiveHit++;
        }
      }
      const phraseMatched = queryPhrase.length >= 4 && haystackPhrase.includes(queryPhrase);
      const score = scoreSearchMatch(weightedHit, weightedQueryWeight, phraseMatched, distinctiveHit);
      if (score <= 0) continue;
      const snippets = snippetsForTerms(item.lines, queryTerms, queryPhrase, maxSnippets);
      const candidate: ScoredLoadedSkill = {
        ...item,
        score,
        hitCount,
        queryTermCount: queryTerms.size,
        phraseMatched,
        matchedQuery: currentQuery,
        snippets,
        evidence: evidenceForDciSearch({
          metadataOnly: Boolean(opts.metadataOnly),
          queryTerms,
          queryPhrase,
          haystackTerms,
          haystackPhrase,
          phraseMatched,
          currentQuery,
          snippets,
          score,
        }),
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
    metadataOnly: Boolean(opts.metadataOnly),
    action: matches.length > 0
      ? (opts.metadataOnly ? "inspect-candidates" : "inspect-or-read-candidates")
      : "no-candidates",
    budget: searchBudget(Boolean(opts.metadataOnly)),
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

/**
 * Stream the target skill file line by line and collect up to `maxSnippets`
 * matches, then stop. The scan honors a hard byte budget (`DCI_BUDGET.maxSkillBytes`)
 * to keep memory bounded for pathologically large SKILL.md files.
 *
 * Strict-budget semantics: if the byte budget is exhausted before EOF and
 * before `maxSnippets` matches have been collected, the result is marked
 * `truncated: true`. A match that exists past the byte budget will NOT be
 * found; the budget is a hard cap on bytes scanned, not a soft hint.
 */
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
  const maxBytes = DCI_BUDGET.maxSkillBytes;
  const snippets: DciSnippet[] = [];
  let bytesRead = 0;
  let truncated = false;

  if (trimmedPattern !== "") {
    const matcher = createGrepMatcher(trimmedPattern, mode);
    const scan = await streamSkillLines(skill.skillMdPath, maxBytes, (line, lineNumber) => {
      if (matcher(line) && snippets.length < maxSnippets) {
        snippets.push({ line: lineNumber, text: clampLine(line) });
      }
      // Stop iterating as soon as we have collected enough snippets.
      return snippets.length < maxSnippets;
    });
    bytesRead = scan.bytesRead;
    // Only flag truncation when we genuinely ran out of byte budget AND we
    // had not already collected the requested number of snippets. Stopping
    // early because `maxSnippets` was reached is not truncation.
    truncated = scan.bytesExhausted && snippets.length < maxSnippets;
  }

  return {
    ...skillRef(skill),
    pattern: trimmedPattern,
    mode,
    action: snippets.length > 0 ? "inspect-or-open-candidate" : "no-matches",
    budget: DCI_BUDGET,
    corpus: { mode: "single-disabled-skill", matchedLines: snippets.length },
    snippets,
    bytesRead,
    truncated,
    maxBytes,
  };
}

/**
 * Stream the skill file once via `readline` and buffer only the window
 * of lines around `anchorLine`. Memory stays bounded to the window size
 * plus a single in-flight line buffer; we never materialize the whole
 * file. The numbered window is then capped to `DCI_BUDGET.maxOpenChars`.
 *
 * Note: the stream still walks the whole file so `totalLines` is accurate
 * and an anchor past EOF can be clamped back. Memory pressure — not raw
 * I/O — is the primary concern this guards against.
 */
export async function dciOpenSkillWindow(
  skills: Skill[],
  idOrRef: string,
  opts: DciOpenOptions = {},
): Promise<DciOpenResult> {
  const skill = findRoutableSkillOrThrow(skills, idOrRef);
  const anchorLine = normalizePositiveInt(opts.line, 1, Number.MAX_SAFE_INTEGER);
  const window = normalizePositiveInt(opts.window, DCI_BUDGET.defaultWindowLines, DCI_BUDGET.maxWindowLines);
  // Read the candidate window plus a small look-ahead so the safeAnchor
  // clamp below can still adjust if the file ends near `anchorLine`.
  const before = Math.floor((window - 1) / 2);
  const provisionalStart = Math.max(1, anchorLine - before);
  const provisionalEnd = provisionalStart + window - 1;

  // Buffer only the candidate window lines; count the rest to expose
  // accurate `totalLines` without retaining content past the window.
  const buffered = new Map<number, string>();
  let totalLines = 0;
  let bytesRead = 0;
  const scan = await streamSkillLines(skill.skillMdPath, Number.POSITIVE_INFINITY, (line, lineNumber) => {
    totalLines = lineNumber;
    if (lineNumber >= provisionalStart && lineNumber <= provisionalEnd) {
      buffered.set(lineNumber, line);
    }
    return true;
  });
  bytesRead = scan.bytesRead;
  if (totalLines === 0) totalLines = 1;

  const safeAnchor = Math.min(anchorLine, Math.max(1, totalLines));
  let startLine = Math.max(1, safeAnchor - before);
  let endLine = Math.min(totalLines, startLine + window - 1);
  startLine = Math.max(1, endLine - window + 1);

  const collected: string[] = [];
  for (let n = startLine; n <= endLine; n++) {
    collected.push(buffered.get(n) ?? "");
  }
  const numbered = collected.map((line, idx) => `${startLine + idx}: ${line}`).join("\n");
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
    bytesRead,
  };
}

export function dciInspectSkill(skills: Skill[], idOrRef: string): DciInspectResult {
  const skill = findRoutableSkillOrThrow(skills, idOrRef);
  return {
    ...skillRef(skill),
    action: "inspect-skill",
    isDisabled: skill.isDisabled,
    canDisable: skill.canDisable,
    conflict: skill.conflict,
  };
}

/**
 * Read the skill file using a bounded `fileHandle.read` against a
 * pre-allocated buffer. `maxChars` is treated as a byte budget at the I/O
 * layer: at most `maxChars + 1` bytes are pulled from disk so we can
 * detect truncation without paying for the full file. The result is then
 * decoded as UTF-8 (with a safe-boundary walk to avoid U+FFFD on
 * mid-character truncation) and sliced to at most `maxChars` characters
 * for backward-compatible content shape.
 */
export async function dciReadSkill(
  skills: Skill[],
  idOrRef: string,
  opts: DciOptions = {},
): Promise<DciReadResult> {
  const skill = findRoutableSkillOrThrow(skills, idOrRef);
  const maxChars = normalizePositiveInt(opts.maxChars, DEFAULT_MAX_READ_CHARS, MAX_READ_CHARS);
  const read = await readSkillWithBudget(skill.skillMdPath, maxChars);
  return {
    ...skillRef(skill),
    action: "read-skill-file",
    content: read.content,
    truncated: read.truncated,
    maxChars,
    bytesRead: read.bytesRead,
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
    const key = skillInstanceKey(skill.id, skill.skillMdPath);
    if (seen.has(key)) continue;
    selected.push({
      ...skillRef(skill),
      action: "read-skill-file",
      confidence,
      reason,
    });
    seen.add(key);
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

function emptySearchResult(query: string, queries: string[], scanned: number, metadataOnly = false): DciSearchResult {
  return {
    query,
    queries,
    metadataOnly,
    action: "no-candidates",
    budget: searchBudget(metadataOnly),
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

function loadSkillMetadata(skills: Skill[]): LoadedSkillSet {
  return {
    skills: skills.map((skill) => {
      const content = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n`;
      return {
        skill,
        content,
        lines: content.split(/\r?\n/),
        bytesRead: 0,
        fileBytes: 0,
        truncated: false,
      };
    }),
    bytesRead: 0,
    truncated: 0,
    skipped: 0,
    warnings: [],
  };
}

function searchBudget(metadataOnly: boolean): DciBudget {
  return metadataOnly
    ? {
      ...DCI_BUDGET,
      maxSkillBytes: 0,
      maxCorpusBytes: 0,
      maxFindsOrOpens: 0,
      maxFullReads: 0,
      maxOpenChars: 0,
    }
    : DCI_BUDGET;
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

function skillMetadataText(skill: Skill): string {
  return [
    skill.id,
    skill.name,
    skill.description,
  ].join("\n");
}

/**
 * Read up to `maxChars + 1` bytes from `path` and decode as UTF-8 (slicing
 * to at most `maxChars` characters). The +1 byte lets the caller detect
 * truncation without reading the whole file. The handle is always closed.
 */
async function readSkillWithBudget(
  path: string,
  maxChars: number,
): Promise<{ content: string; bytesRead: number; truncated: boolean }> {
  const handle = await openFile(path, "r");
  try {
    const stats = await handle.stat();
    // Pull at most maxChars+1 bytes so we can detect "file is bigger than
    // the budget" without materializing the entire file in memory.
    const bytesToRead = Math.min(maxChars + 1, stats.size);
    if (bytesToRead <= 0) {
      return { content: "", bytesRead: 0, truncated: false };
    }
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const result = await handle.read({ buffer, length: bytesToRead, position: 0 });
    const bytesRead = result.bytesRead;
    // Truncation is defined relative to the caller's budget, not the read
    // window: the file is bigger than the budget either when stat() said so
    // or when we successfully read more than maxChars bytes.
    const truncated = stats.size > maxChars;
    // When the buffer ends inside a multibyte UTF-8 sequence, walk back to
    // the last complete boundary before decoding.
    const decodeEnd = bytesRead > maxChars
      ? utf8SafeEnd(buffer, maxChars)
      : (truncated ? utf8SafeEnd(buffer, bytesRead) : bytesRead);
    const decoded = buffer.subarray(0, decodeEnd).toString("utf8");
    const content = decoded.length > maxChars ? decoded.slice(0, maxChars) : decoded;
    return { content, bytesRead, truncated };
  } finally {
    await handle.close();
  }
}

interface StreamScanResult {
  bytesRead: number;
  /** True when the byte budget was reached before EOF. */
  bytesExhausted: boolean;
}

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * Stream `path` line-by-line under a hard byte cap. The cap is enforced
 * *inside* the chunk handler — before any line is yielded — so a single
 * line longer than `maxBytes` cannot accumulate in memory and cannot
 * leak a partial match past the cap to the callback.
 *
 * Implementation notes:
 *
 *  - We read in binary mode and split on `\n` ourselves. `readline` was
 *    rejected because it yields each line only after the trailing newline
 *    arrives; for a pathological SKILL.md whose first newline is past the
 *    cap, readline would buffer past the cap before we got a chance to
 *    enforce it (issue #105 follow-up).
 *  - When the next chunk would push us past `maxBytes`, we accept the
 *    in-cap prefix only (so any complete `\n`-terminated lines inside
 *    that prefix still flush), then drop the pending partial line and
 *    stop reading. The partial line is intentionally NOT yielded: we
 *    cannot prove the matcher's hit falls before or after the cap byte.
 *  - The callback may return `false` to stop the scan early; in that
 *    case `bytesExhausted` is reported as `false` unless the cap was
 *    independently hit by the time the callback returned.
 *  - The stream is destroyed in a `finally` so the file descriptor never
 *    leaks even when the callback throws.
 *
 * UTF-8 boundaries: lines are decoded via `Buffer.toString('utf8')`. A
 * SKILL.md whose final pre-cap line ends mid-character can emit a
 * U+FFFD on the trailing byte; the call sites (`dciFindInSkill`,
 * `dciOpenSkillWindow`) tolerate this because the cap is a hard
 * memory/I/O guard for pathological inputs, not a normal code path.
 */
async function streamSkillLines(
  path: string,
  maxBytes: number,
  onLine: (line: string, lineNumber: number) => boolean,
): Promise<StreamScanResult> {
  const stream = createReadStream(path);
  let bytesRead = 0;
  let bytesExhausted = false;
  let lineNumber = 0;
  let stop = false;
  // Pending bytes of the in-progress (un-terminated) line. Capped at
  // `maxBytes` total bytes read so a runaway long line cannot grow this
  // buffer past the cap.
  let pending: Buffer = Buffer.alloc(0);

  const decodeLine = (buf: Buffer): string => {
    // Strip a trailing CR so `\r\n` terminated files behave identically to
    // `\n` terminated ones, matching the previous readline-based behavior.
    if (buf.length > 0 && buf[buf.length - 1] === CARRIAGE_RETURN) {
      return buf.subarray(0, buf.length - 1).toString("utf8");
    }
    return buf.toString("utf8");
  };

  const emitLine = (buf: Buffer): boolean => {
    lineNumber++;
    return onLine(decodeLine(buf), lineNumber);
  };

  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      // Trim the chunk to whatever still fits inside the byte budget.
      // Anything past the cap is discarded immediately, before we ever
      // search it for newlines.
      let usable: Buffer = chunk;
      if (bytesRead + chunk.length > maxBytes) {
        const room = Math.max(0, maxBytes - bytesRead);
        usable = chunk.subarray(0, room);
        bytesExhausted = true;
      }
      bytesRead += usable.length;

      // Walk the usable bytes splitting on `\n`. Each complete line is
      // yielded; bytes after the last newline accumulate as `pending`.
      let cursor = 0;
      while (cursor < usable.length) {
        const newlineIdx = usable.indexOf(NEWLINE, cursor);
        if (newlineIdx === -1) {
          // No newline in the remaining chunk slice — buffer it.
          const tail = usable.subarray(cursor);
          pending = pending.length === 0 ? Buffer.from(tail) : Buffer.concat([pending, tail]);
          break;
        }
        const segment = usable.subarray(cursor, newlineIdx);
        const line = pending.length === 0
          ? segment
          : Buffer.concat([pending, segment]);
        pending = Buffer.alloc(0);
        if (!emitLine(line)) {
          stop = true;
          break;
        }
        cursor = newlineIdx + 1;
      }

      if (stop) break;
      if (bytesExhausted) {
        // Discard the pending partial line: when the cap straddles a
        // line we can't safely yield it (callers must treat the cap as a
        // hard boundary, including for matches that might sit inside the
        // partial line).
        pending = Buffer.alloc(0);
        break;
      }
    }

    // EOF without exhaustion: flush any trailing un-terminated line.
    if (!stop && !bytesExhausted && pending.length > 0) {
      emitLine(pending);
      pending = Buffer.alloc(0);
    }
  } finally {
    stream.destroy();
  }

  if (stop && bytesRead < maxBytes) bytesExhausted = false;
  return { bytesRead, bytesExhausted };
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
    evidence: item.evidence,
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

interface DciEvidenceInputs {
  metadataOnly: boolean;
  queryTerms: Set<string>;
  queryPhrase: string;
  haystackTerms: Set<string>;
  haystackPhrase: string;
  phraseMatched: boolean;
  currentQuery: string;
  snippets: DciSnippet[];
  score: number;
}

/**
 * Build the shared {@link MatchEvidence} list for a DCI search candidate.
 *
 * `source` is driven by the search mode: `metadata-only` runs scan a
 * synthesized frontmatter-only haystack so all hits are metadata; the
 * default DCI search reads the SKILL.md body so hits are body evidence.
 *
 * `contribution` is intentionally rough — DCI scoring is hit-count + phrase
 * bonus, not per-term weights, so we split the candidate's local score
 * across matched terms (with the phrase bonus broken out as its own row
 * when present). It's still router-local; callers should treat it as a
 * relative signal within a single DCI match list.
 */
function evidenceForDciSearch(inputs: DciEvidenceInputs): MatchEvidence[] {
  const source: "metadata" | "body" = inputs.metadataOnly ? "metadata" : "body";
  const field = inputs.metadataOnly ? "description" : "body";
  const matchedTerms: string[] = [];
  for (const term of inputs.queryTerms) {
    if (inputs.haystackTerms.has(term) || inputs.haystackPhrase.includes(term)) {
      matchedTerms.push(term);
    }
  }
  const phraseBonus = inputs.phraseMatched ? 0.35 : 0;
  const termBudget = Math.max(0, inputs.score - phraseBonus);
  const perTerm = matchedTerms.length > 0 ? termBudget / matchedTerms.length : 0;
  const evidence: MatchEvidence[] = matchedTerms.map((term) => ({
    field,
    matched: term,
    isGeneric: isGenericTerm(term, "dci"),
    contribution: Number(perTerm.toFixed(4)),
    source,
  }));
  if (inputs.phraseMatched) {
    evidence.push({
      field,
      matched: inputs.currentQuery,
      isGeneric: false,
      contribution: Number(phraseBonus.toFixed(4)),
      source,
    });
  }
  return evidence.sort(
    (a, b) => b.contribution - a.contribution || a.matched.localeCompare(b.matched),
  );
}

/**
 * Candidate-level score for a DCI search hit.
 *
 * `weightedHit` and `weightedQueryWeight` are computed by classifying each
 * query term with `isGenericTerm(term, "dci")` and weighting generic terms
 * at {@link GENERIC_TERM_WEIGHT} instead of `1`. This matches the generic
 * down-weight metadata-route applies to per-term contributions so a query
 * dominated by stop words ("the and a") cannot promote a weak candidate
 * just because the haystack happens to contain those same generic tokens.
 *
 * When no distinctive term hits, the result is clamped strictly below the
 * medium-confidence threshold (0.5) so generic-only matches cannot alone
 * promote a skill to medium/high confidence — phrase matches on stop-word
 * queries are also clamped because the phrase is itself generic.
 */
function scoreSearchMatch(
  weightedHit: number,
  weightedQueryWeight: number,
  phraseMatched: boolean,
  distinctiveHit: number,
): number {
  if (weightedQueryWeight <= 0) return phraseMatched ? 1 : 0;
  const termScore = weightedHit / weightedQueryWeight;
  const raw = Math.min(1, termScore + (phraseMatched ? 0.35 : 0));
  if (distinctiveHit === 0) return Math.min(raw, 0.49);
  return raw;
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
      // DCI snippet scoring uses the broader stop set (metadata list +
      // common English + short Latin) so substring-matched fragments like
      // `the`/`for`/`ai`/`es` do not push irrelevant lines ahead of real
      // evidence lines. See `isGenericTerm`'s `'dci'` mode for the union.
      if (isGenericTerm(term, "dci")) score += 0.3;
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

/**
 * Maximum allowed length of a user-supplied `--regex` pattern.
 *
 * `--regex` is a power-user surface that can be supplied by an LLM in
 * agent-facing mode, so we bound the pattern length to keep both compilation
 * and per-line matching cheap. Real-world skill grep patterns are short;
 * patterns over the cap almost always indicate accidental input, an
 * obfuscation attempt, or a ReDoS payload.
 */
export const DCI_REGEX_MAX_LENGTH = 200;

/**
 * Per-line wall-clock budget for a `--regex` match. Backstops the static
 * heuristic for any pathological pattern it fails to flag up front. A real
 * non-pathological regex over a single SKILL.md line completes in well under
 * a millisecond on modern hardware; tripping this budget is strong evidence
 * of catastrophic backtracking.
 *
 * The deadline is post-hoc — we cannot pre-empt the engine without a Worker
 * — so a single line can still spike past this value. After the first trip
 * the matcher stops calling the engine entirely so aggregate damage is
 * bounded to one slow line.
 */
export const DCI_REGEX_LINE_TIMEOUT_MS = 50;

/**
 * Largest `{n,m}` upper bound allowed on a quantifier applied to a group.
 * Higher bounds combined with backtracking-prone groups blow up quickly.
 */
const DCI_REGEX_MAX_GROUP_BOUND = 10;

/**
 * Maximum number of top-level unbounded dot-wildcard atoms (`.*`, `.+`,
 * `.{n,}`) allowed in a pattern. More than this limit creates O(n^k)
 * backtracking when the literals between wildcards appear in the subject —
 * for example `.*a.*a.*a.*a.*c` on a line of `a`s produces O(n^4) paths
 * that the post-hoc per-line deadline cannot reliably pre-empt within
 * bounds. Three wildcards allows common patterns like `.*foo.*bar.*baz`
 * while rejecting longer chains.
 */
export const DCI_REGEX_MAX_DOT_WILDCARDS = 3;

/**
 * Thrown when a user-supplied `--regex` pattern is rejected by the DCI
 * static complexity guard (length cap, nested-quantifier shapes, large
 * group bounds, prefix-overlap alternation in a quantified group). The CLI
 * layer catches this and exits with code 2 so it surfaces as a usage error
 * rather than an internal crash.
 */
export class DciRegexComplexityError extends Error {
  override name = "DciRegexComplexityError";
}

/**
 * Thrown when a user-supplied `--regex` pattern is compiled successfully and
 * passes the static guard but a single per-line match exceeds
 * `DCI_REGEX_LINE_TIMEOUT_MS`. The CLI layer catches this and exits with
 * code 2 just like `DciRegexComplexityError`.
 */
export class DciRegexTimeoutError extends Error {
  override name = "DciRegexTimeoutError";
}

interface RegexGroup {
  /** Inclusive offset of the opening `(`. */
  start: number;
  /** Inclusive offset of the closing `)`. */
  end: number;
  /** Inner body between `(` and `)`, with group prefix (e.g. `?:`) stripped. */
  body: string;
}

/**
 * Walks a pattern to enumerate non-escaped, non-character-class top-level
 * groups (parenthesized subpatterns) along with their bodies. Tracks
 * brackets and escapes so `\(`, `[(]`, and `\\` do not confuse the depth
 * counter. Returns groups in source order; nested groups appear as separate
 * entries.
 */
function enumerateGroups(pattern: string): RegexGroup[] {
  const groups: RegexGroup[] = [];
  const stack: number[] = [];
  let i = 0;
  let inCharClass = false;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (inCharClass) {
      if (ch === "]") inCharClass = false;
      i++;
      continue;
    }
    if (ch === "[") {
      inCharClass = true;
      i++;
      continue;
    }
    if (ch === "(") {
      stack.push(i);
      i++;
      continue;
    }
    if (ch === ")") {
      const start = stack.pop();
      if (start !== undefined) {
        let body = pattern.slice(start + 1, i);
        // Strip a leading group prefix like `?:`, `?=`, `?!`, `?<name>`, `?<=`, `?<!`.
        if (body.startsWith("?")) {
          const prefixMatch = body.match(/^\?(?::|=|!|<=|<!|<[^>]*>)/);
          if (prefixMatch) body = body.slice(prefixMatch[0].length);
        }
        groups.push({ start, end: i, body });
      }
      i++;
      continue;
    }
    i++;
  }
  return groups;
}

/**
 * True iff `body` contains an unescaped quantifier (`+`, `*`, `?`, or `{n…}`)
 * outside a character class — i.e. another repetition lives inside the
 * group. Skips past nested group prefixes (`(?:`, `(?=`, `(?!`, `(?<…>`,
 * `(?<=`, `(?<!`) so their `?` characters do not look like quantifiers.
 * Lookarounds are not unwrapped because a quantifier inside one is just as
 * backtracking-prone as one at the top level.
 */
function containsInnerQuantifier(body: string): boolean {
  let i = 0;
  let inCharClass = false;
  while (i < body.length) {
    const ch = body[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (inCharClass) {
      if (ch === "]") inCharClass = false;
      i++;
      continue;
    }
    if (ch === "[") {
      inCharClass = true;
      i++;
      continue;
    }
    if (ch === "(") {
      // Skip past a group prefix such as `?:`, `?=`, `?!`, `?<name>`,
      // `?<=`, `?<!` so its `?` is not counted as a quantifier.
      const rest = body.slice(i + 1);
      const prefixMatch = rest.match(/^\?(?::|=|!|<=|<!|<[^>]*>)/);
      i += 1 + (prefixMatch ? prefixMatch[0].length : 0);
      continue;
    }
    if (ch === ")") {
      i++;
      continue;
    }
    if (ch === "+" || ch === "*" || ch === "?") return true;
    if (ch === "{") {
      // Match `{n}`, `{n,}`, or `{n,m}`. Anything else is a literal `{`.
      const close = body.indexOf("}", i + 1);
      if (close > i && /^\{\d+(?:,\d*)?\}$/.test(body.slice(i, close + 1))) {
        return true;
      }
    }
    i++;
  }
  return false;
}

/**
 * Splits a group body on top-level `|` alternation, respecting nested
 * parens, escapes, and character classes. Returns the original body as a
 * single-element array when no alternation is present.
 */
function splitTopLevelAlternation(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inCharClass = false;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (inCharClass) {
      if (ch === "]") inCharClass = false;
      continue;
    }
    if (ch === "[") {
      inCharClass = true;
      continue;
    }
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      if (depth > 0) depth--;
      continue;
    }
    if (ch === "|" && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * True iff two of the supplied alternatives share a non-trivial common
 * prefix — the canonical pathological example is `(a|aa)+`, where the
 * engine has two ways to match the same input. Length 1 prefixes count
 * because they are still enough to multiply backtracking branches in a
 * quantified group.
 */
function hasOverlappingAlternatives(alternatives: string[]): boolean {
  for (let i = 0; i < alternatives.length; i++) {
    for (let j = i + 1; j < alternatives.length; j++) {
      const a = alternatives[i]!;
      const b = alternatives[j]!;
      if (a.length === 0 || b.length === 0) continue;
      if (a === b) return true;
      if (a.startsWith(b) || b.startsWith(a)) return true;
    }
  }
  return false;
}

/**
 * Categorizes a quantifier that immediately follows a group's closing `)`.
 *
 * - `plus` / `star` / `question` — the single-character forms.
 * - `fixed` — `{n}`; bounded repetition with no flexibility.
 * - `bounded` — `{n,m}` where `m` is a concrete number.
 * - `open-bound` — `{n,}` with no upper bound.
 *
 * The split between `bounded` and `open-bound` is what powers the
 * `{n,}`-on-group rejection rule. Earlier versions of this code inferred
 * `{n,}` by re-scanning the rest of the pattern with `pattern.slice(group.end)`,
 * which incorrectly fired whenever an unrelated later atom in the pattern
 * contained a `{n,}` (for example, `(foo)+bar{2,}`). The `kind` field
 * captures that classification directly so the rule fires only on the
 * quantifier attached to THIS group.
 */
type ParsedQuantifierKind = "plus" | "star" | "question" | "fixed" | "bounded" | "open-bound";

interface ParsedQuantifier {
  consumed: number;
  /** Upper bound; `null` means open (e.g. `{2,}`) or unbounded (`+`/`*`). */
  upper: number | null;
  kind: ParsedQuantifierKind;
}

/**
 * Inspects the quantifier that follows a group's closing `)` at offset
 * `end`. Returns `null` if no quantifier is present. Handles `+`, `*`, `?`,
 * `{n}`, `{n,}`, `{n,m}` and ignores a trailing lazy `?` modifier. The
 * returned `kind` classifies the quantifier shape so callers can ask
 * "is THIS quantifier `{n,}`?" without re-scanning the pattern.
 */
function parseTrailingQuantifier(pattern: string, end: number): ParsedQuantifier | null {
  const ch = pattern[end + 1];
  if (ch === undefined) return null;
  if (ch === "+") return { consumed: 1, upper: null, kind: "plus" };
  if (ch === "*") return { consumed: 1, upper: null, kind: "star" };
  if (ch === "?") return { consumed: 1, upper: 1, kind: "question" };
  if (ch === "{") {
    const close = pattern.indexOf("}", end + 2);
    if (close < 0) return null;
    const body = pattern.slice(end + 1, close + 1);
    const match = body.match(/^\{(\d+)(?:,(\d*))?\}$/);
    if (!match) return null;
    if (match[2] === undefined) {
      // `{n}` — fixed repetition; treat as bounded.
      const upper = Number(match[1]);
      return {
        consumed: body.length,
        upper: Number.isFinite(upper) ? upper : null,
        kind: "fixed",
      };
    }
    if (match[2] === "") {
      // `{n,}` — open upper bound. This is the form the false-positive bug
      // hinged on; classify it explicitly.
      return { consumed: body.length, upper: null, kind: "open-bound" };
    }
    const upper = Number(match[2]);
    return {
      consumed: body.length,
      upper: Number.isFinite(upper) ? upper : null,
      kind: "bounded",
    };
  }
  return null;
}

/**
 * Maximum allowed streak of consecutive overlapping quantified atoms (e.g.
 * `a*a*a*…`, `\d*\d*…`, `[a-z]*[a-z]*…`). Patterns at or below this length
 * are not pathological in practice; patterns above it produce exponential
 * backtracking that V8's irregexp engine cannot pre-empt.
 */
const DCI_REGEX_MAX_OVERLAP_STREAK = 4;

interface QuantifiedAtom {
  /** Canonical signature for overlap comparison. */
  signature: string;
  /**
   * True iff the quantifier allows the atom to match zero or more times
   * (`*`, `?`, `{0,…}`). Streaks of these atoms on the same signature are
   * the dangerous case; required-repetition (`+`, `{1,}`) is also unsafe
   * when stacked because the engine still has to choose split points.
   */
  overlapProne: boolean;
  /**
   * True iff the quantifier has a finite upper bound (`?`, `{n}`, `{n,m}`).
   * Used by the dot-wildcard rule to distinguish `.*`/`.+`/`.{n,}` from `.?`.
   */
  bounded: boolean;
}

/**
 * Walks the pattern and returns, in source order, the quantified atoms it
 * finds at the top level (not inside a group). Each entry carries a
 * canonical signature so the caller can detect runs of identical atoms.
 *
 * "Atom" here means a single character, escape sequence (`\d`, `\.`, …),
 * `.`, or character class `[…]`. Groups are skipped because the
 * group-quantifier rules in `validateRegexPattern` already cover them.
 */
function enumerateQuantifiedAtoms(pattern: string): QuantifiedAtom[] {
  const atoms: QuantifiedAtom[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;

    // Skip groups wholesale — their internals are scored by the group rules.
    if (ch === "(") {
      let depth = 1;
      let j = i + 1;
      let inCharClass = false;
      while (j < pattern.length && depth > 0) {
        const c = pattern[j]!;
        if (c === "\\") { j += 2; continue; }
        if (inCharClass) {
          if (c === "]") inCharClass = false;
          j++;
          continue;
        }
        if (c === "[") { inCharClass = true; j++; continue; }
        if (c === "(") depth++;
        else if (c === ")") depth--;
        j++;
      }
      // Skip any quantifier on the group as well so it does not register as
      // an atom signature itself.
      const afterGroup = j;
      const groupQuantifier = parseQuantifierAt(pattern, afterGroup);
      i = afterGroup + (groupQuantifier?.consumed ?? 0);
      continue;
    }

    // Anchors and alternation reset the streak naturally — they are not
    // atoms, so skip without recording.
    if (ch === "^" || ch === "$" || ch === "|") {
      i++;
      // Push a streak-breaker so two atoms separated by an anchor don't
      // count as consecutive.
      atoms.push({ signature: `\0anchor:${ch}`, overlapProne: false, bounded: true });
      continue;
    }

    // Parse one atom + optional quantifier.
    const atom = readAtom(pattern, i);
    if (!atom) { i++; continue; }
    const quantifier = parseQuantifierAt(pattern, atom.end);
    const consumed = atom.end + (quantifier?.consumed ?? 0);
    if (quantifier) {
      atoms.push({
        signature: atom.signature,
        overlapProne: quantifier.overlapProne,
        bounded: quantifier.bounded,
      });
    } else {
      // Unquantified atoms reset the streak (they consume exactly one
      // position of input, so two `a` in `aa` can't overlap).
      atoms.push({ signature: `\0fixed:${atom.signature}`, overlapProne: false, bounded: true });
    }
    i = consumed;
  }
  return atoms;
}

interface ReadAtom {
  signature: string;
  /** Exclusive end offset of the atom. */
  end: number;
}

function readAtom(pattern: string, start: number): ReadAtom | null {
  const ch = pattern[start];
  if (ch === undefined) return null;
  if (ch === "\\") {
    const next = pattern[start + 1];
    if (next === undefined) return null;
    return { signature: `\\${next}`, end: start + 2 };
  }
  if (ch === "[") {
    let j = start + 1;
    while (j < pattern.length) {
      const c = pattern[j]!;
      if (c === "\\") { j += 2; continue; }
      if (c === "]") { j++; break; }
      j++;
    }
    return { signature: pattern.slice(start, j), end: j };
  }
  if (ch === ".") return { signature: ".", end: start + 1 };
  // A bare quantifier or grouping character is not an atom on its own.
  if ("+*?{}()|^$".includes(ch)) return null;
  return { signature: ch, end: start + 1 };
}

interface AtomQuantifier {
  consumed: number;
  overlapProne: boolean;
  /**
   * True iff the quantifier has a finite upper bound: `?`, `{n}`, `{n,m}`.
   * False for `*`, `+`, `{n,}`. Used to distinguish unbounded dot-wildcards
   * (`.*`, `.+`, `.{n,}`) from bounded ones (`.?`, `.{n,m}`).
   */
  bounded: boolean;
}

/**
 * Parses an optional quantifier at offset `at`. Returns `null` if no
 * quantifier is present. `overlapProne` is true when the quantifier admits
 * zero or one matches, i.e. when chained instances on the same atom can
 * choose how many characters to claim — `*`, `?`, `+`, `{0,n}`, `{0,}`,
 * `{1,n}`, `{1,}`. Fixed `{n}` with `n > 1` is also treated as overlap-
 * prone because consecutive fixed runs can still produce O(n^k) splits
 * when chained.
 */
function parseQuantifierAt(pattern: string, at: number): AtomQuantifier | null {
  const ch = pattern[at];
  if (ch === undefined) return null;
  if (ch === "*") return { consumed: skipLazy(pattern, at + 1, 1), overlapProne: true, bounded: false };
  if (ch === "?") return { consumed: skipLazy(pattern, at + 1, 1), overlapProne: true, bounded: true };
  if (ch === "+") return { consumed: skipLazy(pattern, at + 1, 1), overlapProne: true, bounded: false };
  if (ch === "{") {
    const close = pattern.indexOf("}", at + 1);
    if (close < 0) return null;
    const body = pattern.slice(at, close + 1);
    if (!/^\{\d+(?:,\d*)?\}$/.test(body)) return null;
    // `{n,}` has no upper bound; `{n}` and `{n,m}` are bounded.
    const isOpen = /^\{\d+,\}$/.test(body);
    return { consumed: skipLazy(pattern, close + 1, body.length), overlapProne: true, bounded: !isOpen };
  }
  return null;
}

/** Account for a trailing lazy `?` modifier on a quantifier. */
function skipLazy(pattern: string, after: number, baseConsumed: number): number {
  return pattern[after] === "?" ? baseConsumed + 1 : baseConsumed;
}

/**
 * Validates a user-supplied regex pattern against the DCI static complexity
 * guard. Throws `DciRegexComplexityError` for any pattern that:
 *   1. exceeds `DCI_REGEX_MAX_LENGTH`;
 *   2. applies a quantifier to a group whose body itself contains a
 *      quantifier (classic nested-repetition ReDoS — `(a+)+`, `(a?)+`,
 *      `(a{1,})+`, `(a+){2,}` …);
 *   3. applies a `{n,}` quantifier with no upper bound, or `{n,m}` with
 *      `m > DCI_REGEX_MAX_GROUP_BOUND`, to a group;
 *   4. applies a quantifier to a group whose top-level alternatives share
 *      a common prefix (`(a|aa)+`, `(foo|foobar)+`, …);
 *   5. contains a streak of more than `DCI_REGEX_MAX_OVERLAP_STREAK`
 *      consecutive quantified atoms with identical signatures — for
 *      example `a*a*a*a*a*…`, `\d*\d*\d*…`, `[a-z]*[a-z]*…`. These have
 *      no groups and slip past every earlier rule but produce exponential
 *      backtracking that the post-hoc per-line deadline cannot pre-empt.
 *   6. contains more than `DCI_REGEX_MAX_DOT_WILDCARDS` top-level unbounded
 *      dot-wildcard atoms (`.*`, `.+`, `.{n,}`). Patterns like
 *      `.*a.*a.*a.*a.*c` interleave dot-wildcards with literals that can
 *      appear many times per line, producing O(n^k) backtracking (where k
 *      is the wildcard count) that the streak rule misses because each `.*`
 *      streak resets on the literal in between.
 *
 * The guard intentionally over-rejects: false positives surface as a clear
 * usage error on an explicitly power-user surface, while false negatives
 * stay caught by the per-line wall-clock deadline in `createGrepMatcher`.
 * Exported so the CLI layer can fail fast before any matching work begins.
 */
export function validateRegexPattern(pattern: string): void {
  if (pattern.length > DCI_REGEX_MAX_LENGTH) {
    throw new DciRegexComplexityError(
      `--regex pattern is ${pattern.length} chars; max allowed is ${DCI_REGEX_MAX_LENGTH}. ` +
        `Use a shorter pattern or drop --regex for literal matching.`,
    );
  }

  // Rule 5: consecutive overlapping quantified atoms.
  // Walk the top-level atom stream looking for `streak > MAX` of the same
  // overlap-prone signature. This catches the codex pattern
  // `"a*".repeat(24) + "b"` and friends before compilation.
  const atoms = enumerateQuantifiedAtoms(pattern);
  let streakSignature: string | null = null;
  let streakLength = 0;
  let dotWildcardCount = 0;
  for (const atom of atoms) {
    if (atom.overlapProne && atom.signature === streakSignature) {
      streakLength++;
      if (streakLength > DCI_REGEX_MAX_OVERLAP_STREAK) {
        throw new DciRegexComplexityError(
          `--regex pattern has more than ${DCI_REGEX_MAX_OVERLAP_STREAK} consecutive overlapping ` +
            `quantified atoms with the same signature (${JSON.stringify(atom.signature)}). ` +
            `Patterns like a*a*a*… / \\d*\\d*\\d*… / [a-z]*[a-z]*… produce exponential ` +
            `backtracking that the per-line deadline cannot pre-empt. ` +
            `Collapse to a single quantifier, or drop --regex for literal matching.`,
        );
      }
    } else if (atom.overlapProne) {
      streakSignature = atom.signature;
      streakLength = 1;
    } else {
      streakSignature = null;
      streakLength = 0;
    }

    // Rule 6: too many top-level unbounded dot-wildcards.
    // `.*` and `.+` (and `.{n,}`) match any character, so interleaving them
    // with a literal that appears k times per line yields O(k^count)
    // backtracking — O(n^count) in the worst case. This is invisible to the
    // streak rule because each wildcard's streak resets at the literal in
    // between. Three wildcards allows patterns like `.*foo.*bar.*baz` while
    // rejecting longer chains.
    if (atom.signature === "." && atom.overlapProne && !atom.bounded) {
      dotWildcardCount++;
      if (dotWildcardCount > DCI_REGEX_MAX_DOT_WILDCARDS) {
        throw new DciRegexComplexityError(
          `--regex pattern has more than ${DCI_REGEX_MAX_DOT_WILDCARDS} top-level ` +
            `unbounded dot-wildcards (.*/.+/.{n,}). ` +
            `Patterns like .*x.*x.*x.*x.*c produce O(n^k) backtracking when x appears ` +
            `in subject lines. Use a tighter pattern or drop --regex for literal matching.`,
        );
      }
    }
  }

  const groups = enumerateGroups(pattern);
  for (const group of groups) {
    const quantifier = parseTrailingQuantifier(pattern, group.end);
    if (!quantifier) continue;

    // Bounded fixed repetition (`{n}` with small n) is treated like the
    // unquantified group: we still drop into the alternation check, but a
    // single-shot bound is not by itself a ReDoS lever.
    const isOpenRepetition = quantifier.upper === null;
    const isLargeBoundedRepetition =
      quantifier.upper !== null && quantifier.upper > DCI_REGEX_MAX_GROUP_BOUND;
    const isRepetition = isOpenRepetition || isLargeBoundedRepetition;

    if (isRepetition) {
      if (containsInnerQuantifier(group.body)) {
        throw new DciRegexComplexityError(
          `--regex pattern looks like a catastrophic-backtracking shape: a quantifier ` +
            `is applied to a group whose body contains another quantifier ` +
            `(e.g. (a+)+, (a?)+, (a+){2,}, (a{1,})+). ` +
            `Rewrite without nested repetition, or drop --regex for literal matching.`,
        );
      }
      const alternatives = splitTopLevelAlternation(group.body);
      if (alternatives.length > 1 && hasOverlappingAlternatives(alternatives)) {
        throw new DciRegexComplexityError(
          `--regex pattern looks like a catastrophic-backtracking shape: a quantified ` +
            `group contains alternation with overlapping alternatives ` +
            `(e.g. (a|aa)+, (foo|foobar)+). ` +
            `Rewrite without overlapping alternatives, or drop --regex for literal matching.`,
        );
      }
      if (isLargeBoundedRepetition) {
        throw new DciRegexComplexityError(
          `--regex pattern applies a large {n,m} bound (>${DCI_REGEX_MAX_GROUP_BOUND}) to a group. ` +
            `Tighten the bound, or drop --regex for literal matching.`,
        );
      }
      if (quantifier.kind === "open-bound") {
        // `{n,}` with no upper bound directly on THIS group: reject even
        // when the inner body looks tame; the engine still has to enumerate
        // runs. Important: this checks the kind of the quantifier we just
        // parsed, not a re-scan of `pattern.slice(group.end)`, which used
        // to spuriously match a `{n,}` on an unrelated later atom (e.g.
        // `(foo)+bar{2,}`).
        throw new DciRegexComplexityError(
          `--regex pattern applies an open-ended {n,} repetition to a group. ` +
            `Use a fixed upper bound, or drop --regex for literal matching.`,
        );
      }
    }
  }
}

function createGrepMatcher(pattern: string, mode: "literal" | "regex"): (line: string) => boolean {
  if (mode === "literal") {
    const needle = normalizeLiteral(pattern);
    return (line) => normalizeLiteral(line).includes(needle);
  }
  validateRegexPattern(pattern);
  const regex = new RegExp(pattern, "iu");
  // Latched flag: once a single line trips the per-line deadline, we stop
  // calling the engine entirely. This bounds aggregate damage from any
  // pathological pattern that slips past the static heuristic.
  let timedOut = false;
  let timeoutPattern = pattern;
  return (line) => {
    if (timedOut) {
      throw new DciRegexTimeoutError(
        `--regex pattern exceeded the per-line ${DCI_REGEX_LINE_TIMEOUT_MS}ms match deadline ` +
          `on a prior line; aborting further matches for ${JSON.stringify(timeoutPattern)}. ` +
          `Rewrite without nested repetition / overlapping alternation, or drop --regex.`,
      );
    }
    const startedAt = Date.now();
    try {
      const matched = regex.test(line);
      regex.lastIndex = 0;
      if (Date.now() - startedAt > DCI_REGEX_LINE_TIMEOUT_MS) {
        timedOut = true;
        throw new DciRegexTimeoutError(
          `--regex match took > ${DCI_REGEX_LINE_TIMEOUT_MS}ms on a single line ` +
            `for ${JSON.stringify(timeoutPattern)}; aborting. ` +
            `Rewrite without nested repetition / overlapping alternation, or drop --regex.`,
        );
      }
      return matched;
    } catch (err) {
      if (err instanceof DciRegexTimeoutError) throw err;
      // Defensive: per-line RegExp errors are not expected for compiled
      // patterns, but normalize to a non-match so a single bad line cannot
      // bubble an uncaught exception out of the API layer.
      regex.lastIndex = 0;
      return false;
    }
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

function normalizeLiteral(input: string): string {
  return input.normalize("NFKC").toLowerCase();
}
