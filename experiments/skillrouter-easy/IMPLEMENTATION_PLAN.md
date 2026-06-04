# SkillRouter Easy — Implementation Plan

Multi-skill metadata-only routing benchmark aligned with the SkillRouter paper
(arXiv:2603.22455). Three local variants (K-bounded, J-bounded-v2, M-bm25)
are evaluated on the paper's Easy tier (78,361 skills) over the 75 core
benchmark queries, scored by Hit@1.

## Locked scope

- **Corpus**: SkillRouter `eval_core/easy/*.jsonl.gz` (78,361 skills),
  installed metadata-only (`name`, `description` frontmatter; body stripped).
  Plus a derived flat-TSV index (`<skillsRoot>/.flat-metadata.tsv`) used by
  K-bounded / J-bounded-v2 for sub-second metadata greps.
- **Queries**: 75 core queries from `relevance.json`
  (`core_gt_ids` non-empty). Split: 24 single + 51 multi by `core_gt_ids.length`.
- **Metric**: Hit@1 (any ground-truth skill at rank 1).
- **Output contract**: agent returns ordered top-10 skill ids.
- **Hosts**: Claude Code + Codex (both).
- **Variants**: K-bounded, J-bounded-v2, M-bm25 — forked into
  `experiments/skillrouter-easy/variants/{claude,codex}/`.

## Paper comparison points (Table 9, Easy nd; Table 2, Easy full)

| Baseline | Easy Hit@1 |
|---|---|
| BM25 nd | 0.000 |
| Qwen3-Emb-0.6B nd | 0.227 |
| Qwen3-Emb-8B nd | 0.307 |
| BM25 full | 0.347 |
| Qwen3-Emb-0.6B full | 0.587 |
| Qwen3-Emb-8B full | 0.653 |
| SR-Emb-0.6B full | 0.667 |
| SR-Emb-0.6B × SR-Rank-0.6B (1.2B pipeline, A-Hit@1) | 0.740 |

Our three variants are metadata-only agent loops, so the directly comparable
column is the **nd** row of Table 9.

## Stages

### Stage 1 — Easy pool install ✅ Complete
`install-easy-pool.mjs --host=claude|codex` materializes the 78,361 Easy
pool as metadata-only disabled skills under a target HOME, emits
`manifest.json`, `queries.json`, and `<skillsRoot>/.flat-metadata.tsv`.
Verified: 19s wall, 17.35 MB disk, 78,361 dirs, 75 core queries with
24/51 single/multi split.

### Stage 2 — Variant rewrites (multi-skill output) ✅ Complete
6 SKILL.md files under `variants/{claude,codex}/{K,J,M}.SKILL.md`. All
emit `{"matched_skill_names": [up to 10 ids]}`. K-bounded glob bug
fixed (now uses the flat-TSV index). Each variant is bounded to ≤ 4
tool calls.

### Stage 3 — Runner ✅ Complete
`run.mjs --host=... --variant=... [--smoke] [--queries=…] [--concurrency=N]`
drives `claude -p` / `codex exec` against an isolated tmp HOME, parses
the top-10 JSON line, writes per-query JSONL + per-cell `summary.json`.
Setup copies auth files from real HOME, installs the plugin, populates
78K skills + flat TSV, and pre-warms the BM25 cache for M-bm25.

### Stage 4 — Score + report ✅ Complete
Inline per-cell Hit@1 in `summary.json`; `render-report.mjs` aggregates
into a markdown report comparing every (host, variant) cell against the
paper's Easy-tier Table 9 nd baselines.

### Stage 5 — README + smoke ✅ Complete
`README.md` documents protocol, layout, paper alignment, quickstart.
Smoke = `run.mjs --smoke` (--queries=3d-scan-calc,citation-check).

### Stage 6 — Full execution 🟡 In Progress
6 (host × variant) cells × 75 queries = 450 agent invocations. Initiated
via `run.mjs --host=all --variant=all --no-setup --concurrency=4
--cell-concurrency=6 --timeout-ms=600000`. Output: `runs/all-summary.json`
+ per-cell summaries + `runs/report.md`.

## Optimizations applied (discovered during smoke)

1. **Flat metadata TSV** (`<skillsRoot>/.flat-metadata.tsv`):
   `find … | xargs grep -l` over 78K disabled-skill files takes ~24s per
   pass (78K inode walks); a single 17 MB TSV scan is <100ms. K-bounded
   and J-bounded-v2 grep the TSV directly. Same routing signal, ~250×
   faster.
2. **BM25 cache pre-warm**: cold BM25 index build over 78K skills is
   ~17s. Setup runs one warm-up `corpus search` so the first real query
   pays no cold cost.
3. **TTL bump**: env `AGENTIC_SKILL_ROUTER_CORPUS_CACHE_TTL_MS=86400000`
   (24 h) keeps caches warm across all 75 queries of a cell.
4. **Tool-call budget**: every variant SKILL.md states "max 4 tool calls"
   in the workflow. This combined with the flat TSV cut Claude/K-bounded
   from 285s/query (timeout-prone) to ~75s/query.
5. **Per-query timeout bumped from 240s to 480s default, 600s in full
   run**: prevents tail timeouts on the slowest Codex sessions.

## Open decisions resolved

- Corpus: Easy 78,361. ✅
- Metric: Hit@1. ✅
- Output shape: ordered top-10. ✅
- Variant fork location: `experiments/skillrouter-easy/variants/`. ✅
- Hosts: both. ✅
- Smoke first, then full. ✅
- Use flat-TSV index for K/J-style scans. ✅ (optimization)
- Pre-warm BM25 cache for M. ✅ (optimization)

## Out of scope

- Hard tier (79,141) — follow-on after Easy lands.
- nDCG, MRR@10, R@10, FC@10 — reportable from same runs but not the
  primary metric this round.
- SR-Emb / SR-Rank baselines — paper numbers are reference only;
  we do not retrain or rerun their pipeline.
- Full-body variants — explicitly out of scope.

## Smoke evidence (2 queries × 6 cells, 2026-05-25 16:51 UTC)

| Cell | Hit@1 | Wall | Notes |
|---|---|---|---|
| claude/K-bounded | 0/2 (0%) | 76s | both single queries answered |
| claude/J-bounded-v2 | 0/2 (0%) | 101s | both answered |
| claude/M-bm25 | 0/2 (0%) | 66s | both answered, BM25 cache warm |
| codex/K-bounded | 1/2 (50%) | 145s | hit 3d-scan-calc gt=sr-11138 |
| codex/J-bounded-v2 | 1/2 (50%) | 131s | hit 3d-scan-calc gt=sr-11138 |
| codex/M-bm25 | 0/2 (0%) | 353s | both answered |

Both smoke queries are single-skill SkillsBench tasks. Multi-skill
behavior is exercised by the full 75-query run.
