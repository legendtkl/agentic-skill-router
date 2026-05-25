# CLI location

Prefer `${SKILL_ROUTER_CLI}` when it points to an executable file.

Project/global init:

If `references/local-cli.md` exists next to this file, use the helper defined
there. `skill-router init` writes that file with the correct CLI path and host.

Installed plugin:

```bash
"<plugin-root>/bin/skill-router" skills list --json
```

Compute `<plugin-root>` by taking `dirname` three times from this `SKILL.md`
path:

```text
<plugin-root>/skills/skill-router-skills/SKILL.md
```

Installed plugin CLIs auto-detect their host from the plugin bundle.

Repository checkout:

```bash
test -x bin/skill-router && printf '%s\n' "$PWD/bin/skill-router"
```

Repository checkout CLIs default to Claude Code.
