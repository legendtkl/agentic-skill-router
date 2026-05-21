---
name: skill-router-skills
description: Use when the user asks to audit, slim, disable, restore, or route locally installed Agent Skills across supported hosts.
metadata:
  skill-router.version: "1"
  skill-router.hosts: "claude-code,codex"
---

# skill-router - Agent Skills routing and slimming

Use this skill when the user wants to inspect installed Agent Skills, identify
unused or stale skills, disable or restore skills, or route a request to a
locally disabled skill. The skill instructions are host-neutral; installation
methods provide the host-specific plugin or slash-command entry point.

## Locate the CLI

Prefer `${SKILL_ROUTER_CLI}` when it is set. Otherwise locate the bundled CLI
next to this skill installation:

- Installed plugin: compute the directory two levels above this `SKILL.md`, then
  append `bin/skill-router`.
- Repository checkout: use `bin/skill-router`.

Always invoke the CLI by absolute path. Installed plugin CLIs auto-detect their
host from the plugin bundle. Repository checkout CLIs default to Claude Code.
Define a helper for the resolved CLI path:

```bash
skill_router() { "<abs-path-to-skill-router>" "$@"; }
```

## Manage skills

For cleanup requests, run:

```bash
skill_router skills suggest --json
```

Show suggestions as a compact table with id, reason, confidence, and details.
Never disable without explicit user confirmation. After confirmation, disable
specific ids or all current suggestions:

```bash
skill_router skills disable <id...> --yes
skill_router skills disable --all-suggested --yes
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

## Route disabled skills

Use this as a closed last-resort fallback when no enabled skill clearly matches
and the request looks skill-shaped: operating, querying, configuring, deploying,
inspecting, or troubleshooting a named tool, API, service, dashboard, datastore,
CLI, DSL, URL, or platform workflow.

Run the route command before solving from general knowledge:

```bash
skill_router skills route --query "<current user request>" --json
```

If the result has `action: "read-skill-file"` and a non-null `selected`, read
`selected.skillMdPath` even when it ends in `SKILL.md.skill-router-disabled`,
then follow that disabled skill's instructions as if it were enabled.

If route mode needs to be evaluated or debugged, use
`--mode=metadata|body|lexical|dci|auto`. `dci` is the compatibility command
group for bounded body search and verification.

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
- State is stored under `~/.skill-router/state-<host>.json`.

## References

- `references/cli-location.md` - CLI lookup details.
- `references/slimming.md` - listing, suggestions, disable, enable, and status.
- `references/disabled-routing.md` - route/body verification workflow.
- `references/safety.md` - confirmation, protection, and repair rules.
