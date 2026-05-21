# CLI location

Prefer `${SKILL_ROUTER_CLI}` when it points to an executable file.

Installed plugin:

```bash
"<plugin-root>/bin/skill-router" --host=<claude-code|codex> skills list --json
```

Compute `<plugin-root>` as the directory two levels above this `SKILL.md`.

Repository checkout:

```bash
test -x bin/skill-router && printf '%s\n' "$PWD/bin/skill-router"
```

Pass `--host=<claude-code|codex>` when the target host is not already provided
by `${SKILL_ROUTER_HOST}`.
