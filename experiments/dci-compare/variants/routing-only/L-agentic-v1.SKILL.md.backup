---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow -- e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "L-agentic"
---

# skill-router - Variant L (agentic corpus primitives)

Use the `skill-router` corpus primitives as an AgenticRAG-style retrieval
harness. Do not call `skills route` and do not call `skills dci`. Do not read
skill bodies. Route from disabled-skill metadata only.

CLI: `<abs-path-to-skill-router>`.

## Workflow

1. Build two term sets from the user request:
   - **must terms**: 1-3 narrow terms that the correct skill should mention
     (file extensions, exact APIs/tools, named methods, protocols, or required
     operations).
   - **probe terms**: 2-5 additional distinctive terms for recall and ranking.

   Prefer exact technical terms over broad words like `data`, `analysis`,
   `report`, `file`, `output`, or `json`. For file-format tasks, include both
   the extension and artifact family when relevant (`pptx` + `presentation`,
   `docx` + `document`).

2. Search metadata with a bounded, agent-controlled query expression. Start
   with the narrowest high-recall expression:

   ```bash
   <abs-path-to-skill-router> skills corpus search \
     --all "<must1>" --any "<probe1>" --any "<probe2>" --any "<probe3>" \
     --limit 30 --json
   ```

   The result reports `totalMatches`, `returned`, `truncated`, and stable
   `ref` values. Do not accept a truncated broad result as final evidence.
   Iterate for a small bounded number of searches (2-4 total) until the
   shortlist is useful: if `totalMatches` is 0, broaden or replace one must
   term; if `truncated` is true or `totalMatches` > 30, narrow with another
   `--all` term or more specific probes. Never dump the whole catalog.

3. Once the returned shortlist is small enough, compare the metadata evidence
   in the JSON result. If one candidate explicitly covers the required
   operation, choose it. If 2-3 candidates remain plausible, inspect only those
   metadata records:

   ```bash
   <abs-path-to-skill-router> skills corpus inspect corpus-REF1 corpus-REF2 corpus-REF3 --json
   ```

4. Choose by metadata evidence:
   - Prefer explicit operation coverage over nearby topic similarity.
   - Prefer a dedicated file-format/tool skill when the task is to operate that
     file format or tool.
   - Prefer a domain/method skill when the named method/domain constraint is
     central and the file/tool is only the substrate.
   - For retrieve/extract/structured-answer tasks, prefer metadata mentioning
     evidence, search, extraction, or structured output over broad discovery or
     planning.
   - If still tied, choose the metadata covering the most distinctive required
     verbs and nouns.

Return exactly one bare `skill-NNN`. Do not execute the user's task.
