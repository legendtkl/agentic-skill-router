---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "H-bounded"
  skill-router.host: "codex"
---

# skill-router - Variant H (DCI-Agent-CC, bounded corpus access, Codex)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Disabled skill corpus

The disabled-skill corpus is EXACTLY this glob — nothing else:

```
~/.codex/skills/*/SKILL.md.skill-router-disabled
```

Every command you run against the corpus MUST target that glob. Never run a
bare `ls ~/.codex/skills/` — that enumerates every skill directory
indiscriminately (enabled, disabled, unrelated) and the bare directory names
carry no description-level signal.

## Bounded retrieval

Search with whatever shell tools you prefer (`grep`, `sed`, `awk`, `find`,
`head`) — but keep every step bounded:

- Your FIRST command must already carry description-level signal. Grep the
  user request's distinctive keywords across the corpus frontmatter so the
  result is a relevance-bounded shortlist, not an unbounded dump:

  ```bash
  grep -l -i -E "<kw1>|<kw2>|<kw3>" ~/.codex/skills/*/SKILL.md.skill-router-disabled
  ```

- Bound every command's output: cap with `head`, `sed -n`, or `grep -m`;
  never emit more than ~80 lines per call.
- Inspect at most the top 2-3 shortlisted candidates' frontmatter before
  committing — bounded, e.g. `sed -n '1,20p'`.
- Read exactly one winner, bounded (`sed -n '1,220p'`).

## Workflow

1. **Bounded keyword grep** over the disabled glob -> a relevance-bounded
   candidate shortlist. Widen or re-word keywords once if it returns nothing.
2. If 2+ candidates remain, **bounded frontmatter inspection** of the top
   few to disambiguate.
3. Return the chosen skill-id as your routing result. (In a non-routing-only
   deployment you would `sed -n '1,220p'` the body bounded and follow its
   instructions; in this routing-only session you do not.)
4. If no candidate is a confident match, fall back to general knowledge.
