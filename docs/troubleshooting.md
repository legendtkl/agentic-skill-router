# Troubleshooting `skills status` anomalies

This guide explains every section that `skill-router skills status` can print
and how to recover from each one. The text quoted here matches the CLI output
verbatim so you can `grep` your terminal scrollback or screenshots.

> A Chinese version of this guide is planned; until then this English doc is
> authoritative.

## Safety first

- **Prefer renames over deletions.** Skill Router never deletes `SKILL.md`. It
  toggles between `SKILL.md` and `SKILL.md.skill-router-disabled` via
  `rename(2)`. The safe recovery primitive for anything below is
  `skill-router skills enable <id>` — not `rm`.
- **Do not edit `~/.skill-router/state-<host>.json` by hand** unless this guide
  explicitly says so. Use `skills enable` / `skills disable` to mutate state.
- **Restart your host after recovering.** Both Claude Code and Codex load
  skills at startup, so the file system change does not take effect until the
  next session.
- **Built-in / system skills are protected.** They show up in `skills list`
  but cannot be disabled, so they will not appear in any of the anomaly lists
  below.

## Where things live

| Item | Location |
| --- | --- |
| State (Claude Code) | `~/.skill-router/state-claude-code.json` |
| State (Codex) | `~/.skill-router/state-codex.json` |
| Enabled skill file | `<root>/<skill>/SKILL.md` |
| Disabled skill file | `<root>/<skill>/SKILL.md.skill-router-disabled` |
| Malformed state backup | `~/.skill-router/state-<host>.json.malformed.<ts>.bak` |

Skill roots come from the host. See `README.md` "How It Works" for the full
list per host.

## `skills status` output fields

A healthy run prints only:

```text
disabled skills: N
  <id>  (<reason>, <iso-timestamp>)
```

Every additional section below indicates an anomaly that Skill Router either
auto-repaired or now needs you to resolve.

### `recovered (in-flight ops committed from journal): <id...>`

**Meaning.** A previous `disable` or `enable` crashed between the on-disk
rename and the state-file save. Skill Router replayed the journal entry and
brought the state file in line with the actual file on disk. **No action
needed** — this is the auto-repair path.

### `rolled back (in-flight ops with no completed rename): <id...>`

**Meaning.** A previous `disable` or `enable` crashed before the rename
happened. Skill Router undid the intent and removed the journal entry. **No
action needed.** If you still want the operation, re-run `skills disable` or
`skills enable`.

### `reapplied (upstream restored these): <id...>`

**Meaning.** A plugin upgrade, `npx skills update`, or a manual file copy
restored a fresh `SKILL.md` for a skill that the user had previously
disabled. Skill Router detected the live file, re-applied the rename to
`SKILL.md.skill-router-disabled`, and kept the disable record intact. **No
action needed.** This is the expected behavior after a plugin upgrade — re-run
`skills status` once after the upgrade to let Skill Router reconcile.

If you actually want the upgraded skill enabled, run:

```bash
skill-router skills enable <id>
```

### `orphaned records (SKILL.md gone entirely; run \`enable <id>\` to clean state): <id...>`

**Meaning.** The state file still has a disable record for `<id>`, but neither
`SKILL.md` nor `SKILL.md.skill-router-disabled` exists at the recorded path.
Typical causes:

- The plugin that owned the skill was uninstalled.
- The skill directory was deleted manually.
- The host upgraded and moved the skill to a new id/path.

**Recovery.** Run:

```bash
skill-router skills enable <id>
```

This removes the orphan record from state without touching the file system
(because there is no file to rename). The CLI exits with `cleanedStateOnly`
set on the result.

### `⚠ CONFLICTED — both SKILL.md and SKILL.md.skill-router-disabled present:`

```text
  <id>
Manually delete one file (typically the .skill-router-disabled to fully
enable, or the SKILL.md to fully disable) and re-run `status`.
```

**Meaning (split-brain).** The state file says `<id>` is disabled, **and both**
of the following exist on disk:

- `<root>/<skill>/SKILL.md`
- `<root>/<skill>/SKILL.md.skill-router-disabled`

This usually happens when:

- The user (or another tool) renamed or copied `SKILL.md` back manually after
  Skill Router disabled it.
- A plugin upgrade wrote a new `SKILL.md` while a crash interrupted the
  reapply step.
- Two `skills disable` runs raced on different hosts and converged on the same
  state file.

`status` exits with code `1` while a CONFLICT is present, so it is a reliable
failure signal in scripts.

**Recovery — pick the file you want to keep:**

1. Compare both files. If they are identical (the common case for plugin
   upgrades), keep whichever side matches your intent.
2. If the **disabled** version is the one you want to keep (the user
   originally disabled this skill and the upgrade brought it back), delete
   the live file:

   ```bash
   rm "<root>/<skill>/SKILL.md"
   skill-router skills status   # should now be clean
   ```

3. If the **live** version is the one you want to keep (you want this skill
   enabled again), delete the disabled marker and then run `skills enable` to
   clear the state record:

   ```bash
   rm "<root>/<skill>/SKILL.md.skill-router-disabled"
   skill-router skills enable <id>
   ```

   The `enable` call is what removes the stale disable record from
   `~/.skill-router/state-<host>.json`.

> Safety note: `rm` is the only place in this guide that uses `rm`. Always run
> `skills status` again afterwards to confirm the anomaly is gone before
> restarting the host.

### `orphan disabled markers (no state record; left from a previous tool or crash):`

```text
  <absolute-path-to-SKILL.md.skill-router-disabled>
```

**Meaning.** A `SKILL.md.skill-router-disabled` file exists, but Skill Router
has no matching state record for it. This typically comes from:

- A previous tool (or an older Skill Router install) that renamed `SKILL.md`
  but did not write to state.
- A crash between the rename and the state save **without** a recoverable
  journal entry (very rare).
- Manual experimentation by the user.

Because there is no state record, `skills enable <id>` cannot find anything to
recover.

**Recovery.** Decide whether you want the skill enabled or disabled, then
restore by hand:

- To enable (recommended default — safest, reversible):

  ```bash
  mv "<path>.skill-router-disabled" "<path-without-suffix>"
  # i.e.  mv .../SKILL.md.skill-router-disabled .../SKILL.md
  skill-router skills status   # the orphan marker should now be gone
  ```

- To keep it disabled but have Skill Router track it, re-run `skills disable
  <id>` after first restoring the file as above. Skill Router will detect the
  live SKILL.md, rename it back, and write a fresh state record so future
  upgrades reapply correctly.

> **When is it safe to `rm` a `.skill-router-disabled` file directly?** Only
> when you (1) understand the skill is gone for good and (2) no state record
> references it. In all other cases, prefer `mv` so the action is reversible.

### `pending operations needing manual resolution (split-brain on disk):`

```text
  <id>  (<op>, started <iso-timestamp>)
```

**Meaning.** Skill Router tried to reconcile a journal entry during this
`status` run but the file system was still in a split-brain state (both
`SKILL.md` and `SKILL.md.skill-router-disabled` present), so the journal entry
was left in place for you to resolve manually.

This always appears together with the CONFLICTED section above. Follow the
CONFLICTED recovery first. Once one of the two files is gone, the next
`skills status` will commit or roll back the pending op automatically and the
journal entry will disappear.

### `routed usage:`

Informational only. Lists disabled skills that were chosen by `skills route`
and how often. Not an anomaly; you can ignore it.

## State record exists but file missing

This is the same case as "orphaned records" above. The summary:

```bash
skill-router skills enable <id>    # safe, idempotent state cleanup
```

`enable` on an orphan record performs no file system rename and just drops
the stale record from state.

## Malformed state file

There are three flavors:

1. **Invalid JSON** — `loadState` throws and `status` aborts with:

   ```text
   state file at <path> is not valid JSON
   ```

2. **Unexpected schema** — wrong `schema` version or wrong `host`:

   ```text
   state file at <path> has unexpected schema
   ```

3. **Some records dropped** — `status` continues running and prints a stderr
   warning:

   ```text
   warning: N malformed disable record(s) in <path> were ignored. Original
   snapshotted to <path>.malformed.<ts>.bak.
   ```

   In this case Skill Router has already snapshotted the original file for
   you. The snapshot sits next to the live state file with a timestamped
   `.malformed.<iso-ts>.bak` suffix. The live file then contains only the
   valid records.

**Recovery procedure (for cases 1 and 2):**

1. **Back up first.** Never edit the live state file without a copy:

   ```bash
   cp ~/.skill-router/state-<host>.json \
      ~/.skill-router/state-<host>.json.bak
   ```

2. Inspect the file. The schema is documented by `validateRecord` /
   `validatePendingOp` in `src/state.ts`. Most corruption is a truncated
   final byte from a crash mid-write; opening the file in an editor and
   re-balancing the braces is usually enough.

3. If you cannot repair it, the safest reset is to remove just the disabled
   skills you no longer remember, restore `SKILL.md` files by hand from
   `.skill-router-disabled` siblings, and let `status` rebuild state by
   running `skills disable <id> --yes` for each skill you want disabled again.

4. Only as a last resort, delete the state file entirely:

   ```bash
   rm ~/.skill-router/state-<host>.json
   ```

   This drops **all** disable records. After deletion, you must walk the skill
   roots yourself and `mv` any leftover `SKILL.md.skill-router-disabled` files
   back to `SKILL.md` (or re-run `skills disable` for each one you want to
   keep disabled).

For case 3, the snapshot at `<path>.malformed.<ts>.bak` is exactly the
pre-cleanup state. Keep it until you are sure no records were lost; you can
copy specific entries from the backup back into the live state file with an
editor.

## Plugin upgrade + `skills reapply` semantics

Skill Router does not expose a separate `skills reapply` command. **Every
`skills status` run is a reapply.** After a plugin upgrade:

1. The host writes a fresh `SKILL.md` for every skill in the plugin.
2. You run `skill-router skills status`.
3. For each disabled record where the live `SKILL.md` reappeared, Skill
   Router renames it back to `SKILL.md.skill-router-disabled` and emits the
   `reapplied (upstream restored these): ...` line.
4. For each disabled record where the file vanished entirely, Skill Router
   emits the `orphaned records ...` line. Run `skills enable <id>` to clean
   those.
5. For each conflict (both files present), Skill Router emits the
   `⚠ CONFLICTED` block and exits with code `1`. Resolve as described above.

If you want to run reapply in a script (e.g. as a post-upgrade hook), use:

```bash
skill-router skills status --json
```

and check the `conflicted`, `orphaned`, `reapplied`, `recoveredCommits`, and
`recoveredRollbacks` arrays in the JSON output.

## Uninstall after a skill is disabled

When you uninstall the skill-router plugin (`npm run uninstall:plugin` or
`npm run uninstall:codex-plugin`), the uninstall script:

- Removes the plugin cache.
- Unregisters the plugin from the host.
- **Does not auto-enable previously-disabled skills.** Their `SKILL.md` files
  remain renamed to `SKILL.md.skill-router-disabled`.
- Prints a warning listing the still-disabled skills:

  ```text
  ⚠ N skill(s) are still disabled by skill-router.
    Their SKILL.md files remain renamed even after uninstall.
    To restore them BEFORE uninstalling, run:
      (use the bundled CLI) skills enable <id>
  ```

- Preserves `~/.skill-router/` unless you pass `--purge`.

**Recommended order:**

1. **Before** running the uninstall script, enable every skill you want back:

   ```bash
   skill-router skills enable <id>
   ```

   Use `skill-router skills status` to confirm `disabled skills: 0`.

2. Then run the uninstall script.

**If you already uninstalled without enabling first:**

You still have two choices:

- Reinstall the plugin (`npm run install:plugin` or
  `npm run install:codex-plugin`), run `skills enable <id>` for each disabled
  skill, then uninstall again.
- Or walk the affected skill roots and `mv` each `.skill-router-disabled` file
  back to `SKILL.md` by hand. After that, delete (or `--purge`)
  `~/.skill-router/` since the state records are now meaningless.

## When it is safe to manually delete `.skill-router-disabled`

Direct deletion of `SKILL.md.skill-router-disabled` files is **destructive and
non-reversible** from Skill Router's perspective. It is only safe when **all**
of the following hold:

- The owning skill is being permanently removed (e.g. you also intend to
  delete the entire `<root>/<skill>/` directory).
- There is no matching state record (the skill does not appear in `skills
  status` under any of the anomaly headers).
- You have confirmed the file is the disabled marker and not a binary backup
  or a different artifact.

In every other case, prefer `mv …/SKILL.md.skill-router-disabled
…/SKILL.md` (which is reversible by running `skill-router skills disable`
later) or `skill-router skills enable <id>` (which performs the rename plus
the state cleanup atomically).
