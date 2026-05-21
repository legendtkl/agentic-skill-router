# CLI location

Prefer `${SKILL_ROUTER_CLI}` when it points to an executable file.

Claude Code:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/skill-router" --host=claude-code skills list --json
```

If `${CLAUDE_PLUGIN_ROOT}` is unset, compute it as the directory two levels
above this `SKILL.md`, then append `bin/skill-router`.

Codex:

```bash
find "${CODEX_HOME:-$HOME/.codex}/plugins/cache/local/skill-router" -path '*/bin/skill-router' -type f 2>/dev/null | sort | tail -1
test -x plugins/codex/bin/skill-router && printf '%s\n' "$PWD/plugins/codex/bin/skill-router"
```

Always pass `--host=codex` for Codex commands.
