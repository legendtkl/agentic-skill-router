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
  withStateLock,
} from "./state.ts";
import { BuiltinSkillCannotDisableError, SkillConflictError } from "./types.ts";
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
    const priorRecord = findDisableRecord(initial, skill.id);
    const pending: PendingOp = {
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
    const committed = removePendingOp(addDisableRecord(beforeRename, record), skill.id);
    await saveState(committed, deps.statePath);
    return { state: committed, alreadyDisabled };
  });
}

export async function enableSkill(
  skill: Skill,
  deps: ApplyDeps = {},
): Promise<{ state: State; alreadyEnabled: boolean }> {
  return withStateLock(deps.statePath, async () => {
    const { livePath, disabledPath } = pathsForSkill(skill);
    return enableSkillPaths(skill.id, livePath, disabledPath, deps);
  });
}

export async function enableSkillFromState(
  id: string,
  deps: ApplyDeps = {},
): Promise<{ state: State; alreadyEnabled: boolean; cleanedStateOnly: boolean }> {
  return withStateLock(deps.statePath, async () => {
    const state = await loadState(deps.statePath, deps.host);
    const rec = state.disabledSkills.find((r) => r.id === id);
    if (!rec) throw new Error(`unknown skill id: ${id}`);
    const { livePath, disabledPath } = pathsForRecord(rec);
    const liveBefore = await fileExists(livePath);
    const disabledBefore = await fileExists(disabledPath);
    const result = await enableSkillPaths(id, livePath, disabledPath, deps, state);
    return { ...result, cleanedStateOnly: !liveBefore && !disabledBefore };
  });
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
    const byId = new Map((deps.skills ?? []).map((skill) => [skill.id, skill]));
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

    let nextState = state;

    for (const rec of state.disabledSkills) {
      const current = byId.get(rec.id);
      const paths = current ? pathsForSkill(current) : pathsForRecord(rec);

      if (current) {
        const refreshed: DisableRecord = {
          ...rec,
          pluginKey: current.pluginKey,
          skillMdPath: paths.disabledPath,
          skillName: current.name,
          source: current.source,
        };
        if (
          refreshed.pluginKey !== rec.pluginKey ||
          refreshed.skillMdPath !== rec.skillMdPath ||
          refreshed.skillName !== rec.skillName ||
          refreshed.source !== rec.source
        ) {
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

  if (pending.op === "disable") {
    if (disabledExists && !liveExists) {
      const record = pending.record ?? state.disabledSkills.find((r) => r.id === pending.id);
      const withRecord = record ? addDisableRecord(state, record) : state;
      return { state: removePendingOp(withRecord, pending.id), commit: "committed" };
    }
    if (liveExists && !disabledExists) {
      // Rename never happened — atomically undo this attempt. If a prior
      // disable record existed before the pending op was written, restore it
      // so subsequent `status` runs can still reapply the user's intent.
      return {
        state: removePendingOp(rollbackDisableRecord(state, pending), pending.id),
        commit: "rolled-back",
      };
    }
    if (!liveExists && !disabledExists) {
      return {
        state: removePendingOp(removeDisableRecord(state, pending.id), pending.id),
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
      state: removePendingOp(removeDisableRecord(state, pending.id), pending.id),
      commit: "committed",
    };
  }
  if (disabledExists && !liveExists) {
    // Rename never happened; the original disable record remains valid.
    return { state: removePendingOp(state, pending.id), commit: "rolled-back" };
  }
  if (!liveExists && !disabledExists) {
    return {
      state: removePendingOp(removeDisableRecord(state, pending.id), pending.id),
      commit: "committed",
    };
  }
  return { state, commit: "noop" };
}

/**
 * Walk the same skill roots that `scan` enumerates and find
 * `SKILL.md.skill-router-disabled` files that are NOT recorded in state.
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
function rollbackDisableRecord(state: State, pending: PendingOp): State {
  if (pending.priorRecord) {
    return addDisableRecord(state, pending.priorRecord);
  }
  return removeDisableRecord(state, pending.id);
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
  id: string,
  livePath: string,
  disabledPath: string,
  deps: ApplyDeps,
  preloadedState?: State,
): Promise<{ state: State; alreadyEnabled: boolean }> {
  const state = preloadedState ?? await loadState(deps.statePath, deps.host);
  const disabledExists = await fileExists(disabledPath);
  const liveExists = await fileExists(livePath);

  if (liveExists && disabledExists) {
    throw new SkillConflictError(id, livePath);
  }

  // Phase 1: persist intent BEFORE renaming. If the post-rename save fails,
  // the next `status` sees pending=enable + live file present and finishes the
  // commit by REMOVING the disable record — it must never reapply disable on
  // a successfully enabled skill.
  const startedAt = (deps.now?.() ?? new Date()).toISOString();
  const pending: PendingOp = {
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

  // Phase 2: rename completed; remove the disable record and clear the
  // journal entry together.
  const committed = removePendingOp(removeDisableRecord(beforeRename, id), id);
  await saveState(committed, deps.statePath);
  return { state: committed, alreadyEnabled };
}
