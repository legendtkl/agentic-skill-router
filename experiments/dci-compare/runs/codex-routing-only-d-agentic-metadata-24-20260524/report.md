# Codex Routing-Only Bench (1 variants × 24 queries)

- **Model**: `gpt-5.5` (`reasoning_effort=high`)
- **Timeout/cell**: 240s
- **Started**: 2026-05-24T15:13:20.926Z
- **Finished**: 2026-05-24T15:23:11.634Z
- **Variants**: D-agentic (router)
- **Queries**: 3d-scan-calc, azure-bgp-oscillation-route-leak, citation-check, court-form-filling, data-to-d3, dialogue-parser, earthquake-plate-calculation, econ-detrending-correlation, enterprise-information-search, gh-repo-analytics, jax-computing-basics, lab-unit-harmonization, offer-letter-generator, pddl-tpp-planning, pptx-reference-formatting, protein-expression-analysis, quantum-numerical-simulation, reserves-at-risk-calc, shock-analysis-demand, shock-analysis-supply, taxonomy-tree-merge, video-tutorial-indexer, virtualhome-agent-planning, weighted-gdp-calc
- **Cost estimate**: based on gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M). Actual Codex billing/service tier may differ. Reasoning tokens are reported separately but treated as included in output tokens for the estimate.

## Per-cell metrics

| variant | query | match | exp | ok | router | dur(s) | tools | msgs | ctx_end | ctx_win | cum_in | cached | out | reason | $est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D-agentic | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 22.0 | 2 | 1 | 18506 | 258400 | 64711 | 39936 | 437 | 92 | 0.157 |
| D-agentic | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 33.1 | 3 | 1 | 19165 | 258400 | 68844 | 52224 | 586 | 135 | 0.127 |
| D-agentic | citation-check | skill-043 | skill-043 | ✓ | ✓ | 18.0 | 3 | 1 | 18397 | 258400 | 66939 | 26624 | 454 | 123 | 0.229 |
| D-agentic | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 13.8 | 2 | 1 | 18236 | 258400 | 48933 | 22656 | 309 | 91 | 0.152 |
| D-agentic | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 19.8 | 2 | 1 | 18743 | 258400 | 49870 | 23168 | 425 | 119 | 0.158 |
| D-agentic | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 24.3 | 3 | 1 | 19076 | 258400 | 68789 | 37376 | 638 | 193 | 0.195 |
| D-agentic | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 20.0 | 2 | 1 | 18323 | 258400 | 48940 | 25728 | 545 | 254 | 0.145 |
| D-agentic | econ-detrending-correlation | skill-080 | skill-080 | ✓ | ✓ | 22.7 | 3 | 1 | 19268 | 258400 | 69385 | 37376 | 687 | 240 | 0.199 |
| D-agentic | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 22.7 | 4 | 1 | 19189 | 258400 | 68288 | 52224 | 785 | 198 | 0.130 |
| D-agentic | gh-repo-analytics | skill-021 | skill-021 | ✓ | ✓ | 31.0 | 4 | 1 | 19497 | 258400 | 69281 | 38912 | 862 | 266 | 0.197 |
| D-agentic | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 26.3 | 3 | 1 | 19126 | 258400 | 68642 | 53760 | 796 | 352 | 0.125 |
| D-agentic | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 15.8 | 2 | 1 | 18579 | 258400 | 49688 | 33920 | 363 | 138 | 0.107 |
| D-agentic | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 28.0 | 4 | 1 | 21354 | 258400 | 91117 | 76672 | 864 | 265 | 0.136 |
| D-agentic | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 43.6 | 4 | 1 | 18629 | 258400 | 67453 | 42496 | 765 | 176 | 0.169 |
| D-agentic | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 25.1 | 4 | 1 | 19189 | 258400 | 68089 | 60416 | 715 | 127 | 0.090 |
| D-agentic | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 26.1 | 4 | 2 | 19349 | 258400 | 68928 | 59392 | 774 | 156 | 0.101 |
| D-agentic | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 19.9 | 3 | 1 | 19337 | 258400 | 69424 | 43008 | 543 | 214 | 0.170 |
| D-agentic | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 22.4 | 3 | 1 | 18590 | 258400 | 67874 | 51712 | 668 | 226 | 0.127 |
| D-agentic | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 23.7 | 4 | 1 | 21449 | 258400 | 92077 | 67456 | 621 | 186 | 0.175 |
| D-agentic | shock-analysis-supply | skill-105 | skill-105 | ✓ | ✓ | 29.0 | 4 | 1 | 19816 | 258400 | 89903 | 73088 | 863 | 272 | 0.147 |
| D-agentic | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 16.7 | 2 | 1 | 18430 | 258400 | 49517 | 42112 | 455 | 149 | 0.072 |
| D-agentic | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 22.8 | 3 | 1 | 18745 | 258400 | 68274 | 28672 | 693 | 254 | 0.233 |
| D-agentic | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | ✓ | 30.3 | 2 | 1 | 18617 | 258400 | 49696 | 33920 | 506 | 205 | 0.111 |
| D-agentic | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 20.9 | 3 | 1 | 18997 | 258400 | 68255 | 47616 | 571 | 120 | 0.144 |

## Per-variant rollup

| variant | acc | router | Σdur(s) | Σtools | Σmsgs | avg ctx_end | max ctx_end | avg cum_in | Σcached | Σout | Σreason | Σ$est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D-agentic | 24/24 | 24/24 | 577.9 | 73 | 25 | 19109 | 21449 | 66372 | 1070464 | 14925 | 4551 | 3.595 |

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
