import { readdir, realpath, rename, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
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
import {
  BuiltinSkillCannotDisableError,
  SkillConflictError,
  SkillOutOfRootError,
  SkillSymlinkTargetMismatchError,
} from "./types.ts";
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
  /**
   * Allow acting through an out-of-root symlink. Kept opt-in so CLI callers
   * retain the default safety behavior unless an interactive surface has
   * explicitly warned the user.
   */
  allowOutOfRoot?: boolean;
  /**
   * Skill roots currently advertised by the active host (typically
   * `await host.skillRoots()`). When supplied, `enableSkillFromState`
   * re-validates the state-recorded `skillMdPath` against these roots before
   * renaming so a tampered or stale state record cannot direct a rename to an
   * arbitrary filesystem path (#100), and so out-of-root drift discovered
   * since the disable was recorded gets gated by `allowOutOfRoot` exactly the
   * way the inventory-path CLI flow already gates it (#125).
   *
   * Optional for backward compatibility: callers that don't have a host on
   * hand (legacy tests, library consumers) skip the gate, just like before.
   */
  allowedSkillRoots?: string[];
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
  if (skill.outOfRoot && !deps.allowOutOfRoot) throw new SkillOutOfRootError(skill.id, skill.skillMdPath);
  if (!skill.canDisable && !(skill.outOfRoot && deps.allowOutOfRoot && skill.source !== "builtin")) {
    throw new BuiltinSkillCannotDisableError(skill.id);
  }

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
    // When the operation flows through an out-of-root symlink, capture the
    // canonical "SKILL.md-form" path of the file we are about to track BEFORE
    // the rename, so later enable/reapply can detect retargeting (#97).
    //
    // We store the SKILL.md-form (suffix stripped) rather than the raw
    // realpath so a single recorded value works regardless of which side of
    // the rename the on-disk file is on at check time:
    //   - At disable time we realpath the live `SKILL.md`.
    //   - At enable time we realpath the disabled marker (.agentic-skill-router-disabled).
    //   - At reapply time we realpath the live `SKILL.md` again.
    // All three resolve to the same external directory, and stripping the
    // suffix on each side gives apples-to-apples comparison without having
    // to remember which suffix the resolver happened to see.
    const recordOutOfRoot = Boolean(skill.outOfRoot) && deps.allowOutOfRoot === true;
    let canonicalAtDisable: string | undefined;
    let canonicalLivePath: string | undefined;
    if (recordOutOfRoot && liveExists) {
      // Resolve the canonical of the live file pre-rename. canonicalLivePath
      // is the realpath we will rename THROUGH (P1.B TOCTOU: rename via the
      // canonical, not the in-root symlink path, so a concurrent symlink
      // swap between this resolve and the rename cannot redirect the rename
      // to a different file). canonicalAtDisable is the suffix-stripped form
      // we persist for later comparison.
      const resolvedLive = await tryRealpath(livePath);
      if (resolvedLive !== null) {
        canonicalLivePath = resolvedLive;
        canonicalAtDisable = resolvedLive.endsWith(DISABLED_SUFFIX)
          ? resolvedLive.slice(0, -DISABLED_SUFFIX.length)
          : resolvedLive;
      }
    } else if (recordOutOfRoot && !liveExists) {
      // Already-disabled marker through a symlink: resolve from the disabled
      // path so the record carries the canonical for future checks.
      const c = await canonicalSkillFile(disabledPath);
      if (c !== null) canonicalAtDisable = c;
    }

    const baseRecord: DisableRecord = {
      instanceKey: skillInstanceKey(skill.id, disabledPath),
      id: skill.id,
      pluginKey: skill.pluginKey,
      skillMdPath: disabledPath,
      skillName: skill.name,
      source: skill.source,
      disabledAt: startedAt,
      reason,
      ...(canonicalAtDisable ? { canonicalSkillMdPath: canonicalAtDisable } : {}),
      ...(recordOutOfRoot ? { discoveredViaSymlink: true } : {}),
    };

    // Phase 1: write intent BEFORE the rename. On crash between this save and
    // the rename, the journal lets `status` either complete the rename or
    // roll back the intent without leaving a half-applied disable record.
    // The journal entry carries the canonical so crash recovery can commit
    // the record without re-resolving (#97 P1.C — see reconcilePendingOp).
    const initial = await loadState(deps.statePath, deps.host);
    // Snapshot any pre-existing disable record so a rollback can restore it
    // instead of silently forgetting the user's prior disabled intent.
    const priorRecord = findDisableRecord(initial, baseRecord.instanceKey);
    const pending: PendingOp = {
      instanceKey: baseRecord.instanceKey,
      op: "disable",
      id: skill.id,
      livePath,
      disabledPath,
      startedAt,
      record: baseRecord,
      ...(priorRecord ? { priorRecord } : {}),
    };
    const beforeRename = addPendingOp(initial, pending);
    await saveState(beforeRename, deps.statePath);

    let alreadyDisabled = false;
    if (liveExists) {
      // P1.B (TOCTOU): for out-of-root symlinks we have already resolved the
      // canonical live path. Rename through it directly so a concurrent
      // symlink swap between resolve and rename cannot redirect this rename
      // to a different file. For in-root paths there is no symlink to swap,
      // so the original livePath -> disabledPath rename is sufficient.
      if (canonicalLivePath) {
        const canonicalDisabledPath = canonicalLivePath.endsWith(DISABLED_SUFFIX)
          ? canonicalLivePath
          : canonicalLivePath + DISABLED_SUFFIX;
        await rename(canonicalLivePath, canonicalDisabledPath);
      } else {
        await rename(livePath, disabledPath);
      }
    } else {
      alreadyDisabled = true;
    }

    // Phase 2: rename succeeded; commit the disable record and clear the
    // pending entry in a single write. If THIS save fails, the next `status`
    // sees pending=disable + disabled file present and finishes the commit
    // idempotently.
    const committed = removePendingOp(addDisableRecord(beforeRename, baseRecord), baseRecord.instanceKey);
    await saveState(committed, deps.statePath);
    return { state: committed, alreadyDisabled };
  });
}

export async function enableSkill(
  skill: Skill,
  deps: ApplyDeps = {},
): Promise<{ state: State; alreadyEnabled: boolean }> {
  if (skill.outOfRoot && !deps.allowOutOfRoot) throw new SkillOutOfRootError(skill.id, skill.skillMdPath);
  if (skill.outOfRoot && deps.allowOutOfRoot && skill.source === "builtin") {
    throw new BuiltinSkillCannotDisableError(skill.id);
  }
  return withStateLock(deps.statePath, async () => {
    const { livePath, disabledPath } = pathsForSkill(skill);
    const instanceKey = skillInstanceKey(skill.id, livePath);
    return enableSkillPaths(instanceKey, livePath, disabledPath, deps, undefined, skill.id);
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
    const inRoot = pathsForRecord(rec);
    const inRootLiveBefore = await fileExists(inRoot.livePath);
    const inRootDisabledBefore = await fileExists(inRoot.disabledPath);

    // P1 follow-up to #100/#125 on top of #97: when a symlink-recorded skill
    // has its in-root symlink later deleted or broken, both in-root probes
    // miss even though the actual file the user renamed (the canonical
    // out-of-root SKILL.md.agentic-skill-router-disabled) is still on disk.
    // Without the canonical fallback below, we would fall straight through
    // to `enableSkillPaths`'s "both absent → clean up state" branch, silently
    // drop the disable record, and strand the canonical disabled marker —
    // bypassing both the root-gate and #97's canonical-drift guard. When the
    // record was discovered via a symlink and captured its canonical
    // realpath (#97 / PR #132), probe the canonical paths too; if either
    // exists, operate against the canonical pair so the gate runs against an
    // out-of-root realpath (it IS out-of-root by construction for
    // `discoveredViaSymlink: true`) and the rename hits the real file.
    let livePath = inRoot.livePath;
    let disabledPath = inRoot.disabledPath;
    let liveBefore = inRootLiveBefore;
    let disabledBefore = inRootDisabledBefore;
    if (
      !inRootLiveBefore &&
      !inRootDisabledBefore &&
      rec.discoveredViaSymlink &&
      rec.canonicalSkillMdPath
    ) {
      const canonicalLive = rec.canonicalSkillMdPath.endsWith(DISABLED_SUFFIX)
        ? rec.canonicalSkillMdPath.slice(0, -DISABLED_SUFFIX.length)
        : rec.canonicalSkillMdPath;
      const canonicalDisabled = canonicalLive + DISABLED_SUFFIX;
      const canonicalLiveExists = await fileExists(canonicalLive);
      const canonicalDisabledExists = await fileExists(canonicalDisabled);
      if (canonicalLiveExists || canonicalDisabledExists) {
        livePath = canonicalLive;
        disabledPath = canonicalDisabled;
        liveBefore = canonicalLiveExists;
        disabledBefore = canonicalDisabledExists;
      }
    }

    // Re-validate whichever path we ended up with against the host's current
    // skill roots BEFORE renaming. The state file is plain JSON and might be
    // tampered, hand-edited, or stale; without this gate
    // `enableSkillFromState` would happily rename arbitrary local paths a
    // record points at (#100) and would also bypass the out-of-root symlink
    // gate the inventory-path enable flow already enforces (#125). When we
    // swapped to the canonical paths above, this also covers the broken
    // in-root symlink case: the canonical path is out-of-root by definition
    // for a `discoveredViaSymlink` record, so this refuses without the flag.
    if (deps.allowedSkillRoots && deps.allowedSkillRoots.length > 0) {
      // Prefer the file that actually exists on disk; fall back to the
      // disabled marker (the canonical resting location for a disable record)
      // so a missing live file still produces a useful realpath comparison.
      const probePath = liveBefore ? livePath : disabledPath;
      const realTarget = await tryRealpath(probePath);
      // If neither file exists, there is nothing to rename and no path to
      // re-validate; let the downstream state-cleanup branch handle it.
      if (realTarget !== null) {
        const rootsResolved = await resolveExistingPaths(deps.allowedSkillRoots);
        if (!isPathUnderAnyRoot(realTarget, rootsResolved) && !deps.allowOutOfRoot) {
          throw new Error(symlinkMutationRefusalMessage(rec.id, probePath, realTarget));
        }
      }
    }
    const result = await enableSkillPaths(rec.instanceKey, livePath, disabledPath, deps, state);
    // `cleanedStateOnly` reports "no on-disk file existed for this record";
    // honour that across BOTH the in-root and the canonical probe sites so a
    // record cleaned up via the canonical fallback (or fully orphaned at
    // both sites) is still correctly classified.
    return {
      ...result,
      cleanedStateOnly: !liveBefore && !disabledBefore,
      id: rec.id,
      instanceKey: rec.instanceKey,
    };
  });
}

/**
 * Mirror of the inventory-path `symlinkMutationRefusal` error in
 * `src/commands/apply.ts`. Kept in apply.ts so the state-only enable flow
 * surfaces an identical refusal message (same flag hint, same linked-target
 * disclosure) without pulling a CLI module into the runtime layer.
 */
function symlinkMutationRefusalMessage(skillId: string, livePath: string, realTarget: string): string {
  const linkedPart = realTarget !== livePath ? `${livePath} -> ${realTarget}` : livePath;
  return (
    `refusing to enable ${skillId}: skill resolves to a symlink target outside this host's skills root ` +
    `(linked target: ${linkedPart}). ` +
    `Re-run with --allow-symlink-target-mutation to modify the linked target.`
  );
}

/**
 * Resolve each candidate root to its realpath if it exists. Non-existent
 * roots are silently skipped — the host may advertise project-scope roots
 * that don't exist in every workspace, and a missing root cannot contain
 * any path anyway.
 */
async function resolveExistingPaths(paths: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const p of paths) {
    const real = await tryRealpath(p);
    if (real !== null) resolved.push(real);
  }
  return resolved;
}

/**
 * Returns true when `candidate` is the same path as one of `roots` or sits
 * underneath one of them. All inputs are expected to be absolute realpaths;
 * comparison is segment-based (so `/a/b` does NOT match `/a/banana`).
 */
function isPathUnderAnyRoot(candidate: string, roots: string[]): boolean {
  const c = resolve(candidate);
  for (const root of roots) {
    const r = resolve(root);
    if (c === r) return true;
    const prefix = r.endsWith(sep) ? r : r + sep;
    if (c.startsWith(prefix)) return true;
  }
  return false;
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
export interface ReapplySkippedSymlink {
  /** disable record id we would have re-applied */
  id: string;
  /** stable per-instance key for the skill */
  instanceKey: string;
  /** absolute path to the live SKILL.md that would have been renamed */
  livePath: string;
  /** realpath of livePath (the actual file outside the host's skills root) */
  linkedTarget: string;
  /**
   * Copy-pasteable command the user can run to opt in. `null` when the bare
   * `id` resolves to multiple inventory instances — `skills disable <id>`
   * would then collapse to a single arbitrary instance via
   * `new Map(skills.map((s) => [s.id, s]))` and could rename the wrong one.
   * Consult `manualRepairHint` instead in that case.
   */
  fixCommand: string | null;
  /**
   * Set only when `fixCommand` is `null` (ambiguous id). Names the specific
   * instance and points the user at a path-level repair so they can act on
   * the correct skill without guessing.
   */
  manualRepairHint?: string;
}

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
  /**
   * Disable records whose live SKILL.md was re-created BUT now resolves
   * through an out-of-root symlink. `reapplyMissing` refuses to silently
   * rename those targets — `skills status` is intended to be a read-only
   * inspection surface and must not mutate files outside the host's skills
   * root. The user can opt back in via the printed `fixCommand`.
   */
  skipped: ReapplySkippedSymlink[];
  /**
   * Disable records whose recorded `canonicalSkillMdPath` (#97) no longer
   * matches the current realpath of the on-disk file — the symlink target
   * was retargeted between disable and now. Distinct from `skipped`: that
   * one fires whenever the current inventory entry is out-of-root (the
   * broader #124 policy), while this one is the narrower belt-and-suspenders
   * canonical-drift check that catches records the broader policy missed
   * (e.g. record indicated an in-root mutation but the file's canonical
   * drifted underneath, or `current.outOfRoot` is unexpectedly false). Each
   * entry is formatted as `<id>: <recorded canonical> -> <current canonical>`.
   */
  symlinkMismatches: string[];
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
    const skipped: ReapplySkippedSymlink[] = [];
    const symlinkMismatches: string[] = [];

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
        // Upstream re-created the live SKILL.md. Two safety gates can refuse
        // the silent re-rename, checked in precedence order:
        //
        //   1. (#124) If the current inventory entry is an out-of-root
        //      mutable symlink, defer to the broader "skills status never
        //      silently mutates out-of-root targets" policy. Emit a
        //      `skipped` entry with a `fixCommand` (unambiguous id) or a
        //      `manualRepairHint` (ambiguous id) so the user can opt back
        //      in explicitly. This is the broader gate because it applies
        //      to every out-of-root skill, including records written by
        //      older versions that never captured a canonical.
        //
        //   2. (#97) Else, if this record captured a `canonicalSkillMdPath`
        //      at disable time and the current realpath of the live file no
        //      longer matches, refuse. This is the narrower
        //      belt-and-suspenders check — it catches drift the broader
        //      policy can miss (e.g. a record that predicates an in-root
        //      mutation but the on-disk file's canonical drifted, or
        //      `current.outOfRoot` is unexpectedly false because the
        //      inventory scan was racy). Surface it as a
        //      `symlinkMismatches` entry, distinct from `skipped`.
        //
        //   3. Else, rename. When we resolved a canonical realpath above,
        //      prefer renaming through THAT (#97 P1.B TOCTOU hardening) —
        //      re-traversing the in-root symlink path again could be
        //      redirected by a concurrent symlink swap. Falls back to the
        //      path-based rename for in-root skills.
        if (current && isOutOfRootMutableSymlinkSkill(current)) {
          const linkedTarget = (await tryRealpath(paths.livePath)) ?? paths.livePath;
          // `skills disable` resolves bare positional ids via a Map keyed on
          // skill.id, which collapses duplicates to a single arbitrary
          // instance. Emitting `disable <id>` would then potentially rename
          // the wrong skill. When the current inventory has >1 instance
          // sharing this id, surface a manual-repair hint that names the
          // specific instanceKey instead of a copy-pasteable command.
          const ambiguous = (idCounts.get(rec.id) ?? 0) > 1;
          if (ambiguous) {
            skipped.push({
              id: rec.id,
              instanceKey: rec.instanceKey,
              livePath: paths.livePath,
              linkedTarget,
              fixCommand: null,
              manualRepairHint:
                `Multiple skills share id \`${rec.id}\`; manually rename ` +
                `${paths.livePath} -> ${paths.disabledPath} or use the Web UI ` +
                `to disable the specific instance (instanceKey: ${rec.instanceKey}).`,
            });
          } else {
            skipped.push({
              id: rec.id,
              instanceKey: rec.instanceKey,
              livePath: paths.livePath,
              linkedTarget,
              fixCommand: `agentic-skill-router skills disable ${rec.id} --yes --allow-symlink-target-mutation`,
            });
          }
          continue;
        }

        let canonicalLive: string | null = null;
        if (rec.canonicalSkillMdPath) {
          canonicalLive = await tryRealpath(paths.livePath);
          if (canonicalLive) {
            const currentCanonical = canonicalLive.endsWith(DISABLED_SUFFIX)
              ? canonicalLive.slice(0, -DISABLED_SUFFIX.length)
              : canonicalLive;
            if (currentCanonical !== rec.canonicalSkillMdPath) {
              symlinkMismatches.push(
                `${rec.id}: ${rec.canonicalSkillMdPath} -> ${currentCanonical}`,
              );
              continue;
            }
          }
        }

        if (canonicalLive) {
          const canonicalDisabled = canonicalLive.endsWith(DISABLED_SUFFIX)
            ? canonicalLive
            : canonicalLive + DISABLED_SUFFIX;
          await rename(canonicalLive, canonicalDisabled);
        } else {
          await rename(paths.livePath, paths.disabledPath);
        }
        reapplied.push(rec.id);
      } else if (!disabledExists && !liveExists) {
        orphaned.push(rec.id);
      }
    }

    if (nextState !== state) await saveState(nextState, deps.statePath);
    return { reapplied, orphaned, conflicted, recoveredCommits, recoveredRollbacks, skipped, symlinkMismatches };
  });
}

/**
 * Mirror of `isOutOfRootMutableSymlink` from `src/commands/apply.ts`. Kept
 * private to apply.ts so reapplyMissing can reuse the same policy without
 * pulling in a CLI command module from the runtime layer. A builtin remains
 * protected by `canDisable=false` upstream; out-of-root user / plugin skills
 * are visible but unsafe to rename without explicit consent.
 */
function isOutOfRootMutableSymlinkSkill(skill: Skill): boolean {
  return skill.outOfRoot === true && skill.source !== "builtin";
}

async function tryRealpath(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
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
  // The pending op's own `instanceKey` is the canonical journal key. The
  // validator synthesizes it from `(id, disabledPath)` for legacy entries that
  // predate the field, so it is always populated here.
  const pendingInstanceKey = pending.instanceKey;

  // P1 (#97 round 3): the disable / enable rename now flows through the
  // canonical realpath (P1.B), so a crash AFTER the rename but BEFORE the
  // final state save can leave the canonical disabled marker on disk while
  // the in-root symlink at `pending.livePath` has been retargeted (by the
  // user or some other tool) to a different file. Checking the symlink
  // paths would then report "live absent / disabled absent" and roll back
  // a record whose canonical disk file is actually in the renamed state —
  // state and disk would silently diverge.
  //
  // Resolve which paths to consult: when we have a record (pending.record
  // for disable, or the matching state record for enable) flagged
  // `discoveredViaSymlink: true` AND carrying a `canonicalSkillMdPath`,
  // make the commit-vs-rollback decision against the canonical paths
  // instead. Otherwise (legacy record, missing canonical, or in-root skill)
  // fall back to the original symlink-path behavior — the legacy shape
  // predates the canonical guard and we have no other ground truth.
  const recordForPaths = pending.op === "disable"
    ? (pending.record ?? state.disabledSkills.find((r) => r.instanceKey === pendingInstanceKey))
    : state.disabledSkills.find((r) => r.instanceKey === pendingInstanceKey);
  const canonicalLive = recordForPaths?.discoveredViaSymlink && recordForPaths.canonicalSkillMdPath
    ? recordForPaths.canonicalSkillMdPath
    : null;
  const checkLivePath = canonicalLive ?? pending.livePath;
  const checkDisabledPath = canonicalLive
    ? canonicalLive + DISABLED_SUFFIX
    : pending.disabledPath;
  const liveExists = await fileExists(checkLivePath);
  const disabledExists = await fileExists(checkDisabledPath);

  if (pending.op === "disable") {
    if (disabledExists && !liveExists) {
      const baseRecord = pending.record ?? state.disabledSkills.find((r) => r.instanceKey === pendingInstanceKey);
      // P1.C (#97 round 2): a disable where the disable-time realpath
      // silently failed, or any legacy journal entry that predates the
      // canonical capture, would leave the recovered record flagged
      // `discoveredViaSymlink: true` without a `canonicalSkillMdPath`. Then
      // enableSkillPaths' guard would treat the missing canonical as legacy
      // and silently skip the retarget check. Backfill the canonical now
      // (the disabled marker is on disk, so realpath works) before
      // committing the record so the safety net survives crash recovery.
      // We prefer the canonical disabled-marker path when we have one, since
      // the symlink at `pending.disabledPath` may already be retargeted and
      // would resolve to the wrong file.
      const record = baseRecord && baseRecord.discoveredViaSymlink && !baseRecord.canonicalSkillMdPath
        ? await backfillCanonical(baseRecord, checkDisabledPath)
        : baseRecord;
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
 * P1.C helper (#97): if a pending disable record is flagged as
 * `discoveredViaSymlink: true` but lacks `canonicalSkillMdPath` (the
 * disable-time realpath failed, or the record predates that field being
 * captured pre-rename), resolve the canonical now from the on-disk disabled
 * marker and fill it in. The on-disk file is the ground truth at this point
 * (rename completed before the crash), so a successful realpath here is the
 * canonical we would have written had the disable run to completion.
 *
 * If realpath still fails, return the record unchanged — the safety net
 * cannot be reconstructed and the record stays "discoveredViaSymlink with no
 * canonical" so a follow-up status sees the same shape and can keep trying.
 * We deliberately do NOT throw here: refusing to commit a recovered record
 * would leave the disk and state out of sync, which is worse than committing
 * a record whose canonical the next status will attempt to backfill again.
 */
async function backfillCanonical(record: DisableRecord, disabledPath: string): Promise<DisableRecord> {
  const c = await canonicalSkillFile(disabledPath);
  if (c === null) return record;
  return { ...record, canonicalSkillMdPath: c };
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

/**
 * Compute the canonical "SKILL.md-form" path: realpath the on-disk file at
 * `path`, then strip any trailing disabled-marker suffix. This gives a stable
 * value regardless of whether the file currently lives at `SKILL.md` or
 * `SKILL.md.agentic-skill-router-disabled`, so the recorded canonical can be
 * compared apples-to-apples by enable, reapply, and the disable-time writer
 * without depending on which side of the rename we are on.
 *
 * Returns null if realpath fails (no on-disk file yet, broken symlink,
 * transient FS error). Callers MUST treat null as "no comparison possible"
 * and skip the mismatch check — never fail the operation on a realpath error.
 */
async function canonicalSkillFile(path: string): Promise<string | null> {
  const resolved = await tryRealpath(path);
  if (resolved === null) return null;
  return resolved.endsWith(DISABLED_SUFFIX)
    ? resolved.slice(0, -DISABLED_SUFFIX.length)
    : resolved;
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
  overrideId?: string,
): Promise<{ state: State; alreadyEnabled: boolean }> {
  const state = preloadedState ?? await loadState(deps.statePath, deps.host);
  const disabledExists = await fileExists(disabledPath);
  const liveExists = await fileExists(livePath);

  // Resolve the human-friendly id (used for the pending journal and error
  // messages) from the disable record matching this instanceKey. If no
  // record exists yet (e.g. enable called on a never-disabled skill), fall
  // back to the instanceKey itself so the journal still has a stable key.
  const matchingRecord = state.disabledSkills.find((r) => r.instanceKey === instanceKey);
  const id = matchingRecord?.id ?? overrideId ?? instanceKey;

  if (liveExists && disabledExists) {
    throw new SkillConflictError(id, livePath);
  }

  // Symlink retarget guard (#97): if the recorded disable captured a
  // canonical realpath, verify the file we are about to rename back still
  // resolves to the same canonical target. A mismatch means the user (or
  // some other tool) retargeted the symlink between disable and enable, and
  // renaming through the new link would silently mutate an unrelated file.
  // Refuse the rename and surface a manual-repair error.
  //
  // We compare the SKILL.md-form canonical (suffix stripped on both sides)
  // so the recorded value matches regardless of which marker the on-disk
  // file currently uses. `currentResolved` is the full realpath we will
  // also use as the rename source to defeat the path-recomputation TOCTOU
  // (P1.B).
  let canonicalRenameSource: string | null = null;
  if (matchingRecord?.canonicalSkillMdPath) {
    const targetPath = disabledExists ? disabledPath : (liveExists ? livePath : null);
    if (targetPath) {
      const currentResolved = await tryRealpath(targetPath);
      if (currentResolved) {
        const currentCanonical = currentResolved.endsWith(DISABLED_SUFFIX)
          ? currentResolved.slice(0, -DISABLED_SUFFIX.length)
          : currentResolved;
        if (currentCanonical !== matchingRecord.canonicalSkillMdPath) {
          throw new SkillSymlinkTargetMismatchError(
            id,
            targetPath,
            matchingRecord.canonicalSkillMdPath,
            currentCanonical,
          );
        }
        canonicalRenameSource = currentResolved;
      }
    }
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
    // P1.B (TOCTOU): when we resolved a canonical above, rename through it
    // directly. The realpath we already computed *is* the file we just
    // confirmed matches the recorded canonical; renaming via the in-root
    // symlink path again would re-traverse the link and could be redirected
    // by a concurrent swap. For non-symlink (in-root) skills there is no
    // canonical to resolve and the path-based rename is sufficient.
    if (canonicalRenameSource && canonicalRenameSource.endsWith(DISABLED_SUFFIX)) {
      const canonicalLive = canonicalRenameSource.slice(0, -DISABLED_SUFFIX.length);
      await rename(canonicalRenameSource, canonicalLive);
    } else {
      await rename(disabledPath, livePath);
    }
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
