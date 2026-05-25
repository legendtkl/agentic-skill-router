# Codex Routing-Only Bench (1 variants × 24 queries)

- **Model**: `gpt-5.5` (`reasoning_effort=high`)
- **Timeout/cell**: 240s
- **Started**: 2026-05-25T09:00:07.779Z
- **Finished**: 2026-05-25T09:11:00.558Z
- **Variants**: L-agentic (router)
- **Queries**: 3d-scan-calc, azure-bgp-oscillation-route-leak, citation-check, court-form-filling, data-to-d3, dialogue-parser, earthquake-plate-calculation, econ-detrending-correlation, enterprise-information-search, gh-repo-analytics, jax-computing-basics, lab-unit-harmonization, offer-letter-generator, pddl-tpp-planning, pptx-reference-formatting, protein-expression-analysis, quantum-numerical-simulation, reserves-at-risk-calc, shock-analysis-demand, shock-analysis-supply, taxonomy-tree-merge, video-tutorial-indexer, virtualhome-agent-planning, weighted-gdp-calc
- **Cost estimate**: based on gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M). Actual Codex billing/service tier may differ. Reasoning tokens are reported separately but treated as included in output tokens for the estimate.

## Per-cell metrics

| variant | query | match | exp | ok | router | dur(s) | tools | msgs | ctx_end | ctx_win | cum_in | cached | out | reason | $est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L-agentic | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 29.1 | 2 | 1 | 16400 | 258400 | 46566 | 13440 | 462 | 147 | 0.186 |
| L-agentic | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 48.2 | 2 | 1 | 16783 | 258400 | 47502 | 28288 | 333 | 98 | 0.120 |
| L-agentic | citation-check | skill-043 | skill-043 | ✓ | ✓ | 19.6 | 2 | 1 | 16703 | 258400 | 47433 | 33920 | 445 | 207 | 0.098 |
| L-agentic | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 22.6 | 2 | 1 | 17800 | 258400 | 48801 | 24192 | 598 | 294 | 0.153 |
| L-agentic | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 23.9 | 3 | 1 | 17917 | 258400 | 65967 | 60928 | 714 | 239 | 0.077 |
| L-agentic | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 34.2 | 5 | 1 | 17798 | 258400 | 99289 | 84736 | 740 | 149 | 0.137 |
| L-agentic | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 25.7 | 2 | 1 | 17016 | 258400 | 47871 | 12928 | 535 | 233 | 0.197 |
| L-agentic | econ-detrending-correlation | skill-080 | skill-080 | ✓ | ✓ | 34.5 | 5 | 1 | 18782 | 258400 | 101869 | 71424 | 1016 | 216 | 0.218 |
| L-agentic | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 30.9 | 5 | 1 | 26575 | 258400 | 115652 | 93440 | 747 | 153 | 0.180 |
| L-agentic | gh-repo-analytics | skill-021 | skill-021 | ✓ | ✓ | 29.5 | 3 | 1 | 18510 | 258400 | 67269 | 39936 | 988 | 522 | 0.186 |
| L-agentic | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 16.8 | 2 | 1 | 16706 | 258400 | 47454 | 24192 | 459 | 142 | 0.142 |
| L-agentic | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 24.7 | 2 | 1 | 17317 | 258400 | 48680 | 33408 | 522 | 209 | 0.109 |
| L-agentic | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 16.3 | 2 | 1 | 16523 | 258400 | 47064 | 31360 | 303 | 79 | 0.103 |
| L-agentic | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 34.5 | 2 | 1 | 17776 | 258400 | 48861 | 12928 | 453 | 133 | 0.200 |
| L-agentic | pptx-reference-formatting | skill-103 | skill-140 | ✗ | ✓ | 32.9 | 2 | 1 | 17704 | 258400 | 48447 | 23168 | 536 | 310 | 0.154 |
| L-agentic | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 18.4 | 2 | 1 | 17234 | 258400 | 48424 | 33920 | 533 | 221 | 0.105 |
| L-agentic | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 26.2 | 3 | 2 | 17552 | 258400 | 65671 | 39424 | 766 | 267 | 0.174 |
| L-agentic | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 30.5 | 3 | 1 | 17955 | 258400 | 66769 | 49664 | 753 | 419 | 0.133 |
| L-agentic | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 25.7 | 3 | 1 | 17940 | 258400 | 66627 | 31232 | 719 | 260 | 0.214 |
| L-agentic | shock-analysis-supply | skill-105 | skill-105 | ✓ | ✓ | 28.2 | 4 | 1 | 18753 | 258400 | 86171 | 71040 | 869 | 254 | 0.137 |
| L-agentic | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 20.1 | 2 | 1 | 16986 | 258400 | 48318 | 34432 | 571 | 266 | 0.104 |
| L-agentic | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 23.5 | 3 | 1 | 17109 | 258400 | 64858 | 40960 | 502 | 166 | 0.155 |
| L-agentic | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | ✓ | 18.8 | 2 | 1 | 17441 | 258400 | 48543 | 44160 | 352 | 121 | 0.055 |
| L-agentic | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 21.7 | 2 | 1 | 17217 | 258400 | 48285 | 34944 | 623 | 317 | 0.103 |

## Per-variant rollup

| variant | acc | router | Σdur(s) | Σtools | Σmsgs | avg ctx_end | max ctx_end | avg cum_in | Σcached | Σout | Σreason | Σ$est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L-agentic | 23/24 | 24/24 | 636.6 | 65 | 25 | 17854 | 26575 | 61350 | 968064 | 14539 | 5422 | 3.442 |

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
