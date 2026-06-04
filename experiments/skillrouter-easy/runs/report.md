# SkillRouter Easy — Metadata-Only Routing Comparison

_Generated 2026-05-25T18:01:04.321Z_

## Setup

- **Corpus**: SkillRouter `eval_core/easy` — 78,361 skills, installed
  metadata-only (`name` + `description` frontmatter, body stripped).
- **Queries**: 75 core benchmark queries (`core_gt_ids` non-empty).
  Split: 24 single-skill, 51 multi-skill (paper Section 2 / Appendix A).
- **Metric**: Hit@1 — any ground-truth skill at rank 1 (paper Table 9).
- **Output**: agent returns ordered top-10 `sr-XXXXX` ids; position 1
  is scored.
- **Variants under test**: K-bounded, J-bounded-v2 (J-v2), M-bm25 —
  three metadata-only agent-loop routers (no body access).

## Headline

- Best of our 3 metadata-only variants: **J-bounded-v2 on codex** at **40.0%**.
- Strongest paper **nd** baseline (Qwen3-Emb-8B): 30.7%.
- Paper end-to-end **full** pipeline (SR-Emb × SR-Rank): 76.0%.
- ✅ Best variant **beats** the strongest paper nd baseline by **+9.3%**.
- ✅ Best variant also **beats** paper's BM25 with full-body input (34.7%), despite having no body access.

## Our variants

| Variant | Host | Hit@1 | Single (n=24) | Multi (n=51) | Answered | Timeouts | Errors | Wall |
|---|---|---|---|---|---|---|---|---|
| J-bounded-v2 | claude | **21.3%** (16/75) | 5/24 (20.8%) | 11/51 (21.6%) | 75/75 | 0 | 0 | 1009s |
| J-bounded-v2 | codex | **40.0%** (30/75) | 9/24 (37.5%) | 21/51 (41.2%) | 75/75 | 0 | 0 | 2532s |
| K-bounded | claude | **25.3%** (19/75) | 4/24 (16.7%) | 15/51 (29.4%) | 75/75 | 0 | 0 | 1037s |
| K-bounded | codex | **32.0%** (24/75) | 5/24 (20.8%) | 19/51 (37.3%) | 74/75 | 1 | 0 | 2966s |
| M-bm25 | claude | **34.7%** (26/75) | 7/24 (29.2%) | 19/51 (37.3%) | 75/75 | 0 | 0 | 1329s |
| M-bm25 | codex | **37.3%** (28/75) | 7/24 (29.2%) | 21/51 (41.2%) | 75/75 | 0 | 0 | 3444s |

## Aggregates

### By variant (avg across hosts)

| Variant | Hit@1 | cells |
|---|---|---|
| J-bounded-v2 | 30.7% | (n=2) |
| K-bounded | 28.7% | (n=2) |
| M-bm25 | 36.0% | (n=2) |

### By host (avg across variants)

| Host | Hit@1 | cells |
|---|---|---|
| claude | 27.1% | (n=3) |
| codex | 36.4% | (n=3) |

## Paper baselines (SkillRouter Table 9 / Table 2, Easy tier)

| Baseline | Easy Hit@1 |
|---|---|
| BM25 (nd) | 0.0% |
| Qwen3-Emb-0.6B (nd) | 22.7% |
| Qwen3-Emb-8B (nd) | 30.7% |
| BM25 (full) | 34.7% |
| Qwen3-Emb-0.6B (full) | 58.7% |
| Qwen3-Emb-8B (full) | 65.3% |
| SR-Emb-0.6B (full) | 66.7% |
| SR-Emb-0.6B × SR-Rank-0.6B (full pipeline) | 76.0% |

The first three rows are the **metadata-only (nd)** column — what our
variants are directly comparable to. The remaining rows use **full skill
body** input, which is structurally unavailable in our metadata-only
setting; they are included as upper-bound reference points.

## Per-query breakdown

| Query | Tier | gt | claude/J-bounded-v2 top1 (✓?) | codex/J-bounded-v2 top1 (✓?) | claude/K-bounded top1 (✓?) | codex/K-bounded top1 (✓?) | claude/M-bm25 top1 (✓?) | codex/M-bm25 top1 (✓?) |
|---|---|---|---|---|---|---|---|---|
| 3d-scan-calc | single | sr-11138 | sr-00114 | sr-11138 ✓ | sr-00114 | sr-78049 | sr-53645 | sr-53645 |
| adaptive-cruise-control | multi | 5 skills | sr-01207 | sr-74164 ✓ | sr-14008 ✓ | sr-74164 ✓ | sr-74164 ✓ | sr-14008 ✓ |
| azure-bgp-oscillation-route-leak | single | sr-13751 | sr-13751 ✓ | sr-13751 ✓ | sr-13751 ✓ | sr-13751 ✓ | sr-13751 ✓ | sr-13751 ✓ |
| citation-check | single | sr-76598 | sr-50937 | sr-45564 | sr-01976 | sr-17851 | sr-17851 | sr-45564 |
| civ6-adjacency-optimizer | multi | 4 skills | sr-69978 ✓ | sr-69978 ✓ | sr-69978 ✓ | sr-69978 ✓ | sr-69978 ✓ | sr-69978 ✓ |
| crystallographic-wyckoff-position-analysis | multi | 2 skills | sr-17148 | sr-17148 | sr-17148 | sr-17148 | sr-17148 | sr-17148 |
| dapt-intrusion-detection | multi | 2 skills | sr-16235 | sr-16235 | sr-01386 | sr-16235 | sr-37860 | sr-16235 |
| data-to-d3 | single | sr-60079 | sr-00419 | sr-00419 | sr-00419 | sr-00419 | sr-40799 | sr-40799 |
| dialogue-parser | single | sr-35315 | sr-03481 | sr-35315 ✓ | sr-00446 | sr-26846 | sr-35315 ✓ | sr-35315 ✓ |
| dynamic-object-aware-egomotion | multi | 4 skills | sr-49453 ✓ | sr-49453 ✓ | sr-49453 ✓ | sr-49453 ✓ | sr-49453 ✓ | sr-49453 ✓ |
| earthquake-phase-association | multi | 4 skills | sr-16603 ✓ | sr-16603 ✓ | sr-16603 ✓ | sr-16603 ✓ | sr-51022 ✓ | sr-16603 ✓ |
| earthquake-plate-calculation | single | sr-07774 | sr-26212 | sr-26212 | sr-26212 | sr-26212 | sr-26212 | sr-26212 |
| econ-detrending-correlation | single | sr-33015 | sr-37231 | sr-37231 | sr-37231 | sr-37231 | sr-37231 | sr-37231 |
| energy-ac-optimal-power-flow | multi | 3 skills | sr-09729 | sr-09729 | sr-09729 | sr-09729 | sr-09729 | sr-09729 |
| energy-market-pricing | multi | 4 skills | sr-09729 | sr-09729 | sr-09729 | sr-09729 | sr-09729 | sr-48638 ✓ |
| enterprise-information-search | single | sr-16544 | sr-01068 | sr-12201 | sr-00094 | sr-01077 | sr-12201 | sr-12201 |
| exoplanet-detection-period | multi | 5 skills | sr-60754 | sr-60754 | sr-00898 | sr-60754 | sr-61625 | sr-60754 |
| find-topk-similiar-chemicals | multi | 2 skills | sr-11508 | sr-11508 | sr-11508 | sr-11508 | sr-11508 | sr-11508 |
| fix-build-agentops | multi | 4 skills | sr-01908 | sr-01908 | sr-01908 | sr-00248 | sr-01908 | sr-01908 |
| fix-build-google-auto | multi | 3 skills | sr-02028 | sr-18627 | sr-01908 | sr-26384 | sr-12281 | sr-12281 |
| fix-druid-loophole-cve | multi | 2 skills | sr-00023 | sr-00023 | sr-00023 | — | sr-54337 | sr-57474 |
| fix-erlang-ssh-cve | multi | 6 skills | sr-00023 | sr-17174 ✓ | sr-00023 | sr-05965 ✓ | sr-17174 ✓ | sr-17174 ✓ |
| fix-visual-stability | multi | 3 skills | sr-01093 | sr-01093 | sr-01069 | sr-34792 | sr-76419 | sr-76419 |
| flink-query | single | sr-46127 | sr-78274 | sr-78274 | sr-78274 | sr-78274 | sr-02876 | sr-78274 |
| flood-risk-analysis | multi | 3 skills | sr-59008 ✓ | sr-58327 ✓ | sr-58327 ✓ | sr-58327 ✓ | sr-58327 ✓ | sr-58327 ✓ |
| gh-repo-analytics | single | sr-51320 | sr-18709 | sr-00776 | sr-00175 | sr-00175 | sr-42490 | sr-42490 |
| glm-lake-mendota | multi | 3 skills | sr-66049 ✓ | sr-63693 ✓ | sr-66049 ✓ | sr-63693 ✓ | sr-63693 ✓ | sr-63693 ✓ |
| gravitational-wave-detection | multi | 2 skills | sr-31403 ✓ | sr-31403 ✓ | sr-31403 ✓ | sr-31403 ✓ | sr-31403 ✓ | sr-31403 ✓ |
| grid-dispatch-operator | multi | 3 skills | sr-09729 | sr-09729 | sr-09729 | sr-09729 | sr-78196 ✓ | sr-09729 |
| hvac-control | multi | 5 skills | sr-01167 | sr-04749 ✓ | sr-02295 | sr-74164 | sr-74164 | sr-74164 |
| invoice-fraud-detection | single | sr-65157 | sr-00103 | sr-00103 | sr-00103 | sr-00103 | sr-12132 | sr-00751 |
| jax-computing-basics | single | sr-44661 | sr-56000 | sr-63428 | sr-63428 | sr-63428 | sr-63428 | sr-63428 |
| jpg-ocr-stat | multi | 3 skills | sr-00103 | sr-00103 | sr-00103 | sr-00103 | sr-63239 | sr-63239 |
| lab-unit-harmonization | single | sr-16389 | sr-00764 | sr-16389 ✓ | sr-00764 | sr-16389 ✓ | sr-16389 ✓ | sr-16389 ✓ |
| lake-warming-attribution | multi | 4 skills | sr-18215 | sr-01369 | sr-01369 | sr-18215 | sr-28596 ✓ | sr-28596 ✓ |
| latex-formula-extraction | single | sr-59618 | sr-00851 | sr-59618 ✓ | sr-00851 | sr-21339 | sr-34411 | sr-34411 |
| lean4-proof | multi | 2 skills | sr-07164 | sr-32589 | sr-07164 | sr-07164 | sr-07164 | sr-07164 |
| manufacturing-codebook-normalization | single | sr-35628 | sr-35628 ✓ | sr-35628 ✓ | sr-00474 | sr-35628 ✓ | sr-35628 ✓ | sr-35628 ✓ |
| manufacturing-equipment-maintenance | multi | 2 skills | sr-00044 | sr-72981 ✓ | sr-54974 ✓ | sr-72981 ✓ | sr-54974 ✓ | sr-54974 ✓ |
| manufacturing-fjsp-optimization | single | sr-43036 | sr-43036 ✓ | sr-74287 | sr-43036 ✓ | sr-74287 | sr-74287 | sr-74287 |
| mario-coin-counting | multi | 3 skills | sr-53226 | sr-53226 | sr-02019 | sr-07557 | sr-74628 | sr-53226 |
| mars-clouds-clustering | multi | 3 skills | sr-50051 | sr-35333 | sr-50051 | sr-00034 | sr-35333 | sr-35333 |
| mhc-layer-impl | multi | 3 skills | sr-56316 ✓ | sr-56316 ✓ | sr-20150 ✓ | sr-07857 | sr-78116 | sr-07857 |
| multilingual-video-dubbing | multi | 6 skills | sr-16538 ✓ | sr-27461 ✓ | sr-27461 ✓ | sr-16538 ✓ | sr-16538 ✓ | sr-16538 ✓ |
| organize-messy-files | multi | 2 skills | sr-00601 | sr-46747 | sr-00601 | sr-00601 | sr-74195 | sr-46747 |
| paper-anonymizer | single | sr-50850 | sr-00294 | sr-50850 ✓ | sr-00294 | sr-00294 | sr-50850 ✓ | sr-50850 ✓ |
| parallel-tfidf-search | multi | 3 skills | sr-69859 | sr-69859 | sr-00634 | sr-44230 | sr-69859 | sr-69859 |
| pddl-tpp-planning | single | sr-47544 | sr-47544 ✓ | sr-47544 ✓ | sr-47544 ✓ | sr-47544 ✓ | sr-47544 ✓ | sr-47544 ✓ |
| pedestrian-traffic-counting | multi | 4 skills | sr-00448 | sr-25131 ✓ | sr-02397 | sr-25131 ✓ | sr-55732 ✓ | sr-25131 ✓ |
| pg-essay-to-audiobook | multi | 4 skills | sr-00059 | sr-70497 | sr-00059 | sr-12763 | sr-70497 | sr-12763 |
| powerlifting-coef-calc | multi | 2 skills | sr-00242 | sr-00242 | sr-06225 | sr-00242 | sr-71137 | sr-60556 |
| python-scala-translation | multi | 6 skills | sr-02528 | sr-06349 ✓ | sr-02528 | sr-44641 ✓ | sr-06349 ✓ | sr-37536 ✓ |
| quantum-numerical-simulation | single | sr-19795 | sr-68239 | sr-68239 | sr-68239 | sr-68239 | sr-68239 | sr-68239 |
| r2r-mpc-control | multi | 4 skills | sr-25668 | sr-25668 | sr-25668 | sr-25668 | sr-25668 | sr-25668 |
| react-performance-debugging | multi | 2 skills | sr-01258 | sr-01093 | sr-01069 | sr-01093 | sr-52997 | sr-24326 |
| scheduling-email-assistant | multi | 3 skills | sr-00678 | sr-00678 | sr-00678 | sr-00678 | sr-61462 | sr-61462 |
| sec-financial-report | multi | 2 skills | sr-15114 ✓ | sr-15114 ✓ | sr-15114 ✓ | sr-15114 ✓ | sr-30046 | sr-15114 ✓ |
| seismic-phase-picking | multi | 4 skills | sr-66696 ✓ | sr-66696 ✓ | sr-66696 ✓ | sr-66696 ✓ | sr-66696 ✓ | sr-66696 ✓ |
| setup-fuzzing-py | multi | 3 skills | sr-22095 | sr-22095 | sr-22095 | sr-22095 | sr-08573 | sr-22095 |
| simpo-code-reproduction | single | sr-16096 | sr-00947 | sr-03330 | sr-00947 | sr-03330 | sr-46124 | sr-03330 |
| software-dependency-audit | multi | 3 skills | sr-02326 | sr-65588 | sr-02326 | sr-15105 | sr-08418 | sr-08418 |
| speaker-diarization-subtitles | multi | 4 skills | sr-43405 | sr-43405 | sr-43405 | sr-43405 | sr-43405 | sr-21716 |
| spring-boot-jakarta-migration | multi | 5 skills | sr-09999 | sr-53460 ✓ | sr-01215 | sr-53460 ✓ | sr-53460 ✓ | sr-53460 ✓ |
| suricata-custom-exfil | multi | 3 skills | sr-01869 | sr-27022 ✓ | sr-27022 ✓ | sr-27022 ✓ | sr-27022 ✓ | sr-27022 ✓ |
| syzkaller-ppdev-syzlang | multi | 3 skills | sr-24101 ✓ | sr-24101 ✓ | sr-24101 ✓ | sr-24101 ✓ | sr-24101 ✓ | sr-24101 ✓ |
| taxonomy-tree-merge | single | sr-53450 | sr-00034 | sr-04204 | sr-00034 | sr-04204 | sr-04204 | sr-04204 |
| threejs-structure-parser | multi | 2 skills | sr-01425 | sr-16860 | sr-01425 | sr-16860 | sr-77114 | sr-16860 |
| threejs-to-obj | multi | 2 skills | sr-16860 | sr-55512 ✓ | sr-16860 | sr-55512 ✓ | sr-16860 | sr-55512 ✓ |
| travel-planning | multi | 6 skills | sr-25134 | sr-22261 | sr-33444 | sr-33444 | sr-77492 | sr-36437 |
| trend-anomaly-causal-inference | multi | 4 skills | sr-34986 | sr-16741 | sr-01369 | sr-19677 ✓ | sr-19677 ✓ | sr-74674 |
| video-filler-word-remover | multi | 3 skills | sr-02411 | sr-07750 ✓ | sr-16928 | sr-39728 | sr-32739 | sr-07750 ✓ |
| video-silence-remover | multi | 7 skills | sr-39728 | sr-39728 | sr-02397 ✓ | sr-04793 | sr-39728 | sr-39728 |
| video-tutorial-indexer | single | sr-44881 | sr-00448 | sr-05656 | sr-00448 | sr-05656 | sr-70996 | sr-05656 |
| virtualhome-agent-planning | single | sr-47544 | sr-47544 ✓ | sr-47544 ✓ | sr-47544 ✓ | sr-47544 ✓ | sr-47544 ✓ | sr-47544 ✓ |
| xlsx-recover-data | single | sr-08836 | sr-01021 | sr-06225 | sr-00242 | sr-36375 | sr-08448 | sr-46321 |

## Notes

- Hit@1 is the primary paper metric. R@10 / FC@10 (multi-skill coverage
  metrics from Table 4) can be computed from the same per-query top-10
  outputs in `runs/<host>-<variant>/<query>.jsonl` without re-running.
- All variants run as agent loops over `find … | xargs grep` /
  `agentic-skill-router skills corpus search`; per-run wall-clock and
  agent token cost are dominated by the agent's reasoning loop, not by
  retrieval over the 78K corpus (grep + BM25 index are each well under
  1s on this disk).
- Anonymous `sr-XXXXX` ids are deterministic across hosts (seed=20260525),
  so the same ground-truth skill has the same id in Claude and Codex runs.
