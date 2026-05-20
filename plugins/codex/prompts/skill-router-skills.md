---
description: Route disabled Codex skills and audit/slim installed skills with skill-router
argument-hint: "[route <query>|dci search <query>|list|suggest|status|enable <id...>|disable <id...>|--unused-for=60d]"
---

Use skill-router to route requests to disabled Codex skills, audit installed skills, suggest unused/stale skills, and safely disable or re-enable selected skills.

Input after `/skill-router:skills` is optional:
- `route <query>`: route the query to a disabled skill and return the `SKILL.md.skill-router-disabled` file to read.
- `dci search <query>`: search disabled skill bodies directly when lexical routing is not confident.
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
2. For `route <query>`, run `skills route --query "<query>" --json`. If it returns `action: "read-skill-file"`, read `selected.skillMdPath` and follow that disabled skill's instructions.
3. If route returns `action: "no-confident-match"`, run `skills dci search --query "<query>" --json`. Use literal `skills dci grep`, `skills dci inspect`, and `skills dci read` only for plausible candidates. If one disabled skill is clearly supported by evidence, run `skills dci select <id> --query "<query>" --confidence=high --reason "<brief evidence>" --json`, then read the returned path.
4. For `dci search <query>`, run `skills dci search --query "<query>" --json` and show only concise candidate ids and snippets; do not select unless evidence is clear.
5. For `list`, run `skills list --json` and show a compact table with id, source, disabled state, last used, and call count.
6. For `status`, run `skills status --json` and summarize disabled records, routed usage, reapplied records, orphaned records, conflicts, and orphan markers.
7. For no input or `suggest`, run `skills suggest --json` with any provided `--unused-for` value. Show id, reason, confidence, and details. Do not disable anything.
8. For `disable <id...>`, first show the target ids and ask for explicit confirmation. Only after confirmation, run `skills disable <id...> --yes`.
9. For `disable --all-suggested`, first run `skills suggest --json`, show the suggestions, and ask for explicit confirmation. Only after confirmation, run `skills disable --all-suggested --yes` with the same `--unused-for` value.
10. For `enable <id...>`, run `skills enable <id...>`; confirmation is not required because it restores skills.

After disabling, tell the user to restart Codex or start a new Codex session for the skill list to refresh.

## Safety

- Never delete skill directories or `SKILL.md` files.
- Never disable without explicit user confirmation.
- If a command reports a split-brain conflict, tell the user which skill needs manual repair and stop.
- Codex system skills under `~/.codex/skills/.system` are protected and cannot be disabled.
- Do not disable a whole plugin when disabled skills still need that plugin's MCP/app tools.
