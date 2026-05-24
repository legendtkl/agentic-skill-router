---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "D-agentic"
---

# skill-router - Variant D (AgenticRAG-style structured loop)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Locate the CLI

Prefer `${SKILL_ROUTER_CLI}` when it is set. Otherwise compute the directory
two levels above this `SKILL.md` and append `bin/skill-router`. Always invoke
the CLI by absolute path:

```bash
skill_router() { "<abs-path-to-skill-router>" "$@"; }
```

## Workflow (structured agentic loop)

This variant follows the four-tool agentic retrieval pattern from arXiv:
2605.05538 (AgenticRAG). Do NOT call `skills route` directly. Instead drive
the loop yourself with four structured tools that the skill-router CLI
exposes:

| Tool | Purpose | CLI form |
|---|---|---|
| `search` | corpus-wide candidate discovery | `skill_router skills dci search --query "<keywords>" --json` |
| `find` | in-skill keyword search by ref | `skill_router skills dci find <ref> --pattern "<term>" --json` |
| `open` | bounded window read by ref+line | `skill_router skills dci open <ref> --line <N> --window 80 --json` |
| `summarize` | bounded full-text read (acts as compaction) | `skill_router skills dci read <ref> --json` |

### Loop

1. **search**: derive 2-3 short keyword queries from the user request
   (proper nouns, file types, distinctive verbs). Run `dci search` once.
   The response lists top candidates each with a `ref`, `id`, `name`,
   `description`, snippets, and a budget object.

2. **drill down** (find / open): for the top 1-2 candidates, refine with
   `dci find <ref> --pattern "<verb-or-noun>"` to confirm coverage, then
   `dci open <ref> --line <hit-line>` if you need surrounding context.
   Keep total find/open calls ≤ 3 per query (the budget enforces this).

3. **summarize / commit**: when one candidate is the clear winner, return its
   **bare** skill-id as your chosen routing result. The `dci search` /
   `dci find` JSON responses report ids in the qualified form
   `user:skill-NNN` (or `user:codex:skill-NNN` on the Codex host). Strip
   the `user:` (and any `codex:`) prefix before emitting `matched_skill_name`
   — output just `skill-NNN` (e.g. `skill-037`, NOT `user:skill-037`).
   (In a non-routing-only deployment you would `dci read <ref>` to retrieve
   the body and follow its instructions; in this routing-only session you
   do not.)

4. If no candidate is a confident match after the bounded loop, fall back
   to general knowledge.
