---
name: skill-router-skills
description: skill-router routes a set of locally disabled Agent Skills. When a request needs a skill capability that no currently enabled skill can satisfy, use this to discover and load a more suitable disabled skill.
metadata:
  skill-router.version: "1"
  skill-router.variant: "I-meta"
---

# skill-router - Variant I (DCI shell, metadata-only)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Disabled skill corpus

The disabled-skill corpus is EXACTLY this glob:

```
~/.claude/skills/*/SKILL.md.skill-router-disabled
```

Each file begins with a YAML frontmatter block (between two `---` markers)
containing `name:` and `description:`, followed by a markdown body.

## Metadata-only retrieval

Route using ONLY frontmatter metadata. You MUST NOT read any skill body — do
not `cat`, `sed`, `head`, or `Read` past a file's frontmatter block (in
practice the first ~12 lines). The `description:` field is your only signal.

### Workflow

1. Pull the whole corpus's id + description in one bounded command:

   ```bash
   for f in ~/.claude/skills/*/SKILL.md.skill-router-disabled; do
     printf '%s\t' "$(basename "$(dirname "$f")")"
     grep -m1 '^description:' "$f" | cut -c1-300
   done
   ```

   This yields one `<skill-id><TAB><description>` line per skill.

2. Reason over the descriptions yourself and pick the single best
   `<skill-id>` for the user request.

3. If two descriptions are genuinely close, you may re-inspect just their
   frontmatter blocks (`sed -n '1,12p' <path>`) to disambiguate — but still
   NEVER read the body.

4. Commit to the chosen skill and output the JSON below. Do not open the
   skill body. If no description is a confident match, output
   `matched_skill_path: null`.

The matched file path is
`~/.claude/skills/<chosen-skill-id>/SKILL.md.skill-router-disabled`.

## Stop condition (routing benchmark)

This installation is a routing benchmark. As soon as you have picked the best
skill from the descriptions, stop. Do NOT read its body and do NOT execute
its task. Output exactly one line of minified JSON and nothing else:

```
{"matched_skill_path":"<path or null>","matched_skill_name":"<name or null>"}
```
