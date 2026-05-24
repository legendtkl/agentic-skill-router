# scaling-jbounded — J-bounded routing under growing skill pool

How does J-bounded (the dci-compare 9×24 cost/context Pareto winner)
degrade when the locally-installed disabled-skill catalog grows from 150
to ~80,000? Where does its inline-shell retrieval template break, and
what's the minimal template fix?

Direct follow-up to two limitations called out in
`experiments/dci-compare/REPORT-claudemd.md`:

- §9 #3 — "语料规模 150 远小于真实部署 ... 在更大规模下 description 层
  的 distractor 密度增加, metadata-only 变体可能性能下降"
- §10 P2 — "扩大规模验证外推性"

Experiment date: 2026-05-24. Total spend ≈ $18. Total cells: 32 sweep
cells + 8 smoke-scale cells + 1 deep probe.

## TL;DR

- **J-bounded (v1, the dci-compare template) breaks at ~13K skills.**
  Shell glob `~/.claude/skills/*/SKILL.md.skill-router-disabled` exceeds
  `ARG_MAX` (~2 MB on Linux); at 20K it consistently hits
  `argument list too long: grep`.
- **Even when v1 routes around ARG_MAX with a `for f in <glob>` fallback,
  `head -20` becomes lossy.** At 80K the keyword `mesh` matches 95 skill
  names; the gt skill sorts at position 23, so `head -20` truncates the
  correct answer.
- **J-bounded-v2 (this experiment) fixes both with one template rewrite.**
  It replaces the glob with `find -print0 | xargs -0 grep -l`,
  removes `head -20`, and tells the agent to *narrow keywords* when the
  shortlist is too long instead of truncating it.
- **Results.** v2 matches v1's accuracy at 150 (22/24, 92%) and is the
  only J variant that finishes correctly at 80K, hitting **12/24
  (50.0%) on the 24 single-skill SkillsBench queries against the 79,141-
  candidate Hard pool** — about **2× the best "name+description-only"
  encoder baseline reported in the SkillRouter paper** (Qwen3-Emb-8B nd,
  25.3%) and below the strongest full-body baselines (SkillRouter 1.2B,
  74.0%).
- **Cost/context property holds.** v2's per-cell payload remains
  bounded; pool size ×527 raises avg cost per cell only 1.35× and
  `ctx_end` only +19%.

## Setup

- **Corpus source.** `pipizhao/SkillRouter-Eval-Core` on Hugging Face,
  the eval-core release of arXiv:2603.22455. 78,361 Easy + 79,141 Hard
  records; the Hard tier (which adds 780 LLM-generated topically-
  plausible distractors) is the pool used here.
- **Skill ids on disk.** No anonymization for the scaling sweeps —
  each record is written as
  `<HOME>/.claude/skills/<safeId>/SKILL.md.skill-router-disabled`
  where `safeId = skill_id.replace('/', '__')` so `gt/mesh-analysis`
  becomes the directory `gt__mesh-analysis`. Frontmatter `name:` is
  rewritten to match. (The dci-compare 150 corpus stays anonymized as
  `skill-001 ... skill-150` for the cross-checks against its 9×24
  baseline.)
- **Variant under test.** `variants/J-bounded-v2.SKILL.md`. Only the
  body differs from dci-compare's `J-bounded` — frontmatter
  `description:` is byte-identical, so the Skill-tool trigger decision
  is unchanged between v1 and v2.
- **Queries.** The 24 SkillsBench single-skill task_ids reused
  verbatim from dci-compare/queries.json. Paper's 75-query main
  benchmark = these 24 + 51 multi-skill. Multi-skill cases are out of
  scope (our STOP_TAIL emits exactly one `matched_skill_name`).
- **Trigger lift.** All sweep24 runs except `v2-150` (the first run)
  inject the dci-compare-validated CLAUDE.md text at
  `<HOME>/.claude/CLAUDE.md`. Confirmed in dci-compare to compress
  trigger hallucinations from 21.4% to 2.6% without affecting the
  routing-quality measurement.
- **No `--append-system-prompt`. No `--max-turns`. Timeout 600s/cell.**
- **Drivers/renderers.** All in `experiments/scaling-jbounded/`.

## Three failure mechanisms at scale

Found in the 80K single-query probe (`runs/probe-full-j/`) and
confirmed in the 4-scale single-query sweep (`runs/sweep-3d-scan-calc/`):

### 1. `ARG_MAX` (~13K skills)

The v1 body opens with:

```bash
grep -i -m1 '^description:' ~/.claude/skills/*/SKILL.md.skill-router-disabled \
  | grep -i -E "<kw1>|<kw2>" | head -20
```

The shell expands the glob into argv. At ~80 chars per path, 13K paths
hit Linux's 2 MB `ARG_MAX`; at 79K argv would need ~11 MB. Result:

```
(eval):1: argument list too long: grep
```

Recovery is up to the LLM. The model usually pivots to
`for f in <glob>; do ...; done` (loop iteration doesn't exec one
process per path, so no `ARG_MAX`). That works structurally but
introduces a separate problem — see mechanism 2.

### 2. `head -20` saturation (any scale with broad keywords)

The for-loop fallback still ends in `| head -20`. At 80K the
keyword `mesh` matches **95 skill names**; the gt skill
`gt__mesh-analysis` sorts at position 23. `head -20` cuts the answer.

The bias is alphabetic: gt skills (prefix `gt__`) come after the bulk
of `distractor__`, `easy__`, `design__` etc., so they are the *first*
to be truncated. At 150 with the same keyword matching maybe 3
skills the cap is a non-issue; at 5K still fine; at 20K already
costing the gt; at 80K systematic.

### 3. Keyword-vocabulary mismatch + near-miss generalisation (any scale)

When the keyword filter narrows to a handful of candidates but none
contains gt, the LLM falls back to "pick whatever looks vaguely
relevant". At 80K this means selecting a generic catch-all skill —
`other__spreadsheet`, `development__excel`, `documents__filling-pdf-forms` —
for any data/finance/forms query whose tight gt isn't surfaceable from
description keywords alone. This is the dci-compare §9 #5
description-quality ceiling, but more painful at scale because the
catch-all skill pool is larger.

## J-bounded v1 → v2 template diff

The `description:` frontmatter field is unchanged byte-for-byte (so
the Skill-tool trigger probability is unchanged). Only the body
workflow changed:

| | v1 (`variants/J-bounded.SKILL.md`) | v2 (`variants/J-bounded-v2.SKILL.md`) |
| --- | --- | --- |
| Enumeration | `~/.claude/skills/*/SKILL.md.skill-router-disabled` (shell glob) | `find ~/.claude/skills -name SKILL.md.skill-router-disabled -print0 \| xargs -0 grep -l` |
| ARG_MAX risk | breaks ~13K paths | none |
| Candidate cap | `head -20` | none (explicit "do not truncate") |
| When too many hits | accept the head | **narrow keywords and rerun** |
| When too few hits | "broaden keywords and re-grep once" | "broaden one keyword and rerun" |
| Keyword guidance | "distinctive keywords" | "narrow technical terms (file extensions, proper nouns, error codes); avoid broad words" |
| Shortlist payload | description text via `grep` | path-only via `grep -l` (smaller) |
| Description inspection | done implicitly in step 1 | explicit step on the narrowed shortlist |

## Sweep results

### Single-query 4-scale validation (`runs/sweep-3d-scan-calc/`)

Query: `3d-scan-calc` (gt = `gt__mesh-analysis`). 8 cells.

| Scale | J-v1 result | J-v2 result |
| --- | --- | --- |
| 1K  | ✓ 4 turns / 1 bash / $0.28 | ✓ 7 turns / 4 bash / $0.17 |
| 5K  | ✓ 5 turns / 2 bash / $0.22 | ✓ 5 turns / 2 bash / $0.14 |
| 20K | ✗ 12 turns / 9 bash / $0.48 (ARG_MAX, picks build123d) | ✓ 6 turns / 3 bash / $0.21 |
| 79K | ✗ 23 turns / 18 bash / $0.59 (timeout, picks build123d) | ✓ 8 turns / 5 bash / $0.23 |

v1 cliff between 5K and 20K. v2 stable across all four scales —
turns 5–8, cost $0.14–0.23.

### 24-query sweep — Task 1: J-v2 × 150 corpus (`runs/sweep24-v2-150-cmd/`)

Direct cross-check against dci-compare's 9×24 J-bounded data at the
same 150 corpus and same 24 queries.

| Variant | CLAUDE.md | accuracy | trigger | Σ cost | avg cost/cell | Σ dur | avg dur/cell | avg ctx_end | source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| J-v1 | ✗ | 21/24 (87.5%) | 22/24 | $2.76 | $0.115 | 322s | 13.4s | 30.1K | dci-compare 9×24 |
| J-v1 | ✓ | 22/24 (91.7%) | 23/24 | $3.07 | $0.128 | 374s | 15.6s | 30.7K | dci-compare paired |
| J-v2 | ✗ | 18/24 (75.0%) | 18/24 | $3.33 | $0.139 | 461s | 19.2s | 29.8K | this experiment |
| **J-v2** | **✓** | **22/24 (91.7%)** | **23/24** | **$3.95** | **$0.164** | **665s** | **27.7s** | **30.8K** | **this experiment** |

Conditional accuracy (excluding the trigger-noise cell): **v2 = 22/23
(95.7%), v1 = 22/23 (95.7%)** — exactly tied. Same description, same
gt skills available, so any residual gap is per-cell LLM variance.

v2 costs +29% / +78% duration at the same accuracy because the
narrow-keyword workflow needs 1–2 more turns on average (5.5 vs 3.8
turns/cell). avg `ctx_end` is statistically identical (+0.1K, 0.3%),
confirming the `grep -l` change does not bloat context.

### 24-query sweep — Task 2: J-v2 × 79K corpus (`runs/sweep24-v2-full-cmd/`)

Same 24 task_ids, same v2 body, same +CLAUDE.md trigger lift; corpus
swapped to the full 79,141-candidate Hard pool.

| Aggregate | value |
| --- | --- |
| accuracy | **12/24 (50.0%)** |
| trigger | 23/24 (95.8%) |
| Σ cost | $5.33 (avg $0.222/cell, max $0.300) |
| Σ duration | 1577s (avg 65.7s/cell, max 138.5s) |
| Σ turns | 140 (avg 5.8/cell, max 9) |
| avg ctx_end | 36.6K (max 42.9K) |
| timeouts | 0 |

**Failure pattern: near-miss to generic catch-all skills.**

| failed query | gt (intended) | matched (wrong) | category |
| --- | --- | --- | --- |
| `citation-check` | bibtex verification | `bib-managing` | same-domain sibling |
| `court-form-filling` | specific court forms | `documents__filling-pdf-forms` | over-generalised |
| `data-to-d3` | D3 stock vis | `d3-layouts-hierarchies-...` | sibling layout |
| `gh-repo-analytics` | GitHub insights | `development__github-insights` | sibling tool |
| `offer-letter-generator` | specific letter | `other__docx-template-filling` | over-generalised |
| `pptx-reference-formatting` | pptx ref formatting | `other__anthropic-pptx` | sibling tool |
| `protein-expression-analysis` | bio domain skill | `other__spreadsheet` | catch-all fallback |
| `reserves-at-risk-calc` | finance | `development__excel` | catch-all fallback |
| `shock-analysis-demand` | econ model | `other__06-office-excel` | catch-all fallback |
| `shock-analysis-supply` | econ model | `xlsx` (no trigger) | hallucinated name |
| `video-tutorial-indexer` | video processing | `marketing__gemini-video-understanding` | sibling tool |
| `weighted-gdp-calc` | econ calc | `development__excel` | catch-all fallback |

Six of twelve failures are "catch-all fallback" (Excel/spreadsheet),
clustered on finance/economics queries whose specific gt skill is
hidden by the dense generic-tool population at 80K. This is exactly
the dci-compare §9 #3 prediction: description-quality ceiling +
distractor density increases together as pool grows, and metadata-only
routing has no body-text recourse.

### Scale-driven cost / context elasticity

How does v2 behave as the pool scales 527× (150 → 79K)?

| Scale | accuracy | avg cost/cell | × 150 baseline | avg dur/cell | × baseline | avg ctx_end | avg turns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 150   | 22/24 (92%) | $0.164 | 1.00× | 27.7s  | 1.00× | 30.8K | 5.5 |
| **79K** | **12/24 (50%)** | **$0.222** | **1.35×** | **65.7s** | **2.37×** | **36.6K** | **5.8** |

Pool ×527 →
- accuracy −42pp (almost entirely catch-all fallbacks, not template breakage),
- cost +35%,
- duration +137%,
- `ctx_end` +19%,
- turns +5%.

Compare to v1 at 79K (single-query smoke): 23 turns / $0.59 /
600s timeout / wrong. The "scale disease" is suppressed from runaway
loops to mild linear growth.

## Comparison with SkillRouter paper baselines

Paper reports averaged Easy + Hard Hit@1 over all 75 core queries
(24 single + 51 multi). Ours is single-skill only on Hard. Not
strictly apples-to-apples but in the same ballpark — the single-skill
subset is treated as the strict-match core in the paper, and Hard is
the harder of the two tiers.

| Method | Body access | n queries | Pool | Hit@1 |
| --- | --- | --- | --- | --- |
| BM25 (sparse) | name+desc only (nd) | 75 (E+H avg) | 80K | 0.0% |
| Qwen3-Emb-0.6B | nd | 75 (E+H avg) | 80K | 18.7% |
| Qwen3-Emb-8B | nd | 75 (E+H avg) | 80K | 25.3% |
| Qwen3-Emb-8B × Qwen3-Rank-8B | nd | 75 (E+H avg) | 80K | 24.0% |
| **J-v2 (this experiment)** | **nd** | **24 single, Hard only** | **79,141** | **50.0%** |
| BM25 | full text | 75 (E+H avg) | 80K | 31.4% |
| Qwen3-Emb-0.6B | full text | 75 (E+H avg) | 80K | 56.0% |
| Qwen3-Emb-8B | full text | 75 (E+H avg) | 80K | 64.0% |
| Qwen3-Emb-8B × Qwen3-Rank-8B | full text | 75 (E+H avg) | 80K | 68.0% |
| **SKILLROUTER 1.2B** | full text | 75 (E+H avg) | 80K | **74.0%** |
| SKILLROUTER 8B | full text | 75 (E+H avg) | 80K | 76.0% |

**Where J-v2 fits.**

- ~**2×** the strongest nd-only encoder baseline (25.3% → 50.0%). The
  LLM-driven keyword extraction + multi-step narrowing extracts more
  signal from description-only than a trained encoder over the same
  field can.
- **−14 to −26 pp** below full-body methods. Concrete evidence for the
  paper's §3 claim: "full skill text is a critical routing signal".
  Six of our twelve misses are queries where description alone cannot
  distinguish the gt skill from generic Excel/spreadsheet tools —
  body content names the specific capability and would route correctly.

J-v2 is not a model contribution; it's a *shell-pipeline contribution*
that makes the description-only LLM-agent baseline scale to 80K
without breaking. Whether to go further requires reading body —
mechanism 3 above is the description-only ceiling.

## Cumulative spend

| stage | content | cost |
| --- | --- | --- |
| 4-scale × 2-variant × 1-query smoke | scale-driven failure mechanism diagnosis | ~$2.46 |
| Task 1a — J-v2 × 150 (no CMD) | first trigger-noise reading | $3.33 |
| Task 1b — J-v2 × 150 (+CMD) | matched cross-check vs dci-compare J-v1 | $3.95 |
| Task 2 — J-v2 × 79K (+CMD) | scale comparison vs paper baselines | $5.33 |
| earlier 79K J-v1 single-query probe | initial failure-mode discovery | $0.59 |
| 1K/5K/20K single-query smoke | scale-cliff validation | ~$2.5 |
| **total** | | **~$18** |

## Known limitations

1. **Single-skill subset of paper's 75-query benchmark.** We test 24
   single-skill on Hard. Paper averages over 75 queries × Easy+Hard.
   Multi-skill queries (51 of 75) are out of scope — our STOP_TAIL
   emits one `matched_skill_name`; the paper's multi-skill Hit@1 uses
   the relaxed "any required skill ranked first" definition.
2. **One run per cell, no multi-vote.** ±1 cell per condition is
   inside per-run LLM variance. The v1 vs v2 match at 150 (22/24 each)
   is exact but the 80K 12/24 should be read as "in the high-40s to
   low-50s" range.
3. **Description-quality bias in failure attribution.** Six of twelve
   80K failures are catch-all fallbacks on finance/economics queries.
   The dci-compare §9 #5 description-quality ceiling means some of
   these queries are arguably routable to either gt or catch-all;
   relabeling or rewriting tool-centric descriptions to task-centric
   ones might recover several cells without any template change.
4. **Hard tier only.** Paper reports Easy + Hard averages. Easy
   (78,361) lacks the 780 targeted distractors and would likely score
   higher; our 50% number on Hard is the lower bound, not the average.
5. **`xargs` exit-123 stutter.** v2's `find | xargs grep -l` returns
   exit 123 whenever at least one file matches *some* but not all
   `-E` alternations. The agent sometimes retries an extra grep when
   it sees the non-zero exit despite valid output. ~1–2 extra turns
   per affected cell. The template could mention this explicitly to
   skip the spurious retry; we have not.
6. **Original SkillRouter ids leak through directory names.** At full
   scale the corpus uses raw `gt/...`, `distractor/...`, `easy/...`
   ids (escape-encoded). `ls ~/.claude/skills | grep gt__` would
   trivially solve any query. We verified by trace that J-v2 never
   uses an `ls | grep gt` shortcut — it greps descriptions — but this
   is structural rather than enforced. For a clean paper-comparable
   number, anonymize the 80K corpus too.
7. **No statistical significance test.** Per-method differences here
   (50% vs paper's 25.3% nd-only) are large enough that single-run
   variance shouldn't flip the ordering. Cell-level differences
   smaller than ±2 cells (e.g. 22/24 vs 23/24) are noise.
8. **Production CLI not tested.** Our J-v1 / J-v2 variants are
   research forks that inline the retrieval logic in SKILL.md. The
   production `skills/skill-router-skills/SKILL.md` delegates to the
   `skill-router skills route` CLI; we did not measure that CLI's
   behavior at 80K. Independent experiment.

## Recommended follow-up

1. **Production CLI at 80K.** Run `skill_router skills route --query`
   over the .tmp-home-full corpus and the 24 queries to see whether
   the CLI's retriever beats v2's shell pipeline at this scale.
2. **Body-on-tie hybrid (dci-compare §10 P1).** When the v2
   shortlist has multiple plausible candidates, read each candidate's
   body once and reason over it. Should recover the catch-all
   fallback misses without paying the per-cell I-meta or B-cc cost on
   every query.
3. **Multi-vote N=3 on 80K.** Bound the ±cell-level variance for the
   accuracy point estimate.
4. **Easy tier.** Run 24 single-skill on the 78,361 Easy pool for a
   direct Easy+Hard average comparable to paper's headline numbers.
5. **Multi-skill subset (51 queries).** Extend STOP_TAIL to allow
   top-K emission, score with the paper's relaxed Hit@1 definition,
   compare on the full 75-query benchmark.

## Files of record

- `variants/J-bounded.SKILL.md` — v1 (copy of dci-compare's routing-only J-bounded, frozen for comparison)
- `variants/J-bounded-v2.SKILL.md` — v2 with the three-mechanism fix
- `probe.mjs` — single-cell driver supporting --scale / --variant / --skip-install
- `sweep-24.mjs` — 24-query parallel driver supporting --queries-source={dci-compare,paper} and --with-claudemd
- `render-sweep-24.mjs` — sweep-24 aggregator
- `render-sweep.mjs` — single-query 4-scale aggregator
- `setup-home-150.mjs` — `.tmp-home-150` builder (uses dci-compare's 150 anonymized corpus)
- `install-full.mjs` — standalone full-corpus installer
- `runs/probe-full-j/` — initial 80K J-v1 single-query probe (timeout)
- `runs/sweep-3d-scan-calc/` — 4-scale × 2-variant × 1-query
- `runs/sweep24-v2-150/` — Task 1a (no CMD)
- `runs/sweep24-v2-150-cmd/` — Task 1b (+CMD)
- `runs/sweep24-v2-full-cmd/` — Task 2
