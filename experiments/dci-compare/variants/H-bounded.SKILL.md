---
name: skill-router-skills
description: skill-router routes a set of locally disabled Agent Skills. When a request needs a skill capability that no currently enabled skill can satisfy, use this to discover and load a more suitable disabled skill.
metadata:
  skill-router.version: "1"
  skill-router.variant: "H-bounded"
---

# skill-router - Variant H (DCI-Agent-CC, bounded corpus access)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Disabled skill corpus

The disabled-skill corpus is EXACTLY this glob — nothing else:

```
~/.claude/skills/*/SKILL.md.skill-router-disabled
```

Every command you run against the corpus MUST target that glob. Never run a
bare `ls ~/.claude/skills/` — that enumerates every skill directory
indiscriminately (enabled, disabled, unrelated) and the bare directory names
carry no description-level signal.

## Bounded retrieval

Search with whatever shell tools you prefer (`grep`, `sed`, `awk`, `find`,
`head`) — but keep every step bounded:

- Your FIRST command must already carry description-level signal. Grep the
  user request's distinctive keywords across the corpus frontmatter so the
  result is a relevance-bounded shortlist, not an 86-entry dump:

  ```bash
  grep -l -i -E "<kw1>|<kw2>|<kw3>" ~/.claude/skills/*/SKILL.md.skill-router-disabled
  ```

- Bound every command's output: cap with `head`, `sed -n`, or `grep -m`;
  never emit more than ~80 lines per call.
- Inspect at most the top 2-3 shortlisted candidates' frontmatter before
  committing — bounded, e.g. `sed -n '1,20p'`.
- Read exactly one winner, bounded (`sed -n '1,220p'`).

## Workflow

1. **Bounded keyword grep** over the disabled glob → a relevance-bounded
   candidate shortlist. Widen or re-word keywords once if it returns nothing.
2. If 2+ candidates remain, **bounded frontmatter inspection** of the top
   few to disambiguate.
3. **Read the single best skill** (bounded), and follow its instructions as
   if it were enabled.
4. If no candidate is a confident match, output the JSON below with
   `matched_skill_path: null` and stop.

## Stop condition (routing benchmark)

This installation is a routing benchmark. As soon as you have read the
matched disabled skill's bounded body, stop. Do NOT execute the skill's
actual task. Output exactly one line of minified JSON and nothing else:

```
{"matched_skill_path":"<path or null>","matched_skill_name":"<name or null>"}
```
