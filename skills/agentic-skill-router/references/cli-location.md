# CLI location

Project/global init:

If `references/local-cli.md` exists next to this file, use the helper defined
there before any filesystem search. `agentic-skill-router init` writes that
file with the correct CLI path and host. Do not search the current project,
package manager caches, or unrelated worktrees for another
`agentic-skill-router` binary unless that generated helper path is missing or
not executable.

Fallback:

Prefer `${AGENTIC_SKILL_ROUTER_CLI}` when it points to an executable file.

Installed plugin:

```bash
"<plugin-root>/bin/agentic-skill-router" list --json
```

Compute `<plugin-root>` by taking `dirname` three times from this `SKILL.md`
path:

```text
<plugin-root>/skills/agentic-skill-router/SKILL.md
```

Installed plugin CLIs auto-detect their host from the plugin bundle.

Repository checkout:

```bash
test -x bin/agentic-skill-router && printf '%s\n' "$PWD/bin/agentic-skill-router"
```

Use the repository checkout fallback only when this skill is being read inside
the `agentic-skill-router` repository checkout itself. Repository checkout CLIs
default to Claude Code.
