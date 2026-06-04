---
name: agentic-skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow -- e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one or more of them likely specialize in this task. Invoke this skill FIRST to identify which ones before attempting the task.
metadata:
  agentic-skill-router.version: "1"
  agentic-skill-router.variant: "M-bm25-multi"
  agentic-skill-router.experiment: "skillrouter-easy"
---

# agentic-skill-router - Variant M (BM25 corpus ranking, multi-skill top-10)

Use the `agentic-skill-router` corpus primitives as a retrieval harness
backed by BM25 metadata ranking. Do not call `skills route` and do not call
`skills dci`. The catalog may contain tens of thousands of disabled skills,
each with only `name:` and `description:` in its frontmatter (this is a
metadata-only routing test — no skill bodies are present).

CLI: `<abs-path-to-agentic-skill-router>`.

## Goal

Produce an ordered **top-10** list of `sr-XXXXX` skill ids most relevant to
the user request. The first id is your best guess; the rest are fallbacks
in decreasing confidence. Position 1 is scored as Hit@1.

## Workflow (max 4 tool calls)

1. Build two term sets from the user request:
   - **must terms**: 1-3 narrow terms that the correct skill should mention
     (file extensions, exact APIs/tools, named methods, protocols, or
     required operations).
   - **probe terms**: 2-6 additional distinctive terms for BM25 recall and
     ranking.

   Prefer exact technical terms over broad words like `data`, `analysis`,
   `report`, `file`, `output`, or `json`. For file-format tasks, include
   both the extension and artifact family when relevant (`pptx` +
   `presentation`, `docx` + `document`). For named methods or protocols,
   keep the exact acronym (`pddl`, `bgp`, `stl`, `d3`, `jax`).

2. Search metadata with BM25 ranking and bounded output:

   ```bash
   <abs-path-to-agentic-skill-router> skills corpus search \
     --ranker=bm25 \
     --any "<probe1>" --any "<probe2>" --any "<probe3>" \
     --limit 30 --json
   ```

   The result reports `corpus.totalMatches`, `corpus.returned`,
   `corpus.truncated`, and a `matches` array with stable `shortId`
   values like `sr-NNNNN`. Do not accept a truncated broad result as
   final evidence. Iterate up to 3 times if needed:
   - If `totalMatches` is 0, broaden or replace a term.
   - If `truncated` is true and `totalMatches` is huge (e.g. > 500),
     re-run with one `--all "<must>"` filter to narrow.

3. For multi-step or multi-domain tasks, you may run a second BM25 search
   covering a different sub-capability of the task and merge the two
   shortlists. Keep total BM25 calls ≤ 4.

4. From the combined shortlists, select the ordered top-10. Heuristics:
   - The default order is BM25 `score` descending — trust it as the
     primary signal. Only reorder when metadata evidence clearly disagrees
     (e.g. position 2 explicitly names the required tool while position 1
     only mentions an adjacent topic).
   - For multi-step tasks, the top positions should cover distinct
     required sub-capabilities rather than near-duplicates.
   - If fewer than 10 plausible matches exist, return fewer rather than
     pad — never invent ids.

5. Emit your final answer as a single JSON line, no prose:

   ```
   {"matched_skill_names": ["sr-AAAAA", "sr-BBBBB", "sr-CCCCC", "sr-DDDDD", "sr-EEEEE", "sr-FFFFF", "sr-GGGGG", "sr-HHHHH", "sr-IIIII", "sr-JJJJJ"]}
   ```

   - Position 0 = best, position 9 = weakest.
   - Use the `shortId` value from the BM25 result (always `sr-NNNNN` in
     this benchmark), NOT the `name` field.
   - At least 1 id; at most 10.

This is a routing-only session: do not execute the user's task and do not
read any skill body.
