# skill-router

English | [简体中文](README.zh-CN.md)

Skill management CLI and installation assets for Agent Skills across supported
hosts. The current scope is the skill-only core migrated from
`~/github/agent-cleaner`: enumerate installed skills, read usage from local
transcripts, suggest stale or unused skills, and safely disable or restore
selected skills by renaming `SKILL.md`.

Subagent management is intentionally out of scope for this repository.

## Quick Start

Claude Code:

```bash
npm install
npm run install:plugin
```

Restart Claude Code, then ask the installed `skill-router-skills` skill to audit
or slim installed skills.

Codex:

```bash
npm install
npm run install:codex-plugin
```

Restart Codex, then run:

```text
/skill-router:skills
```

## CLI

The same top-level bundle can be used directly.

Claude Code:

```bash
bin/skill-router skills list
bin/skill-router skills suggest
bin/skill-router skills disable user:lark-mail --yes
bin/skill-router skills enable user:lark-mail
bin/skill-router skills status
```

Codex:

```bash
bin/skill-router --host=codex skills list
bin/skill-router --host=codex skills suggest --json
bin/skill-router --host=codex skills route --query "draft a Lark mail reply" --json
bin/skill-router --host=codex skills route --mode=metadata --query "draft a Lark mail reply" --json
bin/skill-router --host=codex skills route --mode=body --query "draft a Lark mail reply" --json
bin/skill-router --host=codex skills dci search --query "find a disabled skill for this request" --query "lark mail reply" --json
bin/skill-router --host=codex skills dci open dci-abc123def0 --line=20 --window=80 --json
bin/skill-router --host=codex skills disable user:codex:lark-mail --yes
bin/skill-router --host=codex skills enable user:codex:lark-mail
bin/skill-router --host=codex skills status
```

`--unused-for=<duration>` accepts `30`, `30d`, `2w`, `3m`, and `1y`.
The persistent default lives at `~/.skill-router/config.json`:

```json
{ "unusedForDays": 60, "routeMode": "auto" }
```

## How It Works

One Agent Skills source is installed through multiple host-specific entry
points:

- `skills/skill-router-skills/SKILL.md` is the single source of truth.
- `skills/skill-router-skills/references/` holds shared workflow details.
- `bin/skill-router` and `lib/skill-router.mjs` are the shared CLI runtime.
- `plugins/claude-code/` and `plugins/codex/` only provide host manifests and
  host-specific entry points.
- The install scripts copy the same `skills/`, `bin/`, and `lib/` directories
  into the selected host's local plugin cache, then normalize the installed
  manifest to `./skills/`.
- `plugins/codex/prompts/skill-router-skills.md` is a generated slash-command
  shim for Codex.

Do not create host-specific copies of `SKILL.md`; update the unified skill
source and reinstall or rebuild the package.

Skill inventory sources:

| Host | Sources |
| --- | --- |
| Claude Code | `~/.claude/skills`, `.claude/skills` from CWD to repo root, plugin `skills/`, protected built-ins |
| Codex | `.agents/skills` from CWD to repo root, `~/.agents/skills`, `/etc/codex/skills`, `~/.codex/skills`, `~/.codex/skills/.system`, plugin `skills/` |

Usage signal:

- Claude Code transcripts under `~/.claude/projects/**/*.jsonl`
- Codex sessions under `~/.codex/sessions/**/*.jsonl`
- `Skill` tool calls and `<command-name>...</command-name>` tags

Disable mechanism:

- Enabled: `SKILL.md`
- Disabled: `SKILL.md.skill-router-disabled`
- State: `~/.skill-router/state-claude-code.json` or
  `~/.skill-router/state-codex.json`
- Every `skills disable` form requires explicit `--yes`; without it the CLI
  prints what would be disabled and exits without renaming files.

Built-in and system skills are listed but cannot be disabled.

Disabled-skill routing:

- `skills route --query "<request>" --json` searches disabled skills only.
- Route mode can be set with `--mode=auto|metadata|body|lexical|dci`, `SKILL_ROUTER_ROUTE_MODE`,
  or `~/.skill-router/config.json` as `"routeMode": "auto"`.
- `metadata` is the primary router. It searches only disabled skill metadata
  (`id`, `name`, `description`, aliases, tags, tools, domains, intents, and examples),
  returns field-level evidence, and does not use embeddings or free-form bash.
- `lexical` is the legacy fast description/name matcher.
- `body` searches disabled skill instruction bodies and selects only a confident top candidate.
- `dci` is a legacy alias for body search / body verification commands. It is not a
  full autonomous DCI research agent.
- `auto` is the default: run metadata first, then use bounded body verification when
  metadata is low confidence, ambiguous, or points at a broad umbrella skill.
- A confident route returns `action: "read-skill-file"` and `selected.skillMdPath`.
- The returned path may end in `SKILL.md.skill-router-disabled`; it is still safe to read as instructions.
- Routed use is recorded in state so frequently proxied disabled skills can be identified later.
- If metadata routing is not confident, Skill Router can use bounded body-verification tools:
  - `skills dci budget --json`
  - `skills dci search --query "<request>" [--query "<derived query>"] --json`
  - `skills dci grep --pattern "<phrase>" --json` for literal phrase search; add `--regex` only when intentionally using a regular expression
  - `skills dci find <id-or-ref> --pattern "<phrase>" --json`
  - `skills dci open <id-or-ref> --line=N --window=N --json`
  - `skills dci inspect <id-or-ref> --json`
  - `skills dci read <id-or-ref> --json`
  - `skills dci select <id-or-ref...> --query "<request>" --confidence=high --reason "<evidence>" --json`
- DCI search returns stable candidate refs (`dci-...`) for follow-up `find`, `open`, `read`, and `select` calls.
- `skills body ...` is accepted as an alias for `skills dci ...`.
- Body tools search/read disabled skill instruction bodies with bounded snippets, max 8
  candidates, bounded `open` windows, and a fixed prompt budget instead of loading every
  `SKILL.md` into context.

Skill metadata authoring:

- `name` and `description` remain required by host conventions; all extra routing
  metadata is optional and backward-compatible.
- Add `aliases`, `tags`, `tools`, `domains`, `intents`, and `examples` when a skill is
  often referred to by product names, API names, Chinese names, CLI commands, or task
  intents that do not appear in the short description.

```yaml
---
name: lark-mail
description: 发送、回复、搜索飞书邮件
aliases:
  - 飞书邮箱
  - lark mail
domains:
  - lark
  - feishu
  - email
tools:
  - Lark Mail API
intents:
  - send_mail
  - reply_mail
  - search_mail
examples:
  - 给张三发一封飞书邮件
  - 搜索最近的邮件
---
```

## Development

```bash
npm install
npm run generate:assets
npm run typecheck
npm test
npm run build
```

If local proxy variables break npm, strip them:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY npm test
```

Layout:

```text
src/                         TypeScript source
  cli.ts                     skills command tree
  scan.ts                    SKILL.md enumeration
  metadata-route.ts          metadata-first disabled-skill router
  dci.ts                     bounded body search / verification tools
  usage.ts                   transcript usage parser
  policy.ts                  suggestion rules
  apply.ts                   disable / enable / reapply logic
  state.ts                   ~/.skill-router state files
  hosts/{base,claude-code,codex}.ts
bin/                         Shared CLI wrapper
lib/                         Generated shared CLI bundle
skills/                      Unified Agent Skill source
plugins/claude-code/         Claude Code plugin manifest
plugins/codex/               Codex plugin manifest and slash command prompt
scripts/                     build / install / uninstall helpers
tests/                       node:test suites and fixtures
```

Generated bundles under `lib/` are build outputs and are gitignored. The Codex
slash prompt is generated so plugin installs work from a fresh checkout;
regenerate it instead of editing it by hand.
