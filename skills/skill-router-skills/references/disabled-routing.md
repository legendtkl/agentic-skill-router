# Disabled-skill L-agentic routing

Skill Router routes to disabled skill instructions through metadata-only
AgenticRAG primitives. Use the `skill_router` helper from `SKILL.md`.

Do not call `skills route`. Do not call `skills dci` or `skills body`. During
retrieval, do not read disabled skill bodies.

## Search

Build two term sets from the user request:

- **must terms**: 1-3 narrow terms the correct skill should mention.
- **probe terms**: 2-5 additional distinctive terms for recall and ranking.

Search with a bounded expression:

```bash
skill_router skills corpus search \
  --all "<must1>" --any "<probe1>" --any "<probe2>" --any "<probe3>" \
  --limit 30 --json
```

Iterate at most 2-4 searches. If `totalMatches` is 0, broaden or replace one
must term. If `truncated` is true or `totalMatches` is greater than 30, narrow
with another `--all` term or more specific probes.

## Inspect

Inspect only plausible metadata records:

```bash
skill_router skills corpus inspect corpus-REF1 corpus-REF2 corpus-REF3 --json
```

Choose by explicit metadata evidence, not nearby topic similarity.

## Select

Record exactly one supported selection:

```bash
skill_router skills corpus select "<corpus-ref-or-id>" \
  --query "<current user request>" \
  --confidence high \
  --reason "<brief metadata evidence>" \
  --json
```

Then read `selected.skillMdPath` and follow that disabled skill. If metadata
evidence stays weak or ambiguous, stop the router path and continue normally.
