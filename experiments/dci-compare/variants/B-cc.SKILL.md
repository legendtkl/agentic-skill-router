---
name: skill-router-skills
description: skill-router routes a set of locally disabled Agent Skills. When a request needs a skill capability that no currently enabled skill can satisfy, use this to discover and load a more suitable disabled skill.
metadata:
  skill-router.version: "1"
  skill-router.variant: "B-cc"
---

# skill-router - Variant B (DCI-Agent-CC style, fully free shell)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Disabled skill corpus

The user has additional Agent Skills that are currently disabled. Each
disabled skill lives in its own directory under:

```
~/.claude/skills/<skill-id>/SKILL.md.skill-router-disabled
```

Every disabled `SKILL.md.skill-router-disabled` file has YAML frontmatter with
at least a `name:` field and a `description:` field, followed by a markdown
body of instructions.

## Workflow

1. Search the disabled skill corpus using whatever shell tools you find
   appropriate (for example `ls`, `find`, `grep`, `head`, `cat`, `awk`).
2. Identify the single disabled skill whose `name:` / `description:` / body
   best matches the user's request.
3. Read the full content of that disabled skill file and follow its
   instructions as if it were enabled.
4. If no disabled skill is a confident match, stop the router path and
   continue with general knowledge.

There is no router CLI in this variant. You must do the retrieval and
selection yourself.

## Stop condition (routing benchmark)

This installation is a routing benchmark. As soon as you have read the
matched disabled skill's full content, stop. Do NOT execute the skill's
actual task. Output exactly one line of minified JSON and nothing else:

```
{"matched_skill_path":"<path or null>","matched_skill_name":"<name or null>"}
```
