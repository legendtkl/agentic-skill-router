import { createHash } from "node:crypto";
import { boundaryTermsFor, compact, isShortLatinTerm, termsFor } from "./text-match.ts";
import type { Skill } from "./types.ts";
import { isRoutableDisabledSkill } from "./route.ts";

export interface CorpusSearchOptions {
  any?: string[];
  all?: string[];
  limit?: number;
  ranker?: CorpusRanker;
}

export type CorpusRanker = "weighted" | "bm25";

export interface CorpusQueryExpression {
  any: string[];
  all: string[];
}

export interface CorpusBudget {
  maxResults: number;
  readsBody: false;
}

export interface CorpusSearchResult {
  action: "inspect-candidates" | "narrow-or-broaden" | "no-candidates";
  mode: "disabled-skill-metadata";
  ranker: CorpusRanker;
  query: CorpusQueryExpression;
  budget: CorpusBudget;
  corpus: {
    scanned: number;
    totalMatches: number;
    returned: number;
    truncated: boolean;
  };
  diagnostics: CorpusSearchDiagnostics;
  matches: CorpusSearchMatch[];
}

export interface CorpusSearchMatch extends CorpusSkillRef {
  score: number;
  reason: string;
  matchedTerms: CorpusQueryExpression;
  snippets: CorpusSnippet[];
}

export interface CorpusInspectResult {
  action: "inspect-skills";
  inspected: CorpusSkillRef[];
}

export interface CorpusBm25Index {
  version: 1;
  mode: "disabled-skill-metadata-bm25";
  corpus: { scanned: number; indexed: number };
  documents: CorpusBm25IndexDocument[];
  documentFrequency: Array<[string, number]>;
  postings: Array<[string, number[]]>;
  averageDocLength: number;
}

export interface CorpusBm25IndexDocument {
  skill: Skill;
  fields: CorpusBm25IndexField[];
  termFrequency: Array<[string, number]>;
  docLength: number;
}

export interface CorpusBm25IndexField {
  name: string;
  text: string;
  weight: number;
  normalized: string;
  compact: string;
  terms: string[];
  boundaryTerms: string[];
}

export interface CorpusSkillRef {
  ref: string;
  id: string;
  shortId: string;
  name: string;
  source: Skill["source"];
  pluginKey: string | null;
  description: string;
  metadata: {
    aliases: string[];
    tags: string[];
    tools: string[];
    domains: string[];
    intents: string[];
    examples: string[];
  };
}

export interface CorpusSnippet {
  field: string;
  text: string;
}

export interface CorpusSearchDiagnostics {
  skillsMatchingAllTerms: number;
  skillsMatchingAnyTerms: number;
  filteredByAllTerms: number;
  filteredByAnyTerms: number;
}

interface ScoredCandidate {
  skill: Skill;
  score: number;
  matchedAny: string[];
  matchedAll: string[];
  snippets: CorpusSnippet[];
}

interface MetadataField {
  name: string;
  text: string;
  weight: number;
}

interface PreparedMetadataField extends MetadataField {
  normalized: string;
  compact: string;
  terms: Set<string>;
  boundaryTerms: Set<string>;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function searchSkillCorpus(
  skills: Skill[],
  opts: CorpusSearchOptions = {},
): CorpusSearchResult {
  const candidates = skills.filter(isRoutableDisabledSkill);
  const query = normalizeExpression(opts);
  const limit = normalizeLimit(opts.limit);
  const ranker = normalizeRanker(opts.ranker);
  if (query.any.length === 0 && query.all.length === 0) {
    return {
      action: "no-candidates",
      mode: "disabled-skill-metadata",
      ranker,
      query,
      budget: { maxResults: limit, readsBody: false },
      corpus: { scanned: candidates.length, totalMatches: 0, returned: 0, truncated: false },
      diagnostics: emptyDiagnostics(),
      matches: [],
    };
  }

  if (ranker === "bm25") return searchSkillCorpusBm25(candidates, query, limit);
  return searchSkillCorpusWeighted(candidates, query, limit);
}

export function buildSkillCorpusBm25Index(skills: Skill[]): CorpusBm25Index {
  const candidates = skills.filter(isRoutableDisabledSkill);
  const documents = candidates.map(prepareBm25IndexDocument);
  const documentFrequency = bm25IndexDocumentFrequency(documents);
  const postings = bm25Postings(documents);
  const averageDocLength = documents.length === 0
    ? 1
    : documents.reduce((sum, doc) => sum + doc.docLength, 0) / documents.length;
  return {
    version: 1,
    mode: "disabled-skill-metadata-bm25",
    corpus: { scanned: candidates.length, indexed: documents.length },
    documents,
    documentFrequency: [...documentFrequency.entries()],
    postings: [...postings.entries()],
    averageDocLength,
  };
}

export function searchSkillCorpusBm25Index(
  index: CorpusBm25Index,
  opts: CorpusSearchOptions = {},
): CorpusSearchResult {
  const query = normalizeExpression(opts);
  const limit = normalizeLimit(opts.limit);
  if (query.any.length === 0 && query.all.length === 0) {
    return {
      action: "no-candidates",
      mode: "disabled-skill-metadata",
      ranker: "bm25",
      query,
      budget: { maxResults: limit, readsBody: false },
      corpus: { scanned: index.corpus.scanned, totalMatches: 0, returned: 0, truncated: false },
      diagnostics: emptyDiagnostics(),
      matches: [],
    };
  }

  return searchSkillCorpusBm25Documents(
    index.documents,
    query,
    limit,
    new Map(index.documentFrequency),
    index.averageDocLength,
    new Map(index.postings),
    index.corpus.scanned,
  );
}

function searchSkillCorpusWeighted(
  candidates: Skill[],
  query: CorpusQueryExpression,
  limit: number,
): CorpusSearchResult {
  const top: ScoredCandidate[] = [];
  let totalMatches = 0;
  const diagnostics = emptyDiagnostics();
  for (const skill of candidates) {
    const evaluated = evaluateCandidate(skill, query);
    if (evaluated.allMatched) diagnostics.skillsMatchingAllTerms++;
    if (evaluated.anyMatched) diagnostics.skillsMatchingAnyTerms++;
    if (!evaluated.allMatched && evaluated.anyMatched) diagnostics.filteredByAllTerms++;
    if (evaluated.allMatched && !evaluated.anyMatched) diagnostics.filteredByAnyTerms++;
    const scored = evaluated.scored;
    if (!scored) continue;
    totalMatches++;
    insertTop(top, scored, limit);
  }

  const matches = top.sort(compareScored).map(projectMatch);
  return {
    action: matches.length === 0
      ? "no-candidates"
      : totalMatches > matches.length
        ? "narrow-or-broaden"
        : "inspect-candidates",
    mode: "disabled-skill-metadata",
    ranker: "weighted",
    query,
    budget: { maxResults: limit, readsBody: false },
    corpus: {
      scanned: candidates.length,
      totalMatches,
      returned: matches.length,
      truncated: totalMatches > matches.length,
    },
    diagnostics,
    matches,
  };
}

function searchSkillCorpusBm25(
  candidates: Skill[],
  query: CorpusQueryExpression,
  limit: number,
): CorpusSearchResult {
  const documents = candidates.map(prepareBm25IndexDocument);
  const documentFrequency = bm25IndexDocumentFrequency(documents);
  const averageDocLength = documents.length === 0
    ? 1
    : documents.reduce((sum, doc) => sum + doc.docLength, 0) / documents.length;
  return searchSkillCorpusBm25Documents(
    documents,
    query,
    limit,
    documentFrequency,
    averageDocLength,
    null,
    candidates.length,
  );
}

function searchSkillCorpusBm25Documents(
  documents: CorpusBm25IndexDocument[],
  query: CorpusQueryExpression,
  limit: number,
  documentFrequency: Map<string, number>,
  averageDocLength: number,
  postings: Map<string, number[]> | null,
  scanned: number,
): CorpusSearchResult {
  const queryTokens = bm25QueryTokens(query);
  const candidateIndexes = postings ? bm25CandidateIndexes(postings, query, documents.length) : allDocumentIndexes(documents.length);
  const top: ScoredCandidate[] = [];
  let totalMatches = 0;
  const diagnostics = emptyDiagnostics();

  for (const docIndex of candidateIndexes) {
    const doc = documents[docIndex];
    if (!doc) continue;
    const evaluated = evaluateBm25Document(doc, query, documentFrequency, averageDocLength, documents.length, queryTokens);
    if (evaluated.allMatched) diagnostics.skillsMatchingAllTerms++;
    if (evaluated.anyMatched) diagnostics.skillsMatchingAnyTerms++;
    if (!evaluated.allMatched && evaluated.anyMatched) diagnostics.filteredByAllTerms++;
    if (evaluated.allMatched && !evaluated.anyMatched) diagnostics.filteredByAnyTerms++;
    const scored = evaluated.scored;
    if (!scored) continue;
    totalMatches++;
    insertTop(top, scored, limit);
  }

  const matches = top.sort(compareScored).map(projectMatch);
  return {
    action: matches.length === 0
      ? "no-candidates"
      : totalMatches > matches.length
        ? "narrow-or-broaden"
        : "inspect-candidates",
    mode: "disabled-skill-metadata",
    ranker: "bm25",
    query,
    budget: { maxResults: limit, readsBody: false },
    corpus: {
      scanned,
      totalMatches,
      returned: matches.length,
      truncated: totalMatches > matches.length,
    },
    diagnostics,
    matches,
  };
}

export function inspectSkillCorpus(skills: Skill[], idsOrNames: string[]): CorpusInspectResult {
  if (idsOrNames.length === 0) throw new Error("inspect at least one skill id or name");
  const inspected: CorpusSkillRef[] = [];
  const seen = new Set<string>();
  for (const idOrName of idsOrNames) {
    const skill = findRoutableSkill(skills, idOrName);
    const key = `${skill.id}\0${skill.skillMdPath}`;
    if (seen.has(key)) continue;
    inspected.push(skillRef(skill));
    seen.add(key);
  }
  return { action: "inspect-skills", inspected };
}

function normalizeExpression(opts: CorpusSearchOptions): CorpusQueryExpression {
  return {
    any: normalizeTerms(opts.any ?? []),
    all: normalizeTerms(opts.all ?? []),
  };
}

function normalizeTerms(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const term = value.trim();
    const key = term.normalize("NFKC").toLowerCase();
    if (!term || seen.has(key)) continue;
    out.push(term);
    seen.add(key);
  }
  return out;
}

function normalizeLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(value), MAX_LIMIT);
}

function normalizeRanker(value: CorpusRanker | undefined): CorpusRanker {
  return value ?? "weighted";
}

function emptyDiagnostics(): CorpusSearchDiagnostics {
  return {
    skillsMatchingAllTerms: 0,
    skillsMatchingAnyTerms: 0,
    filteredByAllTerms: 0,
    filteredByAnyTerms: 0,
  };
}

function prepareBm25IndexDocument(skill: Skill): CorpusBm25IndexDocument {
  const fields = metadataFields(skill).map(prepareIndexField);
  const termFrequency = new Map<string, number>();
  for (const field of fields) {
    for (const term of bm25IndexTermsForField(field)) {
      termFrequency.set(term, (termFrequency.get(term) ?? 0) + field.weight);
    }
  }
  const docLength = [...termFrequency.values()].reduce((sum, tf) => sum + tf, 0) || 1;
  return { skill, fields, termFrequency: [...termFrequency.entries()], docLength };
}

function prepareMetadataField(field: MetadataField): PreparedMetadataField {
  return {
    ...field,
    normalized: field.text.normalize("NFKC").toLowerCase(),
    compact: compact(field.text),
    terms: termsFor(field.text, "metadata"),
    boundaryTerms: boundaryTermsFor(field.text),
  };
}

function prepareIndexField(field: MetadataField): CorpusBm25IndexField {
  const prepared = prepareMetadataField(field);
  return {
    name: prepared.name,
    text: prepared.text,
    weight: prepared.weight,
    normalized: prepared.normalized,
    compact: prepared.compact,
    terms: [...prepared.terms],
    boundaryTerms: [...prepared.boundaryTerms],
  };
}

function bm25IndexTermsForField(field: CorpusBm25IndexField): string[] {
  const out = new Set([...field.terms, ...field.boundaryTerms]);
  if (field.compact.length >= 2 && field.compact.length <= 80) out.add(field.compact);
  return [...out];
}

function bm25IndexDocumentFrequency(documents: CorpusBm25IndexDocument[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const doc of documents) {
    for (const [term] of doc.termFrequency) {
      out.set(term, (out.get(term) ?? 0) + 1);
    }
  }
  return out;
}

function bm25Postings(documents: CorpusBm25IndexDocument[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  documents.forEach((doc, idx) => {
    for (const [term] of doc.termFrequency) {
      const posting = out.get(term);
      if (posting) posting.push(idx);
      else out.set(term, [idx]);
    }
  });
  return out;
}

function bm25QueryTokens(query: CorpusQueryExpression): string[] {
  const tokens = new Set<string>();
  for (const term of [...query.all, ...query.any]) {
    for (const token of termsFor(term, "metadata")) tokens.add(token);
  }
  return [...tokens];
}

function evaluateBm25Document(
  doc: CorpusBm25IndexDocument,
  query: CorpusQueryExpression,
  documentFrequency: Map<string, number>,
  averageDocLength: number,
  documentCount: number,
  queryTokens: string[],
): { allMatched: boolean; anyMatched: boolean; scored: ScoredCandidate | null } {
  const allHits = query.all.map((term) => scoreIndexTerm(doc.fields, term));
  const allMatched = allHits.every(Boolean);
  const anyHits = query.any.map((term) => scoreIndexTerm(doc.fields, term)).filter((hit): hit is TermHit => Boolean(hit));
  const anyMatched = query.any.length === 0 || anyHits.length > 0;

  if (!allMatched || !anyMatched) return { allMatched, anyMatched, scored: null };

  const score = bm25Score(doc, queryTokens, documentFrequency, averageDocLength, documentCount);
  const hits = [...allHits.filter((hit): hit is TermHit => Boolean(hit)), ...anyHits];
  return {
    allMatched,
    anyMatched,
    scored: {
      skill: doc.skill,
      score,
      matchedAll: allHits.flatMap((hit, idx) => hit ? [query.all[idx]!] : []),
      matchedAny: anyHits.map((hit) => hit.term),
      snippets: snippetsForHits(hits),
    },
  };
}

function bm25Score(
  doc: CorpusBm25IndexDocument,
  queryTokens: string[],
  documentFrequency: Map<string, number>,
  averageDocLength: number,
  documentCount: number,
): number {
  let score = 0;
  const termFrequency = new Map(doc.termFrequency);
  for (const token of queryTokens) {
    const tf = termFrequency.get(token) ?? 0;
    if (tf <= 0) continue;
    const df = documentFrequency.get(token) ?? 0;
    const idf = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.docLength / averageDocLength));
    score += idf * ((tf * (BM25_K1 + 1)) / denominator);
  }
  return score;
}

function bm25CandidateIndexes(
  postings: Map<string, number[]>,
  query: CorpusQueryExpression,
  documentCount: number,
): number[] {
  const allSets = query.all.map((term) => postingSetForRequiredTerm(postings, term));
  if (allSets.some((set) => set === null)) return allDocumentIndexes(documentCount);

  let candidates: Set<number> | null = null;
  for (const set of allSets) {
    candidates = candidates ? intersectSets(candidates, set!) : new Set(set!);
  }

  if (query.any.length > 0) {
    const anySets = query.any.map((term) => postingSetForOptionalTerm(postings, term));
    if (anySets.some((set) => set === null)) return allDocumentIndexes(documentCount);
    const anyUnion = unionSets(anySets as Set<number>[]);
    candidates = candidates ? intersectSets(candidates, anyUnion) : anyUnion;
  }

  return [...(candidates ?? new Set(allDocumentIndexes(documentCount)))];
}

function postingSetForRequiredTerm(postings: Map<string, number[]>, term: string): Set<number> | null {
  const tokens = [...termsFor(term, "metadata")];
  if (tokens.length === 0) return null;
  let out: Set<number> | null = null;
  for (const token of tokens) {
    const posting = postingSetForTokenLike(postings, token);
    if (posting.size === 0) return null;
    out = out ? intersectSets(out, posting) : posting;
  }
  return out;
}

function postingSetForOptionalTerm(postings: Map<string, number[]>, term: string): Set<number> | null {
  const tokens = [...termsFor(term, "metadata")];
  if (tokens.length === 0) return null;
  const sets: Set<number>[] = [];
  for (const token of tokens) {
    const posting = postingSetForTokenLike(postings, token);
    if (posting.size > 0) sets.push(posting);
  }
  if (sets.length === 0) return null;
  return unionSets(sets);
}

function postingSetForTokenLike(postings: Map<string, number[]>, token: string): Set<number> {
  const out = new Set<number>();
  const exact = postings.get(token);
  if (exact) {
    for (const idx of exact) out.add(idx);
  }
  if (token.length >= 4) {
    for (const [indexedToken, posting] of postings) {
      if (indexedToken === token) continue;
      if (!indexedToken.includes(token)) continue;
      for (const idx of posting) out.add(idx);
    }
  }
  return out;
}

function allDocumentIndexes(documentCount: number): number[] {
  return Array.from({ length: documentCount }, (_, idx) => idx);
}

function intersectSets(a: Set<number>, b: Set<number>): Set<number> {
  const out = new Set<number>();
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) out.add(value);
  }
  return out;
}

function unionSets(sets: Set<number>[]): Set<number> {
  const out = new Set<number>();
  for (const set of sets) {
    for (const value of set) out.add(value);
  }
  return out;
}

function evaluateCandidate(
  skill: Skill,
  query: CorpusQueryExpression,
): { allMatched: boolean; anyMatched: boolean; scored: ScoredCandidate | null } {
  const fields = metadataFields(skill);
  const allHits = query.all.map((term) => scoreTerm(fields, term));
  const allMatched = allHits.every(Boolean);

  const anyHits = query.any.map((term) => scoreTerm(fields, term)).filter((hit): hit is TermHit => Boolean(hit));
  const anyMatched = query.any.length === 0 || anyHits.length > 0;

  if (!allMatched || !anyMatched) return { allMatched, anyMatched, scored: null };

  const hits = [...allHits.filter((hit): hit is TermHit => Boolean(hit)), ...anyHits];
  const score = hits.reduce((sum, hit) => sum + hit.score, 0);
  const snippets = snippetsForHits(hits);
  return {
    allMatched,
    anyMatched,
    scored: {
      skill,
      score,
      matchedAll: allHits.flatMap((hit, idx) => hit ? [query.all[idx]!] : []),
      matchedAny: anyHits.map((hit) => hit.term),
      snippets,
    },
  };
}

interface TermHit {
  term: string;
  field: string;
  text: string;
  score: number;
}

function scoreTerm(fields: MetadataField[], term: string): TermHit | null {
  return scorePreparedTerm(fields.map(prepareMetadataField), term);
}

function scorePreparedTerm(fields: PreparedMetadataField[], term: string): TermHit | null {
  const normalized = term.normalize("NFKC").toLowerCase();
  const compactTerm = compact(term);
  const termTerms = [...termsFor(term, "metadata")];
  const boundaryTerms = boundaryTermsFor(term);
  const shortLatin = isShortLatinTerm(normalized);
  if (shortLatin && boundaryTerms.size === 0) return null;
  let best: TermHit | null = null;
  for (const field of fields) {
    const exact = shortLatin
      ? boundarySetIntersects(field.boundaryTerms, boundaryTerms)
      : normalized.length > 0 && field.normalized.includes(normalized);
    const compactHit = !shortLatin && compactTerm.length >= 2 && field.compact.includes(compactTerm);
    const tokenHit = termTokensMatch(field.terms, termTerms);
    if (!exact && !compactHit && !tokenHit) continue;
    const bonus = exact ? 0.75 : compactHit ? 0.35 : 0;
    const candidate = {
      term,
      field: field.name,
      text: field.text,
      score: field.weight + bonus,
    };
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}

function scoreIndexTerm(fields: CorpusBm25IndexField[], term: string): TermHit | null {
  const preparedFields = fields.map((field) => ({
    ...field,
    terms: new Set(field.terms),
    boundaryTerms: new Set(field.boundaryTerms),
  }));
  return scorePreparedTerm(preparedFields, term);
}

function termTokensMatch(fieldTerms: Set<string>, termTerms: string[]): boolean {
  if (termTerms.length === 0) return false;
  if (termTerms.length === 1) return fieldTerms.has(termTerms[0]!);
  return termTerms.every((term) => fieldTerms.has(term));
}

function metadataFields(skill: Skill): MetadataField[] {
  const metadata = skill.metadata;
  const fields: MetadataField[] = [
    { name: "id", text: skill.id, weight: 3.5 },
    { name: "name", text: skill.name, weight: 4 },
    { name: "description", text: skill.description, weight: 1.5 },
  ];
  appendArrayField(fields, "aliases", metadata?.aliases, 4);
  appendArrayField(fields, "tools", metadata?.tools, 3.5);
  appendArrayField(fields, "tags", metadata?.tags, 2.5);
  appendArrayField(fields, "domains", metadata?.domains, 2);
  appendArrayField(fields, "intents", metadata?.intents, 2);
  appendArrayField(fields, "examples", metadata?.examples, 1);
  return fields.filter((field) => field.text.trim() !== "");
}

function appendArrayField(fields: MetadataField[], name: string, values: string[] | undefined, weight: number): void {
  if (!values || values.length === 0) return;
  fields.push({ name, text: values.join(", "), weight });
}

function snippetsForHits(hits: TermHit[]): CorpusSnippet[] {
  const snippets: CorpusSnippet[] = [];
  const seen = new Set<string>();
  for (const hit of hits.sort((a, b) => b.score - a.score)) {
    const key = `${hit.field}\0${hit.text}`;
    if (seen.has(key)) continue;
    snippets.push({ field: hit.field, text: clamp(hit.text) });
    seen.add(key);
    if (snippets.length >= 3) break;
  }
  return snippets;
}

function insertTop(top: ScoredCandidate[], candidate: ScoredCandidate, limit: number): void {
  top.push(candidate);
  top.sort(compareScored);
  if (top.length > limit) top.pop();
}

function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  const scoreDelta = b.score - a.score;
  if (scoreDelta !== 0) return scoreDelta;
  const hitDelta = (b.matchedAll.length + b.matchedAny.length) - (a.matchedAll.length + a.matchedAny.length);
  if (hitDelta !== 0) return hitDelta;
  return shortIdForSkill(a.skill).localeCompare(shortIdForSkill(b.skill));
}

function projectMatch(candidate: ScoredCandidate): CorpusSearchMatch {
  return {
    ...skillRef(candidate.skill),
    score: Number(candidate.score.toFixed(3)),
    reason: reasonForCandidate(candidate),
    matchedTerms: { any: candidate.matchedAny, all: candidate.matchedAll },
    snippets: candidate.snippets,
  };
}

function reasonForCandidate(candidate: ScoredCandidate): string {
  const parts: string[] = [];
  if (candidate.matchedAll.length > 0) parts.push(`matched all: ${candidate.matchedAll.join(", ")}`);
  if (candidate.matchedAny.length > 0) parts.push(`matched any: ${candidate.matchedAny.join(", ")}`);
  return parts.join("; ") || "matched metadata";
}

function skillRef(skill: Skill): CorpusSkillRef {
  return {
    ref: refForSkill(skill),
    id: skill.id,
    shortId: shortIdForSkill(skill),
    name: skill.name,
    source: skill.source,
    pluginKey: skill.pluginKey,
    description: skill.description,
    metadata: {
      aliases: skill.metadata?.aliases ?? [],
      tags: skill.metadata?.tags ?? [],
      tools: skill.metadata?.tools ?? [],
      domains: skill.metadata?.domains ?? [],
      intents: skill.metadata?.intents ?? [],
      examples: skill.metadata?.examples ?? [],
    },
  };
}

function findRoutableSkill(skills: Skill[], idOrName: string): Skill {
  const needle = idOrName.trim();
  if (!needle) throw new Error("empty skill id or name");
  const candidates = skills.filter(isRoutableDisabledSkill);
  const matches = candidates.filter((skill) =>
    skill.id === needle ||
    skill.name === needle ||
    shortIdForSkill(skill) === needle ||
    refForSkill(skill) === needle
  );
  if (matches.length === 0) throw new Error(`unknown disabled skill id/name/ref: ${idOrName}`);
  if (matches.length > 1) throw new Error(`ambiguous disabled skill id/name/ref: ${idOrName}`);
  return matches[0]!;
}

function shortIdForSkill(skill: Skill): string {
  const parts = skill.id.split(":");
  return parts[parts.length - 1] || skill.name || skill.id;
}

function refForSkill(skill: Skill): string {
  const hash = createHash("sha256").update(`${skill.id}\0${skill.skillMdPath}`).digest("hex").slice(0, 10);
  return `corpus-${hash}`;
}

function clamp(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 300 ? `${trimmed.slice(0, 297)}...` : trimmed;
}

function boundarySetIntersects(a: Set<string>, b: Set<string>): boolean {
  for (const term of b) {
    if (a.has(term)) return true;
  }
  return false;
}
