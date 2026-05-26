import { parseStrict } from "../args.ts";
import { findOrphanMarkers, reapplyMissing } from "../apply.ts";
import { createHost } from "../host-resolve.ts";
import { loadState, statePathForHost } from "../state.ts";
import type { HostName } from "../types.ts";

/**
 * `agentic-skill-router skills status` — reports disabled skills, reapply results,
 * orphans, in-flight ops, and routed-usage counters. Exits 1 when any
 * conflicting on-disk state is detected.
 */
export async function cmdStatus(argv: string[], hostName: HostName): Promise<number> {
  const { values } = parseStrict({
    commandName: "agentic-skill-router skills status",
    config: { args: argv, options: { json: { type: "boolean" } } },
  });
  const host = createHost(hostName);
  const statePath = statePathForHost(host.name);
  const skills = await host.listSkills();
  const reapplyResult = await reapplyMissing({ statePath, host: host.name, skills });
  const state = await loadState(statePath, host.name);
  const orphanMarkers = await findOrphanMarkers(await host.skillRoots(), { statePath, host: host.name });

  if (values.json) {
    process.stdout.write(JSON.stringify({
      disabledCount: state.disabledSkills.length,
      reapplied: reapplyResult.reapplied,
      orphaned: reapplyResult.orphaned,
      conflicted: reapplyResult.conflicted,
      recoveredCommits: reapplyResult.recoveredCommits,
      recoveredRollbacks: reapplyResult.recoveredRollbacks,
      skipped: reapplyResult.skipped,
      orphanMarkers,
      disabled: state.disabledSkills,
      pendingOps: state.pendingOps ?? [],
      routed: state.routedSkills ?? [],
    }, null, 2) + "\n");
    return reapplyResult.conflicted.length > 0 ? 1 : 0;
  }
  console.log(`disabled skills: ${state.disabledSkills.length}`);
  for (const r of state.disabledSkills) {
    console.log(`  ${r.id}  (${r.reason}, ${r.disabledAt})`);
  }
  if (reapplyResult.recoveredCommits.length > 0) {
    console.log(`\nrecovered (in-flight ops committed from journal): ${reapplyResult.recoveredCommits.join(", ")}`);
  }
  if (reapplyResult.recoveredRollbacks.length > 0) {
    console.log(`\nrolled back (in-flight ops with no completed rename): ${reapplyResult.recoveredRollbacks.join(", ")}`);
  }
  if (reapplyResult.reapplied.length > 0) {
    console.log(`\nreapplied (upstream restored these): ${reapplyResult.reapplied.join(", ")}`);
  }
  if (reapplyResult.skipped.length > 0) {
    console.log(
      `\nskipped (out-of-root symlink, manual repair required) — \`skills status\` will not silently rename files outside this host's skills root:`,
    );
    for (const s of reapplyResult.skipped) {
      const linkedPart = s.linkedTarget && s.linkedTarget !== s.livePath
        ? `${s.livePath} -> ${s.linkedTarget}`
        : s.livePath;
      console.log(`  ${s.id}  (linked target: ${linkedPart})`);
      if (s.fixCommand) {
        console.log(`    fix: ${s.fixCommand}`);
      } else if (s.manualRepairHint) {
        // Ambiguous id (multiple inventory instances): `skills disable <id>`
        // would resolve to a single arbitrary instance, so the hint points
        // the user at the specific instanceKey + path instead.
        console.log(`    fix: ${s.manualRepairHint}`);
      }
    }
  }
  if (reapplyResult.orphaned.length > 0) {
    console.log(`\norphaned records (SKILL.md gone entirely; run \`enable <id>\` to clean state): ${reapplyResult.orphaned.join(", ")}`);
  }
  if (reapplyResult.conflicted.length > 0) {
    console.log(`\n⚠ CONFLICTED — both SKILL.md and SKILL.md.agentic-skill-router-disabled present:`);
    for (const id of reapplyResult.conflicted) console.log(`  ${id}`);
    console.log(`Manually delete one file (typically the .agentic-skill-router-disabled to fully enable, or the SKILL.md to fully disable) and re-run \`status\`.`);
  }
  if (orphanMarkers.length > 0) {
    console.log(`\norphan disabled markers (no state record; left from a previous tool or crash):`);
    for (const p of orphanMarkers) console.log(`  ${p}`);
  }
  const remainingPending = state.pendingOps ?? [];
  if (remainingPending.length > 0) {
    console.log(`\npending operations needing manual resolution (split-brain on disk):`);
    for (const p of remainingPending) console.log(`  ${p.id}  (${p.op}, started ${p.startedAt})`);
  }
  const routed = state.routedSkills ?? [];
  if (routed.length > 0) {
    console.log(`\nrouted usage:`);
    for (const r of routed) {
      console.log(`  ${r.id}  (${r.routeCount} route(s), last ${r.lastRoutedAt}, ${r.lastConfidence})`);
    }
  }
  return reapplyResult.conflicted.length > 0 ? 1 : 0;
}
