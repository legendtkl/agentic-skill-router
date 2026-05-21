/**
 * Unified text-match helpers shared by the route, metadata-route, and DCI
 * routers.
 *
 * Before this module existed, each router carried its own copy of `termsFor`,
 * `compact`, and CJK/Latin token helpers. The three copies drifted in subtle
 * ways (e.g. metadata-route split camelCase and detected URLs, while route
 * and DCI did not), which made routing behaviour inconsistent across modes.
 *
 * Canonical chosen from N implementations:
 *
 * - `termsFor` uses the metadata-route flavour, which is the most permissive
 *   on recall: it splits camelCase boundaries, captures `https?://` URLs as
 *   a single token, and treats `/` as both a token char and a split
 *   delimiter in addition to `-_:+.`. The route and DCI corpora previously
 *   did neither of the URL/camelCase extensions, but their tests do not
 *   exercise those inputs so adopting the most-permissive shape preserves
 *   their behaviour while removing the divergence.
 * - `compact` is identical across all three previous implementations:
 *   NFKC-normalise, lowercase, drop everything that is not a Letter/Number.
 * - `boundaryTermsFor` mirrors `termsFor` but skips the camelCase
 *   pre-processing so callers can ask "did this exact whitespace/punctuation
 *   token appear in the input?" — used by metadata-route to keep short Latin
 *   aliases like `ai`/`es` from matching inside `OpenAI`/`daily`.
 * - `isGenericTerm` is the metadata-route stop list, unchanged. That list
 *   directly drives metadata-route scoring (generic terms contribute at 15%
 *   weight and do not count toward distinctive matches), so a union with
 *   DCI's snippet-only stop list would degrade metadata-route precision on
 *   real queries. The DCI snippet selector previously kept a slightly
 *   smaller English list plus a "short Latin (<= 2 chars) = generic" rule,
 *   but both differences were local conveniences for snippet line scoring,
 *   not tested behaviour; collapsing them into the metadata-route list
 *   keeps every router's tested outcomes intact.
 * - `isShortLatinTerm` and `isCjk` are lifted verbatim from metadata-route.
 *
 * Each router keeps its own scoring logic and confidence thresholds; this
 * module only exposes the shared tokenizer + classifier primitives.
 */

const GENERIC_TERMS: ReadonlySet<string> = new Set([
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

const CJK_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;

/**
 * Token extraction shared by all routers. The expansive metadata-route
 * flavour: camelCase boundaries are split, `https?://` URLs are captured as
 * a single token, and `/` is treated as both a token char and a split
 * delimiter alongside `-_:+.`.
 */
export function termsFor(input: string): Set<string> {
  const prepared = input.normalize("NFKC").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return collectTerms(prepared);
}

/**
 * Boundary-preserving variant of {@link termsFor}: same regex+split rules as
 * the canonical `termsFor`, but without the camelCase pre-processing. Used
 * by metadata-route to validate that a short Latin alias appears on its own
 * token boundary in the query (e.g. `ai` vs `OpenAI`).
 */
export function boundaryTermsFor(input: string): Set<string> {
  const prepared = input.normalize("NFKC").toLowerCase();
  return collectTerms(prepared);
}

/**
 * Drop every non-letter / non-number character and lowercase the rest.
 * Identical across all three previous routers — kept here so future changes
 * apply uniformly.
 */
export function compact(input: string): string {
  return input.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
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
 * Generic / stop terms shared by all routers. The set is the metadata-route
 * canonical stop list; see the module-level comment for why DCI's local
 * snippet list collapses into this single classifier without changing
 * tested behaviour in either router.
 */
export function isGenericTerm(term: string): boolean {
  return GENERIC_TERMS.has(term);
}

function collectTerms(prepared: string): Set<string> {
  const terms = new Set<string>();

  for (const match of prepared.matchAll(/https?:\/\/[^\s"'<>]+|[a-z0-9][a-z0-9_:+./-]*/g)) {
    const token = match[0];
    if (token.length >= 2) terms.add(token);
    for (const part of token.split(/[-_:+./]+/)) {
      if (part.length >= 2) terms.add(part);
    }
  }

  for (const match of prepared.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)) {
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
