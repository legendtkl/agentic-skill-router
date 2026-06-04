# SkillRouter Easy — Multi-Skill Metadata-Only Routing Benchmark

Adapt our three metadata-only agent routers (K-bounded, J-bounded-v2,
M-bm25) to run on the SkillRouter paper's Easy-tier evaluation set, and
compare their Hit@1 against the paper's reported baselines.

## Quickstart

```bash
# 1. Smoke: setup all 6 (host × variant) cells and run 2 queries each.
#    ~10 min wall.
node experiments/skillrouter-easy/run.mjs --host=all --variant=all --smoke

# 2. Full run: 6 cells × 75 queries. ~1-3 hours wall.
node experiments/skillrouter-easy/run.mjs --host=all --variant=all \
    --concurrency=4 --cell-concurrency=6 --timeout-ms=300000

# 3. Render the comparison report.
node experiments/skillrouter-easy/render-report.mjs
open experiments/skillrouter-easy/runs/report.md
```

Single cell at a time:

```bash
node experiments/skillrouter-easy/run.mjs --host=claude --variant=K --smoke
node experiments/skillrouter-easy/run.mjs --host=codex  --variant=M
node experiments/skillrouter-easy/run.mjs --host=claude --variant=J --queries=3d-scan-calc
```

## Layout

| Path | Purpose |
| --- | --- |
| `install-easy-pool.mjs` | Materialize 78,361 Easy-tier skills as metadata-only `SKILL.md.agentic-skill-router-disabled` files under a target host's HOME. Anonymizes directory ids to `sr-XXXXX`; preserves original `name:` + `description:`. |
| `variants/{claude,codex}/{K-bounded,J-bounded-v2,M-bm25}.SKILL.md` | Forked router skill prompts adapted to return an ordered top-10 list (multi-skill output contract). Host paths differ only in `~/.claude/skills/` vs `~/.codex/skills/`. |
| `run.mjs` | Per (host, variant) cell: set up isolated HOME, install plugin + 78K corpus, run queries (parallel, bounded), write per-query JSONL + per-cell `summary.json`. |
| `render-report.mjs` | Aggregate every `runs/<host>-<variant>/summary.json` into a comparison markdown report against the paper's Easy-tier baselines. |
| `runs/install-{host,host-variant}/` | `manifest.json` (anon→origSkillId) + `queries.json` (75 core queries with anonymized expected). Gitignored. |
| `runs/<host>-<variant>/` | Per-query JSONL transcripts + `summary.json`. Gitignored. |
| `.tmp-homes/<host>-<variant>/` | Per-cell isolated HOME with `.claude/`/`.codex/` and the 78K skill corpus. Gitignored. |
| `IMPLEMENTATION_PLAN.md` | Stage breakdown + locked scope. |

## Protocol alignment with SkillRouter paper

- **Corpus**: SkillRouter `eval_core/easy/*.jsonl.gz`, 78,361 unique
  skills (paper Section 2; HuggingFace `pipizhao/SkillRouter-Eval-Core`).
- **Queries**: 75 core benchmark queries — every task in `relevance.json`
  with non-empty `core_gt_ids`. Split: **24 single-skill + 51 multi-skill**
  (paper Section 2, Appendix A).
- **Metric**: **Hit@1** — `1` if any `core_gt_ids[*]` is the agent's
  rank-1 candidate, else `0`. Paper Table 9 / Table 2 main number.
- **Input format**: **metadata-only (nd)** — every skill is installed as
  YAML frontmatter only (`name:` + `description:`). No body. Paper Section
  2 "nd" input format; Table 9 reports the same drop pattern (31–44pp
  Hit@1 vs full body).
- **Anonymization**: directory id replaced with deterministic
  `sr-XXXXX` (LCG seed `20260525`) so the upstream `gt/<name>` skill_id
  prefix cannot leak ground-truth membership through path inspection. The
  frontmatter `name:` and `description:` are preserved verbatim — they
  ARE the routing signal under the paper's nd input.

## Reference points (paper Easy-tier Hit@1)

| Baseline | Easy Hit@1 |
|---|---|
| BM25 (nd) | 0.000 |
| Qwen3-Emb-0.6B (nd) | 0.227 |
| Qwen3-Emb-8B (nd) | 0.307 |
| BM25 (full) | 0.347 |
| Qwen3-Emb-0.6B (full) | 0.587 |
| Qwen3-Emb-8B (full) | 0.653 |
| SR-Emb-0.6B (full) | 0.667 |
| SR-Emb-0.6B × SR-Rank-0.6B (full pipeline, A-Hit@1 avg E+H) | 0.740 |

Our three variants are metadata-only agent loops, so the directly
comparable column is the **nd** row of Table 9. The full-body rows are
upper-bound references; the body is structurally unavailable in this
setting.

## Multi-skill output contract

Each variant ranks an ordered top-10 of skill ids and emits a single line:

```
{"matched_skill_names":["sr-AAAAA","sr-BBBBB","sr-CCCCC", ... up to 10 ids]}
```

- Position 0 is scored as Hit@1.
- Ids are **directory names** (`sr-XXXXX`), not the frontmatter `name:`
  field (which is the original upstream name, e.g. `mesh-analysis`).
- Variants return fewer than 10 ids when fewer plausible candidates
  exist; they never invent ids.

## Per-variant differences

- **K-bounded**: two bounded keyword grep passes over
  `^(name|description):` lines, then frontmatter side-by-side inspection
  for the shortlist, then a rank-10 selection. Old K-bounded used
  `for f in ~/.claude/skills/*/...` shell globs — that overflows OS argv
  at 78K skills, so this version uses `find ... -print0 | xargs -0`.
- **J-bounded-v2**: scale-stable keyword filter
  (`find | xargs grep -l -i -E '^(name|description):.*…'`) returning a
  shortlist of paths, then frontmatter inspection and rank-10 selection.
- **M-bm25**: 2–4 bounded BM25 searches via
  `agentic-skill-router skills corpus search --ranker=bm25 --limit=30
  --json`; trust BM25 score as primary ranking signal, override only on
  clear metadata mismatch.

## Auth / runtime requirements

- Claude CLI on `PATH` (the runner shells out to `claude -p`) plus
  `~/.claude/.credentials.json` from a `claude /login`. Proxy env vars
  (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`) are injected by the runner.
- Codex CLI on `PATH` plus `~/.codex/auth.json` from `codex login`.
  `LITELLM_KEY` is injected; proxies are unset (Codex hits an internal
  network).

Auth files are copied from your real `$HOME` into each `.tmp-homes/<cell>/`
during setup. Override the source with
`AGENTIC_SKILL_ROUTER_REAL_HOME=…`.

## Acknowledgement

The 78,361 Easy-tier corpus, the 75 core queries, the relevance labels
and the single/multi split all come from the SkillRouter paper and its
accompanying benchmark (`pipizhao/SkillRouter-Eval-Core`):

```
@misc{zheng2026skillrouter,
  title={SkillRouter: Skill Routing for LLM Agents at Scale},
  author={Zheng, YanZhao and Zhang, ZhenTao and Ma, Chao and others},
  year={2026},
  eprint={2603.22455},
  archivePrefix={arXiv}
}
```

The upstream skill pool is derived from
[majiayu000/claude-skill-registry](https://github.com/majiayu000/claude-skill-registry);
the task–skill mappings come from
[benchflow-ai/skillsbench](https://github.com/benchflow-ai/skillsbench).
