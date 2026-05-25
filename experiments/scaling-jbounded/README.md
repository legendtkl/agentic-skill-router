# scaling-jbounded — J-bounded routing under growing corpus

How does J-bounded (keyword-filtered metadata routing) degrade as the
locally-installed disabled-skill corpus grows? Pair-tested against I-meta
(full catalog dump, the natural "doesn't-scale" reference).

This experiment is the scale companion to `experiments/dci-compare/`'s
150-skill 9-variant bench. Where dci-compare answered "which routing
strategy wins at 150 skills?", scaling-jbounded answers "does the winner
keep winning as N grows?".

## Variants under test

| id | strategy | how it scales (predicted) |
| --- | --- | --- |
| J-bounded | keyword-filtered `grep` over descriptions, `head -20` cap | per-call payload bounded; accuracy depends on keyword quality + whether gt survives the cap |
| I-meta | dump entire catalog of `<id><TAB><description>` lines, reason over it | per-call payload grows ~linearly with N; cost & ctx_end balloon |

Both variants share the same SKILL.md `description:` field (verbatim copies
from `experiments/dci-compare/variants/routing-only/`). Only the body
differs.

## Layout

| Path | Purpose |
| --- | --- |
| `crop.mjs` | Crop SkillRouter eval-core to a `--cap`-sized corpus. Outputs `corpus-<N>/{skills,queries.json,corpus-manifest.json}`. Identical anonymization scheme as dci-compare. |
| `setup-home.mjs` | One-time `.tmp-home/` setup: link credentials, install skill-router plugin, copy corpus skills, disable all user skills. |
| `routing-only-parallel.mjs` | Per-variant HOME isolation + parallel runner. Reads `.tmp-home/`, produces `runs/<run-id>/<variant>/<query>.jsonl` + `summary.json`. |
| `render.mjs` | Produces `report.md` + `cells.json` from a run. |
| `variants/{I-meta,J-bounded}.SKILL.md` | Variant bodies (copies of dci-compare's routing-only variants). |

## Run

Prereqs:

- SkillRouter dataset cached locally at the shared stable path
  `~/.cache/skill-router/datasets/SkillRouter-Eval-Core/eval_core/`
  (`hf download pipizhao/SkillRouter-Eval-Core --repo-type dataset --local-dir ~/.cache/skill-router/datasets/SkillRouter-Eval-Core/eval_core`).
  Set `SKILLROUTER_EVAL_CORE=/path/to/eval_core` or pass `--src=/path/to/eval_core`
  to override this location.
- `claude` CLI on PATH with auth at `~/.claude/.credentials.json`.
- `HTTPS_PROXY` / `HTTP_PROXY` env set (claude CLI requires the site proxy).
- `npm install` run at the repo root (the driver shells out to `npm run install:plugin`).

```bash
# 1. Crop a 1000-skill corpus (saves to corpus-1000/)
node crop.mjs --cap=1000

# 2. Prepare .tmp-home/ with plugin + corpus
node setup-home.mjs --corpus=corpus-1000

# 3. Run J + I × 24 queries × 1000-corpus
node routing-only-parallel.mjs --corpus=corpus-1000

# 4. Render
node render.mjs --run-id=cap-1000
open runs/cap-1000/report.md
```

Subsequent scale points: re-run steps 1–4 with `--cap=N` and matching
`--corpus=corpus-N` / `--run-id=cap-N` for each N in the sweep.

## Data acknowledgement

Corpus and queries come from **SkillRouter** (arXiv:2603.22455).
`crop.mjs` is a fork of `experiments/dci-compare/crop-skillrouter.mjs`
with output paths parameterized. The same anonymization (`skill-NNN` ids
after a deterministic shuffle) is applied so the agent cannot tell
gt from distractor from noise.
