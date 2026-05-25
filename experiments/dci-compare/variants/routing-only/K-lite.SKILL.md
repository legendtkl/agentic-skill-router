---
name: skill-router-skills
description: MUST be used FIRST, before any other tool, for EVERY user request that mentions a specific tool, API, file format, service, framework, library, CLI, platform, dataset, or domain workflow -- e.g. parsing/operating/querying/configuring/deploying/transcribing/analyzing/debugging/generating/refactoring/troubleshooting a named technology. A large catalog of disabled Agent Skills is installed locally; one of them likely specializes in this exact task. Invoke this skill FIRST to identify which one before attempting the task.
metadata:
  skill-router.version: "1"
  skill-router.variant: "K-lite"
---

# skill-router - Variant K-lite (scored metadata grep + compact tie-break)

Corpus: `~/.claude/skills/*/SKILL.md.skill-router-disabled`.

Use shell tools only. Do not invoke the `skill-router` CLI. Do not read skill
bodies. Route from `name`/`description` metadata only.

## Workflow

1. Pick 5-7 fixed-string keywords from the user request. Mix required
   operations/tools/file types with distinctive domain/method terms. For
   file-format tasks, include both the extension and the artifact family
   (`docx` + `document`, `pptx` + `presentation`) instead of only product
   names such as Word or PowerPoint. Avoid generic words alone.

2. Run one scored description-only pass across all descriptions, then print
   only the top rows. Strip paths before matching; do not stop at the first
   id-ordered grep matches:

   ```bash
   for f in ~/.claude/skills/*/SKILL.md.skill-router-disabled; do
     id=$(basename "$(dirname "$f")")
     desc=$(grep -m1 '^description:' "$f" | sed 's/^description:[[:space:]]*//; s/^"//; s/"$//')
     printf '%s\t%s\n' "$id" "$desc"
   done | awk -F '\t' -v k1="<kw1>" -v k2="<kw2>" -v k3="<kw3>" -v k4="<kw4>" -v k5="<kw5>" '
     {
       hay=tolower($0); score=0
       if (k1 && index(hay,tolower(k1))) score++
       if (k2 && index(hay,tolower(k2))) score++
       if (k3 && index(hay,tolower(k3))) score++
       if (k4 && index(hay,tolower(k4))) score++
       if (k5 && index(hay,tolower(k5))) score++
       if (score > 0) printf "%d\t%s\t%s\n", score, $1, $2
     }' | sort -rnk1,1 | head -10
   ```

   Add `k6`/`k7` checks if the request has more distinctive terms. Run a
   second pass only if the first pass has no plausible candidate or only
   generic candidates. Use alternate domain/method/action terms. Never dump
   the whole catalog.

3. If one candidate clearly covers the required operation, choose it. If two
   or three candidates remain genuinely plausible, inspect only those YAML
   frontmatters:

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

4. Choose by metadata evidence:
   - Prefer explicit coverage of the requested operation over nearby topic
     similarity.
   - If a dedicated file-format skill (`.docx` document, `.pptx` presentation,
     spreadsheet, PDF, etc.) and a broad office/file-management skill both
     match, prefer the dedicated file-format skill.
   - For tasks asking to retrieve answers/entities and write structured JSON,
     prefer metadata mentioning evidence/search/extraction/structured output
     over metadata about broad insight discovery, pattern discovery, or
     strategic planning.
   - Distinguish substrate from objective: choose a file/tool skill only when
     the task is to operate that file/tool; choose a domain skill when the
     named method/domain constraint is central.
   - If still tied, choose the metadata covering the most distinctive required
     verbs and nouns.

Return exactly one bare `skill-NNN`. Do not execute the task.
