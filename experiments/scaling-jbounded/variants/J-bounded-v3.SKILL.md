---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow — e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "J-bounded-v3"
---

# skill-router - Variant J v3 (facet-decomposed nd-only retrieval)

The disabled-skill corpus lives at `~/.claude/skills/*/SKILL.md.skill-router-disabled`.
Each file's YAML frontmatter has `name:` and `description:`, followed by
the skill body. You will **not** read bodies in this variant — only
descriptions.

This catalog may contain tens of thousands of skills. Do NOT use shell
globs like `~/.claude/skills/*/...` as command arguments; use
`find ... -print0 | xargs -0` to avoid the OS argument limit. Do not
truncate candidate lists with `head` — if a list is too long, narrow
your filters until it is small.

## Workflow

### 1. Decompose the request into facets

Before any grep, identify the request's facets in your own words:

- **subject / domain** — what topic or field is this about?
- **artifact / data type** — what kind of file or data is being
  processed (`.stl`, BibTeX, options chain, audio, ...)?
- **operation** — what is actually being done (parse, validate, render,
  configure, summarise, ...)?
- **output** — what does the result look like (a JSON, a chart, a
  decision, ...)?
- **named technology** — does the request name a tool, library, API,
  or service by name? If yes, that name is a strong anchor.

Not every facet will be present. Use whatever is.

### 2. Build a facet-anchored grep

Pick keywords for at least **two independent facets** from step 1
(treat exact terms and clear synonyms as equivalent). Glob-free,
scale-safe:

```bash
find ~/.claude/skills -name SKILL.md.skill-router-disabled -print0 \
  | xargs -0 grep -l -i -E '^description:.*(<facet1-kw1>|<facet1-kw2>)' \
  | xargs grep -l -i -E '^description:.*(<facet2-kw1>|<facet2-kw2>)'
```

`grep -l` returns one path per matching file — stable output size even
at 80K candidates. The second `xargs grep -l` AND-chains a second
facet so only candidates that mention both facets survive.

### 3. Iterate on shortlist size

- If 0 paths: relax the weaker facet (drop or broaden it) and re-grep.
- If > ~30 paths: add a third facet, or replace the broadest keyword
  with a more specific one. **Do not `head` your way to a smaller
  list** — that silently throws away the right answer.
- Target shortlist size: 1–20 paths.

### 4. Read each candidate's description in one bounded command

```bash
for f in <shortlist-paths>; do
  printf '%s\t' "$(basename "$(dirname "$f")")"
  grep -m1 '^description:' "$f" | cut -c1-300
done
```

### 5. Rank candidates by facet coverage and specificity

For each candidate, evaluate two things from its description alone:

- **Facet coverage** — how many of the request's facets does the
  candidate's description cover? A candidate that covers
  domain + operation + output beats one that covers only the
  artifact or only the tool.
- **Specificity match** — does the candidate's description advertise a
  narrow use-case that matches the request, or a broad
  general-purpose capability that *could* be used for this request
  but is not about it?

Prefer specific over general. If a candidate description only
advertises a general-purpose implementation vehicle (e.g. a generic
spreadsheet manipulator, a generic file-format reader, a
language-runtime catch-all), choose it only when:

- the user request explicitly names that vehicle, **or**
- no more task-specific candidate remains after another search round.

### 6. Contrastive verification before committing

Before returning a result, name your top 2 candidates and state one
discriminating piece of description-only evidence between them. If
you cannot articulate a discriminator for some requested
operation/output/constraint facet, that facet is your next grep
anchor — go back to step 2 with it.

### 7. Hygiene — no path-prefix reasoning

Use only the description text (and frontmatter `name:` value) as
routing evidence. **Do not** treat directory prefixes, parent
folders, or naming conventions as semantic signals — those reflect
how the corpus was assembled, not what the skill does.

### 8. Commit

Return the chosen `<skill-id>` (the directory name). If after one
narrowing pass no candidate description is a confident match, fall
back to general knowledge.
