---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "B-cc"
  skill-router.host: "codex"
---

# skill-router - Variant B (DCI-Agent-CC style, fully free shell, Codex)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Disabled skill corpus

The user has additional Agent Skills that are currently disabled. Each
disabled skill lives in its own directory under:

```
~/.codex/skills/<skill-id>/SKILL.md.skill-router-disabled
```

Every disabled `SKILL.md.skill-router-disabled` file has YAML frontmatter with
at least a `name:` field and a `description:` field, followed by a markdown
body of instructions.

## Workflow

1. Search the disabled skill corpus using whatever shell tools you find
   appropriate (for example `ls`, `find`, `grep`, `head`, `cat`, `awk`).
2. Identify the single disabled skill whose `name:` / `description:` / body
   best matches the user's request.
3. Return that skill's id as the chosen routing result. (In a non-routing-only
   deployment you would also read the full file and follow its instructions;
   in this routing-only session you do not.)
4. If no disabled skill is a confident match, fall back to general knowledge.

There is no router CLI in this variant. You must do the retrieval and
selection yourself.
