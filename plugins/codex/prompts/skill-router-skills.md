---
description: Audit and slim installed Codex skills with skill-router
argument-hint: "[list|suggest|status|enable <id...>|disable <id...>|--unused-for=60d]"
---

Use skill-router to audit installed Codex skills, suggest unused/stale skills, and safely disable or re-enable selected skills.

Input after `/skill-router:skills` is optional:
- No input or `suggest`: show cleanup suggestions.
- `list`: show all Codex skills.
- `status`: show disabled skills and repair/reapply status.
- `enable <id...>`: re-enable the listed skills.
- `disable <id...>`: disable the listed skills after confirmation.
- `--unused-for=<duration>` may be included with `suggest` or `disable --all-suggested`.

## Locate CLI

Prefer `${SKILL_ROUTER_CLI}` if set. Otherwise locate the newest installed bundle:

```bash
find "${CODEX_HOME:-$HOME/.codex}/plugins/cache/local/skill-router" -path '*/lib/skill-router.mjs' -type f 2>/dev/null | sort | tail -1
```

If not installed but the current working directory is this repository, use:

```bash
plugins/codex/lib/skill-router.mjs
```

Always run commands as:

```bash
node "<abs-path-to-skill-router.mjs>" --host=codex skills ...
```

## Behavior

1. Parse the user's slash-command arguments.
2. For `list`, run `skills list --json` and show a compact table with id, source, disabled state, last used, and call count.
3. For `status`, run `skills status --json` and summarize disabled records, reapplied records, orphaned records, conflicts, and orphan markers.
4. For no input or `suggest`, run `skills suggest --json` with any provided `--unused-for` value. Show id, reason, confidence, and details. Do not disable anything.
5. For `disable <id...>`, first show the target ids and ask for explicit confirmation. Only after confirmation, run `skills disable <id...> --yes`.
6. For `disable --all-suggested`, first run `skills suggest --json`, show the suggestions, and ask for explicit confirmation. Only after confirmation, run `skills disable --all-suggested --yes` with the same `--unused-for` value.
7. For `enable <id...>`, run `skills enable <id...>`; confirmation is not required because it restores skills.

After disabling, tell the user to restart Codex or start a new Codex session for the skill list to refresh.

## Safety

- Never delete skill directories or `SKILL.md` files.
- Never disable without explicit user confirmation.
- If a command reports a split-brain conflict, tell the user which skill needs manual repair and stop.
- Codex system skills under `~/.codex/skills/.system` are protected and cannot be disabled.
