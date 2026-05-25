import { parseStrict } from "../args.ts";
import { routeDisabledSkillsAuto } from "../auto-route.ts";
import { loadConfig } from "../config.ts";
import { dciRouteDisabledSkills } from "../dci.ts";
import { createHost } from "../host-resolve.ts";
import { routeDisabledSkillsMetadata } from "../metadata-route.ts";
import { parseTopK, projectRoute, resolveRouteMode } from "../output.ts";
import { routeDisabledSkills } from "../route.ts";
import { loadState, recordRoutedSkill, saveState, statePathForHost, withStateLock } from "../state.ts";
import type { HostName, RouteMode, Skill } from "../types.ts";

/**
 * `agentic-skill-router skills route` — finds the best disabled-skill match for a
 * query, optionally records the route in state, and prints either text or
 * `--json` output.
 */
export async function cmdRoute(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills route",
    config: {
      args: argv,
      options: {
        query: { type: "string", short: "q" },
        json: { type: "boolean" },
        "top-k": { type: "string" },
        mode: { type: "string" },
        "no-record": { type: "boolean" },
      },
      allowPositionals: true,
    },
  });
  const query = ((values.query as string | undefined) ?? positionals.join(" ")).trim();
  if (query === "") {
    console.error("specify --query=<text> or pass the query as positional text");
    return 2;
  }

  const topK = parseTopK(values["top-k"] as string | undefined);
  if (topK === null) {
    console.error("--top-k must be a positive integer");
    return 2;
  }
  const config = await loadConfig();
  const routeMode = resolveRouteMode(values.mode as string | undefined, config.routeMode);
  if (!routeMode) {
    console.error("--mode must be one of: auto, metadata, body, lexical, dci");
    return 2;
  }

  const host = createHost(hostName);
  const skills = await host.listSkills();
  const result = await routeByMode(skills, query, routeMode, topK === undefined ? {} : { topK });
  const selected = result.selected;
  let recorded = false;
  const warnings: string[] = [];

  if (selected && !values["no-record"]) {
    try {
      const statePath = statePathForHost(host.name);
      await withStateLock(statePath, async () => {
        const state = await loadState(statePath, host.name);
        await saveState(recordRoutedSkill(state, {
          id: selected.skill.id,
          pluginKey: selected.skill.pluginKey,
          skillMdPath: selected.skill.skillMdPath,
          name: selected.skill.name,
          query,
          confidence: selected.confidence,
          routedAt: new Date().toISOString(),
        }), statePath);
      });
      recorded = true;
    } catch (err) {
      const warning = `routed usage was not recorded: ${(err as Error).message}`;
      warnings.push(warning);
      process.stderr.write(`warning: ${warning}\n`);
    }
  }

  const projected = projectRoute(result, recorded, warnings);
  if (values.json) {
    process.stdout.write(JSON.stringify(projected, null, 2) + "\n");
    return 0;
  }

  if (!selected) {
    console.log("no confident disabled-skill route found.");
    if (projected.matches.length > 0) {
      console.log("\ncandidate matches:");
      for (const m of projected.matches) {
        console.log(`  [${m.confidence}] ${m.id} (${m.score})`);
        console.log(`       ${m.reason}`);
      }
    }
    return 1;
  }

  console.log(`route: [${projected.selected!.confidence}] ${projected.selected!.id}`);
  console.log(`read:  ${projected.selected!.skillMdPath}`);
  console.log(`why:   ${projected.selected!.reason}`);
  if (recorded) console.log("usage: recorded routed use");
  return 0;
}

async function routeByMode(
  skills: Skill[],
  query: string,
  mode: RouteMode,
  opts: { topK?: number },
) {
  if (mode === "lexical") return routeDisabledSkills(skills, query, opts);
  if (mode === "metadata") return routeDisabledSkillsMetadata(skills, query, opts);
  if (mode === "body") {
    const result = await dciRouteDisabledSkills(skills, query, opts);
    return { ...result, routeMode: "body" as const };
  }
  if (mode === "dci") return dciRouteDisabledSkills(skills, query, opts);
  return routeDisabledSkillsAuto(skills, query, opts);
}
