---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "E-digest"
  skill-router.host: "codex"
---

# skill-router - Variant E (compact corpus digest, turn-optimized DCI, Codex)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Why this variant

This is a turn-optimized form of Direct Corpus Interaction (arXiv:2605.05242).
B/C variants spend 4-5 shell calls per query (list, then several grep/head
calls, then a read); each extra turn re-sends the whole accumulated context.
This variant collapses corpus access into a thin wrapper so retrieval costs
exactly **two tool calls** — while the agent still does all the judgement
itself (the wrapper performs no scoring or ranking).

## The wrapper

A mechanical corpus-access wrapper is installed at `~/.codex/skill-corpus`.
It has exactly two operations:

- `skill-corpus catalog` — prints the entire disabled-skill corpus, one line
  per skill: `<skill-id><TAB><description>`. No ranking; raw frontmatter only.
- `skill-corpus show <skill-id>` — prints the bounded body of one disabled
  skill.

## Workflow (exactly two tool calls)

1. **Digest** — fetch the whole catalog in one call:

   ```bash
   SKILL_CORPUS_ROOT="$HOME/.codex/skills" bash "$HOME/.codex/skill-corpus" catalog
   ```

   Read the returned `<id>\t<description>` lines. Reason over them yourself:
   match the user's request against the descriptions and pick the single
   best `<skill-id>`. Do all comparison in your own reasoning — there is no
   ranking step.

2. **Commit** — return `<chosen-skill-id>` as your chosen routing result.
   (In a non-routing-only deployment you would also run
   `SKILL_CORPUS_ROOT="$HOME/.codex/skills" bash "$HOME/.codex/skill-corpus" show <chosen-skill-id>`
   to load the body and follow its instructions; in this routing-only session
   you do not.)

3. If no catalog entry is a confident match, fall back to general knowledge.
