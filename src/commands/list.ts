import { parseStrict } from "../args.ts";
import { loadConfig, resolveUsageSince } from "../config.ts";
import { createHost } from "../host-resolve.ts";
import { formatUsageDiagnostics, printSkillTable, projectSkill } from "../output.ts";
import type { HostName } from "../types.ts";

/**
 * `agentic-skill-router skills list` — prints the host's skill inventory (text or
 * `--json`), enriched with last-used / call-count usage stats.
 */
export async function cmdList(argv: string[], hostName: HostName): Promise<number> {
  const { values } = parseStrict({
    commandName: "agentic-skill-router skills list",
    config: { args: argv, options: { json: { type: "boolean" } } },
  });
  const host = createHost(hostName);
  const config = await loadConfig();
  const since = resolveUsageSince({ config });
  const skills = await host.listSkills();
  const { usage, diagnostics } = await host.usageStatsDetailed({ since });

  if (values.json) {
    const payload = {
      skills: skills.map((s) => projectSkill(s, usage, skills)),
      usageDiagnostics: diagnostics,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return 0;
  }
  printSkillTable(skills, usage);
  console.log(formatUsageDiagnostics(diagnostics));
  return 0;
}
