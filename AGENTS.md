# skill-router - Agent Guide

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
| E2E | `npm run test:e2e` |
| Codex CLI e2e | `npm run test:e2e:codex` |
| Claude CLI e2e | `npm run test:e2e:claude` |
| Build bundles | `npm run build` |
| Install Claude plugin | `npm run install:plugin` |
| Install Codex plugin | `npm run install:codex-plugin` |

If the local environment has proxy variables that break npm, strip them:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY npm test
```

## Verification

Before finishing executable changes, run:

```bash
npm run typecheck
npm test
npm run build
```

For executable changes that touch host discovery, plugin install, route
selection, or disabled-skill behavior, also run the networked OpenAI skills
e2e for the installed `skill-router` CLI path inside an isolated temporary
home:

```bash
npm run test:e2e
```

That command covers both the Codex and Claude Code host install paths and
does not require a local Codex or Claude CLI.

If a change touches Codex CLI startup, slash prompts, plugin loading, or the
agent-facing `skill-router-skills` workflow, also run the real Codex CLI e2e
when local `codex` and Codex auth are available:

```bash
npm run test:e2e:codex
```

If a change touches Claude Code plugin loading or the agent-facing
`skill-router-skills` workflow, also run the real Claude CLI e2e when a
local `claude` binary is available:

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

## OpenAI Skills E2E

- Keep `tests/codex-openai.e2e.ts` as the real Codex install and routing
  guard for changes that touch Codex host discovery, Codex plugin install,
  disable/enable state, route selection, or disabled-skill DCI behavior.
- Keep `tests/claude-openai.e2e.ts` as the equivalent guard for the Claude
  Code host. It mirrors the Codex case but installs the Claude Code plugin
  under a fresh `HOME` and routes against `user:<skill>` ids instead of
  `user:codex:<skill>`.
- Keep `npm run test:e2e` as the default e2e command for installed
  `skill-router` behavior in a fresh temporary `HOME`. It must not require a
  local Codex CLI, Claude CLI, Codex auth, `CODEX_HOME`, `AGENTS_HOME`,
  `CLAUDE_HOME`, or `SKILL_ROUTER_HOST`; the installed plugin CLI must
  auto-detect its host from the plugin bundle. It runs the
  `[skill-router-cli]` test in both the Codex and Claude Code e2e files.
- Keep `npm run test:e2e:codex` as the explicit real `codex exec` e2e for
  machines that have a local Codex CLI and auth.
- Keep `npm run test:e2e:claude` as the explicit real `claude` CLI e2e for
  machines that have a local `claude` binary.
- Each case must create a fresh temporary home, install the local
  skill-router plugin for the corresponding host under that home, install all
  curated skills from the pinned official `openai/skills` repository, disable
  a subset via the installed `skill-router` binary, and verify at least 20
  realistic user queries through `skills route --json`.
- The pinned `openai/skills` ref currently contains 38 curated skills; each
  e2e should install that whole curated corpus rather than sampling a smaller
  set.
- The separate Codex CLI e2e must invoke the installed `/skill-router:skills`
  slash prompt, verify the slash prompt sentinel and `skill-router-skills`
  workflow sentinel, then execute a probe that routes those disabled-skill
  queries, reads each returned `selected.skillMdPath`, and verifies per-skill
  sentinel markers from the matched skill file. This guards against tests that
  only check query text without proving Codex can invoke the installed router
  in a fresh environment.
- The separate Claude CLI e2e must drive `claude -p` against the installed
  Claude Code plugin, verify the `skill-router-skills` workflow sentinel, then
  execute the same per-skill probe to confirm the agent can route disabled
  skills and reach each `selected.skillMdPath` in a fresh environment.
- Only install `skills/.curated/*` from `openai/skills`. Do not copy
  `skills/.system/*`; those are preinstalled/builtin skills and should stay
  protected by Codex host logic.
- The GitHub install commands are intentionally fixed in both tests. If the
  official skill corpus changes, update the pinned repository ref, install
  command list, expected skill ids, route queries, and this guide together.
- The default e2e is networked and opt-in. Run `npm run test:e2e` when changing
  the paths above; regular `npm test` must not run networked e2e files.

## Coding Notes

- Keep the runtime dependency-free; build outputs are self-contained ESM bundles.
- Prefer small, host-neutral logic in `src/`, with host path differences isolated
  under `src/hosts/`.
- Built-in/system skills must remain protected and non-disableable.
- Disabling is a rename operation:
  - Skills: `SKILL.md` <-> `SKILL.md.skill-router-disabled`
- Do not commit generated bundles under `plugins/*/lib/`; they are gitignored.
- Add or update focused `node:test` coverage for behavior changes.

## Commit and PR

- Non-doc changes should pass typecheck, tests, and build.
- Keep PRs scoped; avoid unrelated refactors.
- Never commit credentials or user-local state from `~/.skill-router`.

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
