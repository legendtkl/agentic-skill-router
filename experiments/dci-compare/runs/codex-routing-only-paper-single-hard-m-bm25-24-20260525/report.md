# Codex Routing-Only Bench (1 variants × 24 queries)

- **Model**: `gpt-5.5` (`reasoning_effort=high`)
- **Timeout/cell**: 240s
- **Started**: 2026-05-25T08:20:22.572Z
- **Finished**: 2026-05-25T08:36:40.331Z
- **Variants**: M-bm25 (router)
- **Queries**: 3d-scan-calc, azure-bgp-oscillation-route-leak, citation-check, data-to-d3, dialogue-parser, earthquake-plate-calculation, econ-detrending-correlation, enterprise-information-search, flink-query, gh-repo-analytics, invoice-fraud-detection, jax-computing-basics, lab-unit-harmonization, latex-formula-extraction, manufacturing-codebook-normalization, manufacturing-fjsp-optimization, paper-anonymizer, pddl-tpp-planning, quantum-numerical-simulation, simpo-code-reproduction, taxonomy-tree-merge, video-tutorial-indexer, virtualhome-agent-planning, xlsx-recover-data
- **Cost estimate**: based on gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M). Actual Codex billing/service tier may differ. Reasoning tokens are reported separately but treated as included in output tokens for the estimate.

## Per-cell metrics

| variant | query | match | exp | ok | router | dur(s) | tools | msgs | ctx_end | ctx_win | cum_in | cached | out | reason | $est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M-bm25 | 3d-scan-calc | sr-31447b9e40e9 | sr-31447b9e40e9 | ✓ | ✓ | 30.6 | 2 | 1 | 20331 | 258400 | 66888 | 25600 | 443 | 69 | 0.233 |
| M-bm25 | azure-bgp-oscillation-route-leak | sr-9f169a6515e7 | sr-9f169a6515e7 | ✓ | ✓ | 22.2 | 2 | 1 | 18194 | 258400 | 66069 | 52224 | 552 | 190 | 0.112 |
| M-bm25 | citation-check | sr-71b60e635e28 | sr-5e0eeae89f98 | ✗ | ✓ | 23.2 | 2 | 1 | 21384 | 258400 | 68489 | 29184 | 540 | 162 | 0.227 |
| M-bm25 | data-to-d3 | sr-ed2971b73d31 | sr-ed2971b73d31 | ✓ | ✓ | 23.9 | 2 | 1 | 24828 | 258400 | 73025 | 39424 | 595 | 237 | 0.206 |
| M-bm25 | dialogue-parser | sr-359981cba1a7 | sr-359981cba1a7 | ✓ | ✓ | 51.1 | 4 | 1 | 25142 | 258400 | 160514 | 93184 | 1106 | 326 | 0.416 |
| M-bm25 | earthquake-plate-calculation | sr-63990dddf8e0 | sr-63990dddf8e0 | ✓ | ✓ | 21.4 | 2 | 1 | 18265 | 258400 | 65401 | 38912 | 412 | 128 | 0.164 |
| M-bm25 | econ-detrending-correlation | sr-5b4d77069301 | sr-bdc0df8025db | ✗ | ✓ | 48.5 | 5 | 1 | 20609 | 258400 | 160641 | 126336 | 1256 | 307 | 0.272 |
| M-bm25 | enterprise-information-search | sr-d5ef1a11d9a6 | sr-79a363389e67 | ✗ | ✓ | 37.4 | 4 | 1 | 36849 | 258400 | 172375 | 127104 | 963 | 385 | 0.319 |
| M-bm25 | flink-query | sr-ec3fe1a1cbfc | sr-0d566b362b0d | ✗ | ✓ | 57.7 | 4 | 1 | 20288 | 258400 | 126571 | 102528 | 995 | 284 | 0.201 |
| M-bm25 | gh-repo-analytics | sr-20730de9fd8a | sr-f31a4bd901ca | ✗ | ✓ | 120.1 | 11 | 1 | 66243 | 258400 | 883822 | 748416 | 3780 | 1626 | 1.165 |
| M-bm25 | invoice-fraud-detection | sr-f59289a34526 | sr-f5104fffc6ae | ✗ | ✓ | 73.9 | 8 | 1 | 41788 | 258400 | 403644 | 335104 | 2153 | 634 | 0.575 |
| M-bm25 | jax-computing-basics | sr-91a15e008303 | sr-91a15e008303 | ✓ | ✓ | 28.5 | 3 | 1 | 19350 | 258400 | 85343 | 55680 | 913 | 401 | 0.204 |
| M-bm25 | lab-unit-harmonization | sr-62285d0d49aa | sr-62285d0d49aa | ✓ | ✓ | 25.3 | 2 | 2 | 17603 | 258400 | 65846 | 50688 | 555 | 152 | 0.118 |
| M-bm25 | latex-formula-extraction | sr-017f9dcc0514 | sr-017f9dcc0514 | ✓ | ✓ | 33.6 | 3 | 1 | 25085 | 258400 | 118452 | 77568 | 784 | 200 | 0.267 |
| M-bm25 | manufacturing-codebook-normalization | sr-70606d440856 | sr-70606d440856 | ✓ | ✓ | 29.8 | 3 | 1 | 19422 | 258400 | 103959 | 83712 | 734 | 153 | 0.165 |
| M-bm25 | manufacturing-fjsp-optimization | sr-8589cb9bb955 | sr-8589cb9bb955 | ✓ | ✓ | 40.3 | 3 | 1 | 26952 | 258400 | 126783 | 79616 | 723 | 166 | 0.297 |
| M-bm25 | paper-anonymizer | sr-dd8a5defa4bf | sr-dd8a5defa4bf | ✓ | ✓ | 23.2 | 2 | 2 | 22566 | 258400 | 69848 | 37376 | 614 | 222 | 0.199 |
| M-bm25 | pddl-tpp-planning | sr-3a4964485390 | sr-3a4964485390 | ✓ | ✓ | 61.3 | 3 | 1 | 18846 | 258400 | 84981 | 70016 | 740 | 231 | 0.132 |
| M-bm25 | quantum-numerical-simulation | sr-32fac26c3b62 | sr-4dce39e16e05 | ✗ | ✓ | 39.2 | 4 | 1 | 18971 | 258400 | 119237 | 88704 | 800 | 234 | 0.221 |
| M-bm25 | simpo-code-reproduction | sr-47593bdc8f02 | sr-5815e08832b7 | ✗ | ✓ | 42.3 | 4 | 1 | 29889 | 258400 | 160758 | 111616 | 1159 | 372 | 0.336 |
| M-bm25 | taxonomy-tree-merge | sr-7c95eb29ce00 | sr-7c95eb29ce00 | ✓ | ✓ | 27.6 | 2 | 1 | 19148 | 258400 | 67215 | 58368 | 576 | 206 | 0.091 |
| M-bm25 | video-tutorial-indexer | sr-c3af5c613739 | sr-999bac37e5d0 | ✗ | ✓ | 32.9 | 3 | 1 | 34742 | 258400 | 132275 | 89856 | 882 | 445 | 0.283 |
| M-bm25 | virtualhome-agent-planning | sr-3a4964485390 | sr-3a4964485390 | ✓ | ✓ | 22.6 | 2 | 2 | 18272 | 258400 | 66266 | 36864 | 579 | 189 | 0.183 |
| M-bm25 | xlsx-recover-data | sr-54b532ddaa0d | sr-12aa059127c1 | ✗ | ✓ | 47.6 | 5 | 1 | 38382 | 258400 | 250111 | 189696 | 1309 | 359 | 0.436 |

## Per-variant rollup

| variant | acc | router | Σdur(s) | Σtools | Σmsgs | avg ctx_end | max ctx_end | avg cum_in | Σcached | Σout | Σreason | Σ$est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M-bm25 | 14/24 | 24/24 | 964.0 | 85 | 27 | 25965 | 66243 | 154105 | 2747776 | 23163 | 7678 | 6.822 |

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
