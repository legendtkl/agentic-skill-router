---
description: Route disabled Codex skills and audit/slim installed skills with skill-router
argument-hint: "[route <query>|dci search <query>|dci open <ref>|list|suggest|status|enable <id...>|disable <id...>|--unused-for=60d]"
---

Use skill-router to route requests to disabled Codex skills, audit installed skills, suggest unused/stale skills, and safely disable or re-enable selected skills.

Input after `/skill-router:skills` is optional:
- `route <query>`: route the query to a disabled skill and return the `SKILL.md.skill-router-disabled` file to read. Default route mode is `auto`.
- `route --mode=lexical|dci|auto <query>`: force a routing strategy for evaluation or debugging.
- `dci search <query>`: run bounded multi-query search over disabled skill bodies when lexical routing is not confident.
- No input or `suggest`: show cleanup suggestions.
- `list`: show all Codex skills.
- `status`: show disabled skills and repair/reapply status.
- `enable <id...>`: re-enable the listed skills.
- `disable <id...>`: disable the listed skills after confirmation.
- `--unused-for=<duration>` may be included with `suggest` or `disable --all-suggested`.

## Locate CLI

Prefer `${SKILL_ROUTER_CLI}` if set. Otherwise locate the newest installed bundle:

```bash
find "${CODEX_HOME:-$HOME/.codex}/plugins/cache/local/skill-router" -path '*/bin/skill-router' -type f 2>/dev/null | sort | tail -1
```

If not installed but the current working directory is this repository, use:

```bash
test -x plugins/codex/bin/skill-router && printf '%s\n' "$PWD/plugins/codex/bin/skill-router"
```

Always run commands as:

```bash
"<abs-path-to-skill-router>" --host=codex skills ...
```

## Behavior

1. Parse the user's slash-command arguments.
2. For `route <query>`, run `skills route --query "<query>" --json`. This defaults to `auto`: lexical first, then DCI verification when the lexical result is ambiguous or too broad. If it returns `action: "read-skill-file"`, read `selected.skillMdPath` and follow that disabled skill's instructions.
3. If route returns `action: "no-confident-match"`, run `skills dci budget --json`, then run `skills dci search --query "<query>" --query "<derived query>" --json` with at most 3 queries total. Use candidate `ref` values for follow-up commands. Stay within the returned budget: max 8 candidates, max 3 `find`/`open` calls, max 2 full `read` calls, and max selections 3.
4. Use literal `skills dci grep`, `skills dci find <ref> --pattern "<text>"`, `skills dci open <ref> --line N --window 80`, `skills dci inspect <ref>`, and at most 2 `skills dci read <ref> --json` calls only for plausible candidates. If one or more disabled skills are clearly supported by evidence, run `skills dci select <ref...> --query "<query>" --confidence=high|medium --reason "<brief evidence>" --json`, then read only the returned `selected[*].skillMdPath` files needed for the task.
5. For `dci search <query>`, run bounded `skills dci search --query "<query>" --json` and show concise candidate refs, ids, and snippets; do not select unless evidence is clear.
6. For `list`, run `skills list --json` and show a compact table with id, source, disabled state, last used, and call count.
7. For `status`, run `skills status --json` and summarize disabled records, routed usage, reapplied records, orphaned records, conflicts, and orphan markers.
8. For no input or `suggest`, run `skills suggest --json` with any provided `--unused-for` value. Show id, reason, confidence, and details. Do not disable anything.
9. For `disable <id...>`, first show the target ids and ask for explicit confirmation. Only after confirmation, run `skills disable <id...> --yes`.
10. For `disable --all-suggested`, first run `skills suggest --json`, show the suggestions, and ask for explicit confirmation. Only after confirmation, run `skills disable --all-suggested --yes` with the same `--unused-for` value.
11. For `enable <id...>`, run `skills enable <id...>`; confirmation is not required because it restores skills.

After disabling, tell the user to restart Codex or start a new Codex session for the skill list to refresh.

## Safety

- Never delete skill directories or `SKILL.md` files.
- Never disable without explicit user confirmation.
- If a command reports a split-brain conflict, tell the user which skill needs manual repair and stop.
- Codex system skills under `~/.codex/skills/.system` are protected and cannot be disabled.
- Do not disable a whole plugin when disabled skills still need that plugin's MCP/app tools.
