---
name: skill-router-skills
description: "Last-resort resolver for locally disabled Codex skill instruction files. Use when no available skill clearly matches and you would otherwise answer from general knowledge or web search for a skill-shaped request: operating, querying, configuring, deploying, inspecting, or troubleshooting a named tool, API, service, dashboard, datastore, CLI, DSL, URL, or platform workflow. The router searches disabled skills once; if none match, close the router path and continue normally. Also use to clean up / slim / 瘦身 installed Codex skills, audit unused skills, or recover context budget."
---

# skill-router — Codex disabled-skill routing and slimming

Use this skill in two cases:

- No available skill clearly matches the current request, and you would otherwise answer from general knowledge or web search, but the request looks skill-shaped: it asks to operate, query, configure, deploy, inspect, or troubleshoot a named tool, API, service, dashboard, datastore, CLI, DSL, URL, or platform workflow. Check this router once before using general knowledge or web search.
- The user wants to slim, audit, disable, restore, or inspect Codex skills.

Do not hard-code a product list in your decision. Use this as a closed fallback: if an enabled visible skill clearly matches, use that skill instead; if metadata route plus bounded body verification finds no confident disabled-skill match, stop the router path for this request and continue normally.

## 1. Locate the bundled CLI

Prefer `${SKILL_ROUTER_CLI}` if set. Otherwise locate the newest installed bundle:

```bash
find "${CODEX_HOME:-$HOME/.codex}/plugins/cache/local/skill-router" -path '*/bin/skill-router' -type f 2>/dev/null | sort | tail -1
```

If that finds nothing, check the current repository path:

```bash
test -x plugins/codex/bin/skill-router && printf '%s\n' "$PWD/plugins/codex/bin/skill-router"
```

Always invoke via `"<abs-path-to-skill-router>"` and always pass `--host=codex`.

## 2. Route a request to disabled skills

When selected as a disabled-skill fallback, do not solve the task directly first. Run the default route command. It uses `auto` mode: metadata routing first, with bounded body verification when metadata is low-confidence, ambiguous, or points at a broad umbrella skill.

```bash
"<abs-path-to-skill-router>" --host=codex skills route --query "<current user request>" --json
```

If the result has `action: "read-skill-file"` and a non-null `selected`, read the returned `selected.skillMdPath` even when it ends in `SKILL.md.skill-router-disabled`. Then follow that disabled skill's instructions as if it were enabled.

For audits or comparisons, force route mode with `--mode=metadata`, `--mode=body`, `--mode=lexical`, `--mode=dci`, or `--mode=auto`. The persistent default is `routeMode` in `~/.skill-router/config.json`; default is `auto`. `dci` is a legacy alias for body search / body verification; it is not a full autonomous DCI research agent.

If the auto route result still has `action: "no-confident-match"`, use the bounded body-verification corpus tools before giving up. Stay within this prompt budget:

- Max queries: 3
- Max candidates to consider from search: 8
- Max `find` / `open` calls total: 3
- Max full `read` calls: 2
- Max selections: 3
- Max `open` output: 24,000 characters

You can check the current limits with:

```bash
"<abs-path-to-skill-router>" --host=codex skills dci budget --json
```

Start with a multi-query search: include the raw request plus up to two short derived queries containing distinctive APIs, product names, or intent words.

```bash
"<abs-path-to-skill-router>" --host=codex skills dci search --query "<current user request>" --query "<derived query>" --json
```

Search results include stable candidate `ref` values such as `dci-abc123def0`. Use refs for follow-up commands when present. Inspect, find inside, or open windows only for plausible disabled candidates:

```bash
"<abs-path-to-skill-router>" --host=codex skills dci inspect "<skill-id-or-ref>" --json
"<abs-path-to-skill-router>" --host=codex skills dci find "<skill-id-or-ref>" --pattern "<distinctive phrase>" --json
"<abs-path-to-skill-router>" --host=codex skills dci open "<skill-id-or-ref>" --line <line> --window 80 --json
```

You may also run a narrow literal direct-corpus search when a distinctive phrase or API name is visible:

```bash
"<abs-path-to-skill-router>" --host=codex skills dci grep --pattern "<distinctive phrase>" --json
```

If the body-verification evidence clearly identifies one disabled skill, record the selection and then read the returned path:

```bash
"<abs-path-to-skill-router>" --host=codex skills dci select "<skill-id-or-ref>" --query "<current user request>" --confidence=high --reason "<brief evidence>" --json
```

If the evidence clearly identifies multiple complementary disabled skills, select at most 3 refs/ids in one command:

```bash
"<abs-path-to-skill-router>" --host=codex skills dci select "<ref-a>" "<ref-b>" --query "<current user request>" --confidence=medium --reason "<brief evidence>" --json
```

After selection, read only the returned `selected[*].skillMdPath` files needed to perform the task. If body search/grep/find/open still leaves multiple plausible skills or no evidence, continue normally without forcing a disabled skill.

The route and body/DCI select commands record routed usage automatically. Use `--no-record` only for audits or dry runs.

## 3. Listing and suggesting

```bash
"<abs-path-to-skill-router>" --host=codex skills suggest --json
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
"<abs-path-to-skill-router>" --host=codex skills disable user:codex:lark-mail plugin:gmail@openai-curated:gmail --yes
```

Or apply all current suggestions in one shot:

```bash
"<abs-path-to-skill-router>" --host=codex skills disable --all-suggested --yes
```

After disable succeeds, tell the user: "Disabled N skills. Restart Codex or start a new Codex session for the change to take effect."

## 6. Other operations

- `skills route --query "<text>" [--mode=auto|metadata|body|lexical|dci] --json` — choose a disabled skill for the current request and return the file to read. Default `auto` runs metadata first and upgrades to body verification when needed.
- `skills body ...` — alias for `skills dci ...`.
- `skills dci budget --json` — show the bounded retrieval limits.
- `skills dci search --query "<text>" [--query "<text>"] --json` — multi-query search over disabled skill instruction bodies and return candidate refs plus bounded snippets.
- `skills dci grep --pattern "<text>" --json` — literal grep over disabled skill instruction bodies. Use `--regex` only when a regular expression is intentionally required.
- `skills dci find <id-or-ref> --pattern "<text>" --json` — search inside one disabled skill body.
- `skills dci open <id-or-ref> --line N --window N --json` — open a bounded line window from one disabled skill body.
- `skills dci inspect <id-or-ref> --json` — show metadata and path for one disabled skill.
- `skills dci read <id-or-ref> --json` — read a disabled skill body with truncation.
- `skills dci select <id-or-ref...> --query "<text>" --confidence=high|medium --reason "<why>" --json` — record one or more body-verification routes, with max selections capped by the budget.
- `skills enable <id...>` — undo a disable.
- `skills status [--json]` — list currently-disabled skills and detect/auto-reapply any that an upstream plugin or skill update may have restored.
- `skills list --json` — full inventory with `lastUsed` and `callCount`.

## Constraints

- Codex system skills under `~/.codex/skills/.system` cannot be disabled.
- The disable mechanism is `mv SKILL.md SKILL.md.skill-router-disabled`, not deletion.
- State is kept at `~/.skill-router/state-codex.json`.
- Routing only proxies disabled skill instruction files. Do not disable a whole plugin if the disabled skill depends on that plugin's MCP tools or app tools.
