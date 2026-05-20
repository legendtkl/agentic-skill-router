# skill-router

Skill management CLI and plugin assets for Claude Code and Codex. The current
scope is the skill-only core migrated from `~/github/agent-cleaner`: enumerate
installed skills, read usage from local transcripts, suggest stale or unused
skills, and safely disable or restore selected skills by renaming `SKILL.md`.

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

The same bundle can be used directly.

Claude Code:

```bash
node plugins/claude-code/lib/skill-router.mjs skills list
node plugins/claude-code/lib/skill-router.mjs skills suggest
node plugins/claude-code/lib/skill-router.mjs skills disable user:lark-mail --yes
node plugins/claude-code/lib/skill-router.mjs skills enable user:lark-mail
node plugins/claude-code/lib/skill-router.mjs skills status
```

Codex:

```bash
node plugins/codex/lib/skill-router.mjs --host=codex skills list
node plugins/codex/lib/skill-router.mjs --host=codex skills suggest --json
node plugins/codex/lib/skill-router.mjs --host=codex skills disable user:codex:lark-mail --yes
node plugins/codex/lib/skill-router.mjs --host=codex skills enable user:codex:lark-mail
node plugins/codex/lib/skill-router.mjs --host=codex skills status
```

`--unused-for=<duration>` accepts `30`, `30d`, `2w`, `3m`, and `1y`.
The persistent default lives at `~/.skill-router/config.json`:

```json
{ "unusedForDays": 60 }
```

## How It Works

Skill inventory sources:

| Host | Sources |
| --- | --- |
| Claude Code | `~/.claude/skills`, plugin `skills/`, protected built-ins |
| Codex | `~/.codex/skills`, `~/.agents/skills`, `~/.codex/skills/.system`, plugin `skills/` |

Usage signal:

- Claude Code transcripts under `~/.claude/projects/**/*.jsonl`
- Codex sessions under `~/.codex/sessions/**/*.jsonl`
- `Skill` tool calls and `<command-name>...</command-name>` tags

Disable mechanism:

- Enabled: `SKILL.md`
- Disabled: `SKILL.md.skill-router-disabled`
- State: `~/.skill-router/state-claude-code.json` or
  `~/.skill-router/state-codex.json`

Built-in and system skills are listed but cannot be disabled.

## Development

```bash
npm install
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
  usage.ts                   transcript usage parser
  policy.ts                  suggestion rules
  apply.ts                   disable / enable / reapply logic
  state.ts                   ~/.skill-router state files
  hosts/{base,claude-code,codex}.ts
plugins/claude-code/         Claude Code plugin asset
plugins/codex/               Codex plugin asset and slash command prompt
scripts/                     build / install / uninstall helpers
tests/                       node:test suites and fixtures
```

Generated bundles under `plugins/*/lib/` are build outputs and are gitignored.
