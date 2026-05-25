---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow -- e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "J-bounded-v2"
  skill-router.host: "codex"
---

# skill-router - Variant J v2 (scale-stable keyword-filtered retrieval, Codex)

The disabled-skill corpus lives at `~/.codex/skills/*/SKILL.md.skill-router-disabled`.
Each file's YAML frontmatter has `name:` and `description:`, followed by the
skill body or a metadata-only routing stub.

This catalog may contain tens of thousands of skills. Do not use shell globs
like `~/.codex/skills/*/...` as command arguments; they expand into huge argv
and can exceed the OS argument limit. Use `find ... -print0 | xargs -0`
instead. Do not truncate candidate lists with `head`; if you have too many
candidates, narrow your keywords until the list is small.

## Workflow

1. Pick 3-5 distinctive keywords from the user request. Prefer narrow,
   technical terms (file extensions like `.stl`, exact tool/API names, proper
   nouns, error codes) over broad words like `data`, `3D`, `build`,
   `analysis`. Broad words match hundreds of skills at scale and the answer
   drowns in noise.

2. Find candidate skills whose description contains at least one keyword.
   Glob-free, scale-safe:

   ```bash
   find ~/.codex/skills -name SKILL.md.skill-router-disabled -print0 \
     | xargs -0 grep -l -i -E '^description:.*(<kw1>|<kw2>|<kw3>)'
   ```

   `grep -l` returns one path per file, so output stays small even when many
   files match.

3. Count the result. If 0 paths: keywords are too narrow, broaden one keyword
   and rerun. If > 30 paths: keywords are too broad, replace the broadest
   keyword with a narrower one or AND a second filter onto the pipeline and
   rerun. Do not use `head` to make a smaller list; that silently throws away
   the right answer.

4. Once the shortlist has 1-30 entries, inspect each candidate's frontmatter
   side-by-side:

   ```bash
   for f in <shortlist-paths>; do
     printf '%s\t' "$(basename "$(dirname "$f")")"
     sed -n '1,8p' "$f"
   done
   ```

5. Pick the single best `<skill-id>`: the directory name from the selected
   path. In routing-only mode, stop after returning that id; do not execute the
   user's task and do not read the skill body.

If no description is a confident match after one keyword-narrowing pass, fall
back to general knowledge.
