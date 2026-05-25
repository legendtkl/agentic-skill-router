---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow -- e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "K-bounded"
---

# skill-router - Variant K (bounded grep with metadata tie-break)

The disabled-skill corpus is at `~/.claude/skills/*/SKILL.md.skill-router-disabled`.
Each file's YAML frontmatter has `name:` and `description:`, followed by a
markdown body with the skill's actual instructions.

## Workflow

Use shell tools only. Do not invoke the `skill-router` CLI. Do not read skill
bodies. Route from descriptions first, then inspect only YAML frontmatter when
the shortlist is ambiguous.

1. Pick two small keyword groups from the user request:
   - **tool/file/action terms**: proper nouns, CLIs, APIs, file extensions,
     verbs, or required operations.
   - **domain/task terms**: domain words, algorithms, data sources, or objects
     being manipulated.

   Avoid relying on generic words by themselves (`data`, `analysis`, `report`,
   `file`, `output`, `json`). Pair them with distinctive terms when needed.

2. Run at most two bounded description-only grep passes. Strip paths before
   matching so query terms cannot match file paths or directory names:

   ```bash
   for f in ~/.claude/skills/*/SKILL.md.skill-router-disabled; do
     id=$(basename "$(dirname "$f")")
     desc=$(grep -m1 '^description:' "$f" | sed 's/^description:[[:space:]]*//; s/^"//; s/"$//')
     printf '%s\t%s\n' "$id" "$desc"
   done | grep -iF -e "<kw1>" -e "<kw2>" -e "<kw3>" | head -12
   ```

   First use the strongest tool/file/action terms. If that misses an obvious
   domain candidate, run one second pass with domain/task terms. Do not dump the
   whole catalog.

3. Build a candidate set from the grep output:
   - Keep at most 3 plausible `skill-NNN` candidates.
   - If exactly one candidate directly covers the required operation, choose it.
   - If 2-3 candidates remain plausible, inspect only their YAML frontmatter.

4. For metadata tie-breaks, read frontmatter boundaries, not a fixed line count
   and not the markdown body:

   ```bash
   for id in skill-AAA skill-BBB skill-CCC; do
     f=~/.claude/skills/$id/SKILL.md.skill-router-disabled
     printf '\n### %s\n' "$id"
     awk '
       NR > 40 { exit }
       NR == 1 && $0 == "---" { print; fm=1; next }
       fm && $0 == "---" { print; exit }
       fm && (/^[A-Za-z][A-Za-z0-9_-]*:[[:space:]]/ || /^[[:space:]]/ || /^$/) { print; next }
       fm { exit }
     ' "$f"
   done
   ```

   If a file lacks a closing `---`, the command stops at line 40 or at the
   first non-metadata line. Decide from the available metadata. Do not extend
   into the body.

5. Choose by metadata evidence, not by topic similarity alone:
   - Prefer the candidate whose `description` explicitly covers the required
     operation, not just a nearby subject area.
   - Separate the task substrate from the task objective. A file format,
     service, framework, or CLI may be only the medium; choose the substrate
     skill only when the requested operation is to manipulate that medium.
   - If the request requires a named method, algorithm, protocol, or domain
     constraint, prefer the candidate whose metadata names that specialized
     capability over a generic data/file/tool skill.
   - If the request is primarily editing, converting, querying, or operating a
     named tool or file type, prefer the candidate whose metadata states that
     operational capability over a candidate that only matches the content
     topic.
   - If candidates remain tied, choose the one whose metadata covers the most
     distinctive required verbs and nouns from the user request.

6. Return the chosen `<skill-id>` as your routing result. In this routing-only
   session, do not execute the user's task and do not read the chosen skill body.

If no description is a confident match after the bounded passes and metadata
tie-break, fall back to general knowledge.
