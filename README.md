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
plugins/claude-code/bin/skill-router skills list
plugins/claude-code/bin/skill-router skills suggest
plugins/claude-code/bin/skill-router skills disable user:lark-mail --yes
plugins/claude-code/bin/skill-router skills enable user:lark-mail
plugins/claude-code/bin/skill-router skills status
```

Codex:

```bash
plugins/codex/bin/skill-router --host=codex skills list
plugins/codex/bin/skill-router --host=codex skills suggest --json
plugins/codex/bin/skill-router --host=codex skills route --query "draft a Lark mail reply" --json
plugins/codex/bin/skill-router --host=codex skills dci search --query "find a disabled skill for this request" --json
plugins/codex/bin/skill-router --host=codex skills disable user:codex:lark-mail --yes
plugins/codex/bin/skill-router --host=codex skills enable user:codex:lark-mail
plugins/codex/bin/skill-router --host=codex skills status
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

Disabled-skill routing:

- `skills route --query "<request>" --json` searches disabled skills only.
- A confident route returns `action: "read-skill-file"` and `selected.skillMdPath`.
- The returned path may end in `SKILL.md.skill-router-disabled`; it is still safe to read as instructions.
- Routed use is recorded in state so frequently proxied disabled skills can be identified later.
- If fast routing is not confident, Codex can use DCI-style corpus tools:
  - `skills dci search --query "<request>" --json`
  - `skills dci grep --pattern "<phrase>" --json` for literal phrase search; add `--regex` only when intentionally using a regular expression
  - `skills dci inspect <id> --json`
  - `skills dci read <id> --json`
  - `skills dci select <id> --query "<request>" --confidence=high --reason "<evidence>" --json`
- DCI tools search/read disabled skill instruction bodies with bounded snippets instead of loading every `SKILL.md` into context.

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
