---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "J-bounded-v2"
---

# skill-router - Variant J v2 (scale-stable keyword-filtered retrieval)

The disabled-skill corpus lives at `~/.claude/skills/*/SKILL.md.skill-router-disabled`.
Each file's YAML frontmatter has `name:` and `description:`, followed by the
skill body.

This catalog may contain tens of thousands of skills. **Do NOT use shell
globs like `~/.claude/skills/*/...` as command arguments — they expand into
huge argv and exceed the OS argument limit.** Use `find ... -print0 | xargs -0`
instead. Do not truncate candidate lists with `head` — if you have too many
candidates, NARROW your keywords until the list is small.

## Workflow

1. Pick 3–5 distinctive keywords from the user request. **Prefer narrow,
   technical terms** (file extensions like `.stl`, exact tool/API names,
   proper nouns, error codes) over broad words like `data`, `3D`, `build`,
   `analysis`. Broad words match hundreds of skills at scale and the
   answer drowns in noise.

2. Find candidate skills whose **description** contains AT LEAST ONE
   keyword. Glob-free, scale-safe:

   ```bash
   find ~/.claude/skills -name SKILL.md.skill-router-disabled -print0 \
     | xargs -0 grep -l -i -E '^description:.*(<kw1>|<kw2>|<kw3>)'
   ```

   `grep -l` returns one path per file — output stays small even when many
   files match.

3. Count the result. If 0 paths: keywords are too narrow — broaden one
   keyword and rerun. If > 30 paths: keywords are too broad — replace the
   broadest keyword with a narrower one (or AND a second filter onto the
   pipeline) and rerun. **Do not `head` your way to a smaller list — that
   silently throws away the right answer.**

4. Once the shortlist has 1–30 entries, inspect each candidate's
   description side-by-side:

   ```bash
   for f in <shortlist-paths>; do
     printf '%s\t' "$(basename "$(dirname "$f")")"
     grep -m1 '^description:' "$f" | cut -c1-300
   done
   ```

5. Pick the single best `<skill-id>` (the directory name). If two are
   genuinely close, inspect their full frontmatter
   (`sed -n '1,12p' <path>`) to disambiguate.

6. Return the chosen `<skill-id>`. (In a non-routing-only deployment you
   would Read the skill body next; in routing-only mode you stop after
   returning the id.)

If no description is a confident match after one keyword-narrowing pass,
fall back to general knowledge.
