---
name: agentic-skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow -- e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one or more of them likely specialize in this task. Invoke this skill FIRST to identify which ones before attempting the task.
metadata:
  agentic-skill-router.version: "1"
  agentic-skill-router.variant: "K-bounded-multi"
  agentic-skill-router.experiment: "skillrouter-easy"
---

# agentic-skill-router - Variant K (bounded grep with metadata tie-break, multi-skill top-10)

A large pool of metadata-only disabled skills is installed at
`~/.claude/skills/`. A flat metadata index has been pre-built at
`~/.claude/skills/.flat-metadata.tsv` — one tab-separated row per skill:

```
<sr-id>\t<name>\t<description>
```

**Always grep the flat TSV, not the per-skill SKILL.md files.** The TSV is
one ~17 MB file (sub-second to scan) and contains the exact same routing
signal as the 78,361 individual files would (60s+ to walk).

## Goal

Produce an ordered **top-10** list of `sr-XXXXX` skill ids that are most
relevant to the user request. The first id is your best guess; the rest are
fallbacks in decreasing confidence. Position 1 is scored as Hit@1.

## Workflow (max 4 tool calls)

1. Pick two small keyword groups from the user request:
   - **tool/file/action terms**: proper nouns, CLIs, APIs, file extensions,
     required operations.
   - **domain/task terms**: domain words, algorithms, data sources, objects.

   Avoid generic words alone (`data`, `analysis`, `report`, `file`, `json`).
   Pair them with distinctive terms when needed.

2. Run a single bounded grep over the flat metadata index. Use case-insensitive
   ERE alternation, anchor only inside the per-line columns 2-3 (name &
   description). The TSV format means columns are tab-separated:

   ```bash
   grep -iE 'KW1|KW2|KW3|KW4' ~/.claude/skills/.flat-metadata.tsv | head -60
   ```

   - `head -60` is a safety cap; if you saw all 60 lines, narrow keywords
     and re-grep. If you see far fewer than 10, broaden one keyword.
   - It is fine to run this 2-3 times to converge on a workable shortlist.

3. Inspect the shortlist (already three columns: id, name, description) and
   identify the top-10. Heuristics in priority order:
   - Prefer skills whose `name` or `description` explicitly covers the
     required operation, not just an adjacent subject area.
   - Prefer skills whose metadata names the specific tool/file/method the
     request mentions, over generic data/file/tool skills.
   - For multi-step or multi-domain tasks, the top positions should each
     cover a distinct required capability — do not fill positions 1-5 with
     near-duplicates of the same skill.
   - If fewer than 10 candidates remain after filtering, include weaker
     matches at the tail rather than pad — never invent ids.

4. Emit your final answer as a single JSON line, no prose:

   ```
   {"matched_skill_names": ["sr-AAAAA", "sr-BBBBB", "sr-CCCCC", "sr-DDDDD", "sr-EEEEE", "sr-FFFFF", "sr-GGGGG", "sr-HHHHH", "sr-IIIII", "sr-JJJJJ"]}
   ```

   - Position 0 = best, position 9 = weakest.
   - Use the directory id (column 1 of the TSV: `sr-XXXXX`), NOT the name.
   - At least 1 id; at most 10. Stop after emitting.

This is a routing-only session: do not execute the user's task and do not
read any skill body. Keep the whole run to ≤ 4 tool calls.
