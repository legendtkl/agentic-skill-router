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

Documentation-only changes may skip the test suite.

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
