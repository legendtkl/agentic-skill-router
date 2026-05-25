import { readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { DISABLED_SUFFIX } from "./scan.ts";
import {
  addDisableRecord,
  addPendingOp,
  findDisableRecord,
  loadState,
  removeDisableRecord,
  removePendingOp,
  saveState,
  skillInstanceKey,
  withStateLock,
} from "./state.ts";
import { BuiltinSkillCannotDisableError, SkillConflictError, SkillOutOfRootError } from "./types.ts";
import type { DisableRecord, HostName, PendingOp, Skill, State } from "./types.ts";

export interface ApplyDeps {
  /** Override state path for tests. */
  statePath?: string | undefined;
  /** Override host stored in state. */
  host?: HostName;
  /** Override now() for deterministic timestamps. */
  now?: () => Date;
  /** Current inventory, used to reconcile state records after plugin upgrades. */
  skills?: Skill[];
}

export async function disableSkill(
  skill: Skill,
  reason: string,
  deps: ApplyDeps = {},
): Promise<{ state: State; alreadyDisabled: boolean }> {
  // Check outOfRoot before canDisable so that the more specific
  // SkillOutOfRootError is surfaced for symlink-escape cases. Out-of-root
  // skills now also report canDisable=false (see #29/#57), but reporting
  // "builtin" for them would mask the real remediation path. These are the
  // only safety gates protecting SKILL.md from being renamed outside the
  // discovered skills root or on a builtin; hosts intentionally do NOT
  // expose disable/enable, so this check is the single source of truth.
  if (skill.outOfRoot) throw new SkillOutOfRootError(skill.id, skill.skillMdPath);
  if (!skill.canDisable) throw new BuiltinSkillCannotDisableError(skill.id);

  return withStateLock(deps.statePath, async () => {
    const { livePath, disabledPath } = pathsForSkill(skill);
    const liveExists = await fileExists(livePath);
    const disabledExists = await fileExists(disabledPath);

    // Refuse to clobber: if both exist, user must resolve manually.
    if (liveExists && disabledExists) {
      throw new SkillConflictError(skill.id, livePath);
    }
    if (!liveExists && !disabledExists) {
      throw new Error(`SKILL.md not found for ${skill.id} (looked at ${livePath} and ${disabledPath})`);
    }

    const startedAt = (deps.now?.() ?? new Date()).toISOString();
    const record: DisableRecord = {
      instanceKey: skillInstanceKey(skill.id, disabledPath),
      id: skill.id,
      pluginKey: skill.pluginKey,
      skillMdPath: disabledPath,
      skillName: skill.name,
      source: skill.source,
      disabledAt: startedAt,
      reason,
    };

    // Phase 1: write intent BEFORE the rename. On crash between this save and
    // the rename, the journal lets `status` either complete the rename or
    // roll back the intent without leaving a half-applied disable record.
    const initial = await loadState(deps.statePath, deps.host);
    // Snapshot any pre-existing disable record so a rollback can restore it
    // instead of silently forgetting the user's prior disabled intent.
    const priorRecord = findDisableRecord(initial, record.instanceKey);
    const pending: PendingOp = {
      instanceKey: record.instanceKey,
      op: "disable",
      id: skill.id,
      livePath,
      disabledPath,
      startedAt,
      record,
      ...(priorRecord ? { priorRecord } : {}),
    };
    const beforeRename = addPendingOp(initial, pending);
    await saveState(beforeRename, deps.statePath);

    let alreadyDisabled = false;
    if (liveExists) {
      await rename(livePath, disabledPath);
    } else {
      alreadyDisabled = true;
    }

    // Phase 2: rename succeeded; commit the disable record and clear the
    // pending entry in a single write. If THIS save fails, the next `status`
    // sees pending=disable + disabled file present and finishes the commit
    // idempotently.
    const committed = removePendingOp(addDisableRecord(beforeRename, record), record.instanceKey);
    await saveState(committed, deps.statePath);
    return { state: committed, alreadyDisabled };
  });
}

export async function enableSkill(
  skill: Skill,
  deps: ApplyDeps = {},
): Promise<{ state: State; alreadyEnabled: boolean }> {
  if (skill.outOfRoot) throw new SkillOutOfRootError(skill.id, skill.skillMdPath);
  return withStateLock(deps.statePath, async () => {
    const { livePath, disabledPath } = pathsForSkill(skill);
    const instanceKey = skillInstanceKey(skill.id, livePath);
    return enableSkillPaths(instanceKey, livePath, disabledPath, deps);
  });
}

export async function enableSkillFromState(
  idOrInstanceKey: string,
  deps: ApplyDeps = {},
): Promise<{
  state: State;
  alreadyEnabled: boolean;
  cleanedStateOnly: boolean;
  /** The resolved record's id (may differ from the raw input when an instanceKey was passed). */
  id: string;
  /** The resolved record's stable instanceKey. */
  instanceKey: string;
}> {
  return withStateLock(deps.statePath, async () => {
    const state = await loadState(deps.statePath, deps.host);
    const rec = resolveDisableRecord(state, idOrInstanceKey);
    const { livePath, disabledPath } = pathsForRecord(rec);
    const liveBefore = await fileExists(livePath);
    const disabledBefore = await fileExists(disabledPath);
    const result = await enableSkillPaths(rec.instanceKey, livePath, disabledPath, deps, state);
    return {
      ...result,
      cleanedStateOnly: !liveBefore && !disabledBefore,
      id: rec.id,
      instanceKey: rec.instanceKey,
    };
  });
}

function resolveDisableRecord(state: State, idOrInstanceKey: string): DisableRecord {
  // instanceKey is the canonical identity; fall back to id for backward
  // compatibility, but refuse to silently pick when an id is ambiguous.
  const byInstance = state.disabledSkills.find((r) => r.instanceKey === idOrInstanceKey);
  if (byInstance) return byInstance;
  const byId = state.disabledSkills.filter((r) => r.id === idOrInstanceKey);
  if (byId.length === 0) throw new Error(`unknown skill id: ${idOrInstanceKey}`);
  if (byId.length === 1) return byId[0]!;
  // `skills enable` accepts the instanceKey as a positional argument (see
  // cmdEnable). Print one ready-to-copy command per candidate so the user
  // can resolve the ambiguity without guessing CLI syntax.
  const examples = byId
    .map((r) => `  agentic-skill-router skills enable ${r.instanceKey}  # ${r.skillMdPath}`)
    .join("\n");
  throw new Error(
    `ambiguous skill id "${idOrInstanceKey}" matches ${byId.length} disabled instances; ` +
    `re-run with one of:\n${examples}`,
  );
}

/**
 * Re-apply disable for any record where the live SKILL.md re-appeared (plugin
 * upgrade / npx skills update overwrote our rename), and flag various forms
 * of split-brain or partial state.
 */
export interface ReapplyResult {
  /** state had a disable record + live SKILL.md was back; we re-renamed it */
  reapplied: string[];
  /** state had a disable record but neither file is on disk */
  orphaned: string[];
  /** state had a disable record + BOTH files exist (user must resolve) */
  conflicted: string[];
  /** journal entries whose intent was applied (committed) by this run */
  recoveredCommits: string[];
  /** journal entries whose intent was rolled back (rename never completed) */
  recoveredRollbacks: string[];
}

export async function reapplyMissing(deps: ApplyDeps = {}): Promise<ReapplyResult> {
  return withStateLock(deps.statePath, async () => {
    const loaded = await loadState(deps.statePath, deps.host);
    // Primary match key: `(id, canonical path)` so two on-disk instances of
    // the same logical id never collapse.
    const byInstance = new Map<string, Skill>();
    // Secondary fallback: bare id, used only when the inventory and the
    // state both have exactly one record for that id. That covers the plugin
    // upgrade case where the path changed but the id is unambiguous.
    const idCounts = new Map<string, number>();
    const byId = new Map<string, Skill>();
    for (const skill of deps.skills ?? []) {
      const key = skillInstanceKey(skill.id, skill.skillMdPath);
      byInstance.set(key, skill);
      byId.set(skill.id, skill);
      idCounts.set(skill.id, (idCounts.get(skill.id) ?? 0) + 1);
    }
    const reapplied: string[] = [];
    const orphaned: string[] = [];
    const conflicted: string[] = [];
    const recoveredCommits: string[] = [];
    const recoveredRollbacks: string[] = [];

    // Step 0: reconcile the pending-op journal before any other inference.
    // A pending entry means a disable/enable was in flight; the file system
    // tells us whether the rename completed. We resolve each entry to the
    // user-intended terminal state and then drop it from the journal.
    let state = loaded;
    for (const pending of loaded.pendingOps ?? []) {
      const resolved = await reconcilePendingOp(pending, state);
      state = resolved.state;
      if (resolved.commit === "committed") recoveredCommits.push(pending.id);
      else if (resolved.commit === "rolled-back") recoveredRollbacks.push(pending.id);
    }
    if (state !== loaded) await saveState(state, deps.statePath);

    // stateIdCounts is computed after journal reconciliation so the secondary
    // id fallback uses the cleaned-up disabled-skills list, not the raw load.
    const stateIdCounts = new Map<string, number>();
    for (const rec of state.disabledSkills) {
      stateIdCounts.set(rec.id, (stateIdCounts.get(rec.id) ?? 0) + 1);
    }

    let nextState = state;

    for (const rec of state.disabledSkills) {
      let current = byInstance.get(rec.instanceKey);
      if (!current && idCounts.get(rec.id) === 1 && stateIdCounts.get(rec.id) === 1) {
        // Path-shifting upgrade for a uniquely-named skill: reconcile to the
        // new path. Multi-instance ids never enter this branch.
        current = byId.get(rec.id);
      }
      const paths = current ? pathsForSkill(current) : pathsForRecord(rec);

      if (current) {
        const refreshed: DisableRecord = {
          ...rec,
          // canonical instanceKey is stable across rename so re-derive from
          // the live path; this also lets old records pick up the new key
          // shape (if we ever change the hash) on next save.
          instanceKey: skillInstanceKey(rec.id, paths.disabledPath),
          pluginKey: current.pluginKey,
          skillMdPath: paths.disabledPath,
          skillName: current.name,
          source: current.source,
        };
        if (
          refreshed.instanceKey !== rec.instanceKey ||
          refreshed.pluginKey !== rec.pluginKey ||
          refreshed.skillMdPath !== rec.skillMdPath ||
          refreshed.skillName !== rec.skillName ||
          refreshed.source !== rec.source
        ) {
          // If the instanceKey moved (path-shifting upgrade), drop the stale
          // record first so we don't end up with two entries for the same
          // logical skill.
          if (refreshed.instanceKey !== rec.instanceKey) {
            nextState = removeDisableRecord(nextState, rec.instanceKey);
          }
          nextState = addDisableRecord(nextState, refreshed);
        }
      }

      const disabledExists = await fileExists(paths.disabledPath);
      const liveExists = await fileExists(paths.livePath);

      if (liveExists && disabledExists) {
        conflicted.push(rec.id);
      } else if (!disabledExists && liveExists) {
        // upstream re-created it; re-rename
        await rename(paths.livePath, paths.disabledPath);
        reapplied.push(rec.id);
      } else if (!disabledExists && !liveExists) {
        orphaned.push(rec.id);
      }
    }

    if (nextState !== state) await saveState(nextState, deps.statePath);
    return { reapplied, orphaned, conflicted, recoveredCommits, recoveredRollbacks };
  });
}

interface PendingResolution {
  state: State;
  commit: "committed" | "rolled-back" | "noop";
}

/**
 * Reconcile a single pending journal entry based on which file is on disk.
 *
 * disable intent:
 *   - disabled file present, live absent → rename completed; commit the record.
 *   - live present, disabled absent → rename never happened; roll back intent
 *     to the snapshot captured in `priorRecord` (a previously-valid disable
 *     record stays, fresh attempts that had no prior record are dropped).
 *   - both absent → SKILL.md vanished entirely; roll back intent and let the
 *     existing orphan/missing-file diagnostics take over for any pre-existing
 *     record.
 *   - both present → split-brain; leave the journal entry untouched so the
 *     user can resolve manually. We still record this as a noop so a later
 *     status run can retry once they fix it.
 *
 * enable intent:
 *   - live present, disabled absent → rename completed; remove the disable
 *     record. CRITICAL: this is the path that prevents the next `status` from
 *     re-disabling a skill the user just enabled.
 *   - disabled present, live absent → rename never happened; the existing
 *     disable record stays as-is. Roll back intent.
 *   - both absent → SKILL.md vanished; remove the now-stale disable record.
 *   - both present → split-brain; leave the journal entry untouched.
 */
async function reconcilePendingOp(
  pending: PendingOp,
  state: State,
): Promise<PendingResolution> {
  const liveExists = await fileExists(pending.livePath);
  const disabledExists = await fileExists(pending.disabledPath);
  // The pending op's own `instanceKey` is the canonical journal key. The
  // validator synthesizes it from `(id, disabledPath)` for legacy entries that
  // predate the field, so it is always populated here.
  const pendingInstanceKey = pending.instanceKey;

  if (pending.op === "disable") {
    if (disabledExists && !liveExists) {
      const record = pending.record ?? state.disabledSkills.find((r) => r.instanceKey === pendingInstanceKey);
      const withRecord = record ? addDisableRecord(state, record) : state;
      return { state: removePendingOp(withRecord, pendingInstanceKey), commit: "committed" };
    }
    if (liveExists && !disabledExists) {
      // Rename never happened — atomically undo this attempt. If a prior
      // disable record existed before the pending op was written, restore it
      // so subsequent `status` runs can still reapply the user's intent.
      return {
        state: removePendingOp(rollbackDisableRecord(state, pending, pendingInstanceKey), pendingInstanceKey),
        commit: "rolled-back",
      };
    }
    if (!liveExists && !disabledExists) {
      return {
        state: removePendingOp(removeDisableRecord(state, pendingInstanceKey), pendingInstanceKey),
        commit: "rolled-back",
      };
    }
    // split-brain: leave both the files and the journal entry for manual repair
    return { state, commit: "noop" };
  }

  // enable
  if (liveExists && !disabledExists) {
    // User successfully enabled the skill before the crash. Drop the disable
    // record and the journal entry. This is the regression guard from #26:
    // we MUST NOT leave the disable record in place, otherwise reapply would
    // re-disable the skill on the next status.
    return {
      state: removePendingOp(removeDisableRecord(state, pendingInstanceKey), pendingInstanceKey),
      commit: "committed",
    };
  }
  if (disabledExists && !liveExists) {
    // Rename never happened; the original disable record remains valid.
    return { state: removePendingOp(state, pendingInstanceKey), commit: "rolled-back" };
  }
  if (!liveExists && !disabledExists) {
    return {
      state: removePendingOp(removeDisableRecord(state, pendingInstanceKey), pendingInstanceKey),
      commit: "committed",
    };
  }
  return { state, commit: "noop" };
}

/**
 * Walk the same skill roots that `scan` enumerates and find
 * `SKILL.md.agentic-skill-router-disabled` files that are NOT recorded in state.
 * These could be left over from a crash where the rename succeeded but the
 * state save did not, or from a previous tool the user used.
 */
export async function findOrphanMarkers(
  skillRoots: string[],
  deps: ApplyDeps = {},
): Promise<string[]> {
  const state = await loadState(deps.statePath, deps.host);
  const known = new Set<string>();
  for (const r of state.disabledSkills) {
    const p = r.skillMdPath.endsWith(DISABLED_SUFFIX)
      ? r.skillMdPath
      : r.skillMdPath + DISABLED_SUFFIX;
    known.add(p);
  }
  const orphans: string[] = [];
  for (const root of skillRoots) {
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const candidate = join(root, ent.name, `SKILL.md${DISABLED_SUFFIX}`);
      if (await fileExists(candidate) && !known.has(candidate)) {
        orphans.push(candidate);
      }
    }
  }
  return orphans;
}

/**
 * Roll back the disable-record portion of a pending disable op. If the pending
 * op snapshotted a pre-existing record (`priorRecord`), restore it so the
 * user's previous disable intent survives. Otherwise drop the (uncommitted)
 * record we wrote during the failed attempt.
 */
function rollbackDisableRecord(state: State, pending: PendingOp, instanceKey: string): State {
  if (pending.priorRecord) {
    return addDisableRecord(state, pending.priorRecord);
  }
  return removeDisableRecord(state, instanceKey);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

function pathsForSkill(skill: Skill): { livePath: string; disabledPath: string } {
  const livePath = skill.skillMdPath.endsWith(DISABLED_SUFFIX)
    ? skill.skillMdPath.slice(0, -DISABLED_SUFFIX.length)
    : skill.skillMdPath;
  return { livePath, disabledPath: livePath + DISABLED_SUFFIX };
}

function pathsForRecord(record: DisableRecord): { livePath: string; disabledPath: string } {
  const disabledPath = record.skillMdPath.endsWith(DISABLED_SUFFIX)
    ? record.skillMdPath
    : record.skillMdPath + DISABLED_SUFFIX;
  return { livePath: disabledPath.slice(0, -DISABLED_SUFFIX.length), disabledPath };
}

async function enableSkillPaths(
  instanceKey: string,
  livePath: string,
  disabledPath: string,
  deps: ApplyDeps,
  preloadedState?: State,
): Promise<{ state: State; alreadyEnabled: boolean }> {
  const state = preloadedState ?? await loadState(deps.statePath, deps.host);
  const disabledExists = await fileExists(disabledPath);
  const liveExists = await fileExists(livePath);

  // Resolve the human-friendly id (used for the pending journal and error
  // messages) from the disable record matching this instanceKey. If no
  // record exists yet (e.g. enable called on a never-disabled skill), fall
  // back to the instanceKey itself so the journal still has a stable key.
  const matchingRecord = state.disabledSkills.find((r) => r.instanceKey === instanceKey);
  const id = matchingRecord?.id ?? instanceKey;

  if (liveExists && disabledExists) {
    throw new SkillConflictError(id, livePath);
  }

  // Phase 1: persist intent BEFORE renaming. If the post-rename save fails,
  // the next `status` sees pending=enable + live file present and finishes the
  // commit by REMOVING the disable record — it must never reapply disable on
  // a successfully enabled skill.
  const startedAt = (deps.now?.() ?? new Date()).toISOString();
  const pending: PendingOp = {
    instanceKey,
    op: "enable",
    id,
    livePath,
    disabledPath,
    startedAt,
  };
  const beforeRename = addPendingOp(state, pending);
  await saveState(beforeRename, deps.statePath);

  let alreadyEnabled = false;
  if (disabledExists && !liveExists) {
    await rename(disabledPath, livePath);
  } else if (!disabledExists && liveExists) {
    alreadyEnabled = true;
  } else if (!disabledExists && !liveExists) {
    // SKILL.md gone entirely (e.g. plugin uninstalled). Just clean up state.
  }

  // Phase 2: rename completed; remove the disable record (by instanceKey
  // identity) and clear the journal entry together. Both removals use
  // `instanceKey` so two same-id instances never trample each other's state.
  const committed = removePendingOp(removeDisableRecord(beforeRename, instanceKey), instanceKey);
  await saveState(committed, deps.statePath);
  return { state: committed, alreadyEnabled };
}
