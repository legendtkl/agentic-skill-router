---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "I-meta"
  skill-router.host: "codex"
---

# skill-router - Variant I (DCI shell, metadata-only, Codex)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Disabled skill corpus

The disabled-skill corpus is EXACTLY this glob:

```
~/.codex/skills/*/SKILL.md.skill-router-disabled
```

Each file begins with a YAML frontmatter block (between two `---` markers)
containing `name:` and `description:`, followed by a markdown body.

## Metadata-only retrieval

Route using ONLY frontmatter metadata. You MUST NOT read any skill body — do
not `cat`, `sed`, `head`, or otherwise read past a file's frontmatter block
(in practice the first ~12 lines). The `description:` field is your only
signal.

### Workflow

1. Pull the whole corpus's id + description in one bounded command:

   ```bash
   for f in ~/.codex/skills/*/SKILL.md.skill-router-disabled; do
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

4. Commit to the chosen skill (return only its id; do not open the body in
   this metadata-only variant). If no description is a confident match,
   fall back to general knowledge.
