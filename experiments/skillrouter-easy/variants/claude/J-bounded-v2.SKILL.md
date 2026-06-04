---
name: agentic-skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow -- e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one or more of them likely specialize in this task. Invoke this skill FIRST to identify which ones before attempting the task.
metadata:
  agentic-skill-router.version: "1"
  agentic-skill-router.variant: "J-bounded-v2-multi"
  agentic-skill-router.experiment: "skillrouter-easy"
---

# agentic-skill-router - Variant J v2 (scale-stable keyword-filtered retrieval, multi-skill top-10)

A large pool of metadata-only disabled skills is installed at
`~/.claude/skills/`. A flat metadata index has been pre-built at
`~/.claude/skills/.flat-metadata.tsv` — one tab-separated row per skill:

```
<sr-id>\t<name>\t<description>
```

**Always grep the flat TSV, not the per-skill SKILL.md files.** The TSV
contains the same routing signal as the 78,361 individual files but is one
~17 MB file (sub-second to scan).

## Goal

Produce an ordered **top-10** list of `sr-XXXXX` skill ids that are most
relevant to the user request. The first id is your best guess; the rest are
fallbacks in decreasing confidence. Position 1 is scored as Hit@1.

## Workflow (max 4 tool calls)

1. Pick 3-5 distinctive keywords from the user request. **Prefer narrow,
   technical terms** (file extensions like `.stl`, exact tool/API names,
   proper nouns, error codes) over broad words like `data`, `3D`, `build`,
   `analysis`. Broad words match hundreds of skills at scale and the answer
   drowns in noise.

2. Grep the flat metadata index for any keyword. Case-insensitive ERE
   alternation; output capped to a workable shortlist:

   ```bash
   grep -iE 'KW1|KW2|KW3|KW4|KW5' ~/.claude/skills/.flat-metadata.tsv | head -60
   ```

   - 0 matches: keywords too narrow — broaden one keyword and rerun.
   - 1-30 matches: workable shortlist, proceed.
   - 30-60 matches: keywords too broad — add a more specific term or
     pipe through a second `grep -iE '<narrower>'` and rerun.
   - It is fine to run this 2-3 times to converge.

3. From the shortlist (already three columns: id, name, description),
   pick the ordered top-10. Heuristics:
   - Position 1 (most important) should be the candidate whose name +
     description most directly covers the task's primary action.
   - For multi-skill / multi-step tasks, positions 1-N should each cover
     a distinct required capability (don't fill the top with near-duplicates).
   - Within the same capability, prefer the more specific skill (e.g. a
     skill named after the exact tool/format over a generic helper).
   - If fewer than 10 plausible candidates exist, return fewer — do not pad.

4. Emit your final answer as a single JSON line, no prose:

   ```
   {"matched_skill_names": ["sr-AAAAA", "sr-BBBBB", "sr-CCCCC", "sr-DDDDD", "sr-EEEEE", "sr-FFFFF", "sr-GGGGG", "sr-HHHHH", "sr-IIIII", "sr-JJJJJ"]}
   ```

   - Position 0 = best, position 9 = weakest.
   - Use the directory id (column 1 of the TSV: `sr-XXXXX`), NOT the name.
   - At least 1 id; at most 10. Stop after emitting.

This is a routing-only session: do not execute the user's task and do not
read any skill body. Keep the whole run to ≤ 4 tool calls.
