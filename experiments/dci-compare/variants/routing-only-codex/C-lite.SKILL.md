---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "C-lite"
  skill-router.host: "codex"
---

# skill-router - Variant C (DCI-Agent-Lite style, Codex)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Disabled skill corpus

Disabled skill files live at:

```
~/.codex/skills/<skill-id>/SKILL.md.skill-router-disabled
```

Each file starts with a YAML frontmatter block containing `name:` and
`description:`, followed by a markdown body.

## Workflow (DCI-Agent-Lite: bash-only with composable pipelines)

This variant follows the "Direct Corpus Interaction" minimal harness from
arXiv:2605.05242 §3 (DCI-Agent-Lite). Use **only the shell tool** — do NOT
use a file-read tool. Every step must bound its output (`head`, `tail`,
`sed`, or `wc -l`); never dump unbounded file contents.

### Core operations

- **list / find candidates** — corpus enumeration:

  ```bash
  ls ~/.codex/skills/*/SKILL.md.skill-router-disabled | wc -l
  ```

- **exact match** with line numbers — discover relevant skills:

  ```bash
  grep -l -i "<keyword>" ~/.codex/skills/*/SKILL.md.skill-router-disabled
  grep -n -i "<keyword>" ~/.codex/skills/*/SKILL.md.skill-router-disabled | head -20
  ```

- **pipeline composition** — combine weak clues into a strong constraint
  (this is the core DCI-Lite primitive):

  ```bash
  grep -l -i "<kw1>" ~/.codex/skills/*/SKILL.md.skill-router-disabled \
    | xargs grep -l -i "<kw2>"
  ```

- **local inspection** with line numbers and bounded context:

  ```bash
  grep -n -i -B1 -A2 "<keyword>" <path> | head -40
  ```

- **bounded read** (frontmatter or first body block):

  ```bash
  sed -n '1,30p' <path>      # frontmatter
  sed -n '1,200p' <path>     # initial body window
  ```

### Loop (truncation/compaction discipline)

1. Pick 2-4 distinctive keywords from the user's request (proper nouns,
   tool/API/platform/file-type/verb).
2. Run a composable pipeline that AND-combines 2 strong keywords to narrow
   candidates (see "pipeline composition" above).
3. For each finalist, read frontmatter only via `sed -n '1,30p'`.
4. Pick one winner and return its skill-id as your chosen routing result.
   (In a non-routing-only deployment you would `sed -n '1,200p' <path>` and
   follow its instructions; in this routing-only session you do not.)
5. If no winner emerges, fall back to general knowledge.

There is no router CLI in this variant. Compose primitives yourself.
