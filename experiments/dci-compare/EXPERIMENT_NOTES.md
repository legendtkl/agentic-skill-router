# DCI Routing-Only Bench — Status & Known Issues

A study of routing strategies for Claude Code Agent Skills over a large
locally-installed disabled-skill catalog. The question: what is the cheapest /
most accurate way to pick a disabled skill before reading any body?

## Setup

- **Corpus**: 150 disabled Agent Skills cropped from the SkillRouter eval-core
  dataset (arXiv:2603.22455). All skill identifiers are opaque `skill-NNN`;
  the agent only sees neutral ids + `description:` + body. Mapping to the
  original sources is in `corpus-manifest.json` (used for analysis only).
- **Queries**: 24 single-skill SkillsBench tasks (queries.json). Each has a
  known ground-truth `skill-NNN`.
- **Variants** (9; F-index dropped):
  - `G-native` — Claude Code's native Skill auto-select. Corpus is ENABLED;
    no skill-router plugin loaded.
  - 8 router variants (A-router, B-cc, C-lite, D-agentic, E-digest,
    H-bounded, I-meta, J-bounded) — corpus DISABLED, skill-router plugin
    loaded, `--plugin-dir` set; the plugin's `skill-router-skills` SKILL.md
    is swapped per cell to `variants/routing-only/<variant>.SKILL.md`.
- **Alignment**:
  - All 8 router variants share **the same `description:`** field
    (verified: identical md5 across variants/routing-only/*.SKILL.md). The
    description only TRIGGERS the Skill tool — it does not hint at body
    load, JSON emit, or task execution.
  - Each variant's identity lives entirely in the SKILL.md body's routing
    workflow.
  - The previous "ROUTING BENCHMARK — emit JSON and stop" block has been
    stripped from every router variant body (production-ized).
- **Stop semantics**: a `STOP_TAIL` is appended to every query asking the
  agent to emit `{"matched_skill_name":"<skill-id>"}` and stop. The required
  output field is name-only (no path) so native zero-shot doesn't end up in
  a `find /` filesystem scan.
- **No `--append-system-prompt`. No `--max-turns`.** Timeout 240s per cell.
- **Cell isolation in parallel mode**: 9 per-variant HOMEs at
  `.tmp-home-parallel/<variant>/`, copied from `.tmp-home`. Corpus state
  and plugin SKILL.md are set once per HOME and never toggled mid-run.
  Concurrency cap defaults to 4 to keep API pressure bounded.

## Drivers / renderers

- `routing-only-9x3.mjs` — serial 9 × 3 query bench (initial sanity).
- `routing-only-parallel.mjs` — parallel 9 × 24 with per-variant HOMEs.
- `render-routing-only-9x3.mjs`, `render-routing-only-9x24.mjs` — HTML
  renderers.
- `routing-only-bench.mjs` — first 3-query routing-only probe used to
  validate the STOP_TAIL approach with native + J.
- `routing-only-probe.mjs` — single-query probe (kept for ad-hoc reruns).
- `e2e-native.mjs`, `e2e-j.mjs`, `e2e-multi.mjs` — end-to-end probes (run
  past the routing decision to verify the matched skill body can execute).
- `variants/` — original A–J SKILL.md (benchmark + production J kept for
  reference). `variants/routing-only/` — aligned routing-only variants
  used by these new drivers.
- `runs/routing-only-9x24/` — final dataset (216 cells). `summary.json` and
  `report.html` are committed; per-cell `*.jsonl` transcripts are
  gitignored (reproducible from drivers).

## Results (9 × 24 = 216 cells, 0 timeouts, ~$34 spend)

| variant | accuracy | trigger rate | Σ turns | Σ duration | Σ cost | avg ctx_end |
| --- | --- | --- | --- | --- | --- | --- |
| C-lite | 23/24 (96%) | 24/24 | 154 | 544s | $4.18 | 32.0K |
| I-meta | 23/24 (96%) | 23/24 | 93 | 390s | $3.92 | 37.6K |
| D-agentic | 22/24 (92%) | 23/24 | 104 | 428s | $3.62 | 34.5K |
| **J-bounded** | **21/24 (88%)** | **22/24** | **92** | **322s** | **$2.76** | **30.1K** |
| B-cc | 20/24 (83%) | 23/24 | 221 | 1035s | $5.79 | 33.8K |
| E-digest | 17/24 (71%) | 20/24 | 84 | 302s | $3.47 | 36.0K |
| H-bounded | 17/24 (71%) | 20/24 | 119 | 499s | $3.67 | 32.1K |
| G-native | 15/24 (62%) | n/a (zero-shot) | 24 | 132s | $2.88 | 36.1K |
| A-router | 11/24 (46%) | 24/24 | 101 | 448s | $4.08 | 35.9K |

### Pareto observations

- **J-bounded** is the cost / context Pareto winner — 88% acc, lowest cost
  ($2.76), lowest ctx_end (30.1K). Keyword-filtered grep over metadata
  keeps both per-call payload and final context tight.
- **C-lite / I-meta** tie for accuracy ceiling (96%). C-lite pays it in
  turns (154); I-meta pays in ctx_end (37.6K, since it dumps the whole
  150-skill catalog every query).
- **B-cc** (free shell) is the most expensive variant at $5.79 / 221 turns
  but does NOT beat the more constrained C-lite or J-bounded on accuracy.
  Unbounded shell exploration is a cost trap.
- **G-native** zero-shot accuracy drops to 62% on the full 24-query set
  (much lower than the 3-query subset hinted). Claude's attention-based
  skill auto-select degrades on a catalog this large.
- **A-router** at 46% is the worst. Its CLI scoring (skill-router internal
  retriever) doesn't generalize to the broader query set as well as
  metadata-only or DCI shells do.

## Known Issues / Limitations

### 1. Trigger noise — independent random variable

The `natural_trigger_rate` column above is NOT 24/24 for every variant.
That's because triggering the router Skill tool is an LLM decision
influenced by the SKILL.md description, but **also by per-query
randomness**. Concrete failures we observed in J vs I:

- **pptx-reference-formatting**: J emitted `{"matched_skill_name":"pptx"}`
  with 0 tool calls (no routing happened). The matched-name is a query
  keyword the model hallucinated as a skill id. I-meta on the same query
  triggered normally and returned `skill-140` ✓.
- **protein-expression-analysis**: same shape — J 0 tools / `"xlsx"`;
  I-meta 4 turns / `skill-105` ✓.
- **gh-repo-analytics**: J triggered (5 turns, 3 tool_use) and chose
  `skill-046` (a reasonable alternative — see Issue 5). I-meta on the same
  query did NOT trigger (0 tools, hallucinated `"github-cli-analytics"`).

All 8 router variants share the **same description**. The trigger
decision is independent per cell, so J vs I differences aren't description
strength — they're per-call variance. About 8–12% of "wrong" cells in
the 24-query set are trigger noise rather than retrieval failure.

### 2. No statistical significance

24 queries × 9 variants is a small grid. Accuracy is integer-out-of-24;
the gap between J (21) and C/I (23) is 2 cells, well within trigger-noise
range. No random-pick baseline was actually run (theoretical 1/150 =
0.67% — far below all variants, so the relative ordering is sound, but
absolute numbers are noisy).

### 3. Single-run variance

Every cell is one `claude -p` invocation. No multi-run majority vote, no
seed control (the API doesn't expose one). Re-running could produce
different cells flipping between right/wrong, especially the boundary
queries.

### 4. Cost estimate fallback hardcoded

When `result.total_cost_usd` is missing (e.g. on timeout) the renderer
estimates cost using Opus-4.7 list prices baked into a lookup table. The
actual session model is read from `system.init.model`; new model ids will
fall back to a generic default. If pricing tiers shift, the fallback
column lies. Marked with `*` in the report.

### 5. Description-quality ceiling for metadata-only routing

The one query I-meta got wrong (gh-repo-analytics) wasn't because body
content was needed. The skill description for the gt skill is
**tool-centric**: `"The gh CLI is GitHub's official command line tool..."`
while the query is **task-centric**: `"prepare a December community pulse,
gather PRs, count, top contributor..."`. The vocabulary doesn't overlap.
A different skill (`skill-046`, `"Track and visualize GitHub
contributions, insights on commits, PRs, issue resolutions over time"`)
matches the query semantics MUCH better — which is exactly what J
chose. The "wrong" answer per SkillRouter's ground truth is arguably the
better routing decision in practice. Body content wouldn't fix this; it's
a description-writing issue at the corpus level.

### 6. Bash pipe filter sandbox quirk

In the J-bounded run on gh-repo-analytics, the first grep's
inner-filter pipe **did not apply** in the Bash tool result we received
back (the result was the first 20 unfiltered skills, skill-001 through
skill-020). The exact same command run manually outside the Claude Code
Bash tool filters correctly to 14 matches. We don't yet have a
reproducer; could be sandbox-specific shell handling. Worth investigating
before any cost-sensitive bash-heavy variant (B, C, H) is over-trusted.

### 7. End-to-end (post-routing execution) only validated on J + 1 query

Routing-only metrics don't prove that downstream task execution would
succeed. We validated the full chain (`Skill → grep → Read body →
execute → write output`) only for J-bounded on dialogue-parser, and a
3-query e2e on J + native. The other 7 variants only have routing
data — we have not confirmed their downstream `Read body + execute`
behavior under no-system-prompt.

### 8. `.tmp-home-parallel/<variant>/` left on disk

The parallel driver does NOT clean up `.tmp-home-parallel/` after the
run, intentionally — useful for forensic inspection of which corpus state
each variant saw. They are gitignored. Currently ~440 MB total. Delete
them manually before re-running if disk is tight.

### 9. Trigger noise vs `--append-system-prompt` baseline missing

We removed `--append-system-prompt` to test "natural deployment" trigger
behavior. We did NOT also run the same 9 × 24 with `--append-system-prompt`
to isolate trigger noise from routing accuracy. With the system prompt
forcing a Skill-first invocation, trigger rate would be ≈100% across
variants and the gap between J/C/D/I and others would tighten or shift.
That's the next experiment.

### 10. F-index excluded but file kept

The F-index variant (pre-baked corpus index embedded in the SKILL.md body)
is part of the original 10-variant set but excluded from this routing-only
study. Its SKILL.md is still in `variants/F-index.SKILL.md` for
reference; there is no `variants/routing-only/F-index.SKILL.md`.

## Recommended next steps

1. Re-run a smaller 3 × 9 grid with `--append-system-prompt` to measure
   true routing accuracy with trigger noise removed; compare to current
   numbers to quantify the noise floor.
2. Repeat 9 × 24 once (best-of-2) to compress per-cell variance.
3. Verify end-to-end execution for at least one router variant beyond J
   (e.g. C-lite or I-meta given they hit highest accuracy).
4. Investigate the Bash pipe filter behavior on gh-repo-analytics — repro
   in a controlled probe, file an issue if real.
5. Rewrite tool-centric descriptions in the corpus (skill-021, similar) to
   task-centric phrasing and re-run to see whether description quality is
   the actual bottleneck, not the routing strategy.

## Files of record

- `routing-only-parallel.mjs` (canonical driver for the full grid)
- `render-routing-only-9x24.mjs` (renderer)
- `variants/routing-only/*.SKILL.md` (aligned variants under test)
- `variants/*.SKILL.md` (original benchmark + production J kept for
  reference; do not use these for the routing-only bench)
- `runs/routing-only-9x24/summary.json`, `runs/routing-only-9x24/report.html`
- `queries.json`, `corpus-manifest.json`, `skillrouter-skills/`,
  `crop-skillrouter.mjs` (corpus provenance)
