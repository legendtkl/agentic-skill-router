---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "J-bounded-v2-body"
---

# skill-router - Variant J v2-body (description shortlist + bounded body inspection)

The disabled-skill corpus lives at `~/.claude/skills/*/SKILL.md.skill-router-disabled`.
Each file's YAML frontmatter has `name:` and `description:`, followed by
the skill body. This variant uses descriptions to **narrow** to a small
shortlist, then **reads bodies** to make the final pick — full skill
text is a stronger routing signal than the description alone.

This catalog may contain tens of thousands of skills. Do NOT use shell
globs like `~/.claude/skills/*/...` as command arguments; use
`find ... -print0 | xargs -0` to avoid the OS argument limit. Do not
truncate candidate lists with `head` — narrow your filters instead.

## Workflow

### 1. Pick keywords from the user request

Choose 3–5 distinctive keywords. Prefer narrow, technical terms (file
extensions like `.stl`, exact tool/API/service names, proper nouns,
error codes) over broad words. Broad words match too many candidates
at scale.

### 2. Build the description shortlist (no body access yet)

Glob-free, scale-safe; output is paths only:

```bash
find ~/.claude/skills -name SKILL.md.skill-router-disabled -print0 \
  | xargs -0 grep -l -i -E '^description:.*(<kw1>|<kw2>|<kw3>)'
```

### 3. Narrow until the shortlist is small

- If 0 paths: broaden one keyword and rerun.
- If too many paths (more than roughly 30): add a second AND filter
  via another `xargs grep -l`, or replace the broadest keyword with a
  more specific one. Re-run.
- Stop when the shortlist has between 1 and ~10 paths.

### 4. Read each candidate's frontmatter and body

For every path in the shortlist, read the frontmatter and the first
chunk of body:

```bash
for f in <shortlist-paths>; do
  echo "=== $(basename "$(dirname "$f")") ==="
  sed -n '1,80p' "$f"
  echo
done
```

This shows YAML frontmatter (`name`, `description`) plus the first
~70 lines of body — usually the "what this skill does", "when to use",
and the first concrete usage section. If a candidate's decisive
section appears later (e.g. it has long preamble), do one more
bounded read of that file (`sed -n '80,180p'` or a heading-anchored
slice).

### 5. Compare on semantic evidence only

Compare candidates on the actual content of their frontmatter and
body: stated use cases, expected inputs, operations performed,
outputs produced, constraints, and exclusions. Prefer the candidate
whose body explicitly covers the user's requested task —
artifact + operation + output match together, not just the topic.

Two things to **not** use as routing evidence:

- **Directory prefixes / path components.** They reflect how the
  catalog was assembled, not what the skill does. Two skills sitting
  in different folders may be equally valid candidates.
- **The skill's `name:` field shape.** Short or long, abbreviated or
  spelled out — the name is not the evidence; the body is.

### 6. Commit

Return the chosen `<skill-id>` (the directory name of the SKILL.md
file you decided on). If after reading bodies no candidate clearly
covers the requested task, fall back to general knowledge.
