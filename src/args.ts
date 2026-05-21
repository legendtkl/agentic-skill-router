import { parseArgs, type ParseArgsConfig } from "node:util";

/**
 * Shared CLI argument-parsing helpers used by `src/cli.ts`.
 *
 * The whole CLI uses {@link parseStrict} so that mistyped options
 * (`--qurey`, `--jsoon`, etc.) fail fast with exit code 2 and a clear
 * "unknown option" message that includes the command name and an
 * optional did-you-mean suggestion.
 */

export class UnknownOptionError extends Error {
  readonly optionName: string;
  readonly suggestion?: string;
  readonly commandName: string;

  constructor(commandName: string, optionName: string, suggestion?: string) {
    const base = `unknown option \`${optionName}\``;
    const tail = suggestion ? `. Did you mean \`${suggestion}\`?` : "";
    super(`${base}${tail}`);
    this.name = "UnknownOptionError";
    this.optionName = optionName;
    this.commandName = commandName;
    if (suggestion !== undefined) this.suggestion = suggestion;
  }
}

export interface ParseStrictOptions<C extends ParseArgsConfig> {
  /**
   * Logical command name used in error messages, e.g. `"skill-router skills route"`.
   */
  commandName: string;
  /**
   * Full `parseArgs` config. The helper forces `strict: true` regardless of
   * what callers pass to avoid accidental regressions.
   */
  config: C;
}

/**
 * Wraps {@link parseArgs} with `strict: true` and rethrows
 * `ERR_PARSE_ARGS_UNKNOWN_OPTION` as an {@link UnknownOptionError} carrying
 * a did-you-mean suggestion based on Levenshtein distance.
 *
 * Other parseArgs errors propagate unchanged so misuses surface verbatim.
 */
export function parseStrict<C extends ParseArgsConfig>(
  opts: ParseStrictOptions<C>,
): ReturnType<typeof parseArgs<C>> {
  const known = collectKnownOptionNames(opts.config);
  try {
    return parseArgs<C>({ ...opts.config, strict: true });
  } catch (err) {
    if (isUnknownOptionError(err)) {
      const optionName = extractOptionName(err.message);
      const suggestion = optionName ? suggestOption(optionName, known) : undefined;
      throw new UnknownOptionError(opts.commandName, optionName ?? "<unknown>", suggestion);
    }
    throw err;
  }
}

/**
 * Writes a friendly error message and returns the standard exit code (2)
 * for "incorrect usage" failures.
 */
export function reportUnknownOption(err: UnknownOptionError): number {
  const tail = err.suggestion ? ` Did you mean \`${err.suggestion}\`?` : "";
  process.stderr.write(
    `error: unknown option \`${err.optionName}\`.${tail} (try \`${err.commandName} --help\`)\n`,
  );
  return 2;
}

function isUnknownOptionError(err: unknown): err is Error & { code: string } {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: unknown }).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION"
  );
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
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}
