---
name: skill-router-skills
description: Use when the user asks to audit, slim, disable, restore, or route locally installed Agent Skills for Claude Code or Codex. For Codex, also use as a last-resort resolver for locally disabled skills before falling back to general knowledge.
metadata:
  skill-router.version: "1"
  skill-router.hosts: "claude-code,codex"
---

# skill-router - Agent Skills routing and slimming

Use this skill when the user wants to inspect installed Agent Skills, identify
unused or stale skills, disable or restore skills, or route a Codex request to a
locally disabled skill. Keep the workflow host-aware: Claude Code uses skill
management by default, while Codex also uses disabled-skill routing as a
last-resort fallback.

## Locate the CLI

Prefer `${SKILL_ROUTER_CLI}` when it is set. Otherwise locate the bundled
`skill-router` executable for the active host:

- Claude Code: use `${CLAUDE_PLUGIN_ROOT}/bin/skill-router`. If
  `${CLAUDE_PLUGIN_ROOT}` is unset, compute it as the directory two levels above
  this `SKILL.md`.
- Codex: find the newest installed local plugin bundle under
  `${CODEX_HOME:-$HOME/.codex}/plugins/cache/local/skill-router/*/bin/skill-router`.
  If that is not available and the current working directory is this repository,
  use `plugins/codex/bin/skill-router`.

Always invoke the CLI by absolute path. Pass `--host=codex` for Codex. Claude
Code is the default host, but `--host=claude-code` is also accepted.

## Manage skills

For cleanup requests, run:

```bash
"<abs-path-to-skill-router>" --host=<claude-code|codex> skills suggest --json
```

Show suggestions as a compact table with id, reason, confidence, and details.
Never disable without explicit user confirmation. After confirmation, disable
specific ids or all current suggestions:

```bash
"<abs-path-to-skill-router>" --host=<claude-code|codex> skills disable <id...> --yes
"<abs-path-to-skill-router>" --host=<claude-code|codex> skills disable --all-suggested --yes
```

Use `skills list --json` for a full inventory, `skills status --json` for
disabled records and repair status, and `skills enable <id...>` to restore
previously disabled skills.

If the user wants to adjust the staleness threshold, mention
`--unused-for=60d` (or `2w`, `3m`, `1y`) or the persistent config at
`~/.skill-router/config.json`:

```json
{ "unusedForDays": 60, "routeMode": "auto" }
```

## Route disabled Codex skills

In Codex only, use this as a closed last-resort fallback when no enabled skill
clearly matches and the request looks skill-shaped: operating, querying,
configuring, deploying, inspecting, or troubleshooting a named tool, API,
service, dashboard, datastore, CLI, DSL, URL, or platform workflow.

Run the route command before solving from general knowledge:

```bash
"<abs-path-to-skill-router>" --host=codex skills route --query "<current user request>" --json
```

If the result has `action: "read-skill-file"` and a non-null `selected`, read
`selected.skillMdPath` even when it ends in `SKILL.md.skill-router-disabled`,
then follow that disabled skill's instructions as if it were enabled.

If route mode needs to be evaluated or debugged, use
`--mode=metadata|body|lexical|dci|auto`. `dci` is a legacy alias for bounded
body search and verification; it is not an autonomous research agent.

If `auto` returns `action: "no-confident-match"`, use the bounded body tools in
`references/disabled-routing.md`. Stop the router path if the evidence still
does not identify a confident disabled-skill match.

## Safety

- Built-in and system skills are protected and cannot be disabled.
- The disable mechanism is a rename: `SKILL.md` to
  `SKILL.md.skill-router-disabled`. Never delete skill files.
- Never disable a skill without explicit user confirmation.
- Do not disable a whole plugin when a disabled skill still depends on that
  plugin's MCP tools or app tools.
- State is stored under `~/.skill-router/state-claude-code.json` or
  `~/.skill-router/state-codex.json`.

## References

- `references/cli-location.md` - host-specific CLI lookup details.
- `references/slimming.md` - listing, suggestions, disable, enable, and status.
- `references/disabled-routing.md` - Codex route/body verification workflow.
- `references/safety.md` - confirmation, protection, and repair rules.
