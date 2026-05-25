# agentic-skill-router

English | [简体中文](README.zh-CN.md)

Skill management CLI and installation assets for Agent Skills across supported
hosts. It enumerates installed skills, reads usage from local transcripts,
suggests stale or unused skills, and safely disables or restores selected skills
by renaming `SKILL.md`.

Subagent management is intentionally out of scope for this repository.

## Quick Start

Recommended npm install:

```bash
npm install -g agentic-skill-router
agentic-skill-router init
```

`agentic-skill-router init` prompts for the target agent (`codex` or `claude-code`) and
scope (`project` or `global`). Non-interactive examples:

```bash
agentic-skill-router init codex project
agentic-skill-router init codex global
agentic-skill-router init claude-code project
agentic-skill-router init claude-code global
```

For `claude-code`, `init` also writes a small routing-trigger block into
`CLAUDE.md` (project scope: `<projectRoot>/CLAUDE.md`; global scope:
`$CLAUDE_HOME/CLAUDE.md`, defaulting to `~/.claude/CLAUDE.md`). The exact
block written is:

```markdown
<!-- agentic-skill-router:claude-md:begin -->
## Skill routing

`agentic-skill-router-skills` is a routing Skill that searches a catalog of
locally-installed disabled skills.

When the `agentic-skill-router-skills` Skill is available and no other
enabled Skill clearly matches the user's query, call
`agentic-skill-router-skills` before answering. Do not invent a Skill name
or fabricate a routing result without a Skill/tool result. If
`agentic-skill-router-skills` is not installed in this environment, this
section does not apply.
```

(closed with `<!-- agentic-skill-router:claude-md:end -->`)

The HTML-comment fence makes the block idempotent: re-running `init` replaces
the first existing fenced block in place (preserving its position in your
file) and strips any duplicate blocks elsewhere. Fence markers must appear
on their own line — markers quoted inline inside a paragraph or code block
are ignored, so the parser cannot be tricked by user-authored prose.
Existing CLAUDE.md content outside the fence is preserved. Line endings
follow the file's dominant style (CRLF only when CRLF lines outnumber bare
LF lines, otherwise LF). If `CLAUDE.md` is found with an unbalanced fence
(`:begin` without a matching `:end`), `init` aborts before touching the
skill directory, so a malformed file never produces a partial install.
The conditional wording (`If ... is not installed ... this section does
not apply`) is intentional: if the plugin is later uninstalled, a stale
block left in CLAUDE.md is harmless rather than driving the agent to call
a nonexistent Skill.

The wording mirrors the validated `claudemd-policy-probe` in
`experiments/dci-compare/`, which lifted router trigger rate from 78% to
97.6% and routing accuracy from 69% to 86.9% on the 150-skill paired Claude
Code run. Pass `--no-claude-md` to skip this write. Codex `init` never
touches CLAUDE.md.

After init, restart the target agent if it was already running, then ask the
installed `agentic-skill-router-skills` skill to audit, slim, or route installed skills.

One-off project init is also available with `npx` for trial use, but global
install is recommended so generated skills can reference a stable CLI path:

```bash
npx --package agentic-skill-router agentic-skill-router init codex project
```

Plugin install from a source checkout is still available for local development
or for the Codex slash-command shim:

```bash
npm install
npm run install:plugin        # Claude Code plugin
npm run install:codex-plugin  # Codex plugin and /agentic-skill-router:skills prompt
```

After installing the Codex plugin, restart Codex and run:

```text
/agentic-skill-router:skills
```

## CLI

Installed plugin bundles expose a thin `bin/agentic-skill-router` wrapper. Run these
commands from the installed plugin root, or use the absolute path printed by
the installer.

Installed Claude Code plugin:

```bash
bin/agentic-skill-router skills list
bin/agentic-skill-router skills suggest --json
bin/agentic-skill-router skills corpus search --all mail --any lark --limit 30 --json
bin/agentic-skill-router skills corpus inspect corpus-abc123def0 --json
bin/agentic-skill-router skills corpus select corpus-abc123def0 --query "draft a Lark mail reply" --confidence high --reason "metadata mentions Lark mail" --json
bin/agentic-skill-router skills disable user:lark-mail --yes
bin/agentic-skill-router skills enable user:lark-mail
bin/agentic-skill-router skills status
```

Installed Codex plugin:

```bash
bin/agentic-skill-router skills list
bin/agentic-skill-router skills suggest --json
bin/agentic-skill-router skills corpus search --all mail --any lark --limit 30 --json
bin/agentic-skill-router skills corpus inspect corpus-abc123def0 --json
bin/agentic-skill-router skills corpus select corpus-abc123def0 --query "draft a Lark mail reply" --confidence high --reason "metadata mentions Lark mail" --json
bin/agentic-skill-router skills disable user:codex:lark-mail --yes
bin/agentic-skill-router skills enable user:codex:lark-mail
bin/agentic-skill-router skills status
```

`--unused-for=<duration>` accepts `30`, `30d`, `2w`, `3m`, and `1y`.
The persistent default lives at `~/.agentic-skill-router/config.json`:

```json
{ "unusedForDays": 60 }
```

Installed plugin wrappers set their host before delegating to the shared
runtime. Repository checkout CLI runs default to Claude Code and is mainly for
local development.

## How It Works

One Agent Skills source is installed through multiple host-specific entry
points:

- `skills/agentic-skill-router-skills/SKILL.md` is the single source of truth.
- `skills/agentic-skill-router-skills/references/` holds shared workflow details.
- `bin/agentic-skill-router` and `lib/agentic-skill-router.mjs` are the shared CLI runtime.
- `plugins/claude-code/` and `plugins/codex/` only provide host manifests and
  host-specific entry points.
- The install scripts copy the shared runtime once to
  `~/.agentic-skill-router/runtime/<version>/`, then copy host manifests, skills, and a
  tiny host-specific wrapper into the selected host's local plugin cache. The
  wrapper sets `AGENTIC_SKILL_ROUTER_HOST` before delegating to the shared runtime.
- `plugins/codex/prompts/agentic-skill-router-skills.md` is a generated slash-command
  shim for Codex.
- `agentic-skill-router init` can create a project or global skill entry for Codex or
  Claude Code without installing a host plugin.

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
- Disabled: `SKILL.md.agentic-skill-router-disabled`
- State: `~/.agentic-skill-router/state-claude-code.json` or
  `~/.agentic-skill-router/state-codex.json`
- Every `skills disable` form requires explicit `--yes`; without it the CLI
  prints what would be disabled and exits without renaming files.

Built-in and system skills are listed but cannot be disabled.

Disabled-skill routing:

- The default agent workflow is L-agentic: the agent builds must/probe terms,
  searches disabled-skill metadata with `skills corpus search`, optionally
  inspects a small shortlist with `skills corpus inspect`, then records one
  choice with `skills corpus select`.
- During retrieval, the agent must not read disabled skill bodies. Selection is
  based on metadata only.
- `skills corpus search` reads `id`, `name`, `description`, aliases, tags,
  tools, domains, intents, and examples. It returns stable `corpus-...` refs
  without exposing local file paths.
- `skills corpus select <ref>` records routed use and returns
  `selected.skillMdPath`; the returned path may end in
  `SKILL.md.agentic-skill-router-disabled` and is safe to read as instructions.
- If metadata evidence is weak or ambiguous, the agent should stop the router
  path and continue normally without selecting a disabled skill.

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

`agentic-skill-router` ships a minimal, dependency-free YAML parser tuned for the
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
procedures covering every anomaly section that `agentic-skill-router skills status`
can print: split-brain conflicts, orphan disable markers, orphaned state
records, malformed state files, plugin-upgrade reapply, and the safe order
for uninstalling after disabling skills. Default to `agentic-skill-router skills
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
`bin/agentic-skill-router --help` exits cleanly and `npm pack --dry-run` includes the
required `bin/`, `lib/`, `skills/`, plugin manifests, and Codex prompt entries.

The e2e suite is layered by external dependency so CI default does not
need network or local agent auth:

| Layer | Script | Needs | Default CI |
| --- | --- | --- | --- |
| Offline | `npm run test:e2e:offline` | nothing beyond `node` / `npm` and the bundled CLI (no network, no auth) | every PR and push to `main` |
| Network | `npm run test:e2e:network` (alias: `npm run test:e2e`) | network to clone the pinned `openai/skills` GitHub ref | nightly schedule + manual `workflow_dispatch` |
| Agent | `npm run test:e2e:agent` (or single-host `npm run test:e2e:codex` / `npm run test:e2e:claude`) | local `codex` / `claude` CLI plus their auth files | manual `workflow_dispatch` only, and only on a self-hosted runner with the `agentic-skill-router-agent-e2e` label (self-skips when binaries are missing) |

Run higher layers locally when changes touch host install, plugin loading,
slash prompts, or the agent-facing workflow. The agent layer self-skips
when the matching binary or auth file is not available.

The `e2e-agent` workflow job uses `runs-on: [self-hosted, agentic-skill-router-agent-e2e]`.
Without a configured self-hosted runner carrying that label, dispatched runs
will queue and never start — that is intentional, since hosted GitHub runners
do not satisfy the local `codex` / `claude` binary and auth requirements and
the underlying tests would otherwise self-skip silently. To actually exercise
the agent layer in CI, register a self-hosted runner with the
`agentic-skill-router-agent-e2e` label, install `codex` and `claude` on its PATH, and
configure their auth credentials.

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
  state.ts                   ~/.agentic-skill-router state files
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
