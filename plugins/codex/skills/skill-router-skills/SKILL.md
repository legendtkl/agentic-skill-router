---
name: skill-router-skills
description: Identify unused Codex skills and disable them to reduce system-prompt context bloat. Use when the user asks to clean up / slim / 瘦身 their Codex skills, audit which skills are unused, or recover context budget.
---

# skill-router — Codex skills slimming

When the user wants to slim Codex skills, follow this exact sequence.

## 1. Locate the bundled CLI

Prefer `${SKILL_ROUTER_CLI}` if set. Otherwise locate the newest installed bundle:

```bash
find "${CODEX_HOME:-$HOME/.codex}/plugins/cache/local/skill-router" -path '*/lib/skill-router.mjs' -type f 2>/dev/null | sort | tail -1
```

If that finds nothing, check the current repository path:

```bash
test -f plugins/codex/lib/skill-router.mjs && pwd
```

Always invoke via `node <abs-path>` and always pass `--host=codex`.

## 2. Listing and suggesting

```bash
node "<abs-path>/skill-router.mjs" --host=codex skills suggest --json
```

The output is a JSON array of suggestions, each with `id`, `name`, `source`, `reason` (`never-used` | `stale`), `confidence` (`high` | `medium` | `low`), `details`.

If the user wants to see all skills, use `skills list --json`.

## 3. Confirm with the user

Show the suggestion list as a compact table with id, reason, and confidence. Never disable without explicit user confirmation.

If the user wants to adjust the staleness threshold, mention `--unused-for=60d` (or `2w`, `3m`, `1y`) or persist a default in `~/.skill-router/config.json`:

```json
{ "unusedForDays": 60 }
```

## 4. Disable

Either pass specific ids:

```bash
node "<abs-path>/skill-router.mjs" --host=codex skills disable user:codex:lark-mail plugin:gmail@openai-curated:gmail --yes
```

Or apply all current suggestions in one shot:

```bash
node "<abs-path>/skill-router.mjs" --host=codex skills disable --all-suggested --yes
```

After disable succeeds, tell the user: "Disabled N skills. Restart Codex or start a new Codex session for the change to take effect."

## 5. Other operations

- `skills enable <id...>` — undo a disable.
- `skills status [--json]` — list currently-disabled skills and detect/auto-reapply any that an upstream plugin or skill update may have restored.
- `skills list --json` — full inventory with `lastUsed` and `callCount`.

## Constraints

- Codex system skills under `~/.codex/skills/.system` cannot be disabled.
- The disable mechanism is `mv SKILL.md SKILL.md.skill-router-disabled`, not deletion.
- State is kept at `~/.skill-router/state-codex.json`.
