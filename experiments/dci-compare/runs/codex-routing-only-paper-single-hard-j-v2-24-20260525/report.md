# Codex Routing-Only Bench (1 variants × 24 queries)

- **Model**: `gpt-5.5` (`reasoning_effort=high`)
- **Timeout/cell**: 240s
- **Started**: 2026-05-25T08:20:22.562Z
- **Finished**: 2026-05-25T09:12:14.004Z
- **Variants**: J-bounded-v2 (router)
- **Queries**: 3d-scan-calc, azure-bgp-oscillation-route-leak, citation-check, data-to-d3, dialogue-parser, earthquake-plate-calculation, econ-detrending-correlation, enterprise-information-search, flink-query, gh-repo-analytics, invoice-fraud-detection, jax-computing-basics, lab-unit-harmonization, latex-formula-extraction, manufacturing-codebook-normalization, manufacturing-fjsp-optimization, paper-anonymizer, pddl-tpp-planning, quantum-numerical-simulation, simpo-code-reproduction, taxonomy-tree-merge, video-tutorial-indexer, virtualhome-agent-planning, xlsx-recover-data
- **Cost estimate**: based on gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M). Actual Codex billing/service tier may differ. Reasoning tokens are reported separately but treated as included in output tokens for the estimate.

## Per-cell metrics

| variant | query | match | exp | ok | router | dur(s) | tools | msgs | ctx_end | ctx_win | cum_in | cached | out | reason | $est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| J-bounded-v2 | 3d-scan-calc | sr-31447b9e40e9 | sr-31447b9e40e9 | ✓ | ✓ | 109.7 | 6 | 1 | 25868 | 258400 | 321341 | 253056 | 1755 | 518 | 0.521 |
| J-bounded-v2 | azure-bgp-oscillation-route-leak | sr-9f169a6515e7 | sr-9f169a6515e7 | ✓ | ✓ | 94.1 | 5 | 1 | 26624 | 258400 | 269177 | 215936 | 1784 | 469 | 0.428 |
| J-bounded-v2 | citation-check | sr-71b60e635e28 | sr-5e0eeae89f98 | ✗ | ✓ | 146.8 | 5 | 1 | 29494 | 258400 | 399177 | 328064 | 2482 | 1386 | 0.594 |
| J-bounded-v2 | data-to-d3 | sr-ed2971b73d31 | sr-ed2971b73d31 | ✓ | ✓ | 89.7 | 6 | 1 | 44209 | 258400 | 441278 | 361216 | 1600 | 500 | 0.629 |
| J-bounded-v2 | dialogue-parser | dialogue_graph | sr-359981cba1a7 | ✗ | ✓ | 129.4 | 8 | 2 | 52437 | 258400 | 656426 | 556928 | 2304 | 1011 | 0.845 |
| J-bounded-v2 | earthquake-plate-calculation | sr-63990dddf8e0 | sr-63990dddf8e0 | ✓ | ✓ | 94.4 | 5 | 1 | 17149 | 258400 | 195131 | 156160 | 1051 | 302 | 0.304 |
| J-bounded-v2 | econ-detrending-correlation | sr-5b4d77069301 | sr-bdc0df8025db | ✗ | ✓ | 183.5 | 8 | 1 | 29419 | 258400 | 591928 | 521472 | 2589 | 843 | 0.691 |
| J-bounded-v2 | enterprise-information-search | sr-d5ef1a11d9a6 | sr-79a363389e67 | ✗ | ✓ | 162.2 | 13 | 1 | 31197 | 258400 | 533615 | 471808 | 3424 | 1127 | 0.648 |
| J-bounded-v2 | flink-query | sr-f0402ff2a439 | sr-0d566b362b0d | ✗ | ✓ | 113.5 | 4 | 1 | 20944 | 258400 | 268730 | 235136 | 1934 | 352 | 0.344 |
| J-bounded-v2 | gh-repo-analytics | sr-7d8dd389ee03 | sr-f31a4bd901ca | ✗ | ✓ | 133.6 | 9 | 1 | 38432 | 258400 | 662883 | 553728 | 2480 | 627 | 0.897 |
| J-bounded-v2 | invoice-fraud-detection | sr-72decb1178f3 | sr-f5104fffc6ae | ✗ | ✓ | 212.3 | 5 | 1 | 20922 | 258400 | 291899 | 264576 | 1439 | 436 | 0.312 |
| J-bounded-v2 | jax-computing-basics | sr-91a15e008303 | sr-91a15e008303 | ✓ | ✓ | 131.8 | 6 | 1 | 30622 | 258400 | 371026 | 318848 | 2111 | 882 | 0.484 |
| J-bounded-v2 | lab-unit-harmonization | lab-unit-harmonization | sr-62285d0d49aa | ✗ | ✓ | 147.9 | 7 | 1 | 19078 | 258400 | 309382 | 240896 | 2598 | 1244 | 0.541 |
| J-bounded-v2 | latex-formula-extraction | sr-a1260d0a5261 | sr-017f9dcc0514 | ✗ | ✓ | 100.7 | 7 | 1 | 41369 | 258400 | 338558 | 253952 | 1611 | 542 | 0.598 |
| J-bounded-v2 | manufacturing-codebook-normalization | sr-70606d440856 | sr-70606d440856 | ✓ | ✓ | 109.3 | 5 | 1 | 24624 | 258400 | 306721 | 261376 | 1247 | 239 | 0.395 |
| J-bounded-v2 | manufacturing-fjsp-optimization | fjsp-baseline-repair-with-downtime-and-policy | sr-8589cb9bb955 | ✗ | ✓ | 107.5 | 4 | 1 | 23984 | 258400 | 226900 | 163456 | 1625 | 735 | 0.448 |
| J-bounded-v2 | paper-anonymizer | sr-dd8a5defa4bf | sr-dd8a5defa4bf | ✓ | ✓ | 139.7 | 6 | 1 | 47442 | 258400 | 431174 | 337920 | 1869 | 658 | 0.691 |
| J-bounded-v2 | pddl-tpp-planning | sr-3a4964485390 | sr-3a4964485390 | ✓ | ✓ | 84.6 | 3 | 1 | 18696 | 258400 | 183321 | 140928 | 1425 | 242 | 0.325 |
| J-bounded-v2 | quantum-numerical-simulation | sr-4dce39e16e05 | sr-4dce39e16e05 | ✓ | ✓ | 106.3 | 3 | 1 | 19973 | 258400 | 168565 | 152832 | 1627 | 320 | 0.204 |
| J-bounded-v2 | simpo-code-reproduction | sr-b4b63554ba6d | sr-5815e08832b7 | ✗ | ✓ | 180.4 | 12 | 1 | 45286 | 258400 | 863239 | 780416 | 3165 | 792 | 0.899 |
| J-bounded-v2 | taxonomy-tree-merge | sr-7c95eb29ce00 | sr-7c95eb29ce00 | ✓ | ✓ | 176.0 | 6 | 1 | 23994 | 258400 | 340442 | 267264 | 1547 | 369 | 0.546 |
| J-bounded-v2 | video-tutorial-indexer | sr-c3af5c613739 | sr-999bac37e5d0 | ✗ | ✓ | 93.9 | 5 | 1 | 33795 | 258400 | 277965 | 226816 | 1682 | 657 | 0.420 |
| J-bounded-v2 | virtualhome-agent-planning | sr-3a4964485390 | sr-3a4964485390 | ✓ | ✓ | 99.3 | 3 | 1 | 18493 | 258400 | 189135 | 177792 | 1042 | 324 | 0.177 |
| J-bounded-v2 | xlsx-recover-data | sr-da42cf702967 | sr-12aa059127c1 | ✗ | ✓ | 109.1 | 6 | 1 | 43004 | 258400 | 380125 | 323200 | 1702 | 638 | 0.497 |

## Per-variant rollup

| variant | acc | router | Σdur(s) | Σtools | Σmsgs | avg ctx_end | max ctx_end | avg cum_in | Σcached | Σout | Σreason | Σ$est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| J-bounded-v2 | 11/24 | 24/24 | 3055.6 | 147 | 25 | 30294 | 52437 | 375756 | 7563776 | 46093 | 15213 | 12.436 |

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
