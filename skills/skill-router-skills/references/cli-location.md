# CLI location

Prefer `${SKILL_ROUTER_CLI}` when it points to an executable file.

Installed plugin:

```bash
"<plugin-root>/bin/skill-router" skills list --json
```

Compute `<plugin-root>` as the directory two levels above this `SKILL.md`.
Installed plugin CLIs auto-detect their host from the plugin bundle.

Repository checkout:

```bash
test -x bin/skill-router && printf '%s\n' "$PWD/bin/skill-router"
```

Repository checkout CLIs default to Claude Code.
