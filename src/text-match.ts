/**
 * Unified text-match helpers shared by the route, metadata-route, and DCI
 * routers.
 *
 * Before this module existed, each router carried its own copy of `termsFor`,
 * `compact`, and CJK/Latin token helpers. The three copies drifted in subtle
 * ways (e.g. metadata-route split camelCase and detected URLs, while route
 * and DCI did not), which made routing behaviour inconsistent across modes
 * and risked further divergence with every new fix.
 *
 * This module collapses the shared primitives but keeps the original
 * mode-specific tokenizer / classifier shapes by exposing a `mode` parameter
 * on the entry points whose behaviour actually differs between routers:
 *
 * - `termsFor(input, mode?)`:
 *   - `'lexical'` (default) is the route/DCI flavour: no camelCase split,
 *     no URL capture, and `/` is NOT a token character. Identical to the
 *     pre-refactor route.ts / dci.ts tokenizer.
 *   - `'metadata'` is the metadata-route flavour: splits camelCase
 *     boundaries, captures `https?://` URLs as a single token, and treats
 *     `/` as both a token char and a split delimiter alongside `-_:+.`.
 *   The two flavours stay separate so a single-term query like `OpenAI`
 *   does not silently become `open` + `ai` for lexical/DCI scoring (which
 *   would bypass the route's `queryTerms.size <= 1` weak-match guard and
 *   promote noisy substring hits on `ai`).
 * - `boundaryTermsFor` is the metadata-route boundary helper, unchanged.
 *   Used to validate that a short Latin alias appears on its own token
 *   boundary in the query (e.g. `ai` vs `OpenAI`).
 * - `compact` is identical across all three previous implementations:
 *   NFKC-normalise, lowercase, drop everything that is not a Letter/Number.
 * - `isGenericTerm(term, mode?)`:
 *   - `'metadata'` (default) is the metadata-route scoring stop list,
 *     unchanged. That list directly drives metadata-route scoring (generic
 *     terms contribute at 15% weight and do not count toward distinctive
 *     matches), so a union with DCI's snippet stop list would degrade
 *     metadata-route precision on real queries.
 *   - `'dci'` is the broader snippet-line stop set originally local to
 *     dci.ts: the metadata list PLUS common English stop words
 *     (`the`/`and`/`for`/`with`) PLUS short Latin tokens (<=2 chars) as
 *     generic. DCI snippet scoring uses substring matching for query
 *     terms, so without this broader set substring-matched stop fragments
 *     would push irrelevant lines ahead of real evidence.
 * - `isShortLatinTerm` and `isCjk` are lifted verbatim from metadata-route.
 *
 * Each router keeps its own scoring logic and confidence thresholds; this
 * module only exposes the shared tokenizer + classifier primitives.
 */

export type TermsMode = "lexical" | "metadata";
export type GenericTermMode = "metadata" | "dci";

/**
 * Per-term weight applied to generic / stop terms in router scoring.
 *
 * Distinctive terms count at full weight (`1.0`); generic terms count at this
 * reduced weight when computing both the matched-hit total and the query
 * normalization total. This keeps a long generic-heavy query (e.g.
 * "the and a") from inflating a candidate's match ratio.
 *
 * Both `metadata-route.ts` and `dci.ts` use the same constant so their
 * generic-term down-weight stays consistent.
 */
export const GENERIC_TERM_WEIGHT = 0.15;

const METADATA_GENERIC_TERMS: ReadonlySet<string> = new Set([
  // Latin generic / stop terms — taken verbatim from metadata-route.ts so
  // the canonical scoring-side classifier is unchanged.
  "api",
  "config",
  "data",
  "get",
  "helper",
  "list",
  "manage",
  "management",
  "operate",
  "operation",
  "platform",
  "query",
  "search",
  "service",
  "task",
  "tool",
  "tools",
  "use",
  "workflow",
  // CJK generic / stop terms — taken verbatim from metadata-route.ts.
  "任务",
  "工具",
  "平台",
  "查看",
  "查询",
  "操作",
  "搜索",
  "数据",
  "服务",
  "流程",
  "管理",
  "获取",
  "配置",
]);

// DCI snippet scoring needs a broader stop set than metadata-route, because
// snippet matching is substring-based (`linePhrase.includes(term)`) and
// substring hits on common fragments like `the`, `for`, or short Latin
// aliases would otherwise contribute full distinctive weight. This is the
// original `SNIPPET_GENERIC_TERMS` set from dci.ts, kept here so the DCI
// snippet selector retains its pre-refactor ranking semantics.
const DCI_SNIPPET_EXTRA_GENERIC_TERMS: ReadonlySet<string> = new Set(["and", "for", "the", "with"]);

const CJK_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;

const LEXICAL_TOKEN_RE = /[a-z0-9][a-z0-9_:+.-]*/g;
const LEXICAL_SPLIT_RE = /[-_:+.]+/;
const METADATA_TOKEN_RE = /https?:\/\/[^\s"'<>]+|[a-z0-9][a-z0-9_:+./-]*/g;
const METADATA_SPLIT_RE = /[-_:+./]+/;
const CJK_RUN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

/**
 * Token extraction shared by the route, metadata-route, and DCI routers.
 *
 * `mode` controls the dialect:
 * - `'lexical'` (default) matches the pre-refactor route.ts / dci.ts
 *   tokenizer: no camelCase split, no `https?://` URL capture, and `/` is
 *   treated as plain whitespace (not a token character).
 * - `'metadata'` matches the pre-refactor metadata-route tokenizer:
 *   splits camelCase boundaries, captures `https?://` URLs as a single
 *   token, and treats `/` as both a token char and a split delimiter
 *   alongside `-_:+.`.
 */
export function termsFor(input: string, mode: TermsMode = "lexical"): Set<string> {
  if (mode === "metadata") {
    const prepared = input
      .normalize("NFKC")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase();
    return collectTerms(prepared, METADATA_TOKEN_RE, METADATA_SPLIT_RE);
  }
  const prepared = input.normalize("NFKC").toLowerCase();
  return collectTerms(prepared, LEXICAL_TOKEN_RE, LEXICAL_SPLIT_RE);
}

/**
 * Boundary-preserving variant of {@link termsFor} in metadata mode: same
 * regex+split rules as the canonical metadata-mode `termsFor`, but without
 * the camelCase pre-processing. Used by metadata-route to validate that a
 * short Latin alias appears on its own token boundary in the query (e.g.
 * `ai` vs `OpenAI`).
 */
export function boundaryTermsFor(input: string): Set<string> {
  const prepared = input.normalize("NFKC").toLowerCase();
  return collectTerms(prepared, METADATA_TOKEN_RE, METADATA_SPLIT_RE);
}

/**
 * Drop every non-letter / non-number character and lowercase the rest.
 * Identical across all three previous routers — kept here so future changes
 * apply uniformly.
 */
export function compact(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

/**
 * True for purely-CJK terms (Han / Hiragana / Katakana / Hangul). Used by
 * routers to give CJK tokens slightly different weighting from Latin ones.
 */
export function isCjk(term: string): boolean {
  return CJK_RE.test(term);
}

/**
 * Latin tokens of length <= 3 (e.g. `ai`, `es`, `tcc`). Metadata-route uses
 * this to require boundary matching before treating the term as evidence.
 */
export function isShortLatinTerm(term: string): boolean {
  return /^[a-z0-9]+$/.test(term) && term.length <= 3;
}

/**
 * Generic / stop terms shared by all routers.
 *
 * `mode` controls the stop set:
 * - `'metadata'` (default) is the metadata-route scoring stop list,
 *   unchanged. That list directly drives metadata-route scoring (generic
 *   terms contribute at 15% weight and do not count toward distinctive
 *   matches).
 * - `'dci'` is the broader snippet-line stop set originally local to
 *   dci.ts: the metadata list PLUS common English stop words
 *   (`the`/`and`/`for`/`with`) PLUS short Latin tokens (<=2 chars). DCI
 *   snippet scoring uses substring matching for query terms, so without
 *   this broader set, substring-matched stop fragments would contribute
 *   full distinctive weight and push irrelevant lines ahead of real
 *   evidence.
 */
export function isGenericTerm(term: string, mode: GenericTermMode = "metadata"): boolean {
  if (METADATA_GENERIC_TERMS.has(term)) return true;
  if (mode === "dci") {
    if (DCI_SNIPPET_EXTRA_GENERIC_TERMS.has(term)) return true;
    if (term.length <= 2 && /^[a-z0-9]+$/.test(term)) return true;
  }
  return false;
}

function collectTerms(prepared: string, tokenRe: RegExp, splitRe: RegExp): Set<string> {
  const terms = new Set<string>();

  for (const match of prepared.matchAll(tokenRe)) {
    const token = match[0];
    if (token.length >= 2) terms.add(token);
    for (const part of token.split(splitRe)) {
      if (part.length >= 2) terms.add(part);
    }
  }

  for (const match of prepared.matchAll(CJK_RUN_RE)) {
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
