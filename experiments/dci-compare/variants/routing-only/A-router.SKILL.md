---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "A-router"
---

# skill-router - Variant A (self-implemented retriever)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Locate the CLI

Prefer `${SKILL_ROUTER_CLI}` when it is set. Otherwise locate the bundled CLI
next to this skill installation:

- Installed plugin: compute the directory two levels above this `SKILL.md`,
  then append `bin/skill-router`.
- Repository checkout: use `bin/skill-router`.

Always invoke the CLI by absolute path. Define a helper for the resolved CLI
path:

```bash
skill_router() { "<abs-path-to-skill-router>" "$@"; }
```

## Route disabled skills

Run the route command before solving from general knowledge. Pass the user's
verbatim message as `--query`, including filenames, file types, and concrete
nouns. Do NOT summarize, paraphrase, or shorten — the router scores against
the exact text.

```bash
skill_router skills route --query "<user message verbatim>" --json
```

If the result has `action: "read-skill-file"` and a non-null `selected`, the
`selected.skillName` (or the directory name in `selected.skillMdPath`) IS
the chosen skill id. Return that id as your routing result. (In a
non-routing-only deployment you would also Read `selected.skillMdPath` and
follow its instructions; in this routing-only session you do not.)

If `action` is `"no-confident-match"`, fall back to general knowledge.
