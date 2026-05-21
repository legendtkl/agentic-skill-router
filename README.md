# skill-router

English | [简体中文](README.zh-CN.md)

Skill management CLI and installation assets for Agent Skills across supported
hosts. It enumerates installed skills, reads usage from local transcripts,
suggests stale or unused skills, and safely disables or restores selected skills
by renaming `SKILL.md`.

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

Installed plugin bundles also expose `bin/skill-router`. Run these commands
from the installed plugin root, or use the absolute path printed by the
installer.

Installed Claude Code plugin:

```bash
bin/skill-router skills list
bin/skill-router skills suggest --json
bin/skill-router skills route --query "draft a Lark mail reply" --json
bin/skill-router skills route --mode=metadata --query "draft a Lark mail reply" --json
bin/skill-router skills route --mode=body --query "draft a Lark mail reply" --json
bin/skill-router skills dci search --query "find a disabled skill for this request" --query "lark mail reply" --json
bin/skill-router skills dci open dci-abc123def0 --line=20 --window=80 --json
bin/skill-router skills disable user:lark-mail --yes
bin/skill-router skills enable user:lark-mail
bin/skill-router skills status
```

Installed Codex plugin:

```bash
bin/skill-router skills list
bin/skill-router skills suggest --json
bin/skill-router skills route --query "draft a Lark mail reply" --json
bin/skill-router skills route --mode=metadata --query "draft a Lark mail reply" --json
bin/skill-router skills route --mode=body --query "draft a Lark mail reply" --json
bin/skill-router skills dci search --query "find a disabled skill for this request" --query "lark mail reply" --json
bin/skill-router skills dci open dci-abc123def0 --line=20 --window=80 --json
bin/skill-router skills disable user:codex:lark-mail --yes
bin/skill-router skills enable user:codex:lark-mail
bin/skill-router skills status
```

`--unused-for=<duration>` accepts `30`, `30d`, `2w`, `3m`, and `1y`.
The persistent default lives at `~/.skill-router/config.json`:

```json
{ "unusedForDays": 60, "routeMode": "auto" }
```

Installed plugin CLIs auto-detect their host. Repository checkout CLI runs
default to Claude Code and is mainly for local development.

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
- `lexical` is the fast description/name matcher.
- `body` searches disabled skill instruction bodies and selects only a confident top candidate.
- `dci` is the compatibility command group for bounded body search and verification.
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
- Body search reads at most 64,000 bytes per disabled `SKILL.md` and at most
  1,000,000 bytes across the corpus, reporting JSON warnings when a body is
  truncated or the corpus budget is exhausted.
- Body tools also use bounded snippets, max 8 candidates, bounded `open` windows,
  and a fixed prompt budget instead of loading every `SKILL.md` into context.

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

### SKILL.md frontmatter support

`skill-router` ships a minimal, dependency-free YAML parser tuned for the
SKILL.md subset that Claude Code and Codex skills actually use. The supported
forms are:

- Top-level scalar `key: value` pairs. Quoted (`"..."`/`'...'`) and unquoted
  values both work; for unquoted scalars an inline ` # comment` is stripped.
- Literal (`|`) and folded (`>`) block strings as the value of a top-level
  key — e.g. multi-line `description`s.
- Top-level arrays in either inline (`tags: [feishu, email]`) or block list
  (`- item`) form.

Anything else — nested mappings under a key (e.g. `metadata.routing.aliases`),
anchors/aliases, tags, flow mappings, or multi-document streams — is **not**
supported. When the parser encounters a nested mapping it drops that key and
emits a warning such as:

```
frontmatter: skipped nested mapping under `metadata` (line 7)
```

Warnings are attached to the skill record as the optional
`frontmatterWarnings` field and surfaced in `skills list --json` output so
authors can spot silently-skipped metadata. Keep all routing metadata at the
top level (see the `lark-mail` example above) so it parses reliably.

## Troubleshooting

See [`docs/troubleshooting.md`](docs/troubleshooting.md) for recovery
procedures covering every anomaly section that `skill-router skills status`
can print: split-brain conflicts, orphan disable markers, orphaned state
records, malformed state files, plugin-upgrade reapply, and the safe order
for uninstalling after disabling skills. Default to `skill-router skills
enable <id>` rather than `rm` whenever a recovery path is available.

## Development

Requires Node.js >= 20 (matches CI).

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

Local CI reproduction (mirrors `.github/workflows/ci.yml`):

```bash
npm ci
npm run check:assets
npm run typecheck
npm test
npm run build
npm run check:pack
```

`npm run check:pack` runs after `npm run build` and verifies that
`bin/skill-router --help` exits cleanly and `npm pack --dry-run` includes the
required `bin/`, `lib/`, `skills/`, plugin manifests, and Codex prompt entries.

The e2e suite is layered by external dependency so CI default does not
need network or local agent auth:

| Layer | Script | Needs | Default CI |
| --- | --- | --- | --- |
| Offline | `npm run test:e2e:offline` | nothing beyond `node` / `npm` and the bundled CLI (no network, no auth) | every PR and push to `main` |
| Network | `npm run test:e2e:network` (alias: `npm run test:e2e`) | network to clone the pinned `openai/skills` GitHub ref | nightly schedule + manual `workflow_dispatch` |
| Agent | `npm run test:e2e:agent` (or single-host `npm run test:e2e:codex` / `npm run test:e2e:claude`) | local `codex` / `claude` CLI plus their auth files | manual `workflow_dispatch` only (self-skips when binaries are missing) |

Run higher layers locally when changes touch host install, plugin loading,
slash prompts, or the agent-facing workflow. The agent layer self-skips
when the matching binary or auth file is not available.

To compare routing thresholds before and after a change, run the evaluation
harness:

```bash
npm run eval:route                # prints markdown + JSON summary, mode=auto
npm run eval:route -- --mode=metadata
npm run eval:route -- --json      # JSON only, easier to diff
```

Fixture: `tests/fixtures/route-cases.json`. Cases cover Chinese, English, API
names, product names, umbrella vs specific skills, and multi-domain keyword
piles. The script is informational — failing metrics do not fail the command,
and `eval:route` is intentionally not wired into `npm test`.

`routedSource` reports which source produced each hit. In `--mode=auto` it
reflects `diagnostics.auto.selectedSource` (metadata vs DCI-after-escalation);
in `--mode=metadata|lexical|dci` every hit is attributed to that mode by
definition. `metadataHitRate` is reported in `auto` and `metadata` modes; it
is `n/a` in `lexical` and `dci`. `dciEscalationRate` is meaningful only in
`auto` mode and is `n/a` elsewhere.

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
