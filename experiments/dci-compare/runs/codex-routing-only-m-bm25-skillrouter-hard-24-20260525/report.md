# Codex Routing-Only Bench (1 variants × 24 queries)

- **Model**: `gpt-5.5` (`reasoning_effort=high`)
- **Timeout/cell**: 240s
- **Started**: 2026-05-25T07:20:16.636Z
- **Finished**: 2026-05-25T07:37:25.360Z
- **Variants**: M-bm25 (router)
- **Queries**: 3d-scan-calc, azure-bgp-oscillation-route-leak, citation-check, court-form-filling, data-to-d3, dialogue-parser, earthquake-plate-calculation, econ-detrending-correlation, enterprise-information-search, gh-repo-analytics, jax-computing-basics, lab-unit-harmonization, offer-letter-generator, pddl-tpp-planning, pptx-reference-formatting, protein-expression-analysis, quantum-numerical-simulation, reserves-at-risk-calc, shock-analysis-demand, shock-analysis-supply, taxonomy-tree-merge, video-tutorial-indexer, virtualhome-agent-planning, weighted-gdp-calc
- **Cost estimate**: based on gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M). Actual Codex billing/service tier may differ. Reasoning tokens are reported separately but treated as included in output tokens for the estimate.

## Per-cell metrics

| variant | query | match | exp | ok | router | dur(s) | tools | msgs | ctx_end | ctx_win | cum_in | cached | out | reason | $est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M-bm25 | 3d-scan-calc | sr-31447b9e40e9 | sr-31447b9e40e9 | ✓ | ✓ | 28.8 | 2 | 1 | 20763 | 258400 | 67654 | 22016 | 635 | 270 | 0.258 |
| M-bm25 | azure-bgp-oscillation-route-leak | sr-9f169a6515e7 | sr-9f169a6515e7 | ✓ | ✓ | 27.3 | 2 | 1 | 17943 | 258400 | 65772 | 58368 | 512 | 152 | 0.082 |
| M-bm25 | citation-check | sr-71b60e635e28 | sr-5e0eeae89f98 | ✗ | ✓ | 28.5 | 3 | 1 | 23279 | 258400 | 92968 | 78208 | 819 | 294 | 0.137 |
| M-bm25 | court-form-filling | sr-39dd313f16ee | sr-eb49f66b9e7c | ✗ | ✓ | 26.6 | 3 | 1 | 30181 | 258400 | 130901 | 104192 | 719 | 290 | 0.207 |
| M-bm25 | data-to-d3 | sr-ed2971b73d31 | sr-ed2971b73d31 | ✓ | ✓ | 64.9 | 5 | 1 | 30529 | 258400 | 211917 | 171392 | 1379 | 464 | 0.330 |
| M-bm25 | dialogue-parser | sr-359981cba1a7 | sr-359981cba1a7 | ✓ | ✓ | 27.9 | 3 | 1 | 23061 | 258400 | 111066 | 90368 | 764 | 206 | 0.172 |
| M-bm25 | earthquake-plate-calculation | sr-63990dddf8e0 | sr-63990dddf8e0 | ✓ | ✓ | 36.0 | 2 | 1 | 18352 | 258400 | 65602 | 40448 | 456 | 179 | 0.160 |
| M-bm25 | econ-detrending-correlation | sr-5b4d77069301 | sr-bdc0df8025db | ✗ | ✓ | 45.1 | 5 | 1 | 27778 | 258400 | 198044 | 171776 | 1115 | 295 | 0.251 |
| M-bm25 | enterprise-information-search | sr-79a363389e67 | sr-79a363389e67 | ✓ | ✓ | 63.0 | 6 | 1 | 34995 | 258400 | 292935 | 239616 | 1641 | 494 | 0.436 |
| M-bm25 | gh-repo-analytics | sr-e4fbdc175f67 | sr-f31a4bd901ca | ✗ | ✓ | 102.3 | 8 | 1 | 48289 | 258400 | 479098 | 387328 | 1952 | 694 | 0.711 |
| M-bm25 | jax-computing-basics | sr-91a15e008303 | sr-91a15e008303 | ✓ | ✓ | 35.2 | 3 | 1 | 18459 | 258400 | 83262 | 57728 | 745 | 217 | 0.179 |
| M-bm25 | lab-unit-harmonization | sr-62285d0d49aa | sr-62285d0d49aa | ✓ | ✓ | 19.5 | 2 | 1 | 17246 | 258400 | 65287 | 50688 | 434 | 145 | 0.111 |
| M-bm25 | offer-letter-generator | sr-4fa38a2afa1b | sr-454594ec77e9 | ✗ | ✓ | 34.2 | 4 | 1 | 31146 | 258400 | 161410 | 129664 | 895 | 164 | 0.250 |
| M-bm25 | pddl-tpp-planning | sr-3a4964485390 | sr-3a4964485390 | ✓ | ✓ | 38.8 | 3 | 1 | 19501 | 258400 | 104421 | 72448 | 792 | 212 | 0.220 |
| M-bm25 | pptx-reference-formatting | sr-fce52b3bdf3c | sr-f41baaba92d4 | ✗ | ✓ | 33.3 | 3 | 1 | 37167 | 258400 | 137230 | 101632 | 708 | 146 | 0.250 |
| M-bm25 | protein-expression-analysis | sr-82eae35eb3b2 | sr-d5822be01889 | ✗ | ✓ | 63.0 | 4 | 1 | 33238 | 258400 | 199032 | 146432 | 1232 | 470 | 0.373 |
| M-bm25 | quantum-numerical-simulation | sr-32fac26c3b62 | sr-4dce39e16e05 | ✗ | ✓ | 29.7 | 4 | 1 | 18984 | 258400 | 119124 | 90240 | 770 | 200 | 0.213 |
| M-bm25 | reserves-at-risk-calc | sr-82eae35eb3b2 | sr-d5822be01889 | ✗ | ✓ | 25.6 | 3 | 1 | 28020 | 258400 | 102917 | 76160 | 752 | 341 | 0.194 |
| M-bm25 | shock-analysis-demand | sr-fbf18a27fb48 | sr-d5822be01889 | ✗ | ✓ | 41.3 | 4 | 1 | 32950 | 258400 | 197331 | 151040 | 861 | 266 | 0.333 |
| M-bm25 | shock-analysis-supply | sr-1ce355f7e05b | sr-d5822be01889 | ✗ | ✓ | 66.1 | 6 | 1 | 42540 | 258400 | 306891 | 253056 | 1995 | 895 | 0.456 |
| M-bm25 | taxonomy-tree-merge | sr-7c95eb29ce00 | sr-7c95eb29ce00 | ✓ | ✓ | 39.5 | 4 | 1 | 29315 | 258400 | 150458 | 111104 | 1049 | 289 | 0.284 |
| M-bm25 | video-tutorial-indexer | sr-e6f17d2ce85a | sr-999bac37e5d0 | ✗ | ✓ | 58.8 | 4 | 1 | 36118 | 258400 | 169178 | 134784 | 1228 | 512 | 0.276 |
| M-bm25 | virtualhome-agent-planning | sr-3a4964485390 | sr-3a4964485390 | ✓ | ✓ | 18.5 | 2 | 1 | 18250 | 258400 | 65975 | 48128 | 432 | 136 | 0.126 |
| M-bm25 | weighted-gdp-calc | sr-82eae35eb3b2 | sr-d5822be01889 | ✗ | ✓ | 61.7 | 4 | 1 | 32057 | 258400 | 156198 | 104576 | 929 | 215 | 0.338 |

## Per-variant rollup

| variant | acc | router | Σdur(s) | Σtools | Σmsgs | avg ctx_end | max ctx_end | avg cum_in | Σcached | Σout | Σreason | Σ$est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M-bm25 | 11/24 | 24/24 | 1015.7 | 89 | 24 | 27923 | 48289 | 155611 | 2891392 | 22814 | 7546 | 6.347 |

## Column definitions

- **match / exp / ok**: routed skill id vs. ground-truth, ✓/✗
- **router**: whether the router variant actually loaded `skill-router-skills/SKILL.md`; native mode is n/a.
- **dur(s)**: wall-clock duration of `codex exec`
- **tools**: count of `command_execution` items (shell calls). G-native uses no router so this is 0.
- **msgs**: count of `agent_message` items (model-emitted text turns)
- **ctx_end**: real prompt size of the FINAL internal Responses API call, read from rollout `event_msg/token_count.info.last_token_usage.input_tokens` (requires --ephemeral OFF). This is the conventional "context size at session end" comparable to Claude Code's per-turn input.
- **ctx_win**: `info.model_context_window` — the model's hard ctx limit (gpt-5.5 reports 258400).
- **cum_in**: `turn.completed.usage.input_tokens` — CUMULATIVE input tokens billed across every internal Responses API call in the agentic loop (= `info.total_token_usage.input_tokens`). Useful for cost, NOT for ctx-saturation.
- **cached**: cached input tokens (server-side prompt-cache reuse)
- **out**: output tokens (visible)
- **reason**: reasoning output tokens (high-effort thinking budget; displayed separately, not added again to $est)
- **$est**: estimated USD using gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M)

## Notes

- Completed cells: 24/24; exit failures: 0; timeouts: 0.
- Full-query run; compare against the Claude Code 9x24 table before drawing cross-host conclusions.
- Codex has no per-turn input-token breakdown like Claude Code's stream-json, so we cannot report ctx_start. The ctx_end value is the final internal Responses API call's prompt size from rollout token_count.
