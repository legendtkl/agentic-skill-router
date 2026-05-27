import {
  boundaryTermsFor,
  compact,
  GENERIC_TERM_WEIGHT,
  isCjk,
  isGenericTerm,
  isShortLatinTerm,
  termsFor,
} from "./text-match.ts";
import type { Confidence, Skill } from "./types.ts";
import { isRoutableDisabledSkill, type MatchEvidence, type SkillRouteMatch, type SkillRouteResult } from "./route.ts";

export interface MetadataRouteOptions {
  topK?: number;
}

interface QueryPlan {
  raw: string;
  compact: string;
  terms: Set<string>;
  boundaryTerms: Set<string>;
  distinctiveTerms: Set<string>;
  genericTerms: Set<string>;
}

interface MetadataField {
  field: "id" | "name" | "alias" | "description" | "tag" | "tool" | "domain" | "intent" | "example";
  text: string;
  weight: number;
  terms: Set<string>;
  compact: string;
}

interface IndexedSkill {
  skill: Skill;
  fields: MetadataField[];
  allTerms: Set<string>;
  isUmbrella: boolean;
}

interface ScoredMetadataSkill {
  skill: Skill;
  score: number;
  rawScore: number;
  matchedDistinctiveTerms: Set<string>;
  matchedGenericTerms: Set<string>;
  matchedName: boolean;
  matchedAlias: boolean;
  containedNameMatched: boolean;
  containedAliasMatched: boolean;
  exactNameMatched: boolean;
  exactAliasMatched: boolean;
  matchedTool: boolean;
  matchedIntent: boolean;
  isUmbrella: boolean;
  evidence: MatchEvidence[];
}

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

const FIELD_WEIGHTS: Record<MetadataField["field"], number> = {
  name: 4.0,
  alias: 3.5,
  tool: 3.0,
  intent: 2.5,
  domain: 2.0,
  tag: 2.0,
  id: 1.2,
  description: 1.0,
  example: 0.8,
};

export function routeDisabledSkillsMetadata(
  skills: Skill[],
  query: string,
  opts: MetadataRouteOptions = {},
): SkillRouteResult {
  const trimmedQuery = query.trim();
  if (trimmedQuery === "") {
    return { query: trimmedQuery, mode: "disabled-only", routeMode: "metadata", selected: null, matches: [] };
  }

  const candidates = skills.filter(isRoutableDisabledSkill).map(indexSkill);
  const queryPlan = analyzeQuery(trimmedQuery);
  if (queryPlan.terms.size === 0) {
    return { query: trimmedQuery, mode: "disabled-only", routeMode: "metadata", selected: null, matches: [] };
  }

  const idf = computeIdf(candidates);
  const scored = candidates
    .map((candidate) => scoreIndexedSkill(candidate, queryPlan, idf))
    .filter((candidate) => candidate.score > 0)
    .sort(compareScoredMetadata);

  const topK = normalizeTopK(opts.topK);
  const selectionWindow = scored.slice(0, 2).map(toRouteMatch);
  const selected = selectMetadataMatch(selectionWindow);
  return {
    query: trimmedQuery,
    mode: "disabled-only",
    routeMode: "metadata",
    selected,
    matches: scored.slice(0, topK).map(toRouteMatch),
    diagnostics: {
      metadata: {
        selectedId: selected?.skill.id ?? null,
        action: selected ? "read-skill-file" : "no-confident-match",
        matches: scored.slice(0, Math.max(topK, 2)).map((item) => {
          const match = toRouteMatch(item);
          return { id: match.skill.id, confidence: match.confidence, score: match.score, reason: match.reason };
        }),
      },
    },
  };
}

export function hasDistinctiveMetadataEvidence(match: SkillRouteMatch): boolean {
  return match.signals.matchedName ||
    match.signals.matchedPhrase ||
    match.signals.cueHitCount >= 2 ||
    (match.evidence?.some((e) => e.field === "tool") && match.evidence?.some((e) => e.field === "intent")) === true;
}

export function isMetadataUmbrellaSkill(skill: Skill): boolean {
  const text = `${skill.name}\n${skill.description}`.normalize("NFKC").toLowerCase();
  if (/\b(router skill|routes? to subskills?|unified skill|command surface)\b/.test(text)) return true;
  return skill.description.length > 700 && /\bcovers?\b/.test(text);
}

function indexSkill(skill: Skill): IndexedSkill {
  const metadata = skill.metadata;
  const fields: MetadataField[] = [
    field("id", skill.id),
    field("name", skill.name || metadata?.name || ""),
    field("description", skill.description || metadata?.description || ""),
    ...manyFields("alias", metadata?.aliases),
    ...manyFields("tag", metadata?.tags),
    ...manyFields("tool", metadata?.tools),
    ...manyFields("domain", metadata?.domains),
    ...manyFields("intent", metadata?.intents),
    ...manyFields("example", metadata?.examples),
  ].filter((item) => item.text.trim() !== "");
  const allTerms = new Set<string>();
  for (const item of fields) {
    for (const term of item.terms) allTerms.add(term);
  }
  return { skill, fields, allTerms, isUmbrella: isMetadataUmbrellaSkill(skill) };
}

function field(fieldName: MetadataField["field"], text: string): MetadataField {
  return {
    field: fieldName,
    text,
    weight: FIELD_WEIGHTS[fieldName],
    terms: termsFor(text, "metadata"),
    compact: compact(text),
  };
}

function manyFields(fieldName: MetadataField["field"], values: string[] | undefined): MetadataField[] {
  return (values ?? []).map((value) => field(fieldName, value));
}

function analyzeQuery(raw: string): QueryPlan {
  const terms = termsFor(raw, "metadata");
  const boundaryTerms = boundaryTermsFor(raw);
  const distinctiveTerms = new Set<string>();
  const genericTerms = new Set<string>();
  for (const term of terms) {
    if (isGenericTerm(term)) genericTerms.add(term);
    else distinctiveTerms.add(term);
  }
  return { raw, compact: compact(raw), terms, boundaryTerms, distinctiveTerms, genericTerms };
}

function computeIdf(candidates: IndexedSkill[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const candidate of candidates) {
    for (const term of candidate.allTerms) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  const out = new Map<string, number>();
  const docCount = candidates.length;
  for (const [term, count] of docFreq) {
    out.set(term, Math.log((1 + docCount) / (1 + count)) + 1);
  }
  return out;
}

function scoreIndexedSkill(candidate: IndexedSkill, query: QueryPlan, idf: Map<string, number>): ScoredMetadataSkill {
  let rawScore = 0;
  let matchedName = false;
  let matchedAlias = false;
  let containedNameMatched = false;
  let containedAliasMatched = false;
  let exactNameMatched = false;
  let exactAliasMatched = false;
  let matchedTool = false;
  let matchedIntent = false;
  const matchedDistinctiveTerms = new Set<string>();
  const matchedGenericTerms = new Set<string>();
  const evidence: MatchEvidence[] = [];

  for (const item of candidate.fields) {
    const exactFieldEqualsQuery = item.compact !== "" && query.compact === item.compact;
    const partialFieldAppearsInQuery = !exactFieldEqualsQuery &&
      query.compact.length >= 4 &&
      fieldAppearsInQuery(item, query);
    if (exactFieldEqualsQuery || partialFieldAppearsInQuery) {
      const contribution = item.field === "name" ? 4.0 : item.field === "alias" ? 3.5 : item.weight * 0.8;
      rawScore += contribution;
      if (item.field === "name") {
        matchedName = true;
        containedNameMatched = containedNameMatched || partialFieldAppearsInQuery;
        exactNameMatched = exactNameMatched || exactFieldEqualsQuery;
      }
      if (item.field === "alias") {
        matchedAlias = true;
        containedAliasMatched = containedAliasMatched || partialFieldAppearsInQuery;
        exactAliasMatched = exactAliasMatched || exactFieldEqualsQuery;
      }
      evidence.push(evidenceFor(item, item.text, contribution));
    }

    if (query.compact.length >= 8 && item.compact.includes(query.compact)) {
      const contribution = item.weight * 1.2;
      rawScore += contribution;
      evidence.push(evidenceFor(item, query.raw, contribution));
    }

    for (const term of query.terms) {
      if (isShortLatinTerm(term) && !query.boundaryTerms.has(term)) continue;
      const quality = matchQuality(term, item);
      if (quality <= 0) continue;
      const generic = isGenericTerm(term);
      const genericFactor = generic ? GENERIC_TERM_WEIGHT : 1;
      const contribution = item.weight * (idf.get(term) ?? 1) * quality * genericFactor;
      rawScore += contribution;
      if (generic) matchedGenericTerms.add(term);
      else matchedDistinctiveTerms.add(term);
      if (item.field === "name") matchedName = true;
      if (item.field === "alias") matchedAlias = true;
      if (item.field === "tool") matchedTool = true;
      if (item.field === "intent") matchedIntent = true;
      evidence.push(evidenceFor(item, term, contribution));
    }
  }

  const distinctiveCount = Math.max(1, query.distinctiveTerms.size);
  let score = Math.min(1, rawScore / Math.max(4, distinctiveCount * 3.2));
  if (exactNameMatched) score = Math.max(score, 0.9);
  if (exactAliasMatched) score = Math.max(score, 0.85);
  if (containedAliasMatched) score = Math.max(score, 0.75);
  if (
    matchedDistinctiveTerms.size < 2 &&
    !exactNameMatched &&
    !exactAliasMatched &&
    !containedAliasMatched
  ) {
    score = Math.min(score, 0.54);
  }
  if (matchedDistinctiveTerms.size === 0 && !matchedName && !matchedAlias) score = Math.min(score, 0.34);
  if (candidate.isUmbrella && !exactNameMatched && !exactAliasMatched) score = Math.min(score, 0.68);

  return {
    skill: candidate.skill,
    score,
    rawScore,
    matchedDistinctiveTerms,
    matchedGenericTerms,
    matchedName,
    matchedAlias,
    containedNameMatched,
    containedAliasMatched,
    exactNameMatched,
    exactAliasMatched,
    matchedTool,
    matchedIntent,
    isUmbrella: candidate.isUmbrella,
    evidence: compactEvidence(evidence),
  };
}

function matchQuality(term: string, item: MetadataField): number {
  if (item.terms.has(term)) return 1;
  const compactTerm = compact(term);
  if (compactTerm.length >= 3 && item.compact.includes(compactTerm)) {
    return isCjk(term) ? 0.7 : 0.6;
  }
  return 0;
}

function fieldAppearsInQuery(item: MetadataField, query: QueryPlan): boolean {
  if (item.compact === "" || !query.compact.includes(item.compact)) return false;

  if (item.field !== "alias" && item.field !== "name") {
    return item.compact.length >= 4;
  }

  if (isCjk(item.compact)) {
    return Array.from(item.compact).length >= 3;
  }

  // Short Latin aliases such as "ai" and "es" are handled by term matching,
  // which preserves token boundaries and avoids OpenAI/daily-style substrings.
  if (item.compact.length < 5) return query.boundaryTerms.has(item.compact);

  const parts = latinBoundaryParts(item.text);
  return query.boundaryTerms.has(item.compact) ||
    (parts.length > 0 && parts.every((part) => query.boundaryTerms.has(part)));
}

function evidenceFor(item: MetadataField, matched: string, contribution: number): MatchEvidence {
  return {
    field: item.field,
    matched,
    isGeneric: isGenericTerm(matched),
    contribution: Number(contribution.toFixed(4)),
    source: "metadata",
    weight: item.weight,
    text: clamp(item.text),
  };
}

function compactEvidence(evidence: MatchEvidence[]): MatchEvidence[] {
  const best = new Map<string, MatchEvidence>();
  for (const item of evidence) {
    const key = `${item.field}\0${item.matched}\0${item.text}`;
    const existing = best.get(key);
    if (!existing || item.contribution > existing.contribution) best.set(key, item);
  }
  return [...best.values()]
    .sort((a, b) => b.contribution - a.contribution || a.field.localeCompare(b.field))
    .slice(0, 8);
}

function toRouteMatch(item: ScoredMetadataSkill): SkillRouteMatch {
  return {
    skill: item.skill,
    score: Number(item.score.toFixed(4)),
    confidence: confidenceForScore(item.score),
    reason: reasonFor(item),
    evidence: item.evidence,
    signals: {
      hitCount: item.matchedDistinctiveTerms.size + item.matchedGenericTerms.size,
      tokenCount: item.matchedDistinctiveTerms.size + item.matchedGenericTerms.size,
      candidateHitCount: item.matchedDistinctiveTerms.size,
      candidateTokenCount: item.evidence.length,
      cueHitCount: item.matchedDistinctiveTerms.size,
      matchedName: item.exactNameMatched || item.exactAliasMatched,
      matchedPhrase: item.containedNameMatched ||
        item.containedAliasMatched ||
        item.evidence.some((e) => e.matched.length >= 8 && compact(e.text ?? "").includes(compact(e.matched))),
    },
  };
}

function confidenceForScore(score: number): Confidence {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function selectMetadataMatch(matches: SkillRouteMatch[]): SkillRouteMatch | null {
  const first = matches[0];
  if (!first) return null;
  const second = matches[1];
  const margin = second ? first.score - second.score : 1;
  if (first.confidence === "high" && margin >= 0.12 && hasDistinctiveMetadataEvidence(first)) return first;
  if (first.confidence === "medium" && margin >= 0.08 && hasDistinctiveMetadataEvidence(first)) return first;
  return null;
}

function reasonFor(item: ScoredMetadataSkill): string {
  const parts = [
    `matched ${item.matchedDistinctiveTerms.size} distinctive metadata term(s)`,
  ];
  if (item.matchedGenericTerms.size > 0) parts.push(`matched ${item.matchedGenericTerms.size} generic term(s)`);
  if (item.containedNameMatched) parts.push("matched name phrase");
  if (item.containedAliasMatched) parts.push("matched alias phrase");
  if (item.exactNameMatched) parts.push("matched name");
  if (item.exactAliasMatched) parts.push("matched alias");
  if (item.matchedTool) parts.push("matched tool/API field");
  if (item.matchedIntent) parts.push("matched intent field");
  if (item.isUmbrella) parts.push("umbrella candidate capped unless exact/alias matched");
  return parts.join("; ");
}

function compareScoredMetadata(a: ScoredMetadataSkill, b: ScoredMetadataSkill): number {
  const delta = b.score - a.score;
  if (delta !== 0) return delta;
  const rawDelta = b.rawScore - a.rawScore;
  if (rawDelta !== 0) return rawDelta;
  return a.skill.id.localeCompare(b.skill.id);
}

function normalizeTopK(topK: number | undefined): number {
  if (!topK || !Number.isFinite(topK) || topK < 1) return DEFAULT_TOP_K;
  return Math.min(Math.floor(topK), MAX_TOP_K);
}

function latinBoundaryParts(input: string): string[] {
  const prepared = input.normalize("NFKC").toLowerCase();
  const parts = new Set<string>();
  for (const match of prepared.matchAll(/[a-z0-9][a-z0-9_:+./-]*/g)) {
    const token = match[0];
    const splitParts = token.split(/[-_:+./]+/).filter((part) => part.length >= 2);
    if (splitParts.length > 1) {
      for (const part of splitParts) parts.add(part);
    } else if (token.length >= 2) {
      parts.add(token);
    }
  }
  return [...parts];
}

function clamp(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
}
