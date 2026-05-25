# Codex Routing-Only Bench (1 variants × 24 queries)

- **Model**: `gpt-5.5` (`reasoning_effort=high`)
- **Timeout/cell**: 240s
- **Started**: 2026-05-24T14:47:39.257Z
- **Finished**: 2026-05-24T14:59:36.350Z
- **Variants**: K-lite (router)
- **Queries**: 3d-scan-calc, azure-bgp-oscillation-route-leak, citation-check, court-form-filling, data-to-d3, dialogue-parser, earthquake-plate-calculation, econ-detrending-correlation, enterprise-information-search, gh-repo-analytics, jax-computing-basics, lab-unit-harmonization, offer-letter-generator, pddl-tpp-planning, pptx-reference-formatting, protein-expression-analysis, quantum-numerical-simulation, reserves-at-risk-calc, shock-analysis-demand, shock-analysis-supply, taxonomy-tree-merge, video-tutorial-indexer, virtualhome-agent-planning, weighted-gdp-calc
- **Cost estimate**: based on gpt-5.5 standard API list pricing (input $5/M, cached $0.50/M, output $30/M). Actual Codex billing/service tier may differ. Reasoning tokens are reported separately but treated as included in output tokens for the estimate.

## Per-cell metrics

| variant | query | match | exp | ok | router | dur(s) | tools | msgs | ctx_end | ctx_win | cum_in | cached | out | reason | $est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| K-lite | 3d-scan-calc | skill-079 | skill-079 | ✓ | ✓ | 28.9 | 2 | 1 | 17167 | 258400 | 64274 | 40448 | 735 | 124 | 0.161 |
| K-lite | azure-bgp-oscillation-route-leak | skill-070 | skill-070 | ✓ | ✓ | 24.3 | 2 | 1 | 17257 | 258400 | 65207 | 51712 | 711 | 106 | 0.115 |
| K-lite | citation-check | skill-043 | skill-043 | ✓ | ✓ | 27.3 | 2 | 1 | 17257 | 258400 | 64820 | 45568 | 813 | 206 | 0.143 |
| K-lite | court-form-filling | skill-003 | skill-003 | ✓ | ✓ | 30.4 | 2 | 1 | 17106 | 258400 | 64807 | 50176 | 749 | 147 | 0.121 |
| K-lite | data-to-d3 | skill-037 | skill-037 | ✓ | ✓ | 24.8 | 2 | 1 | 17304 | 258400 | 65510 | 39424 | 716 | 188 | 0.172 |
| K-lite | dialogue-parser | skill-009 | skill-009 | ✓ | ✓ | 26.1 | 2 | 2 | 17439 | 258400 | 65528 | 38400 | 802 | 171 | 0.179 |
| K-lite | earthquake-plate-calculation | skill-135 | skill-135 | ✓ | ✓ | 28.0 | 2 | 1 | 17266 | 258400 | 64920 | 50176 | 826 | 219 | 0.124 |
| K-lite | econ-detrending-correlation | skill-080 | skill-080 | ✓ | ✓ | 33.4 | 2 | 1 | 17250 | 258400 | 65670 | 60416 | 824 | 212 | 0.081 |
| K-lite | enterprise-information-search | skill-049 | skill-049 | ✓ | ✓ | 23.9 | 2 | 1 | 16995 | 258400 | 64353 | 60928 | 682 | 151 | 0.068 |
| K-lite | gh-repo-analytics | skill-021 | skill-021 | ✓ | ✓ | 35.1 | 3 | 1 | 17857 | 258400 | 83082 | 55168 | 1143 | 427 | 0.201 |
| K-lite | jax-computing-basics | skill-042 | skill-042 | ✓ | ✓ | 27.3 | 2 | 1 | 16879 | 258400 | 64388 | 40448 | 761 | 232 | 0.163 |
| K-lite | lab-unit-harmonization | skill-123 | skill-123 | ✓ | ✓ | 27.4 | 2 | 1 | 17463 | 258400 | 65912 | 61440 | 816 | 209 | 0.078 |
| K-lite | offer-letter-generator | skill-116 | skill-116 | ✓ | ✓ | 32.0 | 3 | 1 | 17456 | 258400 | 81687 | 54656 | 978 | 149 | 0.192 |
| K-lite | pddl-tpp-planning | skill-117 | skill-117 | ✓ | ✓ | 35.1 | 3 | 1 | 17750 | 258400 | 83110 | 57728 | 1029 | 200 | 0.187 |
| K-lite | pptx-reference-formatting | skill-140 | skill-140 | ✓ | ✓ | 40.2 | 3 | 1 | 17661 | 258400 | 82497 | 68480 | 1313 | 489 | 0.144 |
| K-lite | protein-expression-analysis | skill-105 | skill-105 | ✓ | ✓ | 24.3 | 2 | 1 | 17104 | 258400 | 65121 | 50688 | 691 | 167 | 0.118 |
| K-lite | quantum-numerical-simulation | skill-033 | skill-033 | ✓ | ✓ | 26.9 | 2 | 1 | 17529 | 258400 | 65941 | 41472 | 787 | 182 | 0.167 |
| K-lite | reserves-at-risk-calc | skill-105 | skill-105 | ✓ | ✓ | 24.3 | 2 | 1 | 17050 | 258400 | 48375 | 35968 | 668 | 128 | 0.100 |
| K-lite | shock-analysis-demand | skill-105 | skill-105 | ✓ | ✓ | 37.5 | 3 | 2 | 17940 | 258400 | 83767 | 75136 | 1087 | 228 | 0.113 |
| K-lite | shock-analysis-supply | skill-105 | skill-105 | ✓ | ✓ | 45.5 | 3 | 1 | 17995 | 258400 | 84504 | 57728 | 1021 | 189 | 0.193 |
| K-lite | taxonomy-tree-merge | skill-068 | skill-068 | ✓ | ✓ | 25.1 | 2 | 1 | 17193 | 258400 | 65424 | 39424 | 757 | 153 | 0.172 |
| K-lite | video-tutorial-indexer | skill-113 | skill-113 | ✓ | ✓ | 24.5 | 2 | 1 | 17180 | 258400 | 65284 | 60928 | 688 | 162 | 0.073 |
| K-lite | virtualhome-agent-planning | skill-117 | skill-117 | ✓ | ✓ | 25.7 | 2 | 1 | 17292 | 258400 | 65536 | 49664 | 857 | 253 | 0.130 |
| K-lite | weighted-gdp-calc | skill-105 | skill-105 | ✓ | ✓ | 26.2 | 2 | 1 | 17082 | 258400 | 64871 | 49152 | 792 | 183 | 0.127 |

## Per-variant rollup

| variant | acc | router | Σdur(s) | Σtools | Σmsgs | avg ctx_end | max ctx_end | avg cum_in | Σcached | Σout | Σreason | Σ$est |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| K-lite | 24/24 | 24/24 | 704.3 | 54 | 26 | 17353 | 17995 | 68941 | 1235328 | 20246 | 4875 | 3.321 |

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
