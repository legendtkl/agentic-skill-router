# Skill slimming

Use `suggest` for cleanup requests.

Use the `skill_router` helper from `SKILL.md`.

```bash
skill_router skills suggest --json
```

Each suggestion includes `id`, `name`, `source`, `reason`, `confidence`, and
`details`.

Show a compact table and ask for explicit confirmation before disabling.
Supported disable forms:

```bash
skill_router skills disable <id...> --yes
skill_router skills disable --all-suggested --yes
```

Other operations:

- `skills list --json` - full inventory with disabled state, last used time,
  and call count.
- `skills status --json` - disabled records, routed usage, reapplied records,
  orphaned records, conflicts, and orphan markers.
- `skills enable <id...>` - restore disabled skills.

After disabling, tell the user to restart the host or start a new session so the
visible skill list refreshes.
