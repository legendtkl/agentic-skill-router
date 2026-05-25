# Codex Routing-Only Bench (1 variants × 24 queries)

- **Model**: `gpt-5.5` (`reasoning_effort=high`)
- **Timeout/cell**: 240s
- **Started**: 2026-05-25T04:19:45.559Z
- **Finished**: 2026-05-25T04:28:54.457Z
- **Variants**: L-agentic (router)
- **Queries**: 3d-scan-calc, azure-bgp-oscillation-route-leak, citation-check, court-form-filling, data-to-d3, dialogue-parser, earthquake-plate-calculation, econ-detrending-correlation, enterprise-information-search, gh-repo-analytics, jax-computing-basics, lab-unit-harmonization, offer-letter-generator, pddl-tpp-planning, pptx-reference-formatting, protein-expression-analysis, quantum-numerical-simulation, reserves-at-risk-calc, shock-analysis-demand, shock-analysis-supply, taxonomy-tree-merge, video-tutorial-indexer, virtualhome-agent-planning, weighted-gdp-calc
- **Cost estimate**: based on gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M). Actual Codex billing/service tier may differ. Reasoning tokens are reported separately but treated as included in output tokens for the estimate.

## Per-cell metrics

| variant | query | match | exp | ok | router | dur(s) | tools | msgs | ctx_end | ctx_win | cum_in | cached | out | reason | $est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L-agentic | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 25.2 | 2 | 1 | 16658 | 258400 | 47110 | 22656 | 482 | 167 | 0.148 |
| L-agentic | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 14.8 | 2 | 1 | 16809 | 258400 | 47860 | 33920 | 411 | 91 | 0.099 |
| L-agentic | citation-check | skill-043 | skill-043 | ✓ | ✓ | 17.2 | 2 | 1 | 16768 | 258400 | 47632 | 33920 | 565 | 327 | 0.102 |
| L-agentic | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 19.6 | 2 | 1 | 17686 | 258400 | 48612 | 33920 | 540 | 224 | 0.107 |
| L-agentic | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 17.4 | 2 | 1 | 17473 | 258400 | 48827 | 44672 | 548 | 234 | 0.060 |
| L-agentic | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 27.7 | 5 | 1 | 18967 | 258400 | 102416 | 79616 | 919 | 172 | 0.181 |
| L-agentic | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 20.6 | 2 | 1 | 17061 | 258400 | 48012 | 21632 | 659 | 352 | 0.162 |
| L-agentic | econ-detrending-correlation | skill-080 | skill-080 | ✓ | ✓ | 26.7 | 4 | 1 | 18304 | 258400 | 83517 | 77696 | 852 | 208 | 0.094 |
| L-agentic | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 36.5 | 3 | 1 | 19284 | 258400 | 66475 | 46592 | 702 | 227 | 0.144 |
| L-agentic | gh-repo-analytics | skill-021 | skill-021 | ✓ | ✓ | 25.4 | 3 | 1 | 18384 | 258400 | 67239 | 57344 | 794 | 330 | 0.102 |
| L-agentic | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 15.1 | 2 | 1 | 16585 | 258400 | 47312 | 33920 | 410 | 179 | 0.096 |
| L-agentic | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 13.1 | 2 | 1 | 16866 | 258400 | 48121 | 44160 | 367 | 75 | 0.053 |
| L-agentic | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 13.4 | 2 | 1 | 16470 | 258400 | 47006 | 33408 | 310 | 81 | 0.094 |
| L-agentic | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 21.9 | 2 | 1 | 17560 | 258400 | 48709 | 24704 | 583 | 271 | 0.150 |
| L-agentic | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 27.8 | 3 | 1 | 18522 | 258400 | 67062 | 49152 | 859 | 407 | 0.140 |
| L-agentic | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 30.4 | 3 | 1 | 17777 | 258400 | 66150 | 52224 | 651 | 205 | 0.115 |
| L-agentic | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 22.1 | 3 | 1 | 17702 | 258400 | 65703 | 37888 | 670 | 185 | 0.178 |
| L-agentic | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 18.9 | 2 | 1 | 17193 | 258400 | 48401 | 42112 | 488 | 171 | 0.067 |
| L-agentic | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 34.7 | 3 | 1 | 17900 | 258400 | 66571 | 55296 | 738 | 278 | 0.106 |
| L-agentic | shock-analysis-supply | skill-105 | skill-105 | ✓ | ✓ | 16.2 | 2 | 1 | 17416 | 258400 | 49164 | 36480 | 508 | 217 | 0.097 |
| L-agentic | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 36.0 | 3 | 1 | 17081 | 258400 | 64812 | 45056 | 506 | 156 | 0.136 |
| L-agentic | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 23.1 | 4 | 1 | 17508 | 258400 | 82169 | 54144 | 594 | 161 | 0.185 |
| L-agentic | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | ✓ | 17.0 | 2 | 1 | 17556 | 258400 | 48701 | 40064 | 475 | 155 | 0.077 |
| L-agentic | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 15.7 | 2 | 1 | 17001 | 258400 | 47916 | 40064 | 479 | 166 | 0.074 |

## Per-variant rollup

| variant | acc | router | Σdur(s) | Σtools | Σmsgs | avg ctx_end | max ctx_end | avg cum_in | Σcached | Σout | Σreason | Σ$est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L-agentic | 24/24 | 24/24 | 536.7 | 62 | 24 | 17522 | 19284 | 58562 | 1040640 | 14110 | 5039 | 2.768 |

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
