# dci-compare — DCI Routing Strategy Benchmark

A benchmark comparing skill-routing strategies for Claude Code Agent Skills
over a large catalog of locally-installed but disabled skills. The variants
under study span self-implemented retrievers, free-shell DCI agents, bounded
DCI shells, AgenticRAG, compact corpus digests, metadata-only routers, and
keyword-filtered metadata routers.

## Quick start

```bash
# Aligned 9 × 24 routing-only bench (parallel, ~25 min, ~$34 spend)
node routing-only-parallel.mjs
node render-routing-only-9x24.mjs
open runs/routing-only-9x24/report.html
```

See `EXPERIMENT_NOTES.md` for the full setup, results table, Pareto analysis,
and 10 known limitations.

## Data acknowledgement — SkillRouter

The skill corpus and query set used by every variant come from the
**SkillRouter** paper and its accompanying **SkillsBench** benchmark:

- Paper: *SkillRouter: Routing Agent Skills via Description-Based Retrieval*
  (arXiv:2603.22455)
- Dataset: SkillRouter `eval_core` (80K skill pool + single-skill SkillsBench
  tasks with ground-truth skill labels and GPT-4o-mini-generated targeted
  distractors)

`crop-skillrouter.mjs` crops the 80K pool down to a controlled 150-skill
working set (`skillrouter-skills/`) — `gt + targeted distractors + noise
padding` — by deterministically shuffling and re-labelling all skills as
opaque `skill-NNN` ids so the agent cannot tell ground truth from distractor
from noise. The mapping from `skill-NNN` back to the original SkillRouter
entities is kept in `corpus-manifest.json` for offline analysis only; the
benchmark harness and the agent never read it.

The 24 queries in `queries.json` are SkillsBench tasks reused verbatim:
each `query.query` is `instruction_text` from the upstream dataset, and
each `query.expected` is the upstream `gt` skill entity, opaqued to a
`skill-NNN` id by the same shuffle.

All routing-signal data (skill `description:` fields, skill bodies, task
instructions) is preserved unchanged. We **only** add an experiment-side
`STOP_TAIL` to the query so the agent emits a single
`{"matched_skill_name":"<id>"}` line and stops, enabling routing-only
measurement without changing the upstream task content.

We are grateful to the SkillRouter authors for releasing both the
benchmark and the targeted-distractor data — without them this controlled
comparison of routing strategies inside a real agent loop (Claude Code)
would not have been possible.

## Layout

| Path | Purpose |
| --- | --- |
| `routing-only-parallel.mjs` | Main 9 × 24 parallel driver. |
| `routing-only-9x3.mjs` | Earlier serial 9 × 3 sanity driver. |
| `routing-only-{bench,probe}.mjs` | Small probes used to validate the STOP_TAIL design. |
| `render-routing-only-{9x3,9x24}.mjs` | HTML report renderers. |
| `e2e-{native,j,multi}.mjs`, `render-e2e.mjs` | End-to-end probes that exercise the full chain past routing. |
| `run.mjs` | Original `--append-system-prompt` 24 × 10 benchmark driver (kept for reference). |
| `variants/*.SKILL.md` | Original A–J variant SKILL.md (benchmark + production J). |
| `variants/routing-only/*.SKILL.md` | Aligned routing-only variants (shared description, production-ized body). |
| `crop-skillrouter.mjs`, `gen-synthetic-corpus.mjs` | Corpus crop / synthesize scripts. |
| `skillrouter-skills/` | Cropped 150-skill corpus from SkillRouter. |
| `synthetic-skills/` | Alt synthetic corpus (not used by the 9 × 24 bench). |
| `queries.json`, `corpus-manifest.json` | Query set + provenance mapping. |
| `runs/` | Aggregated `summary.json` + `report.html` per experiment. Per-cell `*.jsonl` is gitignored (reproducible from drivers). |
| `EXPERIMENT_NOTES.md` | Status, results, and known limitations. |

## Citation

If you reuse this benchmark scaffold, please cite the SkillRouter paper
alongside this repository:

```
@misc{skillrouter2026,
  title  = {SkillRouter: Routing Agent Skills via Description-Based Retrieval},
  note   = {arXiv:2603.22455},
  year   = {2026}
}
```
