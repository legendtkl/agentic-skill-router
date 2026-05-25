import { parseStrict } from "../args.ts";
import {
  CONFIG_KEYS,
  ConfigValueError,
  DEFAULT_CONFIG,
  configPath,
  isConfigKey,
  loadConfig,
  setConfigValue,
} from "../config.ts";
import { usage } from "../output.ts";

/**
 * `agentic-skill-router skills config` — dispatch for the config get/set/path
 * subcommands. The handler does not need a host because the config file is
 * a single user-global JSON document shared by every host bundle.
 */
export async function cmdConfig(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case "get": return await cmdConfigGet(rest);
    case "set": return await cmdConfigSet(rest);
    case "path": return cmdConfigPath(rest);
    case undefined:
    case "-h":
    case "--help":
      return usage();
    default:
      console.error(`unknown config subcommand: ${subcommand}`);
      return usage(2);
  }
}

async function cmdConfigGet(argv: string[]): Promise<number> {
  const { values } = parseStrict({
    commandName: "agentic-skill-router skills config get",
    config: { args: argv, options: { json: { type: "boolean" } } },
  });
  const path = configPath();
  const config = await loadConfig(path);
  if (values.json) {
    process.stdout.write(JSON.stringify({ path, config }, null, 2) + "\n");
    return 0;
  }
  console.log(`path: ${path}`);
  console.log(`unusedForDays: ${config.unusedForDays}${defaultMarker("unusedForDays", config.unusedForDays)}`);
  console.log(`routeMode:     ${config.routeMode}${defaultMarker("routeMode", config.routeMode)}`);
  if (config.keepNames && config.keepNames.length > 0) {
    console.log(`keepNames:     ${JSON.stringify(config.keepNames)}`);
  } else {
    console.log(`keepNames:     []  (default)`);
  }
  if (config.keepIds && config.keepIds.length > 0) {
    console.log(`keepIds:       ${JSON.stringify(config.keepIds)}`);
  } else {
    console.log(`keepIds:       []  (default)`);
  }
  return 0;
}

async function cmdConfigSet(argv: string[]): Promise<number> {
  const { positionals } = parseStrict({
    commandName: "agentic-skill-router skills config set",
    config: { args: argv, options: {}, allowPositionals: true },
  });
  if (positionals.length < 2) {
    console.error("specify <key> <value>");
    return 2;
  }
  if (positionals.length > 2) {
    console.error(
      `unexpected extra argument(s) for config set: ${positionals.slice(2).join(" ")}. ` +
      `Quote multi-word values, e.g. \`config set keepNames '["foo","bar"]'\`.`,
    );
    return 2;
  }
  const key = positionals[0]!;
  const value = positionals[1]!;
  if (!isConfigKey(key)) {
    console.error(`unknown config key: ${key}. Known keys: ${CONFIG_KEYS.join(", ")}`);
    return 2;
  }
  try {
    const written = await setConfigValue(key, value);
    console.log(`set ${written.key} = ${JSON.stringify(written.value)} in ${configPath()}`);
    return 0;
  } catch (err) {
    if (err instanceof ConfigValueError) {
      console.error(`invalid value for ${key}: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

function cmdConfigPath(argv: string[]): number {
  parseStrict({
    commandName: "agentic-skill-router skills config path",
    config: { args: argv, options: {} },
  });
  console.log(configPath());
  return 0;
}

function defaultMarker(key: "unusedForDays" | "routeMode", value: number | string): string {
  const defaultValue = DEFAULT_CONFIG[key];
  return value === defaultValue ? "  (default)" : "";
}
