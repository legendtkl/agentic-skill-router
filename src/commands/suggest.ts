import { parseStrict } from "../args.ts";
import { loadConfig, resolveUnusedForDays, resolveUsageSince } from "../config.ts";
import { createHost } from "../host-resolve.ts";
import { formatUsageDiagnostics, printSuggestions, projectSuggestion } from "../output.ts";
import { suggest } from "../policy.ts";
import type { HostName } from "../types.ts";

/**
 * `agentic-skill-router skills suggest` — lists skills the policy thinks are
 * candidates for disabling based on the configured unused-for threshold.
 */
export async function cmdSuggest(argv: string[], hostName: HostName): Promise<number> {
  const { values } = parseStrict({
    commandName: "agentic-skill-router skills suggest",
    config: {
      args: argv,
      options: { "unused-for": { type: "string" }, json: { type: "boolean" } },
    },
  });
  const host = createHost(hostName);
  const config = await loadConfig();
  const days = resolveUnusedForDays({ cliFlag: values["unused-for"] as string | undefined, config });
  const since = resolveUsageSince({ config });
  const skills = await host.listSkills();
  const { usage, diagnostics } = await host.usageStatsDetailed({ since });
  const suggestions = suggest(skills, usage, {
    unusedForDays: days,
    keepNames: config.keepNames,
    keepIds: config.keepIds,
  });

  if (values.json) {
    const payload = {
      suggestions: suggestions.map((s) => projectSuggestion(s)),
      usageDiagnostics: diagnostics,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return 0;
  }
  printSuggestions(suggestions, days);
  console.log(formatUsageDiagnostics(diagnostics));
  return 0;
}
