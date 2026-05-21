import { parseStrict } from "../args.ts";
import { loadConfig, resolveUnusedForDays } from "../config.ts";
import { createHost } from "../host-resolve.ts";
import { printSuggestions, projectSuggestion } from "../output.ts";
import { suggest } from "../policy.ts";
import type { HostName } from "../types.ts";

/**
 * `skill-router skills suggest` — lists skills the policy thinks are
 * candidates for disabling based on the configured unused-for threshold.
 */
export async function cmdSuggest(argv: string[], hostName: HostName): Promise<number> {
  const { values } = parseStrict({
    commandName: "skill-router skills suggest",
    config: {
      args: argv,
      options: { "unused-for": { type: "string" }, json: { type: "boolean" } },
    },
  });
  const host = createHost(hostName);
  const config = await loadConfig();
  const days = resolveUnusedForDays({ cliFlag: values["unused-for"] as string | undefined, config });
  const skills = await host.listSkills();
  const usage = await host.usageStats();
  const suggestions = suggest(skills, usage, {
    unusedForDays: days,
    keepNames: config.keepNames,
    keepIds: config.keepIds,
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(suggestions.map((s) => projectSuggestion(s)), null, 2) + "\n");
    return 0;
  }
  printSuggestions(suggestions, days);
  return 0;
}
