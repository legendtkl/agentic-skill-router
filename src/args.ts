import { parseArgs, type ParseArgsConfig } from "node:util";

/**
 * Shared CLI argument-parsing helpers used by `src/cli.ts`.
 *
 * The whole CLI uses {@link parseStrict} so that mistyped options
 * (`--qurey`, `--jsoon`, etc.) or other malformed flag usage fails fast
 * with exit code 2 and a clear message that includes the command name.
 */

/**
 * Base error class for any `node:util.parseArgs` strict-mode failure that
 * should be presented to the user as a CLI usage error (exit code 2),
 * not as an uncaught exception with a stack trace.
 */
export class ParseArgsError extends Error {
  readonly commandName: string;
  readonly code: string;

  constructor(commandName: string, code: string, message: string) {
    super(message);
    this.name = "ParseArgsError";
    this.commandName = commandName;
    this.code = code;
  }
}

export class UnknownOptionError extends ParseArgsError {
  readonly optionName: string;
  readonly suggestion?: string;

  constructor(commandName: string, optionName: string, suggestion?: string) {
    const base = `unknown option \`${optionName}\``;
    const tail = suggestion ? `. Did you mean \`${suggestion}\`?` : "";
    super(commandName, "ERR_PARSE_ARGS_UNKNOWN_OPTION", `${base}${tail}`);
    this.name = "UnknownOptionError";
    this.optionName = optionName;
    if (suggestion !== undefined) this.suggestion = suggestion;
  }
}

export interface ParseStrictOptions<C extends ParseArgsConfig> {
  /**
   * Logical command name used in error messages, e.g. `"agentic-skill-router skills route"`.
   */
  commandName: string;
  /**
   * Full `parseArgs` config. The helper forces `strict: true` regardless of
   * what callers pass to avoid accidental regressions.
   */
  config: C;
}

/**
 * Wraps {@link parseArgs} with `strict: true` and converts any
 * `ERR_PARSE_ARGS_*` failure into a {@link ParseArgsError} (or its
 * {@link UnknownOptionError} subclass with a did-you-mean suggestion).
 *
 * Non-parseArgs errors propagate unchanged.
 */
export function parseStrict<C extends ParseArgsConfig>(opts: ParseStrictOptions<C>): ReturnType<typeof parseArgs<C>> {
  const known = collectKnownOptionNames(opts.config);
  try {
    return parseArgs<C>({ ...opts.config, strict: true });
  } catch (err) {
    if (!isParseArgsError(err)) throw err;
    if (err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      const optionName = extractOptionName(err.message);
      const suggestion = optionName ? suggestOption(optionName, known) : undefined;
      throw new UnknownOptionError(opts.commandName, optionName ?? "<unknown>", suggestion);
    }
    throw new ParseArgsError(opts.commandName, err.code, err.message);
  }
}

/**
 * Writes a friendly error message for any parseArgs strict-mode failure
 * and returns the standard exit code (2) for "incorrect usage" errors.
 */
export function reportParseArgsError(err: ParseArgsError): number {
  if (err instanceof UnknownOptionError) {
    const tail = err.suggestion ? ` Did you mean \`${err.suggestion}\`?` : "";
    process.stderr.write(`error: unknown option \`${err.optionName}\`.${tail} (try \`${err.commandName} --help\`)\n`);
    return 2;
  }
  process.stderr.write(`error: ${err.message} (try \`${err.commandName} --help\`)\n`);
  return 2;
}

/**
 * @deprecated Use {@link reportParseArgsError} which also handles other
 * `ERR_PARSE_ARGS_*` codes. Kept for backwards compatibility.
 */
export function reportUnknownOption(err: UnknownOptionError): number {
  return reportParseArgsError(err);
}

function isParseArgsError(err: unknown): err is Error & { code: string } {
  if (!(err instanceof Error) || !("code" in err)) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_");
}

function extractOptionName(message: string): string | undefined {
  // Node formats the message as: `Unknown option '--foo'. ...`
  // or `Unknown option '-x'. ...`. Pull out the quoted token.
  const match = message.match(/Unknown option '([^']+)'/);
  return match ? match[1] : undefined;
}

function collectKnownOptionNames(config: ParseArgsConfig): string[] {
  const names: string[] = [];
  const options = config.options ?? {};
  for (const [name, opt] of Object.entries(options)) {
    names.push(`--${name}`);
    if (opt && typeof opt === "object" && typeof (opt as { short?: unknown }).short === "string") {
      names.push(`-${(opt as { short: string }).short}`);
    }
  }
  return names;
}

/**
 * Returns the closest known option name (within edit distance 2) or
 * `undefined` if none qualifies.
 */
export function suggestOption(input: string, known: string[]): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const name of known) {
    const distance = levenshtein(input, name);
    if (best === undefined || distance < best.distance) best = { name, distance };
  }
  if (!best) return undefined;
  const threshold = input.length <= 4 ? 1 : 2;
  return best.distance <= threshold ? best.name : undefined;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}
