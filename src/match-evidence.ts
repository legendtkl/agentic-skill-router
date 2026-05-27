/**
 * Shared evidence shape used by all three routers (metadata-route, corpus
 * search, DCI snippet/metadata search).
 *
 * Each router still computes its own scoring math — this module only shares
 * the *vocabulary* used to explain why a candidate matched. The goal is to
 * stop the three router result envelopes from drifting: a downstream JSON
 * consumer can iterate over `result.matches[].evidence` from any of the
 * routers without per-router special-casing.
 *
 * `field` is left open as a string because each router has its own field
 * vocabulary (metadata-route exposes structured metadata field names like
 * `alias`/`tool`/`intent`; corpus search exposes `id`/`name`/`description`
 * plus aggregated `aliases`/`tools`/etc; DCI exposes `body` and metadata
 * pseudo-fields). The four canonical values (`name`, `id`, `description`,
 * `body`) are surfaced explicitly so consumers can switch on them without
 * losing type safety, while still accepting router-specific field names.
 *
 * `source` distinguishes evidence that came from a skill's structured
 * metadata (frontmatter, name, description, id, aliases, tools, etc.) from
 * evidence that came from a free-text scan of the SKILL.md body. DCI
 * surfaces both, depending on whether `--metadata-only` was passed.
 *
 * `contribution` is the router-local weighted score contribution. It is
 * intentionally not normalized across routers (metadata-route and the
 * weighted corpus ranker share field weights; BM25 produces unbounded
 * scores; DCI snippet scoring is per-line) — consumers should treat it as
 * a *relative* signal within a single router's match list, not a number
 * that can be compared across routers.
 *
 * Legacy fields `weight` and `text` are kept optional so existing
 * metadata-route consumers (notably `tests/metadata-route.test.ts`, which
 * asserts on `e.text`) continue to work. New router emitters should set
 * `weight` when they have a meaningful per-field weight, and `text` when
 * they have a longer human-readable excerpt distinct from `matched`.
 */
export interface MatchEvidence {
  /**
   * The field the match came from. Canonical values are `name`, `id`,
   * `description`, and `body`; routers may also surface their own
   * structured field names (e.g. `alias`, `tool`, `intent`, `tag`).
   */
  field: "name" | "id" | "description" | "body" | string;
  /** The token, phrase, or value text that produced the match. */
  matched: string;
  /**
   * True when `matched` is a generic / stop term (see {@link isGenericTerm}
   * in `text-match.ts`). Generic matches are still surfaced so consumers
   * can show them, but they should be down-weighted in any consumer-side
   * ranking.
   */
  isGeneric: boolean;
  /**
   * Router-local weighted score contribution. Comparable within a single
   * router's match list; not comparable across routers.
   */
  contribution: number;
  /**
   * Where the match came from. `metadata` covers any structured metadata
   * field (frontmatter, id, name, description, aliases, tools, …); `body`
   * covers free-text scans of the SKILL.md body.
   */
  source: "metadata" | "body";
  /**
   * Optional per-field weight. Surfaced by routers that have a meaningful
   * weight to expose (metadata-route, weighted corpus ranker). Omitted by
   * routers that score in a different unit (BM25, DCI snippet count).
   */
  weight?: number;
  /**
   * Optional human-readable excerpt of the matched text. Kept for
   * back-compat with the pre-issue-#109 metadata-route shape; new emitters
   * may omit it when `matched` already conveys the full context.
   */
  text?: string;
}
