# Troubleshooting `skills status` anomalies

This guide explains every section that `agentic-skill-router skills status` can print
and how to recover from each one. The text quoted here matches the CLI output
verbatim so you can `grep` your terminal scrollback or screenshots.

> A Chinese version of this guide is planned; until then this English doc is
> authoritative.

## Safety first

- **Prefer renames over deletions.** Agentic Skill Router never deletes `SKILL.md`. It
  toggles between `SKILL.md` and `SKILL.md.agentic-skill-router-disabled` via
  `rename(2)`. The safe recovery primitive for anything below is
  `agentic-skill-router skills enable <id>` — not `rm`.
- **Do not edit `~/.agentic-skill-router/state-<host>.json` by hand** unless this guide
  explicitly says so. Use `skills enable` / `skills disable` to mutate state.
- **Restart your host after recovering.** Both Claude Code and Codex load
  skills at startup, so the file system change does not take effect until the
  next session.
- **Built-in / system skills are protected.** They show up in `skills list`
  but cannot be disabled, so they will not appear in any of the anomaly lists
  below.

## Out-of-root symlink skills

When a skill in your skills root is itself a symlink whose target lives
outside the host's skills tree (e.g.
`~/.claude/skills/lark-mail` → `/shared/skills/lark-mail`), `agentic-skill-router`
will not silently rename the linked target file. Disable / enable / status all
refuse with a clear message and ask you to re-confirm.

To proceed, re-run the command with `--allow-symlink-target-mutation`:

```bash
agentic-skill-router skills disable user:codex:lark-mail --yes --allow-symlink-target-mutation
agentic-skill-router skills enable  user:codex:lark-mail --allow-symlink-target-mutation
```

- The mutation modifies the **linked target file** (e.g.
  `/shared/skills/lark-mail/SKILL.md` ↔
  `/shared/skills/lark-mail/SKILL.md.agentic-skill-router-disabled`),
  not the in-root symlink.
- `skills status` (which calls `reapplyMissing` internally) will never
  silently mutate out-of-root targets. If a target was re-created externally
  after you disabled it, status reports it under
  `skipped (out-of-root symlink, manual repair required)` with the exact
  `--allow-symlink-target-mutation` command to re-apply.
- The state record stores the canonical realpath of the originally-mutated
  file. If the symlink is later retargeted to a different location, enable /
  reapply refuse with a mismatch error naming both paths instead of touching
  the new target. Manual recovery: rename the canonical disabled marker back
  to `SKILL.md` yourself, then run `agentic-skill-router skills enable <id>` to
  clear the stale state record.

### If a symlink target was renamed by accident

If you ran `--allow-symlink-target-mutation` and disabled a file you didn't
mean to, find the canonical path (printed in the warning) and rename it back
manually:

```bash
mv /shared/skills/lark-mail/SKILL.md.agentic-skill-router-disabled \
   /shared/skills/lark-mail/SKILL.md
agentic-skill-router skills enable user:codex:lark-mail   # clears the state record
```

The CLI never deletes content, so the file is always recoverable.

## Where things live

| Item | Location |
| --- | --- |
| State (Claude Code) | `~/.agentic-skill-router/state-claude-code.json` |
| State (Codex) | `~/.agentic-skill-router/state-codex.json` |
| Enabled skill file | `<root>/<skill>/SKILL.md` |
| Disabled skill file | `<root>/<skill>/SKILL.md.agentic-skill-router-disabled` |
| Malformed state backup | `~/.agentic-skill-router/state-<host>.json.malformed.<ts>.bak` |

Skill roots come from the host. See `README.md` "How It Works" for the full
list per host.

## `skills status` output fields

A healthy run prints only:

```text
disabled skills: N
  <id>  (<reason>, <iso-timestamp>)
```

Every additional section below indicates an anomaly that Agentic Skill Router either
auto-repaired or now needs you to resolve.

### `recovered (in-flight ops committed from journal): <id...>`

**Meaning.** A previous `disable` or `enable` crashed between the on-disk
rename and the state-file save. Agentic Skill Router replayed the journal entry and
brought the state file in line with the actual file on disk. **No action
needed** — this is the auto-repair path.

### `rolled back (in-flight ops with no completed rename): <id...>`

**Meaning.** A previous `disable` or `enable` crashed before the rename
happened. Agentic Skill Router undid the intent and removed the journal entry. **No
action needed.** If you still want the operation, re-run `skills disable` or
`skills enable`.

### `reapplied (upstream restored these): <id...>`

**Meaning.** A plugin upgrade, `npx skills update`, or a manual file copy
restored a fresh `SKILL.md` for a skill that the user had previously
disabled. Agentic Skill Router detected the live file, re-applied the rename to
`SKILL.md.agentic-skill-router-disabled`, and kept the disable record intact. **No
action needed.** This is the expected behavior after a plugin upgrade — re-run
`skills status` once after the upgrade to let Agentic Skill Router reconcile.

If you actually want the upgraded skill enabled, run:

```bash
agentic-skill-router skills enable <id>
```

### `orphaned records (SKILL.md gone entirely; run \`enable <id>\` to clean state): <id...>`

**Meaning.** The state file still has a disable record for `<id>`, but neither
`SKILL.md` nor `SKILL.md.agentic-skill-router-disabled` exists at the recorded path.
Typical causes:

- The plugin that owned the skill was uninstalled.
- The skill directory was deleted manually.
- The host upgraded and moved the skill to a new id/path.

**Recovery.** Run:

```bash
agentic-skill-router skills enable <id>
```

This removes the orphan record from state without touching the file system
(because there is no file to rename). The CLI's `--json` output for each id
is shaped `{ "id": "...", "alreadyEnabled": <boolean> }`; there is no
dedicated "cleaned state only" flag, so automation should treat a successful
exit (code `0`) together with the id appearing in the result array as
confirmation that the orphan record was cleaned.

### `⚠ CONFLICTED — both SKILL.md and SKILL.md.agentic-skill-router-disabled present:`

```text
  <id>
Manually delete one file (typically the .agentic-skill-router-disabled to fully
enable, or the SKILL.md to fully disable) and re-run `status`.
```

**Meaning (split-brain).** The state file says `<id>` is disabled, **and both**
of the following exist on disk:

- `<root>/<skill>/SKILL.md`
- `<root>/<skill>/SKILL.md.agentic-skill-router-disabled`

This usually happens when:

- The user (or another tool) renamed or copied `SKILL.md` back manually after
  Agentic Skill Router disabled it.
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
   agentic-skill-router skills status   # should now be clean
   ```

3. If the **live** version is the one you want to keep (you want this skill
   enabled again), delete the disabled marker and then run `skills enable` to
   clear the state record:

   ```bash
   rm "<root>/<skill>/SKILL.md.agentic-skill-router-disabled"
   agentic-skill-router skills enable <id>
   ```

   The `enable` call is what removes the stale disable record from
   `~/.agentic-skill-router/state-<host>.json`.

> Safety note: `rm` is the only place in this guide that uses `rm`. Always run
> `skills status` again afterwards to confirm the anomaly is gone before
> restarting the host.

### `orphan disabled markers (no state record; left from a previous tool or crash):`

```text
  <absolute-path-to-SKILL.md.agentic-skill-router-disabled>
```

**Meaning.** A `SKILL.md.agentic-skill-router-disabled` file exists, but Agentic Skill Router
has no matching state record for it. This typically comes from:

- A previous tool (or an older Agentic Skill Router install) that renamed `SKILL.md`
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
  mv "<path>.agentic-skill-router-disabled" "<path-without-suffix>"
  # i.e.  mv .../SKILL.md.agentic-skill-router-disabled .../SKILL.md
  agentic-skill-router skills status   # the orphan marker should now be gone
  ```

- To keep it disabled but have Agentic Skill Router track it, re-run `skills disable
  <id>` after first restoring the file as above. Agentic Skill Router will detect the
  live SKILL.md, rename it back, and write a fresh state record so future
  upgrades reapply correctly.

> **When is it safe to `rm` a `.agentic-skill-router-disabled` file directly?** Only
> when you (1) understand the skill is gone for good and (2) no state record
> references it. In all other cases, prefer `mv` so the action is reversible.

### `pending operations needing manual resolution (split-brain on disk):`

```text
  <id>  (<op>, started <iso-timestamp>)
```

**Meaning.** Agentic Skill Router tried to reconcile a journal entry during this
`status` run but the file system was still in a split-brain state (both
`SKILL.md` and `SKILL.md.agentic-skill-router-disabled` present), so the journal entry
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
agentic-skill-router skills enable <id>    # safe, idempotent state cleanup
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

   In this case Agentic Skill Router has already snapshotted the original file for
   you. The snapshot sits next to the live state file with a timestamped
   `.malformed.<iso-ts>.bak` suffix.

   The live state file on disk is **not** rewritten by `loadState`; only the
   in-memory copy drops the malformed records. The file is only overwritten
   the next time a state-mutating command (such as
   `agentic-skill-router skills disable`, `enable`, or `reset`) runs and calls
   `saveState`. Until then, the bad records remain on disk. If you do not
   plan to run a mutating command soon, treat this as a manual repair: edit
   the live state file to remove the bad records (using the
   `.malformed.<iso-ts>.bak` snapshot as a reference), or follow the
   recovery procedure below.

**Recovery procedure (for cases 1 and 2):**

1. **Back up first.** Never edit the live state file without a copy:

   ```bash
   cp ~/.agentic-skill-router/state-<host>.json \
      ~/.agentic-skill-router/state-<host>.json.bak
   ```

2. Inspect the file. The schema is documented by `validateRecord` /
   `validatePendingOp` in `src/state.ts`. Most corruption is a truncated
   final byte from a crash mid-write; opening the file in an editor and
   re-balancing the braces is usually enough.

3. If you cannot repair it, the safest reset is to remove just the disabled
   skills you no longer remember, restore `SKILL.md` files by hand from
   `.agentic-skill-router-disabled` siblings, and let `status` rebuild state by
   running `skills disable <id> --yes` for each skill you want disabled again.

4. Only as a last resort, delete the state file entirely:

   ```bash
   rm ~/.agentic-skill-router/state-<host>.json
   ```

   This drops **all** disable records. After deletion, you must walk the skill
   roots yourself and `mv` any leftover `SKILL.md.agentic-skill-router-disabled` files
   back to `SKILL.md` (or re-run `skills disable` for each one you want to
   keep disabled).

For case 3, the snapshot at `<path>.malformed.<ts>.bak` is exactly the
pre-cleanup state. Keep it until you are sure no records were lost; you can
copy specific entries from the backup back into the live state file with an
editor.

## Plugin upgrade + `skills reapply` semantics

Agentic Skill Router does not expose a separate `skills reapply` command. **Every
`skills status` run is a reapply.** After a plugin upgrade:

1. The host writes a fresh `SKILL.md` for every skill in the plugin.
2. You run `agentic-skill-router skills status`.
3. For each disabled record where the live `SKILL.md` reappeared, Skill
   Router renames it back to `SKILL.md.agentic-skill-router-disabled` and emits the
   `reapplied (upstream restored these): ...` line.
4. For each disabled record where the file vanished entirely, Agentic Skill Router
   emits the `orphaned records ...` line. Run `skills enable <id>` to clean
   those.
5. For each conflict (both files present), Agentic Skill Router emits the
   `⚠ CONFLICTED` block and exits with code `1`. Resolve as described above.

If you want to run reapply in a script (e.g. as a post-upgrade hook), use:

```bash
agentic-skill-router skills status --json
```

and check the `conflicted`, `orphaned`, `reapplied`, `recoveredCommits`, and
`recoveredRollbacks` arrays in the JSON output.

## Uninstall after a skill is disabled

When you uninstall the agentic-skill-router plugin (`npm run uninstall:plugin` or
`npm run uninstall:codex-plugin`), the uninstall script:

- Removes the plugin cache.
- Unregisters the plugin from the host.
- **Does not auto-enable previously-disabled skills.** Their `SKILL.md` files
  remain renamed to `SKILL.md.agentic-skill-router-disabled`.
- Prints a warning listing the still-disabled skills:

  ```text
  ⚠ N skill(s) are still disabled by agentic-skill-router.
    Their SKILL.md files remain renamed even after uninstall.
    To restore them BEFORE uninstalling, run:
      (use the bundled CLI) skills enable <id>
  ```

- Preserves `~/.agentic-skill-router/` unless you pass `--purge`.

**Recommended order:**

1. **Before** running the uninstall script, enable every skill you want back:

   ```bash
   agentic-skill-router skills enable <id>
   ```

   Use `agentic-skill-router skills status` to confirm `disabled skills: 0`.

2. Then run the uninstall script.

**If you already uninstalled without enabling first:**

You still have two choices:

- Reinstall the plugin (`npm run install:plugin` or
  `npm run install:codex-plugin`), run `skills enable <id>` for each disabled
  skill, then uninstall again.
- Or walk the affected skill roots and `mv` each `.agentic-skill-router-disabled` file
  back to `SKILL.md` by hand. After that, delete (or `--purge`)
  `~/.agentic-skill-router/` since the state records are now meaningless.

## When it is safe to manually delete `.agentic-skill-router-disabled`

Direct deletion of `SKILL.md.agentic-skill-router-disabled` files is **destructive and
non-reversible** from Agentic Skill Router's perspective. It is only safe when **all**
of the following hold:

- The owning skill is being permanently removed (e.g. you also intend to
  delete the entire `<root>/<skill>/` directory).
- There is no matching state record (the skill does not appear in `skills
  status` under any of the anomaly headers).
- You have confirmed the file is the disabled marker and not a binary backup
  or a different artifact.

In every other case, prefer `mv …/SKILL.md.agentic-skill-router-disabled
…/SKILL.md` (which is reversible by running `agentic-skill-router skills disable`
later) or `agentic-skill-router skills enable <id>` (which performs the rename plus
the state cleanup atomically).

## See also

- [README — Web UI safety](../README.md#web-ui-safety) for the bind defaults,
  `--dangerously-bind-public` flow, and `--project-root` allowlist semantics.
- [简体中文版本](troubleshooting.zh-CN.md).
