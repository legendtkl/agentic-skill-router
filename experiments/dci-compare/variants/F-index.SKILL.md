---
name: skill-router-skills
description: skill-router routes a set of locally disabled Agent Skills. When a request needs a skill capability that no currently enabled skill can satisfy, use this to discover and load a more suitable disabled skill.
metadata:
  skill-router.version: "1"
  skill-router.variant: "F-index"
---

# skill-router - Variant F (pre-baked corpus index, scope-narrowed DCI)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Why this variant

This narrows the search scope to zero filesystem exploration. The full
disabled-skill corpus index is baked directly into this skill below, so you
already have the catalog in context — no `ls`, no `grep`, no `catalog` call.
Match against the index in your own reasoning, then read exactly one file.
Retrieval costs **one tool call**.

## Disabled skill corpus index

Each line is `<skill-id>` TAB `<description>`. This index IS the corpus —
there is nothing else to discover.

```
<<CORPUS-INDEX>>
```

## Workflow (one tool call)

1. Read the index above. Match the user's request against the descriptions
   and pick the single best `<skill-id>`. Do all comparison in your own
   reasoning — there is no ranking step and nothing else to search.

2. Read the chosen skill in one call:

   ```bash
   sed -n '1,220p' ~/.claude/skills/<chosen-skill-id>/SKILL.md.skill-router-disabled
   ```

   Then follow that disabled skill's instructions as if it were enabled.

3. If no index entry is a confident match, output the JSON below with
   `matched_skill_path: null` and stop.

The matched file path is
`~/.claude/skills/<chosen-skill-id>/SKILL.md.skill-router-disabled`.

## Stop condition (routing benchmark)

This installation is a routing benchmark. As soon as you have read the
matched disabled skill, stop. Do NOT execute the skill's actual task. Output
exactly one line of minified JSON and nothing else:

```
{"matched_skill_path":"<path or null>","matched_skill_name":"<name or null>"}
```
