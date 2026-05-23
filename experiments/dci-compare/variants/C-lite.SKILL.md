---
name: skill-router-skills
description: skill-router routes a set of locally disabled Agent Skills. When a request needs a skill capability that no currently enabled skill can satisfy, use this to discover and load a more suitable disabled skill.
metadata:
  skill-router.version: "1"
  skill-router.variant: "C-lite"
---

# skill-router - Variant C (DCI-Agent-Lite style)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Disabled skill corpus

Disabled skill files live at:

```
~/.claude/skills/<skill-id>/SKILL.md.skill-router-disabled
```

Each file starts with a YAML frontmatter block containing `name:` and
`description:`, followed by a markdown body.

## Workflow (DCI-Agent-Lite: bash-only with composable pipelines)

This variant follows the "Direct Corpus Interaction" minimal harness from
arXiv:2605.05242 §3 (DCI-Agent-Lite). Use **only the Bash tool** — do NOT
use the Read tool. Every step must bound its output (`head`, `tail`, `sed`,
or `wc -l`); never dump unbounded file contents.

### Core operations

- **list / find candidates** — corpus enumeration:

  ```bash
  ls ~/.claude/skills/*/SKILL.md.skill-router-disabled | wc -l
  ```

- **exact match** with line numbers — discover relevant skills:

  ```bash
  grep -l -i "<keyword>" ~/.claude/skills/*/SKILL.md.skill-router-disabled
  grep -n -i "<keyword>" ~/.claude/skills/*/SKILL.md.skill-router-disabled | head -20
  ```

- **pipeline composition** — combine weak clues into a strong constraint
  (this is the core DCI-Lite primitive):

  ```bash
  grep -l -i "<kw1>" ~/.claude/skills/*/SKILL.md.skill-router-disabled \
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
4. Pick one winner. Read its body in a bounded window with
   `sed -n '1,200p' <path>` (do NOT cat the whole file). Then follow the
   selected disabled skill's instructions.
5. If no winner emerges, output the JSON below with
   `matched_skill_path: null` and stop.

There is no router CLI in this variant. Compose primitives yourself.

## Stop condition (routing benchmark)

This installation is a routing benchmark. As soon as you have read the
matched disabled skill's bounded body (step 4), stop. Do NOT execute the
skill's actual task. Output exactly one line of minified JSON and nothing
else:

```
{"matched_skill_path":"<path or null>","matched_skill_name":"<name or null>"}
```
