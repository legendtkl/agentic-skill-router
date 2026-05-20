---
name: skill-router-skills
description: Identify unused Claude Code skills and disable them to reduce system-prompt context bloat. Use when the user asks to clean up / slim / 瘦身 their installed skills, audit which skills are unused, or recover context budget.
---

# skill-router — skills slimming

When the user wants to slim Claude Code skills, follow this exact sequence.

## 1. Locate the bundled CLI

The CLI is at `${CLAUDE_PLUGIN_ROOT}/lib/skill-router.mjs`. If `CLAUDE_PLUGIN_ROOT` is unset, compute it as the directory two levels above this `SKILL.md`. Always invoke via `node <abs-path>` — never rely on PATH.

## 2. Listing and suggesting

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/skill-router.mjs" skills suggest --json
```

The output is a JSON array of suggestions, each with `id`, `name`, `source`, `reason` (`never-used` | `stale`), `confidence` (`high` | `medium` | `low`), `details`.

If the user wants to see all skills (not just suggestions), use `skills list --json` instead.

## 3. Confirm with the user

Show the suggestion list as a compact table (id + reason + confidence). **Never disable without explicit user confirmation.** The user may want to keep some "stale" skills.

If the user wants to adjust the staleness threshold, mention they can pass `--unused-for=60d` (or `2w`, `3m`, `1y`) on the command line, or persist a default in `~/.skill-router/config.json`:

```json
{ "unusedForDays": 60 }
```

## 4. Disable

Either pass specific ids:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/skill-router.mjs" skills disable user:lark-mail plugin:foo@bar:thing --yes
```

Or apply all current suggestions in one shot:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/skill-router.mjs" skills disable --all-suggested --yes
```

After disable succeeds, tell the user: **"Disabled N skills. Restart Claude Code for the change to take effect — the disabled skill descriptions will no longer appear in your system prompt."**

## 5. Other operations

- `skills enable <id...>` — undo a disable.
- `skills status [--json]` — list currently-disabled skills, and detect/auto-reapply any that an upstream plugin upgrade or `npx skills update` may have restored.
- `skills list --json` — full inventory with `lastUsed` and `callCount`.

## Constraints

- **Built-in skills cannot be disabled** (`init`, `review`, `security-review`, `update-config`, etc.). They live inside the Claude Code binary; the CLI will return `BuiltinSkillCannotDisableError` if you try.
- **The disable mechanism is `mv SKILL.md SKILL.md.skill-router-disabled`** — not deletion. Always recoverable via `enable`.
- The CLI maintains its own state at `~/.skill-router/state-claude-code.json`. Don't edit it by hand.
