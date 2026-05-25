---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "D-agentic"
---

# skill-router - Variant D (metadata-only agentic loop)

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

Do NOT call `skills route` directly. Drive the loop yourself with structured
metadata-only DCI commands. This variant is intentionally not allowed to read
skill bodies; it tests whether agentic query reformulation over stable
metadata is enough.

| Tool | Purpose | CLI form |
|---|---|---|
| `search` | metadata-only candidate discovery | `skill_router skills dci search --metadata-only --query "<keywords>" --json` |
| `inspect` | metadata/path check by ref | `skill_router skills dci inspect <ref> --json` |

### Loop

1. **search**: derive 2-3 short keyword queries from the user request
   (proper nouns, file types, distinctive verbs). Run `dci search` once.
   The response lists top candidates each with a `ref`, `id`, `name`,
   `description`, metadata snippets, and a budget object. The search result
   must show `"metadataOnly": true` and `corpus.bytesRead` must be `0`.

2. **drill down** (inspect only): if the top candidates are close, inspect
   the top 1-2 refs to confirm their id/name/description. Do not call
   `dci find`, `dci open`, or `dci read`; those commands read skill bodies
   and are outside this variant.

3. **commit**: when one candidate is the clear winner, return its
   **bare** skill-id as your chosen routing result. The `dci search` /
   `dci inspect` JSON responses report ids in the qualified form
   `user:skill-NNN` (or `user:codex:skill-NNN` on the Codex host). Strip
   the `user:` (and any `codex:`) prefix before emitting `matched_skill_name`
   — output just `skill-NNN` (e.g. `skill-037`, NOT `user:skill-037`).

4. If no candidate is a confident match after the bounded loop, fall back
   to general knowledge.
