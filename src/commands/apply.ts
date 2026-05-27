import { realpath } from "node:fs/promises";
import { parseStrict } from "../args.ts";
import { disableSkill, enableSkill, enableSkillFromState } from "../apply.ts";
import { loadConfig, resolveUnusedForDays } from "../config.ts";
import { createHost, displayHost } from "../host-resolve.ts";
import { printSuggestions } from "../output.ts";
import { suggest } from "../policy.ts";
import { loadState, skillInstanceKey, statePathForHost } from "../state.ts";
import type { HostName, Skill, Suggestion } from "../types.ts";

/**
 * `agentic-skill-router skills disable` — disables specific ids or every
 * suggested-stale skill (with `--all-suggested`). Requires `--yes` to
 * actually mutate disk; without it, prints a dry-run preview and exits 1.
 */
export async function cmdDisable(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills disable",
    config: {
      args: argv,
      options: {
        "all-suggested": { type: "boolean" },
        "unused-for": { type: "string" },
        yes: { type: "boolean", short: "y" },
        reason: { type: "string" },
        json: { type: "boolean" },
        "allow-symlink-target-mutation": { type: "boolean" },
      },
      allowPositionals: true,
    },
  });
  const allowSymlinkMutation = values["allow-symlink-target-mutation"] === true;

  const host = createHost(hostName);
  const skills = await host.listSkills();
  const statePath = statePathForHost(host.name);

  let targets: Skill[];
  let reason = (values.reason as string | undefined) ?? "manual";
  let suggested: Suggestion[] | undefined;
  let unusedDays: number | undefined;

  if (values["all-suggested"]) {
    const config = await loadConfig();
    unusedDays = resolveUnusedForDays({ cliFlag: values["unused-for"] as string | undefined, config });
    const usage = await host.usageStats();
    suggested = suggest(skills, usage, {
      unusedForDays: unusedDays,
      keepNames: config.keepNames,
      keepIds: config.keepIds,
    });
    // Don't auto-disable skills whose usage attribution is ambiguous (e.g.
    // two plugins sharing the same pluginShort name): we can't safely tell
    // whether the user has been using them via the transcript short form.
    // They still appear in `suggest --json` output flagged so the user can
    // investigate; explicit `disable <id>` still works.
    const safe = suggested.filter((s) => !s.attributionAmbiguous);
    targets = safe.map((s) => s.skill);
    // `--all-suggested` MUST NOT silently rewrite out-of-root symlink targets
    // (e.g. ~/.claude/skills/foo → /shared/skill/foo) — that would let `--yes`
    // alone modify files outside the host's skills root. Skip them with a
    // clear stderr note and keep going for the rest of the batch.
    if (!allowSymlinkMutation) {
      const skippedSymlinks = targets.filter((t) => isOutOfRootMutableSymlink(t));
      if (skippedSymlinks.length > 0) {
        targets = targets.filter((t) => !isOutOfRootMutableSymlink(t));
        const lines = await Promise.all(
          skippedSymlinks.map(async (t) => {
            const realTarget = await resolveLinkedTarget(t.skillMdPath);
            const linkedPart =
              realTarget && realTarget !== t.skillMdPath ? `${t.skillMdPath} -> ${realTarget}` : t.skillMdPath;
            return `  ${t.id}  (linked target: ${linkedPart})`;
          }),
        );
        console.error(
          `note: skipping ${skippedSymlinks.length} out-of-root symlink skill(s) from --all-suggested; ` +
            `pass --allow-symlink-target-mutation to include them:\n${lines.join("\n")}`,
        );
      }
    }
    reason = (values.reason as string | undefined) ?? `auto:unused-${unusedDays}d`;
  } else {
    if (positionals.length === 0) {
      console.error("specify <id...> or --all-suggested");
      return 2;
    }
    const byId = new Map(skills.map((s) => [s.id, s]));
    targets = [];
    for (const id of positionals) {
      const s = byId.get(id);
      if (!s) {
        console.error(`unknown skill id: ${id}`);
        return 2;
      }
      targets.push(s);
    }
  }

  if (!values.yes) {
    console.error(`would disable ${targets.length} skill(s); pass --yes to apply`);
    if (suggested && unusedDays !== undefined) {
      printSuggestions(suggested, unusedDays);
      const skipped = suggested.filter((s) => s.attributionAmbiguous);
      if (skipped.length > 0) {
        console.error(
          `\nnote: ${skipped.length} skill(s) skipped from --all-suggested because their usage attribution is ambiguous (multiple plugins share the same pluginShort name). Disable explicitly with \`agentic-skill-router skills disable <id>\` if intended.`,
        );
      }
    } else {
      for (const t of targets) console.error(`  ${t.id}`);
    }
    return 1;
  }

  const results: Array<{ id: string; instanceKey: string; alreadyDisabled: boolean }> = [];
  for (const t of targets) {
    try {
      if (isOutOfRootMutableSymlink(t) && !allowSymlinkMutation) {
        console.error(await symlinkMutationRefusal(t, "disable"));
        return 1;
      }
      const allowOutOfRoot = allowSymlinkMutation && isOutOfRootMutableSymlink(t);
      if (allowOutOfRoot) await warnIfSymlinkMutation(t, "disable");
      const r = await disableSkill(t, reason, { statePath, host: host.name, allowOutOfRoot });
      results.push({
        id: t.id,
        instanceKey: skillInstanceKey(t.id, t.skillMdPath),
        alreadyDisabled: r.alreadyDisabled,
      });
    } catch (err: unknown) {
      console.error(`failed to disable ${t.id}: ${(err as Error).message}`);
      return 1;
    }
  }
  if (values.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    console.log(`disabled ${results.length} skill(s). Restart ${displayHost(host.name)} for changes to take effect.`);
    for (const r of results)
      console.log(`  ${r.id}${r.alreadyDisabled ? "  (already disabled, state refreshed)" : ""}`);
  }
  return 0;
}

/**
 * `agentic-skill-router skills enable` — re-enables skills previously disabled by
 * the router. Handles ambiguous bare-id resolution (inventory + state) and
 * orphan state records.
 */
export async function cmdEnable(argv: string[], hostName: HostName): Promise<number> {
  const { positionals, values } = parseStrict({
    commandName: "agentic-skill-router skills enable",
    config: {
      args: argv,
      options: {
        json: { type: "boolean" },
        "allow-symlink-target-mutation": { type: "boolean" },
      },
      allowPositionals: true,
    },
  });
  const allowSymlinkMutation = values["allow-symlink-target-mutation"] === true;
  if (positionals.length === 0) {
    console.error("specify <id...>");
    return 2;
  }
  const host = createHost(hostName);
  const skills = await host.listSkills();
  const statePath = statePathForHost(host.name);
  // Snapshot the host's skill roots once per invocation so the state-only
  // enable branch can re-validate any state-recorded path against current
  // host policy (issues #100, #125). Inventory-path enable doesn't need
  // these — it already operates on a Skill with `outOfRoot` precomputed by
  // the host's scan.
  const allowedSkillRoots = await host.skillRoots();
  const inventoryByInstanceKey = new Map<string, Skill>();
  for (const s of skills) {
    inventoryByInstanceKey.set(skillInstanceKey(s.id, s.skillMdPath), s);
  }

  const results: Array<{ id: string; instanceKey: string; alreadyEnabled: boolean }> = [];
  for (const target of positionals) {
    try {
      // Resolution must consider BOTH inventory and the live state: a stale
      // state record sharing the same id as a live inventory entry still
      // makes a bare-id call ambiguous (the user may have meant the orphan).
      // We re-read state per iteration so prior enables in the same command
      // line don't trip stale-ambiguity errors.
      const state = await loadState(statePath, host.name);
      const candidatesByInstanceKey = new Map<string, { id: string; description: string }>();
      const instanceKeysById = new Map<string, Set<string>>();
      const addCandidate = (instanceKey: string, id: string, description: string): void => {
        if (!candidatesByInstanceKey.has(instanceKey)) {
          candidatesByInstanceKey.set(instanceKey, { id, description });
        }
        let bucket = instanceKeysById.get(id);
        if (!bucket) {
          bucket = new Set();
          instanceKeysById.set(id, bucket);
        }
        bucket.add(instanceKey);
      };
      for (const [key, s] of inventoryByInstanceKey) addCandidate(key, s.id, s.skillMdPath);
      for (const rec of state.disabledSkills) addCandidate(rec.instanceKey, rec.id, rec.skillMdPath);

      // 1) Exact instanceKey match -> unambiguous by definition.
      let resolvedKey: string | undefined;
      if (candidatesByInstanceKey.has(target)) {
        resolvedKey = target;
      } else {
        // 2) Bare id: collect every candidate (inventory + state) with this
        //    id. Exactly one -> use it. Multiple -> ambiguous; do not silently
        //    pick. Zero -> fall through to the state resolver which produces
        //    the canonical "unknown skill id" error.
        const keys = instanceKeysById.get(target);
        if (keys && keys.size > 1) {
          // `skills enable` takes the instanceKey as a positional argument; the
          // suggestion lines must be a ready-to-paste invocation so the user
          // doesn't have to guess CLI syntax (there is no --instance-key flag).
          const lines = [...keys]
            .map((k) => {
              const c = candidatesByInstanceKey.get(k)!;
              return `  agentic-skill-router skills enable ${k}  # ${c.description}`;
            })
            .join("\n");
          console.error(
            `ambiguous skill id "${target}" matches ${keys.size} instances; ` + `re-run with one of:\n${lines}`,
          );
          return 2;
        }
        if (keys && keys.size === 1) resolvedKey = [...keys][0];
      }

      if (resolvedKey && inventoryByInstanceKey.has(resolvedKey)) {
        // Inventory path: we have a live Skill to operate on.
        const s = inventoryByInstanceKey.get(resolvedKey)!;
        if (isOutOfRootMutableSymlink(s) && !allowSymlinkMutation) {
          console.error(await symlinkMutationRefusal(s, "enable"));
          return 1;
        }
        const allowOutOfRoot = allowSymlinkMutation && isOutOfRootMutableSymlink(s);
        if (allowOutOfRoot) await warnIfSymlinkMutation(s, "enable");
        const r = await enableSkill(s, { statePath, host: host.name, allowOutOfRoot });
        results.push({
          id: s.id,
          instanceKey: skillInstanceKey(s.id, s.skillMdPath),
          alreadyEnabled: r.alreadyEnabled,
        });
        continue;
      }

      // 3) State-only path: either we resolved to a state-only instanceKey
      //    (orphan record), or we have no inventory/state match at all and
      //    want the state resolver to produce a clear "unknown skill id"
      //    error. Pass the resolvedKey when known so enableSkillFromState
      //    operates on the canonical identity rather than the raw target.
      //    Plumb the host's current skill roots AND the symlink-mutation
      //    flag through so a record whose recorded `skillMdPath` now points
      //    out-of-root gets the same refusal-with-flag-hint as the inventory
      //    flow (PR #123, issues #100 & #125), not a silent rename of a
      //    file outside the host's skills root.
      const lookup = resolvedKey ?? target;
      const r = await enableSkillFromState(lookup, {
        statePath,
        host: host.name,
        allowedSkillRoots,
        allowOutOfRoot: allowSymlinkMutation,
      });
      results.push({ id: r.id, instanceKey: r.instanceKey, alreadyEnabled: r.alreadyEnabled });
    } catch (err) {
      const message = (err as Error).message;
      if (/unknown skill id/.test(message) || /ambiguous skill id/.test(message)) {
        console.error(message);
        return 2;
      }
      // The state-only refusal (out-of-root realpath without
      // `--allow-symlink-target-mutation`, #100 + #125) already names the
      // skill id, the linked target, and the required flag — printing
      // `failed to enable X: refusing to enable X: ...` would just duplicate
      // the id. Mirror the inventory-path branch which prints the refusal
      // verbatim and exits 1.
      if (/^refusing to enable /.test(message)) {
        console.error(message);
        return 1;
      }
      console.error(`failed to enable ${target}: ${message}`);
      return 1;
    }
  }
  if (values.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    console.log(`enabled ${results.length} skill(s). Restart ${displayHost(host.name)} for changes to take effect.`);
  }
  return 0;
}

/**
 * A non-builtin skill whose `SKILL.md` resolves outside the host's skills
 * root (typically via a user-created symlink). Modifying it would rename a
 * file under a path the host does not own, so the CLI requires explicit
 * `--allow-symlink-target-mutation` before touching it. Builtins remain
 * non-disableable irrespective of the flag.
 */
function isOutOfRootMutableSymlink(skill: Skill): boolean {
  return skill.outOfRoot === true && skill.source !== "builtin";
}

async function warnIfSymlinkMutation(skill: Skill, operation: "disable" | "enable"): Promise<void> {
  if (!isOutOfRootMutableSymlink(skill)) return;
  const realTarget = await resolveLinkedTarget(skill.skillMdPath);
  const linkedPart =
    realTarget && realTarget !== skill.skillMdPath ? `${skill.skillMdPath} -> ${realTarget}` : skill.skillMdPath;
  console.error(
    `warning: ${skill.id} is a symlink outside this host's skills root; ${operation} will modify the linked target (${linkedPart})`,
  );
}

async function symlinkMutationRefusal(skill: Skill, operation: "disable" | "enable"): Promise<string> {
  const realTarget = await resolveLinkedTarget(skill.skillMdPath);
  const linkedPart =
    realTarget && realTarget !== skill.skillMdPath ? `${skill.skillMdPath} -> ${realTarget}` : skill.skillMdPath;
  return (
    `refusing to ${operation} ${skill.id}: skill resolves to a symlink target outside this host's skills root ` +
    `(linked target: ${linkedPart}). ` +
    `Re-run with --allow-symlink-target-mutation to modify the linked target.`
  );
}

async function resolveLinkedTarget(skillMdPath: string): Promise<string | null> {
  try {
    return await realpath(skillMdPath);
  } catch {
    return null;
  }
}
