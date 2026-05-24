---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "J-bounded"
---

# skill-router - Variant J (keyword-filtered retrieval)

The disabled-skill corpus is at `~/.claude/skills/*/SKILL.md.skill-router-disabled`.
Each file's YAML frontmatter has `name:` and `description:`, followed by a
markdown body with the skill's actual instructions.

## Workflow

1. Pick 3–5 distinctive keywords from the user request (proper nouns, file
   types, verbs, tool/platform names; use synonyms if a term is generic).

2. Filter descriptions by keywords in one bounded command — never pull the
   whole catalog:

   ```bash
   grep -i -m1 '^description:' ~/.claude/skills/*/SKILL.md.skill-router-disabled \
     | grep -i -E "<kw1>|<kw2>|<kw3>" | head -20
   ```

   Output lines look like `<path>:description: "..."`.

3. If the shortlist is empty or all candidates look wrong, broaden keywords
   and re-grep once. Do not fall back to dumping the whole catalog.

4. Pick the single best `<skill-id>` from the shortlisted descriptions. If
   two are genuinely close, inspect their frontmatter (`sed -n '1,12p' <path>`)
   to disambiguate.

5. Return the chosen `<skill-id>` as your routing result. (In a
   non-routing-only deployment you would `Read
   ~/.claude/skills/<chosen-skill-id>/SKILL.md.skill-router-disabled` and
   follow the body's instructions; in this routing-only session you do
   not.)

If no description is a confident match after one re-grep, fall back to
general knowledge.
