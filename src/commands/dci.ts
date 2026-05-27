import { parseStrict } from "../args.ts";
import {
  DCI_BUDGET,
  DciRegexComplexityError,
  DciRegexTimeoutError,
  dciFindInSkill,
  dciGrepDisabledSkills,
  dciInspectSkill,
  dciOpenSkillWindow,
  dciReadSkill,
  dciSearchDisabledSkills,
  dciSelectSkills,
  validateRegexPattern,
} from "../dci.ts";
import { createHost } from "../host-resolve.ts";
import {
  parseConfidence,
  parsePositiveFlag,
  printDciFind,
  printDciInspect,
  printDciMatches,
  stringValues,
  usage,
} from "../output.ts";
import { loadState, recordRoutedSkill, saveState, statePathForHost, withStateLock } from "../state.ts";
import type { HostName } from "../types.ts";

/**
 * Dispatcher for `agentic-skill-router skills dci ...` and the `body` alias. The
 * named subcommands match the documented surface in `usage()`.
 */
export async function cmdDci(argv: string[], hostName: HostName): Promise<number> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case "search":
      return cmdDciSearch(rest, hostName);
    case "grep":
      return cmdDciGrep(rest, hostName);
    case "find":
      return cmdDciFind(rest, hostName);
    case "open":
      return cmdDciOpen(rest, hostName);
    case "inspect":
      return cmdDciInspect(rest, hostName);
    case "read":
      return cmdDciRead(rest, hostName);
    case "select":
      return cmdDciSelect(rest, hostName);
    case "budget":
      return cmdDciBudget(rest);
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
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills dci search",
    config: {
      args: argv,
      options: {
        query: { type: "string", short: "q", multiple: true },
        json: { type: "boolean" },
        "metadata-only": { type: "boolean" },
        "top-k": { type: "string" },
        "max-snippets": { type: "string" },
        "max-queries": { type: "string" },
      },
      allowPositionals: true,
    },
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
    metadataOnly: Boolean(values["metadata-only"]),
  });
  if (values.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }
  printDciMatches(result.matches);
  return result.matches.length > 0 ? 0 : 1;
}

async function cmdDciGrep(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills dci grep",
    config: {
      args: argv,
      options: {
        pattern: { type: "string", short: "p" },
        json: { type: "boolean" },
        regex: { type: "boolean" },
        "top-k": { type: "string" },
        "max-snippets": { type: "string" },
      },
      allowPositionals: true,
    },
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
      validateRegexPattern(pattern);
      new RegExp(pattern, "iu");
    } catch (err) {
      if (err instanceof DciRegexComplexityError) {
        console.error(err.message);
        return 2;
      }
      console.error(`invalid --regex pattern: ${(err as Error).message}`);
      return 2;
    }
  }

  const host = createHost(hostName);
  try {
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
  } catch (err) {
    if (err instanceof DciRegexComplexityError || err instanceof DciRegexTimeoutError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }
}

async function cmdDciFind(argv: string[], hostName: HostName): Promise<number> {
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills dci find",
    config: {
      args: argv,
      options: {
        pattern: { type: "string", short: "p" },
        json: { type: "boolean" },
        regex: { type: "boolean" },
        "max-snippets": { type: "string" },
      },
      allowPositionals: true,
    },
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
      validateRegexPattern(pattern);
      new RegExp(pattern, "iu");
    } catch (err) {
      if (err instanceof DciRegexComplexityError) {
        console.error(err.message);
        return 2;
      }
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
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills dci open",
    config: {
      args: argv,
      options: {
        json: { type: "boolean" },
        line: { type: "string" },
        window: { type: "string" },
      },
      allowPositionals: true,
    },
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
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills dci inspect",
    config: {
      args: argv,
      options: { json: { type: "boolean" } },
      allowPositionals: true,
    },
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
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills dci read",
    config: {
      args: argv,
      options: {
        json: { type: "boolean" },
        "max-chars": { type: "string" },
      },
      allowPositionals: true,
    },
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
  const { values, positionals } = parseStrict({
    commandName: "agentic-skill-router skills dci select",
    config: {
      args: argv,
      options: {
        query: { type: "string", short: "q" },
        confidence: { type: "string" },
        reason: { type: "string" },
        json: { type: "boolean" },
        "no-record": { type: "boolean" },
      },
      allowPositionals: true,
    },
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
    const result =
      selected.selected.length === 1
        ? {
            ...selected.selected[0]!,
            query,
            recorded,
            warnings,
            selected: selected.selected,
            maxSelections: selected.maxSelections,
          }
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
  const { values } = parseStrict({
    commandName: "agentic-skill-router skills dci budget",
    config: {
      args: argv,
      options: { json: { type: "boolean" } },
    },
  });
  if (values.json) {
    process.stdout.write(JSON.stringify(DCI_BUDGET, null, 2) + "\n");
    return 0;
  }
  console.log(`max queries:        ${DCI_BUDGET.maxQueries}`);
  console.log(`max candidates:     ${DCI_BUDGET.maxCandidates}`);
  console.log(`max skill body:     ${DCI_BUDGET.maxSkillBytes} bytes`);
  console.log(`max corpus body:    ${DCI_BUDGET.maxCorpusBytes} bytes`);
  console.log(`max find/open ops:  ${DCI_BUDGET.maxFindsOrOpens}`);
  console.log(`max full reads:     ${DCI_BUDGET.maxFullReads}`);
  console.log(`max selections:     ${DCI_BUDGET.maxSelections}`);
  console.log(`default window:     ${DCI_BUDGET.defaultWindowLines} lines`);
  console.log(`max window:         ${DCI_BUDGET.maxWindowLines} lines`);
  console.log(`max open output:    ${DCI_BUDGET.maxOpenChars} chars`);
  return 0;
}
