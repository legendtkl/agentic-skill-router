# Codex routing-only bench — handoff notes

Audience: the next agent (likely Codex itself) picking up this experiment.
Date of this snapshot: 2026-05-24.
Repo / branch: `skill-router` worktree at `.claude/worktrees/codex` (off `main`).

## TL;DR

We ported the Claude Code routing-only DCI bench to Codex and ran the
full 4-variant × 24-query grid for G-native, C-lite, I-meta, and J-bounded,
all with model `gpt-5.5` + `model_reasoning_effort=high`, served through
the host's OpenAI subscription auth (`~/.codex/auth.json`). 96 cells,
0 timeouts, all router variants triggered the router skill in every cell.

Mid-session we discovered that `turn.completed.usage.input_tokens` from
`codex exec --json` is **cumulative across all internal Responses API
calls in the turn**, not the final prompt size. Recovered the true
`ctx_end` by dropping `--ephemeral` and reading
`event_msg/token_count.info.last_token_usage.input_tokens` out of the
per-cell rollout JSONL.

Final 4×24 per-variant rollup (see `runs/codex-routing-only-4x24/report.md`
for the full per-cell table):

| variant   | acc   | router | avg ctx_end | avg cum_in | Σdur(s) | Σ$est |
|-----------|-------|--------|-------------|------------|---------|-------|
| G-native  | 24/24 | n/a    | 19456       | 19456      | 185.4   | 1.816 |
| C-lite    | 23/24 | 24/24  | 18388       | 78523      | 658.5   | 3.594 |
| I-meta    | 22/24 | 24/24  | 21076       | 64697      | 495.0   | 3.310 |
| J-bounded | 22/24 | 24/24  | **16851**   | **49773**  | 473.9   | **2.415** |

The surprising result is **G-native 24/24** on Codex, unlike Claude Code's
native 15/24 on the same 150-skill corpus. Among router variants, C-lite
has the best strict accuracy (23/24), while J-bounded remains the cost /
context Pareto winner but drops to 22/24.

## What was built this session

```
experiments/dci-compare/
├── variants/routing-only-codex/      # NEW — Codex-adapted SKILL.md variants
│   ├── C-lite.SKILL.md               #   `~/.codex/skills/` paths (not `~/.claude/...`)
│   ├── I-meta.SKILL.md               #   description line is byte-identical
│   └── J-bounded.SKILL.md            #   across the three (md5 verified)
├── codex-routing-only-4x5.mjs        # NEW — driver, serial 4 variants × 5 queries
├── codex-routing-only-4x24.mjs       # NEW — wrapper for full 4 variants × 24 queries
├── render-codex-4x5.mjs              # NEW — report renderer
├── render-codex-4x24.mjs             # NEW — full-run renderer wrapper
├── runs/codex-routing-only-4x5/      # NEW — output (committed: summary.json,
│   │                                 #   report.md; jsonl per-cell is large
│   │                                 #   and reproducible, see .gitignore)
│   ├── summary.json
│   ├── report.md
│   └── <variant>/<query>.jsonl
├── runs/codex-routing-only-4x24/     # NEW — full-run output
│   ├── summary.json
│   ├── report.md
│   └── <variant>/<query>.jsonl
└── .tmp-home-codex/                  # NEW — per-variant isolated HOMEs
    ├── _base/                        #   built once: auth.json + 150-skill corpus +
    │                                 #   plugin install (~600 MB total)
    └── <variant>/                    #   cp -R from _base + per-variant tweaks
```

The driver writes to `runs/codex-routing-only-4x5/` or
`runs/codex-routing-only-4x24/` under the experiment dir, leaves
`.tmp-home-codex/` for forensic inspection, and `.tmp-home-codex/` is
now gitignored. Per-cell JSONL is also gitignored; `summary.json` and
`report.md` are the files of record.

## Reproducibility

Run from repo root (the worktree at `.claude/worktrees/codex`):

```bash
# Full grid (4 variants × 5 queries):
node experiments/dci-compare/codex-routing-only-4x5.mjs

# Full grid (4 variants × 24 queries):
node experiments/dci-compare/codex-routing-only-4x24.mjs

# Subset (env-var filters):
ONLY_VARIANTS=J-bounded ONLY_QUERIES=dialogue-parser \
  node experiments/dci-compare/codex-routing-only-4x5.mjs

# Render after a run:
node experiments/dci-compare/render-codex-4x5.mjs
node experiments/dci-compare/render-codex-4x24.mjs
```

Prerequisites:
- `codex` on PATH with valid OpenAI subscription auth at `~/.codex/auth.json`.
- `npm run build` works in the worktree (we had to `npm install
  @esbuild/linux-arm64 --no-save` at the repo root once because the
  shared `node_modules/@esbuild/` only contained the darwin-arm64
  binary; see Known issue #2).
- `HTTP_PROXY` / `HTTPS_PROXY` may be set (Codex via OpenAI subscription
  works through the bytedance proxy — confirmed in this session).
- The `_base` HOME is cached at `.tmp-home-codex/_base/` and reused only
  when its manifest matches model/reasoning settings, plugin version,
  corpus hash, and auth file size/mtime. Set `CODEX_REBUILD_BASE=1` to
  force a clean rebuild.

## Key technical findings

### Finding 1 — `turn.completed.usage.input_tokens` is cumulative, not ctx_end

`codex exec --json` emits exactly one `turn.completed` per cell with
`usage.input_tokens` set to `usage.total.input_tokens` (the sum of
prompt sizes across every internal Responses API call in the agentic
loop). It is **not** the final call's prompt size.

Confirmation: `codex-rs/exec/src/event_processor_with_jsonl_output.rs`'s
`usage_from_last_total()` copies from `usage.total`, not `usage.last`.

In our renderer the column was originally mislabeled `ctx_end`; it is
now reported as `cum_in` ("cumulative input tokens billed") and the
real `ctx_end` is sourced from the rollout (see Finding 2).

### Finding 2 — Recovering real ctx_end via rollout file

Drop `--ephemeral` from `codex exec`. Codex then writes a rollout to:

```
$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<iso-ts>-<thread_id>.jsonl
```

Lines are typed; the ones we care about are
`{"type":"event_msg","payload":{"type":"token_count","info":{...}}}`.
Multiple `token_count` events fire per session (one per internal API
call); the **last** one with non-null `info` has:

```jsonc
{
  "info": {
    "total_token_usage": { "input_tokens": ..., ... },   // = cum_in
    "last_token_usage":  { "input_tokens": ..., ... },   // = ctx_end
    "model_context_window": 258400                       // = ctx_win
  }
}
```

The thread id from `thread.started.thread_id` in the JSONL stream
matches the rollout filename suffix exactly; we use it to pair the
rollout with the cell. Helper `readLastTokenCountFromRollout()` in the
driver does the lookup.

We considered `codex app-server` (option B) for live `tokenUsage`
events; rejected as much higher complexity than the rollout-parsing
approach.

### Finding 3 — Codex native is unexpectedly strong

On the full 24-query set, Codex G-native selected the ground-truth skill
for all 24 queries with no tool calls. This is the largest cross-host
surprise: Claude Code's G-native baseline was 15/24 on the same corpus.

After comparing archived Claude Code evidence and the current Claude Code
source mirror (`legendtkl/claude-code`), the two native baselines are not the
same mechanism:

- Claude Code old G-native had the corpus enabled and no router plugin, but
  its stream-json/report trace shows **24 native `Skill[...]` tool launches**
  over 24 queries. The report's representative failure is:
  `TOOL[Skill]: {"skill":"skill-026"}` followed by
  `{"matched_skill_path":null,"matched_skill_name":"skill-026"}`. Its
  failures were mostly distractor launches; four Excel-like queries were
  routed to `skill-026`.
- Codex G-native in this run also had the corpus enabled and no router plugin,
  but each per-cell JSONL contains only `thread.started`, `turn.started`,
  one `item.completed/agent_message`, `turn.completed`, `_stderr`, and
  `_final_message`. Across all 24 cells: **0 command executions, 0 skill-body
  reads, 0 router loads, 24 direct agent messages**.
- Codex exposes the enabled skills in the developer prompt as a plain
  `### Available skills` list, then says that if the task clearly matches a
  listed description the agent "must use that skill." In this STOP_TAIL
  routing harness, "use" collapses to returning `{"matched_skill_name":...}`;
  Codex never has to commit to a tool call.
- Claude Code exposes native skills through a separate `SkillTool`. Its prompt
  says matching skills are a **blocking requirement**: call `Skill` before any
  other response. The skill list itself is injected as a `skill_listing`
  `<system-reminder>` with wording like "The following skills are available for
  use with the Skill tool". The representative failure therefore happened at
  the tool-selection step: `Skill({"skill":"skill-026"})`.
- Claude Code's source also budgets the skill listing at **1% of the context
  window in characters** (`SKILL_BUDGET_CONTEXT_PERCENT = 0.01`, fallback
  8,000 chars) and truncates descriptions to fit. The full corpus descriptions
  are ~29k chars; Codex G-native's actual skill section was ~21.1k chars. This
  means Claude Code native likely saw much less discriminating metadata for
  close distractors.

We then confirmed this with a local fake-upstream request capture, without
sending prompts to the real APIs:

- Script: `experiments/dci-compare/capture-native-prompts.mjs`
- Artifacts: `experiments/dci-compare/runs/native-prompt-capture/`
  (`analysis.md/json` are the shareable summaries; raw request captures are
  local/ignored and metadata-redacted when written)
- Captured query: `weighted-gdp-calc` (expected `user:skill-105`)
- Codex true `/v1/responses` request:
  - `### Available skills` is in the request body.
  - 150 experiment skill lines.
  - skill section = **21,117 chars / 21,265 bytes**.
  - average description shown = **92 chars**, max = **100 chars**.
  - `skill-105` line still says:
    `Comprehensive spreadsheet creation, editing, and analysis with support for formulas, formatting,`
- Claude Code true `/v1/messages?beta=true` main request:
  - The first POST was a Haiku title-generation request, so the capture script
    now records multiple POSTs and selects the main Sonnet request containing
    `Skill`.
  - 26 tools, including `Skill`.
  - 150 experiment skill lines in a `<system-reminder>`.
  - skill listing section = **7,948 chars / 8,294 bytes**.
  - average description shown = **20 chars**, max = **20 chars**.
  - `skill-105` line is only `Comprehensive sprea…`; `skill-026` is only
    `A skill for generat…`.

This is strong prompt-level evidence for the mechanism difference, not only a
source-code inference. For this representative query/current CLI pair, Codex
gets roughly 4-5x more routing metadata per experiment skill and can answer
directly from that metadata, while Claude Code must choose a `Skill` tool from a
heavily truncated list before it can see the full skill body.

So Codex G-native here behaves like a one-shot metadata classifier over the
enabled skill descriptions, while Claude Code G-native behaved like native
skill auto-selection that actually launched one skill. The 24/24 result should
therefore be phrased as "Codex metadata-only routing classification is strong
in this routing-only harness", not as proof that native skill execution is
solved.

### Finding 4 — Router tradeoff differs from Claude Code but J remains cheapest

Among routers, C-lite reached 23/24 but was most expensive. I-meta and
J-bounded both reached 22/24; J-bounded used the lowest final context,
cumulative input, wall time, and estimated cost among router variants.
The router ranking is therefore cost-aligned with the Claude Code result,
but strict accuracy is not identical.

### Finding 5 — Server-side prompt cache helps a lot

Cached input ratios on Codex:
- G-native: ~29%
- C-lite:   ~76%
- I-meta:   ~69%
- J-bounded: ~72%

`$est` uses gpt-5.5 standard API list pricing checked on 2026-05-24
(input $5/M, cached $0.50/M, output $30/M). `reasoning_output_tokens` is
displayed but not added again because rollout totals show output tokens are
inclusive for total-token accounting. The real Codex subscription/service-tier
bill is opaque — these numbers are for ranking, not for accounting.

## Open questions / suggested next steps

1. **Native apples-to-apples audit** — Codex G-native currently never launches
   a skill, while Claude Code G-native did. The local request capture above
   confirms that their real prompt surfaces are different. Add two probes before
   treating the 24/24 vs 15/24 gap as a direct host comparison:
   - Claude classify-only: same 24 queries, same final JSON contract, but
     disable/suppress `SkillTool` invocation and expose a Codex-shaped plain
     skill list.
   - Budget matched: rerun Codex G-native with a Claude-shaped 8k/1% truncated
     skill listing, and rerun or simulate Claude with a 21k-ish fuller listing.
     This separates model quality from prompt/list-budget effects.
2. **Miss analysis** — inspect router misses:
   - C-lite: enterprise-information-search -> skill-087 (expected skill-049)
   - I-meta: earthquake-plate-calculation -> skill-092; gh-repo-analytics -> skill-046
   - J-bounded: econ-detrending-correlation -> skill-105; shock-analysis-supply -> skill-080
3. **Missing variants** — Add B-cc, D-agentic, E-digest, H-bounded
   for cross-host parity with the Claude Code 9x24 table. The variant
   `description:` line is identical across all routers; only the body
   workflow differs. Adapt by changing `~/.claude/skills/` →
   `~/.codex/skills/` like we did for C/I/J.
4. **Trigger-noise control** — Codex doesn't have a direct equivalent
   of Claude Code's `--append-system-prompt`. Investigate whether
   `-c instructions=...` or a `AGENTS.md` in the project cwd can force
   the agent to always call the router skill, so trigger noise (an LLM
   decision) can be separated from routing accuracy.
5. **web_search guard** — Codex CAN call `web_search` by default; we
   observed 0 calls in 20 cells but want to defensively disable it for
   harder queries. The user explicitly said skip for now since we have
   no evidence of misbehavior; reconsider when expanding to 24 queries
   or larger corpora. If disabling: add a `do not use web_search` line
   to the body of all router variants (the description line must stay
   byte-identical across variants).
6. **Best-of-N** — Single-run variance not measured. A second 4×24 on
   the same setup with a different `LITELLM_KEY`/seed would
   tell us how much of any future spread is noise.
7. **Cost truth** — The `$est` column uses public gpt-5.5 standard API
   pricing. If we want real billed numbers, instrument against the OpenAI
   subscription usage dashboard or use the litellm path (`config.toml.litellm`
   reference exists at `~/.codex/`).

## Known issues / workarounds

1. **`turn.completed.usage` is cumulative, not last** — see Finding 1.
   Fixed in the renderer by sourcing ctx_end from the rollout. Do
   **not** drop `--ephemeral` if you only care about cum_in.
2. **esbuild platform mismatch** — `/Users/bytedance/github/skill-router/node_modules/@esbuild/`
   only contained `darwin-arm64` because node_modules was installed on
   macOS and shared via the worktree mount. Fix:
   ```bash
   env -u HTTP_PROXY -u HTTPS_PROXY npm install @esbuild/linux-arm64 \
     --no-save --prefix /Users/bytedance/github/skill-router
   ```
3. **`.tmp-home-codex/` size** — base HOME plus per-variant HOMEs can be
   large. Gitignored. Delete `.tmp-home-codex/` manually if disk is tight.
4. **Auth coupling** — base HOME copies `~/.codex/auth.json` into
   `.tmp-home-codex/_base/.codex/auth.json` at build time. The manifest
   checks auth size/mtime and rebuilds on change; set `CODEX_REBUILD_BASE=1`
   if in doubt.
5. **Files of record are not fully self-contained** — `summary.json` keeps
   absolute local rollout paths, while per-cell JSONL and `.tmp-home-codex/`
   are gitignored. A fresh checkout can read `summary.json`/`report.md`, but
   cannot independently re-render all ctx details unless the ignored local
   artifacts are still present or the run is regenerated.
6. **Base HOME reuse remains a reproducibility risk** — the manifest checks
   model/reasoning settings, plugin version, corpus hash, and auth size/mtime,
   but not the Codex CLI version or a full plugin content hash. Use
   `CODEX_REBUILD_BASE=1` after CLI or plugin install-path changes.

## Files of record

- `experiments/dci-compare/codex-routing-only-4x5.mjs` — canonical driver
  (`CODEX_QUERY_SET=all` also runs the full set)
- `experiments/dci-compare/codex-routing-only-4x24.mjs` — full-run wrapper
- `experiments/dci-compare/render-codex-4x5.mjs` — renderer
- `experiments/dci-compare/render-codex-4x24.mjs` — full-run renderer wrapper
- `experiments/dci-compare/variants/routing-only-codex/{C-lite,I-meta,J-bounded}.SKILL.md`
- `experiments/dci-compare/runs/codex-routing-only-4x24/summary.json`
- `experiments/dci-compare/runs/codex-routing-only-4x24/report.md`
- `experiments/dci-compare/runs/codex-routing-only-4x5/summary.json`
- `experiments/dci-compare/runs/codex-routing-only-4x5/report.md`
- `experiments/dci-compare/runs/codex-routing-only-4x5/<variant>/<query>.jsonl`
  (gitignored, regenerable via the driver)
- `experiments/dci-compare/EXPERIMENT_NOTES.md` — original Claude Code
  9x24 notes (read this for CC-side numbers we're comparing against)
- `experiments/dci-compare/queries.json` — full 24-query corpus
- `experiments/dci-compare/skillrouter-skills/` — 150 skill corpus (the
  base HOME copies this into `<HOME>/.codex/skills/`)
