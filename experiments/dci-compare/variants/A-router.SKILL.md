---
name: skill-router-skills
description: skill-router routes a set of locally disabled Agent Skills. When a request needs a skill capability that no currently enabled skill can satisfy, use this to discover and load a more suitable disabled skill.
metadata:
  skill-router.version: "1"
  skill-router.variant: "A-router"
---

# skill-router - Variant A (self-implemented retriever)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Locate the CLI

Prefer `${SKILL_ROUTER_CLI}` when it is set. Otherwise locate the bundled CLI
next to this skill installation:

- Installed plugin: compute the directory two levels above this `SKILL.md`,
  then append `bin/skill-router`.
- Repository checkout: use `bin/skill-router`.

Always invoke the CLI by absolute path. Define a helper for the resolved CLI
path:

```bash
skill_router() { "<abs-path-to-skill-router>" "$@"; }
```

## Route disabled skills

Run the route command before solving from general knowledge. Pass the user's
verbatim message as `--query`, including filenames, file types, and concrete
nouns. Do NOT summarize, paraphrase, or shorten — the router scores against
the exact text.

```bash
skill_router skills route --query "<user message verbatim>" --json
```

If the result has `action: "read-skill-file"` and a non-null `selected`, read
`selected.skillMdPath` even when it ends in `SKILL.md.skill-router-disabled`,
then follow that disabled skill's instructions as if it were enabled.

If `action` is `"no-confident-match"`, output the JSON below with
`matched_skill_path: null` and stop.

## Stop condition (routing benchmark)

This installation is a routing benchmark. As soon as you have read the
matched disabled skill's full content, stop. Do NOT execute the skill's
actual task. Output exactly one line of minified JSON and nothing else:

```
{"matched_skill_path":"<path or null>","matched_skill_name":"<name or null>"}
```

## Safety

- Built-in and system skills are protected and cannot be disabled.
- The disable mechanism is a rename: `SKILL.md` <-> `SKILL.md.skill-router-disabled`.
- Never delete skill files.
