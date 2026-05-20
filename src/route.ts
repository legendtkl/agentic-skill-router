import type { Confidence, Skill } from "./types.ts";

export interface RouteOptions {
  topK?: number;
}

export interface SkillRouteMatch {
  skill: Skill;
  confidence: Confidence;
  score: number;
  reason: string;
}

export interface SkillRouteResult {
  query: string;
  mode: "disabled-only";
  selected: SkillRouteMatch | null;
  matches: SkillRouteMatch[];
}

interface ScoredCandidate {
  skill: Skill;
  score: number;
  hitCount: number;
  tokenCount: number;
  candidateHitCount: number;
  candidateTokenCount: number;
  cueHitCount: number;
  matchedName: boolean;
  matchedPhrase: boolean;
}

const DEFAULT_TOP_K = 3;
const AMBIGUOUS_SELECTION_MARGIN = 0.08;
const SINGLE_TERM_PARTIAL_MATCH_CAP = 0.34;
const SELECTABLE_CONFIDENCES: ReadonlySet<Confidence> = new Set(["high", "medium"]);

export function routeDisabledSkills(
  skills: Skill[],
  query: string,
  opts: RouteOptions = {},
): SkillRouteResult {
  const trimmedQuery = query.trim();
  if (trimmedQuery === "") {
    return { query: trimmedQuery, mode: "disabled-only", selected: null, matches: [] };
  }

  const topK = normalizeTopK(opts.topK);
  const queryTerms = termsFor(trimmedQuery);
  const queryPhrase = compact(trimmedQuery);
  const scored: ScoredCandidate[] = [];

  for (const skill of skills) {
    if (!isRoutableDisabledSkill(skill)) continue;

    const corpus = `${skill.id} ${skill.name} ${skill.description}`;
    const corpusTerms = termsFor(corpus);
    const candidateTerms = termsFor(`${skill.name} ${skill.description}`);
    const corpusPhrase = compact(corpus);
    const skillNamePhrase = compact(skill.name);

    let hitCount = 0;
    for (const term of queryTerms) {
      if (corpusTerms.has(term) || corpusPhrase.includes(term)) hitCount++;
    }

    let candidateHitCount = 0;
    let cueHitCount = 0;
    for (const term of candidateTerms) {
      const matched = queryTerms.has(term) || queryPhrase.includes(term);
      if (matched) {
        candidateHitCount++;
        if (isHighSignalCue(term)) cueHitCount++;
      }
    }

    const matchedName = queryPhrase !== "" &&
      skillNamePhrase !== "" &&
      (queryPhrase === skillNamePhrase || queryPhrase.includes(skillNamePhrase));
    const matchedPhrase = queryTerms.size > 1 && queryPhrase.length >= 4 && corpusPhrase.includes(queryPhrase);

    const tokenScore = queryTerms.size > 0 ? hitCount / queryTerms.size : 0;
    const candidateScore = candidateTerms.size > 0 && candidateHitCount >= 3
      ? candidateHitCount / candidateTerms.size
      : 0;
    const nameScore = matchedName ? 0.45 : 0;
    const phraseScore = matchedPhrase ? 0.35 : 0;
    const cueScore = cueHitCount > 0 ? 0.4 : 0;
    let score = Math.min(1, Math.max(tokenScore * 0.8, candidateScore * 0.85) + nameScore + phraseScore + cueScore);
    if (queryTerms.size <= 1 && !matchedName && !matchedPhrase && candidateHitCount < 3) {
      score = Math.min(score, SINGLE_TERM_PARTIAL_MATCH_CAP);
    }
    if (
      queryTerms.size >= 3 &&
      !matchedName &&
      !matchedPhrase &&
      cueHitCount === 0 &&
      tokenScore <= 0.5 &&
      candidateHitCount < 3
    ) {
      score = Math.min(score, SINGLE_TERM_PARTIAL_MATCH_CAP);
    }

    if (score > 0) {
      scored.push({
        skill,
        score,
        hitCount,
        tokenCount: queryTerms.size,
        candidateHitCount,
        candidateTokenCount: candidateTerms.size,
        cueHitCount,
        matchedName,
        matchedPhrase,
      });
    }
  }

  scored.sort((a, b) => {
    const delta = b.score - a.score;
    if (delta !== 0) return delta;
    return a.skill.id.localeCompare(b.skill.id);
  });

  const selectionWindow = scored.slice(0, 2).map(toRouteMatch);
  const selected = selectMatch(selectionWindow);
  const matches = scored.slice(0, topK).map(toRouteMatch);
  return { query: trimmedQuery, mode: "disabled-only", selected, matches };
}

export function isRoutableDisabledSkill(skill: Skill): boolean {
  return skill.isDisabled &&
    skill.canDisable &&
    !skill.isPluginDisabled &&
    !skill.conflict &&
    skill.skillMdPath !== "";
}

function toRouteMatch(candidate: ScoredCandidate): SkillRouteMatch {
  return {
    skill: candidate.skill,
    score: Number(candidate.score.toFixed(4)),
    confidence: confidenceForScore(candidate.score),
    reason: reasonFor(candidate),
  };
}

function confidenceForScore(score: number): Confidence {
  if (score >= 0.5) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}

function selectMatch(matches: SkillRouteMatch[]): SkillRouteMatch | null {
  const first = matches[0];
  if (!first || !SELECTABLE_CONFIDENCES.has(first.confidence)) return null;

  const second = matches[1];
  if (
    second &&
    SELECTABLE_CONFIDENCES.has(second.confidence) &&
    first.score - second.score < AMBIGUOUS_SELECTION_MARGIN
  ) {
    return null;
  }
  return first;
}

function reasonFor(candidate: ScoredCandidate): string {
  const parts: string[] = [];
  if (candidate.matchedName) parts.push("matched skill name");
  if (candidate.matchedPhrase) parts.push("matched query phrase");
  if (candidate.tokenCount > 0) parts.push(`matched ${candidate.hitCount}/${candidate.tokenCount} query terms`);
  if (candidate.cueHitCount > 0) parts.push(`matched ${candidate.cueHitCount} high-signal candidate cue(s)`);
  if (candidate.candidateTokenCount > 0) {
    parts.push(`matched ${candidate.candidateHitCount}/${candidate.candidateTokenCount} candidate terms`);
  }
  return parts.join("; ") || "weak lexical match";
}

function normalizeTopK(topK: number | undefined): number {
  if (!topK || !Number.isFinite(topK) || topK < 1) return DEFAULT_TOP_K;
  return Math.min(Math.floor(topK), 20);
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

function isHighSignalCue(term: string): boolean {
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(term)) {
    return Array.from(term).length >= 3;
  }
  return false;
}

function compact(input: string): string {
  return input.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}
