import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ClaudeCodeHost } from "./hosts/claude-code.ts";
import { CodexHost } from "./hosts/codex.ts";
import type { Host } from "./hosts/base.ts";
import { lookupUsage } from "./usage.ts";
import { suggest } from "./policy.ts";
import { routeDisabledSkillsAuto } from "./auto-route.ts";
import { routeDisabledSkillsMetadata } from "./metadata-route.ts";
import { routeDisabledSkills, type SkillRouteMatch, type SkillRouteResult } from "./route.ts";
import {
  DCI_BUDGET,
  dciRouteDisabledSkills,
  dciFindInSkill,
  dciGrepDisabledSkills,
  dciInspectSkill,
  dciOpenSkillWindow,
  dciReadSkill,
  dciSearchDisabledSkills,
  dciSelectSkills,
} from "./dci.ts";
import { disableSkill, enableSkill, enableSkillFromState, findOrphanMarkers, reapplyMissing } from "./apply.ts";
import { loadConfig, parseRouteMode, resolveUnusedForDays } from "./config.ts";
import { loadState, recordRoutedSkill, saveState, statePathForHost, withStateLock } from "./state.ts";
import type { Confidence, HostName, RouteMode, Skill, Suggestion, UsageStat } from "./types.ts";

export async function run(argv: string[]): Promise<number> {
  const { hostName, args } = parseGlobalArgs(argv);
  const [command, subcommand, ...rest] = args;
  if (command === "__bad_host__") return usage(2);
  if (command === "skills") {
    switch (subcommand) {
      case "list": return cmdList(rest, hostName);
      case "suggest": return cmdSuggest(rest, hostName);
      case "route": return cmdRoute(rest, hostName);
      case "dci": return cmdDci(rest, hostName);
      case "body": return cmdDci(rest, hostName);
      case "disable": return cmdDisable(rest, hostName);
      case "enable": return cmdEnable(rest, hostName);
      case "status": return cmdStatus(rest, hostName);
      case undefined:
      case "-h":
      case "--help":
        return usage();
      default:
        console.error(`unknown subcommand: ${subcommand}`);
        return usage(2);
    }
  }
  return usage();
}

function parseGlobalArgs(argv: string[]): { hostName: HostName; args: string[] } {
  let hostName = parseHostName(process.env["SKILL_ROUTER_HOST"]) ?? "claude-code";
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--host") {
      const next = argv[++i];
      const parsed = parseHostName(next);
      if (!parsed) {
        console.error(`unknown host: ${next ?? ""}`);
        return { hostName, args: ["__bad_host__"] };
      }
      hostName = parsed;
      continue;
    }
    if (arg.startsWith("--host=")) {
      const parsed = parseHostName(arg.slice("--host=".length));
      if (!parsed) {
        console.error(`unknown host: ${arg.slice("--host=".length)}`);
        return { hostName, args: ["__bad_host__"] };
      }
      hostName = parsed;
      continue;
    }
    args.push(arg);
  }
  return { hostName, args };
}

function parseHostName(value: string | undefined): HostName | null {
  if (value === "claude-code" || value === "codex") return value;
  return null;
}

function createHost(hostName: HostName): Host {
  if (hostName === "codex") return new CodexHost();
  const claudeHome = process.env["CLAUDE_HOME"];
  const opts: { claudeHome?: string } = {};
  if (claudeHome) opts.claudeHome = claudeHome;
  return new ClaudeCodeHost(opts);
}

function displayHost(hostName: HostName): string {
  return hostName === "codex" ? "Codex" : "Claude Code";
}

function usage(code = 0): number {
  console.log(`skill-router — manage installed Claude Code and Codex skills

USAGE
  skill-router [--host=claude-code|codex] skills list [--json]
  skill-router [--host=claude-code|codex] skills suggest [--unused-for=<dur>] [--json]
  skill-router [--host=claude-code|codex] skills route --query=<text> [--mode=auto|metadata|body|lexical|dci] [--json] [--top-k=N] [--no-record]
  skill-router [--host=claude-code|codex] skills dci search --query=<text> [--query=<text>...] [--json] [--top-k=N]
  skill-router [--host=claude-code|codex] skills dci grep --pattern=<text> [--regex] [--json] [--top-k=N]
  skill-router [--host=claude-code|codex] skills dci find <id-or-ref> --pattern=<text> [--regex] [--json]
  skill-router [--host=claude-code|codex] skills dci open <id-or-ref> [--line=N] [--window=N] [--json]
  skill-router [--host=claude-code|codex] skills dci inspect <id-or-ref> [--json]
  skill-router [--host=claude-code|codex] skills dci read <id-or-ref> [--json] [--max-chars=N]
  skill-router [--host=claude-code|codex] skills dci select <id-or-ref...> --query=<text> --confidence=high|medium --reason=<text> [--json]
  skill-router [--host=claude-code|codex] skills dci budget [--json]
  skill-router [--host=claude-code|codex] skills body <search|grep|find|open|inspect|read|select|budget> ...  (alias for dci)
  skill-router [--host=claude-code|codex] skills disable (<id...> | --all-suggested [--unused-for=<dur>]) --yes [--reason=<text>]
  skill-router [--host=claude-code|codex] skills enable <id...>
  skill-router [--host=claude-code|codex] skills status [--json]

DURATION  bare integer = days. Suffixed: 30d / 2w / 3m / 1y
CONFIG    ~/.skill-router/config.json   { "unusedForDays": 30, "routeMode": "auto" }
STATE     ~/.skill-router/state-<host>.json
`);
  return code;
}

async function cmdList(argv: string[], hostName: HostName): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" } }, strict: false });
  const host = createHost(hostName);
  const skills = await host.listSkills();
  const usage = await host.usageStats();

  if (values.json) {
    process.stdout.write(JSON.stringify(skills.map((s) => projectSkill(s, usage)), null, 2) + "\n");
    return 0;
  }
  printSkillTable(skills, usage);
  return 0;
}

async function cmdSuggest(argv: string[], hostName: HostName): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { "unused-for": { type: "string" }, json: { type: "boolean" } },
    strict: false,
  });
  const host = createHost(hostName);
  const config = await loadConfig();
  const days = resolveUnusedForDays({ cliFlag: values["unused-for"] as string | undefined, config });
  const skills = await host.listSkills();
  const usage = await host.usageStats();
  const suggestions = suggest(skills, usage, { unusedForDays: days });

  if (values.json) {
    process.stdout.write(JSON.stringify(suggestions.map((s) => projectSuggestion(s)), null, 2) + "\n");
    return 0;
  }
  printSuggestions(suggestions, days);
  return 0;
}

async function cmdRoute(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      query: { type: "string", short: "q" },
      json: { type: "boolean" },
      "top-k": { type: "string" },
      mode: { type: "string" },
      "no-record": { type: "boolean" },
    },
    allowPositionals: true,
    strict: false,
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

async function cmdDci(argv: string[], hostName: HostName): Promise<number> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case "search": return cmdDciSearch(rest, hostName);
    case "grep": return cmdDciGrep(rest, hostName);
    case "find": return cmdDciFind(rest, hostName);
    case "open": return cmdDciOpen(rest, hostName);
    case "inspect": return cmdDciInspect(rest, hostName);
    case "read": return cmdDciRead(rest, hostName);
    case "select": return cmdDciSelect(rest, hostName);
    case "budget": return cmdDciBudget(rest);
    case undefined:
    case "-h":
    case "--help":
      return usage();
    default:
      console.error(`unknown dci subcommand: ${subcommand}`);
      return usage(2);
  }
}

async function cmdDciSearch(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      query: { type: "string", short: "q", multiple: true },
      json: { type: "boolean" },
      "top-k": { type: "string" },
      "max-snippets": { type: "string" },
      "max-queries": { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });
  const queries = stringValues(values.query);
  const positionalQuery = positionals.join(" ").trim();
  if (positionalQuery) queries.push(positionalQuery);
  if (queries.length === 0) {
    console.error("specify --query=<text> or pass the query as positional text");
    return 2;
  }
  const topK = parsePositiveFlag(values["top-k"] as string | undefined, "--top-k");
  if (topK === null) return 2;
  const maxSnippets = parsePositiveFlag(values["max-snippets"] as string | undefined, "--max-snippets");
  if (maxSnippets === null) return 2;
  const maxQueries = parsePositiveFlag(values["max-queries"] as string | undefined, "--max-queries");
  if (maxQueries === null) return 2;

  const host = createHost(hostName);
  const result = await dciSearchDisabledSkills(await host.listSkills(), queries, {
    ...(topK === undefined ? {} : { topK }),
    ...(maxSnippets === undefined ? {} : { maxSnippets }),
    ...(maxQueries === undefined ? {} : { maxQueries }),
  });
  if (values.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }
  printDciMatches(result.matches);
  return result.matches.length > 0 ? 0 : 1;
}

async function cmdDciGrep(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      pattern: { type: "string", short: "p" },
      json: { type: "boolean" },
      regex: { type: "boolean" },
      "top-k": { type: "string" },
      "max-snippets": { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });
  const pattern = ((values.pattern as string | undefined) ?? positionals.join(" ")).trim();
  if (pattern === "") {
    console.error("specify --pattern=<text> or pass the pattern as positional text");
    return 2;
  }
  const topK = parsePositiveFlag(values["top-k"] as string | undefined, "--top-k");
  if (topK === null) return 2;
  const maxSnippets = parsePositiveFlag(values["max-snippets"] as string | undefined, "--max-snippets");
  if (maxSnippets === null) return 2;
  if (values.regex) {
    try {
      new RegExp(pattern, "iu");
    } catch (err) {
      console.error(`invalid --regex pattern: ${(err as Error).message}`);
      return 2;
    }
  }

  const host = createHost(hostName);
  const result = await dciGrepDisabledSkills(await host.listSkills(), pattern, {
    regex: Boolean(values.regex),
    ...(topK === undefined ? {} : { topK }),
    ...(maxSnippets === undefined ? {} : { maxSnippets }),
  });
  if (values.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }
  printDciMatches(result.matches);
  return result.matches.length > 0 ? 0 : 1;
}

async function cmdDciFind(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      pattern: { type: "string", short: "p" },
      json: { type: "boolean" },
      regex: { type: "boolean" },
      "max-snippets": { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });
  const idOrRef = positionals[0];
  if (!idOrRef) {
    console.error("specify <id-or-ref>");
    return 2;
  }
  const pattern = (values.pattern as string | undefined)?.trim();
  if (!pattern) {
    console.error("specify --pattern=<text>");
    return 2;
  }
  const maxSnippets = parsePositiveFlag(values["max-snippets"] as string | undefined, "--max-snippets");
  if (maxSnippets === null) return 2;
  if (values.regex) {
    try {
      new RegExp(pattern, "iu");
    } catch (err) {
      console.error(`invalid --regex pattern: ${(err as Error).message}`);
      return 2;
    }
  }

  const host = createHost(hostName);
  try {
    const result = await dciFindInSkill(await host.listSkills(), idOrRef, pattern, {
      regex: Boolean(values.regex),
      ...(maxSnippets === undefined ? {} : { maxSnippets }),
    });
    if (values.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    else printDciFind(result);
    return result.snippets.length > 0 ? 0 : 1;
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
}

async function cmdDciOpen(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean" },
      line: { type: "string" },
      window: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });
  const idOrRef = positionals[0];
  if (!idOrRef) {
    console.error("specify <id-or-ref>");
    return 2;
  }
  const line = parsePositiveFlag(values.line as string | undefined, "--line");
  if (line === null) return 2;
  const window = parsePositiveFlag(values.window as string | undefined, "--window");
  if (window === null) return 2;

  const host = createHost(hostName);
  try {
    const result = await dciOpenSkillWindow(await host.listSkills(), idOrRef, {
      ...(line === undefined ? {} : { line }),
      ...(window === undefined ? {} : { window }),
    });
    if (values.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    else {
      process.stdout.write(result.content + (result.content.endsWith("\n") ? "" : "\n"));
      if (result.truncated) {
        process.stdout.write(`[truncated at ${result.maxChars} chars]\n`);
      }
    }
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
}

async function cmdDciInspect(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" } },
    allowPositionals: true,
    strict: false,
  });
  const id = positionals[0];
  if (!id) {
    console.error("specify <id-or-ref>");
    return 2;
  }
  const host = createHost(hostName);
  try {
    const result = dciInspectSkill(await host.listSkills(), id);
    if (values.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    else printDciInspect(result);
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
}

async function cmdDciRead(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean" },
      "max-chars": { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });
  const id = positionals[0];
  if (!id) {
    console.error("specify <id-or-ref>");
    return 2;
  }
  const maxChars = parsePositiveFlag(values["max-chars"] as string | undefined, "--max-chars");
  if (maxChars === null) return 2;
  const host = createHost(hostName);
  try {
    const result = await dciReadSkill(await host.listSkills(), id, maxChars === undefined ? {} : { maxChars });
    if (values.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    else process.stdout.write(result.content + (result.content.endsWith("\n") ? "" : "\n"));
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
}

async function cmdDciSelect(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      query: { type: "string", short: "q" },
      confidence: { type: "string" },
      reason: { type: "string" },
      json: { type: "boolean" },
      "no-record": { type: "boolean" },
    },
    allowPositionals: true,
    strict: false,
  });
  const id = positionals[0];
  if (!id) {
    console.error("specify <id-or-ref...>");
    return 2;
  }
  const query = (values.query as string | undefined)?.trim();
  if (!query) {
    console.error("specify --query=<text>");
    return 2;
  }
  const confidence = parseConfidence(values.confidence as string | undefined);
  if (!confidence || confidence === "low") {
    console.error("--confidence must be high or medium");
    return 2;
  }
  const reason = (values.reason as string | undefined)?.trim();
  if (!reason) {
    console.error("specify --reason=<text>");
    return 2;
  }

  const host = createHost(hostName);
  const skills = await host.listSkills();
  try {
    const selected = dciSelectSkills(skills, positionals, confidence, reason);
    const warnings: string[] = [];
    let recorded = false;
    if (!values["no-record"]) {
      try {
        const statePath = statePathForHost(host.name);
        await withStateLock(statePath, async () => {
          let state = await loadState(statePath, host.name);
          const routedAt = new Date().toISOString();
          for (const item of selected.selected) {
            state = recordRoutedSkill(state, {
              id: item.id,
              pluginKey: item.pluginKey,
              skillMdPath: item.skillMdPath,
              name: item.name,
              query,
              confidence,
              routedAt,
            });
          }
          await saveState(state, statePath);
        });
        recorded = true;
      } catch (err) {
        const warning = `routed usage was not recorded: ${(err as Error).message}`;
        warnings.push(warning);
        process.stderr.write(`warning: ${warning}\n`);
      }
    }
    const result = selected.selected.length === 1
      ? { ...selected.selected[0]!, query, recorded, warnings, selected: selected.selected, maxSelections: selected.maxSelections }
      : { ...selected, query, recorded, warnings };
    if (values.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      for (const item of selected.selected) {
        console.log(`select: [${item.confidence}] ${item.id} (${item.ref})`);
        console.log(`read:   ${item.skillMdPath}`);
      }
      console.log(`why:    ${selected.reason}`);
      if (recorded) console.log("usage:  recorded routed use");
    }
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
}

async function cmdDciBudget(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" } },
    strict: false,
  });
  if (values.json) {
    process.stdout.write(JSON.stringify(DCI_BUDGET, null, 2) + "\n");
    return 0;
  }
  console.log(`max queries:        ${DCI_BUDGET.maxQueries}`);
  console.log(`max candidates:     ${DCI_BUDGET.maxCandidates}`);
  console.log(`max find/open ops:  ${DCI_BUDGET.maxFindsOrOpens}`);
  console.log(`max full reads:     ${DCI_BUDGET.maxFullReads}`);
  console.log(`max selections:     ${DCI_BUDGET.maxSelections}`);
  console.log(`default window:     ${DCI_BUDGET.defaultWindowLines} lines`);
  console.log(`max window:         ${DCI_BUDGET.maxWindowLines} lines`);
  console.log(`max open output:    ${DCI_BUDGET.maxOpenChars} chars`);
  return 0;
}

async function cmdDisable(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      "all-suggested": { type: "boolean" },
      "unused-for": { type: "string" },
      yes: { type: "boolean", short: "y" },
      reason: { type: "string" },
      json: { type: "boolean" },
    },
    allowPositionals: true,
    strict: false,
  });

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
    suggested = suggest(skills, usage, { unusedForDays: unusedDays });
    targets = suggested.map((s) => s.skill);
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
    } else {
      for (const t of targets) console.error(`  ${t.id}`);
    }
    return 1;
  }

  const results: Array<{ id: string; alreadyDisabled: boolean }> = [];
  for (const t of targets) {
    try {
      const r = await disableSkill(t, reason, { statePath, host: host.name });
      results.push({ id: t.id, alreadyDisabled: r.alreadyDisabled });
    } catch (err: unknown) {
      console.error(`failed to disable ${t.id}: ${(err as Error).message}`);
      return 1;
    }
  }
  if (values.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    console.log(`disabled ${results.length} skill(s). Restart ${displayHost(host.name)} for changes to take effect.`);
    for (const r of results) console.log(`  ${r.id}${r.alreadyDisabled ? "  (already disabled, state refreshed)" : ""}`);
  }
  return 0;
}

async function cmdEnable(argv: string[], hostName: HostName): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" } },
    allowPositionals: true,
    strict: false,
  });
  if (positionals.length === 0) {
    console.error("specify <id...>");
    return 2;
  }
  const host = createHost(hostName);
  const skills = await host.listSkills();
  const byId = new Map(skills.map((s) => [s.id, s]));
  const statePath = statePathForHost(host.name);

  const results: Array<{ id: string; alreadyEnabled: boolean }> = [];
  for (const id of positionals) {
    const s = byId.get(id);
    try {
      const r = s
        ? await enableSkill(s, { statePath, host: host.name })
        : await enableSkillFromState(id, { statePath, host: host.name });
      results.push({ id, alreadyEnabled: r.alreadyEnabled });
    } catch (err) {
      const message = (err as Error).message;
      if (/unknown skill id/.test(message)) {
        console.error(message);
        return 2;
      }
      console.error(`failed to enable ${id}: ${message}`);
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

async function cmdStatus(argv: string[], hostName: HostName): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" } }, strict: false });
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
      orphanMarkers,
      disabled: state.disabledSkills,
      routed: state.routedSkills ?? [],
    }, null, 2) + "\n");
    return reapplyResult.conflicted.length > 0 ? 1 : 0;
  }
  console.log(`disabled skills: ${state.disabledSkills.length}`);
  for (const r of state.disabledSkills) {
    console.log(`  ${r.id}  (${r.reason}, ${r.disabledAt})`);
  }
  if (reapplyResult.reapplied.length > 0) {
    console.log(`\nreapplied (upstream restored these): ${reapplyResult.reapplied.join(", ")}`);
  }
  if (reapplyResult.orphaned.length > 0) {
    console.log(`\norphaned records (SKILL.md gone entirely; run \`enable <id>\` to clean state): ${reapplyResult.orphaned.join(", ")}`);
  }
  if (reapplyResult.conflicted.length > 0) {
    console.log(`\n⚠ CONFLICTED — both SKILL.md and SKILL.md.skill-router-disabled present:`);
    for (const id of reapplyResult.conflicted) console.log(`  ${id}`);
    console.log(`Manually delete one file (typically the .skill-router-disabled to fully enable, or the SKILL.md to fully disable) and re-run \`status\`.`);
  }
  if (orphanMarkers.length > 0) {
    console.log(`\norphan disabled markers (no state record; left from a previous tool or crash):`);
    for (const p of orphanMarkers) console.log(`  ${p}`);
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

// ────────────────── output helpers ──────────────────

function projectSkill(s: Skill, usage: Map<string, UsageStat>) {
  const u = lookupUsage(s, usage);
  return {
    id: s.id,
    name: s.name,
    source: s.source,
    pluginKey: s.pluginKey,
    isDisabled: s.isDisabled,
    isPluginDisabled: s.isPluginDisabled,
    canDisable: s.canDisable,
    conflict: s.conflict,
    description: s.description,
    lastUsed: u?.lastUsed?.toISOString() ?? null,
    callCount: u?.callCount ?? 0,
  };
}

function projectSuggestion(s: Suggestion) {
  return {
    id: s.skill.id,
    name: s.skill.name,
    source: s.skill.source,
    reason: s.reason,
    confidence: s.confidence,
    details: s.details,
  };
}

function projectRoute(result: SkillRouteResult, recorded: boolean, warnings: string[] = []) {
  const projectMatch = (m: SkillRouteMatch) => ({
    id: m.skill.id,
    name: m.skill.name,
    source: m.skill.source,
    pluginKey: m.skill.pluginKey,
    isDisabled: m.skill.isDisabled,
    skillMdPath: m.skill.skillMdPath,
    confidence: m.confidence,
    score: m.score,
    reason: m.reason,
    signals: m.signals,
    evidence: m.evidence ?? [],
  });
  return {
    query: result.query,
    mode: result.mode,
    routeMode: result.routeMode,
    action: result.selected ? "read-skill-file" as const : "no-confident-match" as const,
    recorded,
    warnings,
    selected: result.selected ? { ...projectMatch(result.selected), action: "read-skill-file" as const } : null,
    matches: result.matches.map(projectMatch),
    diagnostics: result.diagnostics,
  };
}

function parsePositiveFlag(value: string | undefined, flagName: string): number | undefined | null {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`${flagName} must be a positive integer`);
    return null;
  }
  return n;
}

function parseTopK(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function parseConfidence(value: string | undefined): Confidence | null {
  if (value === "high" || value === "medium" || value === "low") return value;
  return null;
}

function resolveRouteMode(cliValue: string | undefined, configValue: RouteMode): RouteMode | null {
  if (cliValue === undefined || cliValue === "") return parseRouteMode(process.env["SKILL_ROUTER_ROUTE_MODE"]) ?? configValue;
  return parseRouteMode(cliValue);
}

function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function printDciMatches(matches: Array<{ ref?: string; id: string; score: number; reason: string; snippets: Array<{ line: number; text: string }> }>): void {
  if (matches.length === 0) {
    console.log("no disabled-skill corpus candidates found.");
    return;
  }
  for (const m of matches) {
    console.log(`${m.ref ? `${m.ref}  ` : ""}${m.id} (${m.score})`);
    console.log(`  ${m.reason}`);
    for (const snippet of m.snippets) {
      console.log(`  L${snippet.line}: ${snippet.text}`);
    }
  }
}

function printDciFind(result: { ref: string; id: string; action: string; snippets: Array<{ line: number; text: string }> }): void {
  if (result.snippets.length === 0) {
    console.log(`no matches in ${result.ref}  ${result.id}`);
    return;
  }
  console.log(`${result.ref}  ${result.id}`);
  for (const snippet of result.snippets) {
    console.log(`  L${snippet.line}: ${snippet.text}`);
  }
}

function printDciInspect(result: { id: string; name: string; description: string; skillMdPath: string }): void {
  console.log(`${result.id}`);
  console.log(`name: ${result.name}`);
  console.log(`path: ${result.skillMdPath}`);
  if (result.description) console.log(`description: ${result.description}`);
}

function printSkillTable(skills: Skill[], usage: Map<string, UsageStat>): void {
  const rows = skills.map((s) => {
    const u = lookupUsage(s, usage);
    return {
      id: s.id,
      source: s.source,
      disabled: s.conflict ? "CONFLICT"
        : s.isDisabled ? "yes"
        : s.isPluginDisabled ? "plugin-off"
        : !s.canDisable ? "builtin"
        : "no",
      last: u?.lastUsed?.toISOString().slice(0, 10) ?? "—",
      calls: String(u?.callCount ?? 0),
    };
  });
  rows.sort((a, b) => (b.last > a.last ? 1 : a.last > b.last ? -1 : 0));
  const widths = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    source: 7,
    disabled: 10,
    last: 10,
    calls: 5,
  };
  const header = `${pad("ID", widths.id)}  ${pad("SOURCE", widths.source)}  ${pad("DISABLED", widths.disabled)}  ${pad("LAST", widths.last)}  ${pad("CALLS", widths.calls)}`;
  console.log(header);
  console.log("─".repeat(header.length));
  for (const r of rows) {
    console.log(`${pad(r.id, widths.id)}  ${pad(r.source, widths.source)}  ${pad(r.disabled, widths.disabled)}  ${pad(r.last, widths.last)}  ${pad(r.calls, widths.calls)}`);
  }
}

function printSuggestions(suggestions: Suggestion[], days: number): void {
  if (suggestions.length === 0) {
    console.log(`no suggestions (threshold: ${days} days unused).`);
    return;
  }
  console.log(`${suggestions.length} suggestion(s) (threshold: ${days} days unused):\n`);
  for (const s of suggestions) {
    const tag = `[${s.confidence}]`;
    console.log(`  ${tag.padEnd(8)} ${s.skill.id}`);
    console.log(`           ${s.reason}: ${s.details}`);
  }
  console.log(`\nrun:  skill-router skills disable --all-suggested --unused-for=${days} --yes`);
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
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
  process.exit(code);
}
