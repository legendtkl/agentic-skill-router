import { readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { DISABLED_SUFFIX } from "./scan.ts";
import {
  addDisableRecord,
  loadState,
  removeDisableRecord,
  saveState,
  withStateLock,
} from "./state.ts";
import { BuiltinSkillCannotDisableError, SkillConflictError } from "./types.ts";
import type { DisableRecord, HostName, Skill, State } from "./types.ts";

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

    // Persist intent to state BEFORE renaming. If the rename fails midway, status
    // can detect the orphan (state record present, neither file present) and
    // alert the user. If the rename succeeds but state save fails, status's
    // orphan-marker scan finds the disabled file with no record.
    const record: DisableRecord = {
      id: skill.id,
      pluginKey: skill.pluginKey,
      skillMdPath: disabledPath,
      skillName: skill.name,
      source: skill.source,
      disabledAt: (deps.now?.() ?? new Date()).toISOString(),
      reason,
    };
    const state = await loadState(deps.statePath, deps.host);
    const updated = addDisableRecord(state, record);
    await saveState(updated, deps.statePath);

    let alreadyDisabled = false;
    if (liveExists) {
      await rename(livePath, disabledPath);
    } else {
      alreadyDisabled = true;
    }
    return { state: updated, alreadyDisabled };
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
}

export async function reapplyMissing(deps: ApplyDeps = {}): Promise<ReapplyResult> {
  return withStateLock(deps.statePath, async () => {
    const state = await loadState(deps.statePath, deps.host);
    const byId = new Map((deps.skills ?? []).map((skill) => [skill.id, skill]));
    const reapplied: string[] = [];
    const orphaned: string[] = [];
    const conflicted: string[] = [];
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
    return { reapplied, orphaned, conflicted };
  });
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
  let alreadyEnabled = false;

  if (liveExists && disabledExists) {
    throw new SkillConflictError(id, livePath);
  }
  if (disabledExists && !liveExists) {
    await rename(disabledPath, livePath);
  } else if (!disabledExists && liveExists) {
    alreadyEnabled = true;
  } else if (!disabledExists && !liveExists) {
    // SKILL.md gone entirely (e.g. plugin uninstalled). Just clean up state.
  }

  const updated = removeDisableRecord(state, id);
  await saveState(updated, deps.statePath);
  return { state: updated, alreadyEnabled };
}
