import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ParseArgsError, reportParseArgsError } from "./args.ts";
import { cmdDisable, cmdEnable } from "./commands/apply.ts";
import { cmdConfig } from "./commands/config.ts";
import { cmdCorpus } from "./commands/corpus.ts";
import { cmdDci } from "./commands/dci.ts";
import { cmdInit } from "./commands/init.ts";
import { cmdList } from "./commands/list.ts";
import { cmdRoute } from "./commands/route.ts";
import { cmdStatus } from "./commands/status.ts";
import { cmdSuggest } from "./commands/suggest.ts";
import { cmdWeb } from "./commands/web.ts";
import { findDeprecatedHostFlag, resolveHostName } from "./host-resolve.ts";
import { usage } from "./output.ts";

export async function run(argv: string[]): Promise<number> {
  try {
    const deprecatedHostFlag = findDeprecatedHostFlag(argv);
    if (deprecatedHostFlag) {
      console.error(`${deprecatedHostFlag} has been removed; use the installed host-specific plugin CLI instead.`);
      return usage(2);
    }
    const [command, subcommand, ...rest] = argv;
    if (command === undefined || command === "-h" || command === "--help") return usage();
    if (command === "init") return await cmdInit(subcommand === undefined ? rest : [subcommand, ...rest]);
    const hostName = resolveHostName();
    if (!hostName) return usage(2);
    if (command === "skills") {
      switch (subcommand) {
        case "list": return await cmdList(rest, hostName);
        case "suggest": return await cmdSuggest(rest, hostName);
        case "route": return await cmdRoute(rest, hostName);
        case "corpus": return await cmdCorpus(rest, hostName);
        case "dci": return await cmdDci(rest, hostName);
        case "body": return await cmdDci(rest, hostName);
        case "disable": return await cmdDisable(rest, hostName);
        case "enable": return await cmdEnable(rest, hostName);
        case "status": return await cmdStatus(rest, hostName);
        case "config": return await cmdConfig(rest);
        case "web": return await cmdWeb(rest, hostName);
        case undefined:
        case "-h":
        case "--help":
          return usage();
        default:
          console.error(`unknown subcommand: ${subcommand}`);
          return usage(2);
      }
    }
    console.error(`unknown command: ${command}`);
    return usage(2);
  } catch (err) {
    if (err instanceof ParseArgsError) {
      return reportParseArgsError(err);
    }
    throw err;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;

  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(modulePath) === realpathSync(entry);
  } catch {
    return modulePath === entry;
  }
}

if (isMainModule()) {
  const code = await run(process.argv.slice(2));
  process.exitCode = code;
}
