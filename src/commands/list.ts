import { parseStrict } from "../args.ts";
import { createHost } from "../host-resolve.ts";
import { printSkillTable, projectSkill } from "../output.ts";
import type { HostName } from "../types.ts";

/**
 * `skill-router skills list` — prints the host's skill inventory (text or
 * `--json`), enriched with last-used / call-count usage stats.
 */
export async function cmdList(argv: string[], hostName: HostName): Promise<number> {
  const { values } = parseStrict({
    commandName: "skill-router skills list",
    config: { args: argv, options: { json: { type: "boolean" } } },
  });
  const host = createHost(hostName);
  const skills = await host.listSkills();
  const usage = await host.usageStats();

  if (values.json) {
    process.stdout.write(JSON.stringify(skills.map((s) => projectSkill(s, usage, skills)), null, 2) + "\n");
    return 0;
  }
  printSkillTable(skills, usage);
  return 0;
}
