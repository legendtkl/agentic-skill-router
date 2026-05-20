import { readFile } from "node:fs/promises";
import type { Confidence, Skill } from "./types.ts";
import { isRoutableDisabledSkill } from "./route.ts";

export interface DciOptions {
  topK?: number;
  maxSnippets?: number;
  maxChars?: number;
}

export interface DciGrepOptions extends DciOptions {
  regex?: boolean;
}

export interface DciSkillRef {
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

export interface DciSearchMatch extends DciSkillRef {
  score: number;
  reason: string;
  snippets: DciSnippet[];
}

export interface DciSearchResult {
  query: string;
  action: "inspect-or-read-candidates" | "no-candidates";
  corpus: {
    mode: "disabled-only";
    scanned: number;
    matched: number;
  };
  matches: DciSearchMatch[];
}

export interface DciGrepResult {
  pattern: string;
  mode: "literal" | "regex";
  action: "inspect-or-read-candidates" | "no-candidates";
  corpus: {
    mode: "disabled-only";
    scanned: number;
    matched: number;
  };
  matches: DciSearchMatch[];
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

interface LoadedSkill {
  skill: Skill;
  content: string;
  lines: string[];
}

interface ScoredLoadedSkill extends LoadedSkill {
  score: number;
  hitCount: number;
  queryTermCount: number;
  phraseMatched: boolean;
  snippets: DciSnippet[];
}

const DEFAULT_TOP_K = 8;
const DEFAULT_MAX_SNIPPETS = 3;
const DEFAULT_MAX_READ_CHARS = 12_000;
const MAX_TOP_K = 50;
const MAX_SNIPPETS = 10;
const MAX_READ_CHARS = 80_000;

export async function dciSearchDisabledSkills(
  skills: Skill[],
  query: string,
  opts: DciOptions = {},
): Promise<DciSearchResult> {
  const trimmedQuery = query.trim();
  const candidates = routableDisabledSkills(skills);
  if (trimmedQuery === "") {
    return emptySearchResult(trimmedQuery, candidates.length);
  }

  const queryTerms = termsFor(trimmedQuery);
  const queryPhrase = compact(trimmedQuery);
  const loaded = await loadSkills(candidates);
  const scored: ScoredLoadedSkill[] = [];
  const maxSnippets = normalizePositiveInt(opts.maxSnippets, DEFAULT_MAX_SNIPPETS, MAX_SNIPPETS);

  for (const item of loaded) {
    const haystack = `${item.skill.id}\n${item.skill.name}\n${item.skill.description}\n${item.content}`;
    const haystackTerms = termsFor(haystack);
    const haystackPhrase = compact(haystack);
    let hitCount = 0;
    for (const term of queryTerms) {
      if (haystackTerms.has(term) || haystackPhrase.includes(term)) hitCount++;
    }
    const phraseMatched = queryPhrase.length >= 4 && haystackPhrase.includes(queryPhrase);
    const score = scoreSearchMatch(hitCount, queryTerms.size, phraseMatched);
    if (score <= 0) continue;
    scored.push({
      ...item,
      score,
      hitCount,
      queryTermCount: queryTerms.size,
      phraseMatched,
      snippets: snippetsForTerms(item.lines, queryTerms, queryPhrase, maxSnippets),
    });
  }

  scored.sort(compareScored);
  const topK = normalizePositiveInt(opts.topK, DEFAULT_TOP_K, MAX_TOP_K);
  const matches = scored.slice(0, topK).map(projectSearchMatch);
  return {
    query: trimmedQuery,
    action: matches.length > 0 ? "inspect-or-read-candidates" : "no-candidates",
    corpus: { mode: "disabled-only", scanned: candidates.length, matched: scored.length },
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
      corpus: { mode: "disabled-only", scanned: candidates.length, matched: 0 },
      matches: [],
    };
  }

  const matcher = createGrepMatcher(trimmedPattern, mode);
  const maxSnippets = normalizePositiveInt(opts.maxSnippets, DEFAULT_MAX_SNIPPETS, MAX_SNIPPETS);
  const loaded = await loadSkills(candidates);
  const matches: DciSearchMatch[] = [];

  for (const item of loaded) {
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
      snippets,
    });
  }

  matches.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const topK = normalizePositiveInt(opts.topK, DEFAULT_TOP_K, MAX_TOP_K);
  const topMatches = matches.slice(0, topK);
  return {
    pattern: trimmedPattern,
    mode,
    action: topMatches.length > 0 ? "inspect-or-read-candidates" : "no-candidates",
    corpus: { mode: "disabled-only", scanned: candidates.length, matched: matches.length },
    matches: topMatches,
  };
}

export function dciInspectSkill(skills: Skill[], id: string): DciInspectResult {
  const skill = findRoutableSkillOrThrow(skills, id);
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
  id: string,
  opts: DciOptions = {},
): Promise<DciReadResult> {
  const skill = findRoutableSkillOrThrow(skills, id);
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
  id: string,
  confidence: Confidence,
  reason: string,
): DciSelectResult {
  const skill = findRoutableSkillOrThrow(skills, id);
  return {
    ...skillRef(skill),
    action: "read-skill-file",
    confidence,
    reason,
  };
}

export function routableDisabledSkills(skills: Skill[]): Skill[] {
  return skills.filter(isRoutableDisabledSkill);
}

function emptySearchResult(query: string, scanned: number): DciSearchResult {
  return {
    query,
    action: "no-candidates",
    corpus: { mode: "disabled-only", scanned, matched: 0 },
    matches: [],
  };
}

async function loadSkills(skills: Skill[]): Promise<LoadedSkill[]> {
  const out: LoadedSkill[] = [];
  for (const skill of skills) {
    try {
      const content = await readFile(skill.skillMdPath, "utf8");
      out.push({ skill, content, lines: content.split(/\r?\n/) });
    } catch (err) {
      process.stderr.write(`warning: failed to read ${skill.skillMdPath}: ${(err as Error).message}\n`);
    }
  }
  return out;
}

function findRoutableSkillOrThrow(skills: Skill[], id: string): Skill {
  const skill = skills.find((s) => s.id === id);
  if (!skill) throw new Error(`unknown skill id: ${id}`);
  if (!isRoutableDisabledSkill(skill)) {
    throw new Error(`skill is not a routable disabled skill: ${id}`);
  }
  return skill;
}

function projectSearchMatch(item: ScoredLoadedSkill): DciSearchMatch {
  return {
    ...skillRef(item.skill),
    score: Number(item.score.toFixed(4)),
    reason: reasonForSearch(item),
    snippets: item.snippets,
  };
}

function skillRef(skill: Skill): DciSkillRef {
  return {
    id: skill.id,
    name: skill.name,
    source: skill.source,
    pluginKey: skill.pluginKey,
    skillMdPath: skill.skillMdPath,
    description: skill.description,
  };
}

function reasonForSearch(item: ScoredLoadedSkill): string {
  const parts: string[] = [];
  if (item.phraseMatched) parts.push("matched query phrase in skill corpus");
  if (item.queryTermCount > 0) parts.push(`matched ${item.hitCount}/${item.queryTermCount} query terms in skill corpus`);
  return parts.join("; ") || "matched skill corpus";
}

function scoreSearchMatch(hitCount: number, queryTermCount: number, phraseMatched: boolean): number {
  if (queryTermCount === 0) return phraseMatched ? 1 : 0;
  const termScore = hitCount / queryTermCount;
  return Math.min(1, termScore + (phraseMatched ? 0.35 : 0));
}

function snippetsForTerms(lines: string[], terms: Set<string>, phrase: string, maxSnippets: number): DciSnippet[] {
  const snippets: DciSnippet[] = [];
  for (let i = 0; i < lines.length && snippets.length < maxSnippets; i++) {
    const line = lines[i]!;
    const lineTerms = termsFor(line);
    const linePhrase = compact(line);
    let matched = phrase.length >= 4 && linePhrase.includes(phrase);
    if (!matched) {
      for (const term of terms) {
        if (lineTerms.has(term) || linePhrase.includes(term)) {
          matched = true;
          break;
        }
      }
    }
    if (matched) snippets.push({ line: i + 1, text: clampLine(line) });
  }
  return snippets;
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
