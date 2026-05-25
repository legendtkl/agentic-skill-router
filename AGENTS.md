# agentic-skill-router - Agent Guide

## Project Overview

Small TypeScript CLI/plugin project for managing installed Claude Code and Codex
skills based on usage. It scans skill roots and session logs, suggests stale
entries, and disables/restores skills by renaming `SKILL.md`.

Subagent management is intentionally out of scope in this repository.

- `src/` - canonical TypeScript source
  - `cli.ts` - argument parsing and the `skills` command tree
  - `scan.ts` - skill enumeration
  - `usage.ts` - session-log skill usage parsing
  - `policy.ts` - suggestion rules
  - `apply.ts` / `state.ts` - disable, enable, reapply, and state files
  - `hosts/` - Claude Code and Codex host-specific paths
- `plugins/claude-code/` - Claude Code plugin assets
- `plugins/codex/` - Codex plugin assets and slash-command prompt
- `scripts/` - build/install/uninstall helpers
- `tests/` - `node:test` suites and fixtures

## Quick Commands

| Task | Command |
| --- | --- |
| Install deps | `npm install` |
| Run CLI from source | `npm run cli -- skills list` |
| Type check | `npm run typecheck` |
| Test | `npm test` |
| E2E (offline, no network) | `npm run test:e2e:offline` |
| E2E (network, fetches openai/skills) | `npm run test:e2e:network` |
| E2E (agent, needs local codex/claude CLI) | `npm run test:e2e:agent` |
| E2E (alias of `test:e2e:network`, kept for back-compat) | `npm run test:e2e` |
| Codex CLI e2e (single host) | `npm run test:e2e:codex` |
| Claude CLI e2e (single host) | `npm run test:e2e:claude` |
| Build bundles | `npm run build` |
| Pack smoke check | `npm run check:pack` |
| Install Claude plugin | `npm run install:plugin` |
| Install Codex plugin | `npm run install:codex-plugin` |

If the local environment has proxy variables that break npm, strip them:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY npm test
```

## Verification

The e2e suite is layered into three tiers by external dependency. Pick the
narrowest tier that still covers what your change touched.

| Layer | Script | External deps | Default CI |
| --- | --- | --- | --- |
| Offline | `npm run test:e2e:offline` | none (temp HOME, local plugin install) | PR + push to main |
| Network | `npm run test:e2e:network` | clones pinned `openai/skills` from GitHub | nightly schedule + `workflow_dispatch` |
| Agent | `npm run test:e2e:agent` | local `codex` / `claude` CLI + auth, GitHub access | manual `workflow_dispatch` only |

`npm run test:e2e` is kept as a back-compat alias for the network layer.
`npm run test:e2e:codex` and `npm run test:e2e:claude` are single-host slices
of the agent layer.

Before finishing executable changes, run:

```bash
npm run typecheck
npm test
npm run build
```

If a change touches host discovery, plugin install, route selection,
disabled-skill behavior, the CLI surface, or any code path the offline e2e
exercises, also run:

```bash
npm run test:e2e:offline
```

For executable changes that touch host discovery, plugin install, route
selection, or disabled-skill behavior, also run the networked OpenAI skills
e2e for the installed `agentic-skill-router` CLI path inside an isolated temporary
home:

```bash
npm run test:e2e:network
```

That command covers both the Codex and Claude Code host install paths and
does not require a local Codex or Claude CLI, but does fetch the pinned
`openai/skills` GitHub ref.

If a change touches Codex CLI startup, slash prompts, plugin loading, or the
agent-facing `agentic-skill-router-skills` workflow, also run the real Codex CLI e2e
when local `codex` and Codex auth are available:

```bash
npm run test:e2e:codex
```

If a change touches Claude Code plugin loading or the agent-facing
`agentic-skill-router-skills` workflow, also run the real Claude CLI e2e when a
local `claude` binary and Claude auth (`~/.claude/.credentials.json`) are
available:

```bash
npm run test:e2e:claude
```

If any e2e is not run because local Codex, Claude, network, GitHub, or auth
access is unavailable, state that explicitly in the final verification notes.

Before finishing non-documentation changes, create an independent review agent
to inspect the final diff for regressions, inconsistencies, and missing tests.
Address any actionable findings or explicitly report why they are not being
changed.

Documentation-only changes may skip the test suite.

## E2E Layers

The e2e suite is split into three layers so CI can run a narrow default on
every PR without touching the network or requiring local agent binaries.

### Layer 1 — Offline (`npm run test:e2e:offline`)

- File: `tests/cli-offline.e2e.ts`.
- Creates a fresh temporary `HOME`, installs the local Codex plugin into it,
  drops a single fixture skill into the Codex skills dir, disables it via
  the installed `agentic-skill-router` binary, and asserts that
  `skills route --query ... --json` selects the fixture back.
- Must never touch the network and must not require any auth or external
  binary beyond `node`, `npm`, and the bundled CLI.
- Runs on every PR and every push to `main` in CI.

### Layer 2 — Network (`npm run test:e2e:network`, alias: `npm run test:e2e`)

- Files: the `[agentic-skill-router-cli]` subtest of `tests/codex-openai.e2e.ts` and
  `tests/claude-openai.e2e.ts`.
- Keep `tests/codex-openai.e2e.ts` as the real Codex install and routing
  guard for changes that touch Codex host discovery, Codex plugin install,
  disable/enable state, route selection, or disabled-skill DCI behavior.
- Keep `tests/claude-openai.e2e.ts` as the equivalent guard for the Claude
  Code host. It mirrors the Codex case but installs the Claude Code plugin
  under a fresh `HOME` and routes against `user:<skill>` ids instead of
  `user:codex:<skill>`.
- Allowed to fetch external git repositories (currently the pinned
  `openai/skills` ref). Must not require a local Codex CLI, Claude CLI,
  Codex auth, `CODEX_HOME`, `AGENTS_HOME`, `CLAUDE_HOME`, or a caller-provided
  `AGENTIC_SKILL_ROUTER_HOST`; installed plugin wrappers must set their host
  before delegating to the shared runtime.
- Runs on the nightly schedule and via manual `workflow_dispatch` in CI.

### Layer 3 — Agent (`npm run test:e2e:agent`)

- Files: the `[codex-cli]` and `[claude-cli]` subtests of the same two
  OpenAI e2e files. `npm run test:e2e:codex` and `npm run test:e2e:claude`
  remain available as single-host slices.
- Keep `npm run test:e2e:codex` as the explicit real `codex exec` e2e for
  machines that have a local Codex CLI and auth.
- Keep `npm run test:e2e:claude` as the explicit real `claude` CLI e2e for
  machines that have a local `claude` binary.
- These tests self-skip when the local agent binary or auth is missing, so
  they are safe to run on any developer machine.
- CI runs this layer only via manual `workflow_dispatch`, and the job is
  pinned to `runs-on: [self-hosted, agentic-skill-router-agent-e2e]`. Hosted GitHub
  runners would not satisfy the local `codex` / `claude` binary and auth
  requirements, so without a configured self-hosted runner carrying the
  `agentic-skill-router-agent-e2e` label the dispatched job will queue and never
  start — by design, so the agent layer never silently self-skips in CI.
- To actually exercise the agent layer in CI, register a self-hosted runner
  with the `agentic-skill-router-agent-e2e` label, put `codex` and `claude` on its
  PATH, and configure their auth credentials on that runner.

### Shared invariants for the OpenAI e2e files (layers 2 and 3)

- Each case must create a fresh temporary home, install the local
  agentic-skill-router plugin for the corresponding host under that home, install all
  curated skills from the pinned official `openai/skills` repository, disable
  a subset via the installed `agentic-skill-router` binary, and verify at least 20
  realistic user queries through `skills route --json`.
- The pinned `openai/skills` ref currently contains 38 curated skills; each
  e2e should install that whole curated corpus rather than sampling a smaller
  set.
- The separate Codex CLI e2e must invoke the installed `/agentic-skill-router:skills`
  slash prompt, verify the slash prompt sentinel and `agentic-skill-router-skills`
  workflow sentinel, then execute a probe that routes those disabled-skill
  queries, reads each returned `selected.skillMdPath`, and verifies per-skill
  sentinel markers from the matched skill file. This guards against tests that
  only check query text without proving Codex can invoke the installed router
  in a fresh environment.
- The separate Claude CLI e2e must drive `claude -p` against the installed
  Claude Code plugin, verify the `agentic-skill-router-skills` workflow sentinel, then
  execute the same per-skill probe to confirm the agent can route disabled
  skills and reach each `selected.skillMdPath` in a fresh environment.
- Only install `skills/.curated/*` from `openai/skills`. Do not copy
  `skills/.system/*`; those are preinstalled/builtin skills and should stay
  protected by Codex host logic.
- The GitHub install commands are intentionally fixed in both tests. If the
  official skill corpus changes, update the pinned repository ref, install
  command list, expected skill ids, route queries, and this guide together.
- The network layer is opt-in for local development but runs nightly in CI.
  Run `npm run test:e2e:network` when changing the paths above; regular
  `npm test` must not run networked e2e files, and the offline layer
  (`tests/cli-offline.e2e.ts`) must never reach the network.

## Coding Notes

- Keep the runtime dependency-free; build outputs are self-contained ESM bundles.
- Prefer small, host-neutral logic in `src/`, with host path differences isolated
  under `src/hosts/`.
- Built-in/system skills must remain protected and non-disableable.
- Disabling is a rename operation:
  - Skills: `SKILL.md` <-> `SKILL.md.agentic-skill-router-disabled`
- Do not commit generated bundles under `plugins/*/lib/`; they are gitignored.
- Add or update focused `node:test` coverage for behavior changes.

## Commit and PR

- Non-doc changes should pass typecheck, tests, and build.
- Keep PRs scoped; avoid unrelated refactors.
- Never commit credentials or user-local state from `~/.agentic-skill-router`.

### PR Guidelines

- Use a Conventional Commits-style English title:
  `<type>(<scope>): <short summary>`, max 72 characters.
- The PR body should include:
  - `Goal` - one sentence explaining the problem or user need.
  - `Changes` - concise bullets for the meaningful code/doc updates.
  - `Verification` - commands run, or a clear note when skipped for docs-only
    changes.
  - `Risk / Impact` - call out affected hosts, skill roots, state files, or
    migration concerns when relevant.
- Link related issues, discussions, or follow-up tasks when they exist.
- Update tests and docs together with behavior changes, especially when CLI
  output, state format, or host-specific paths change.
- Before requesting review, replace placeholders, remove unused template
  sections, and make sure generated bundles under `plugins/*/lib/` are not
  included.
