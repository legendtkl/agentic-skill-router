# Disabled-skill routing

Codex can route a request to disabled skill instructions when no enabled skill
clearly matches.

```bash
"<abs-path-to-skill-router>" --host=codex skills route --query "<current user request>" --json
```

If the route result has `action: "read-skill-file"` and a non-null `selected`,
read the returned `selected.skillMdPath` and follow the instructions. The path
may end in `SKILL.md.skill-router-disabled`.

Use explicit modes only for audits or debugging:

```bash
"<abs-path-to-skill-router>" --host=codex skills route --mode=metadata --query "<query>" --json
"<abs-path-to-skill-router>" --host=codex skills route --mode=body --query "<query>" --json
"<abs-path-to-skill-router>" --host=codex skills route --mode=lexical --query "<query>" --json
"<abs-path-to-skill-router>" --host=codex skills route --mode=dci --query "<query>" --json
"<abs-path-to-skill-router>" --host=codex skills route --mode=auto --query "<query>" --json
```

When `auto` cannot select confidently, keep body verification bounded:

- Max queries: 3
- Max candidates to consider from search: 8
- Max bytes per disabled skill body read by search: 64,000
- Max bytes across one disabled-skill corpus search: 1,000,000
- Max `find` / `open` calls total: 3
- Max full `read` calls: 2
- Max selections: 3
- Max `open` output: 24,000 characters

Search and route JSON include `warnings` when a skill body is truncated or when
the corpus byte budget is exhausted before all disabled skills are read.

Check the active budget:

```bash
"<abs-path-to-skill-router>" --host=codex skills dci budget --json
```

Search with the raw request plus up to two short derived queries:

```bash
"<abs-path-to-skill-router>" --host=codex skills dci search --query "<current user request>" --query "<derived query>" --json
```

Use returned `ref` values for follow-up commands:

```bash
"<abs-path-to-skill-router>" --host=codex skills dci inspect "<skill-id-or-ref>" --json
"<abs-path-to-skill-router>" --host=codex skills dci find "<skill-id-or-ref>" --pattern "<distinctive phrase>" --json
"<abs-path-to-skill-router>" --host=codex skills dci open "<skill-id-or-ref>" --line <line> --window 80 --json
"<abs-path-to-skill-router>" --host=codex skills dci read "<skill-id-or-ref>" --json
```

Use literal grep for visible product, API, or command names:

```bash
"<abs-path-to-skill-router>" --host=codex skills dci grep --pattern "<distinctive phrase>" --json
```

Record a clearly supported selection before reading the selected file:

```bash
"<abs-path-to-skill-router>" --host=codex skills dci select "<skill-id-or-ref>" --query "<current user request>" --confidence=high --reason "<brief evidence>" --json
```

If evidence stays weak or ambiguous, stop the router path and continue normally.
