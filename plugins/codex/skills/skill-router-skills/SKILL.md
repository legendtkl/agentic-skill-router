---
name: skill-router-skills
description: Use as a fallback when a request may need a specialized Codex skill that has been disabled or is not currently visible, and use when the user asks to clean up / slim / 瘦身 installed Codex skills, audit unused skills, or recover context budget.
---

# skill-router — Codex disabled-skill routing and slimming

Use this skill in two cases:

- The current request looks like it may need a specialized skill that is disabled or not visible in the available-skill list.
- The user wants to slim, audit, disable, restore, or inspect Codex skills.

## 1. Locate the bundled CLI

Prefer `${SKILL_ROUTER_CLI}` if set. Otherwise locate the newest installed bundle:

```bash
find "${CODEX_HOME:-$HOME/.codex}/plugins/cache/local/skill-router" -path '*/lib/skill-router.mjs' -type f 2>/dev/null | sort | tail -1
```

If that finds nothing, check the current repository path:

```bash
test -f plugins/codex/lib/skill-router.mjs && printf '%s\n' "$PWD/plugins/codex/lib/skill-router.mjs"
```

Always invoke via `node <abs-path-to-skill-router.mjs>` and always pass `--host=codex`.

## 2. Route a request to disabled skills

When selected as a disabled-skill fallback, do not solve the task directly first. Run:

```bash
node "<abs-path-to-skill-router.mjs>" --host=codex skills route --query "<current user request>" --json
```

If the result has `action: "read-skill-file"` and a non-null `selected`, read the returned `selected.skillMdPath` even when it ends in `SKILL.md.skill-router-disabled`. Then follow that disabled skill's instructions as if it were enabled.

If the route result has `action: "no-confident-match"`, continue normally without forcing a disabled skill.

The route command records routed usage automatically. Use `--no-record` only for audits or dry runs.

## 3. Listing and suggesting

```bash
node "<abs-path-to-skill-router.mjs>" --host=codex skills suggest --json
```

The output is a JSON array of suggestions, each with `id`, `name`, `source`, `reason` (`never-used` | `stale`), `confidence` (`high` | `medium` | `low`), `details`.

If the user wants to see all skills, use `skills list --json`.

## 4. Confirm with the user

Show the suggestion list as a compact table with id, reason, and confidence. Never disable without explicit user confirmation.

If the user wants to adjust the staleness threshold, mention `--unused-for=60d` (or `2w`, `3m`, `1y`) or persist a default in `~/.skill-router/config.json`:

```json
{ "unusedForDays": 60 }
```

## 5. Disable

Either pass specific ids:

```bash
node "<abs-path-to-skill-router.mjs>" --host=codex skills disable user:codex:lark-mail plugin:gmail@openai-curated:gmail --yes
```

Or apply all current suggestions in one shot:

```bash
node "<abs-path-to-skill-router.mjs>" --host=codex skills disable --all-suggested --yes
```

After disable succeeds, tell the user: "Disabled N skills. Restart Codex or start a new Codex session for the change to take effect."

## 6. Other operations

- `skills route --query "<text>" --json` — choose a disabled skill for the current request and return the file to read.
- `skills enable <id...>` — undo a disable.
- `skills status [--json]` — list currently-disabled skills and detect/auto-reapply any that an upstream plugin or skill update may have restored.
- `skills list --json` — full inventory with `lastUsed` and `callCount`.

## Constraints

- Codex system skills under `~/.codex/skills/.system` cannot be disabled.
- The disable mechanism is `mv SKILL.md SKILL.md.skill-router-disabled`, not deletion.
- State is kept at `~/.skill-router/state-codex.json`.
- Routing only proxies disabled skill instruction files. Do not disable a whole plugin if the disabled skill depends on that plugin's MCP tools or app tools.
