---
name: skill-router-skills
description: skill-router routes a set of locally disabled Agent Skills. When a request needs a skill capability that no currently enabled skill can satisfy, use this to discover and load a more suitable disabled skill.
metadata:
  skill-router.version: "1"
  skill-router.variant: "E-digest"
---

# skill-router - Variant E (compact corpus digest, turn-optimized DCI)

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

A mechanical corpus-access wrapper is installed at `~/.claude/skill-corpus`.
It has exactly two operations:

- `skill-corpus catalog` — prints the entire disabled-skill corpus, one line
  per skill: `<skill-id><TAB><description>`. No ranking; raw frontmatter only.
- `skill-corpus show <skill-id>` — prints the bounded body of one disabled
  skill.

## Workflow (exactly two tool calls)

1. **Digest** — fetch the whole catalog in one call:

   ```bash
   bash ~/.claude/skill-corpus catalog
   ```

   Read the returned `<id>\t<description>` lines. Reason over them yourself:
   match the user's request against the descriptions and pick the single
   best `<skill-id>`. Do all comparison in your own reasoning — there is no
   ranking step.

2. **Load** — read the chosen skill in one call:

   ```bash
   bash ~/.claude/skill-corpus show <chosen-skill-id>
   ```

   Then follow that disabled skill's instructions as if it were enabled.

3. If no catalog entry is a confident match, output the JSON below with
   `matched_skill_path: null` and stop.

The matched file path is
`~/.claude/skills/<chosen-skill-id>/SKILL.md.skill-router-disabled`.

## Stop condition (routing benchmark)

This installation is a routing benchmark. As soon as you have read the
matched disabled skill via `skill-corpus show`, stop. Do NOT execute the
skill's actual task. Output exactly one line of minified JSON and nothing
else:

```
{"matched_skill_path":"<path or null>","matched_skill_name":"<name or null>"}
```
