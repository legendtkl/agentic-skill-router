import { isPluginShortAmbiguous, lookupUsage } from "./usage.ts";
import { parseRouteMode } from "./config.ts";
import type { SkillRouteMatch, SkillRouteResult } from "./route.ts";
import type { Confidence, RouteMode, Skill, Suggestion, UsageStat } from "./types.ts";

// ────────────────── top-level usage ──────────────────

/**
 * Prints the global CLI usage block and returns `code`. Used by `cli.ts`
 * for `--help` and by the various dispatch fallbacks for `-h`/`--help`.
 */
export function usage(code = 0): number {
  console.log(`agentic-skill-router — manage installed Agent Skills across supported hosts

USAGE
  agentic-skill-router init [codex|claude-code] [project|global] [--cwd=<dir>] [--force] [--json]
  agentic-skill-router skills list [--json]
  agentic-skill-router skills suggest [--unused-for=<dur>] [--json]
  agentic-skill-router skills route --query=<text> [--mode=auto|metadata|body|lexical|dci] [--json] [--top-k=N] [--no-record]
  agentic-skill-router skills corpus search (--any=<term>... | --all=<term>...) [--ranker=weighted|bm25] [--limit=N] [--json]
  agentic-skill-router skills corpus inspect <id-or-name-or-ref...> [--json]
  agentic-skill-router skills corpus select <id-or-name-or-ref> --query=<text> --confidence=high|medium --reason=<text> [--json]
  agentic-skill-router skills dci search --query=<text> [--query=<text>...] [--metadata-only] [--json] [--top-k=N]
  agentic-skill-router skills dci grep --pattern=<text> [--regex] [--json] [--top-k=N]
  agentic-skill-router skills dci find <id-or-ref> --pattern=<text> [--regex] [--json]
  agentic-skill-router skills dci open <id-or-ref> [--line=N] [--window=N] [--json]
  agentic-skill-router skills dci inspect <id-or-ref> [--json]
  agentic-skill-router skills dci read <id-or-ref> [--json] [--max-chars=N]
  agentic-skill-router skills dci select <id-or-ref...> --query=<text> --confidence=high|medium --reason=<text> [--json]
  agentic-skill-router skills dci budget [--json]
  agentic-skill-router skills body <search|grep|find|open|inspect|read|select|budget> ...  (alias for dci)
  agentic-skill-router skills disable (<id...> | --all-suggested [--unused-for=<dur>]) --yes [--reason=<text>] [--allow-symlink-target-mutation]
  agentic-skill-router skills enable <id...> [--allow-symlink-target-mutation]
  agentic-skill-router skills status [--json]
  agentic-skill-router skills config get [--json]
  agentic-skill-router skills config set <key> <value>
  agentic-skill-router skills config path
  agentic-skill-router skills web [--port=N] [--bind=ADDR] [--dangerously-bind-public] [--project-root=DIR ...]

DURATION  bare integer = days. Suffixed: 30d / 2w / 3m / 1y
CONFIG    ~/.agentic-skill-router/config.json   { "unusedForDays": 30, "routeMode": "auto" }
          keys: unusedForDays (int), routeMode (auto|metadata|body|lexical|dci),
                keepNames (JSON array), keepIds (JSON array)
HOST      installed plugin wrappers set their host; repo checkouts default to claude-code
STATE     ~/.agentic-skill-router/state-<host>.json
`);
  return code;
}

// ────────────────── JSON projections ──────────────────

/** Shape one `Skill` for `skills list --json` output. */
export function projectSkill(s: Skill, usage: Map<string, UsageStat>, inventory?: Skill[]) {
  const u = lookupUsage(s, usage, inventory);
  const ambiguous = inventory ? isPluginShortAmbiguous(s, inventory) : false;
  const warnings = s.frontmatterWarnings ?? [];
  return {
    id: s.id,
    name: s.name,
    source: s.source,
    pluginKey: s.pluginKey,
    isDisabled: s.isDisabled,
    isPluginDisabled: s.isPluginDisabled,
    canDisable: s.canDisable,
    conflict: s.conflict,
    outOfRoot: s.outOfRoot ?? false,
    skipped: s.outOfRoot ? "out-of-root" as const : null,
    description: s.description,
    lastUsed: u?.lastUsed?.toISOString() ?? null,
    callCount: u?.callCount ?? 0,
    ...(ambiguous ? { attributionAmbiguous: true } : {}),
    ...(warnings.length > 0 ? { frontmatterWarnings: warnings } : {}),
    ...(s.builtinListSource ? { builtinListSource: s.builtinListSource } : {}),
  };
}

/** Shape one `Suggestion` for `skills suggest --json` output. */
export function projectSuggestion(s: Suggestion) {
  return {
    id: s.skill.id,
    name: s.skill.name,
    source: s.skill.source,
    reason: s.reason,
    confidence: s.confidence,
    details: s.details,
    ...(s.attributionAmbiguous ? { attributionAmbiguous: true } : {}),
  };
}

/** Shape a route result for `skills route --json` output. */
export function projectRoute(result: SkillRouteResult, recorded: boolean, warnings: string[] = []) {
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

// ────────────────── flag parsing helpers ──────────────────
//
// These return:
//   - the parsed value when valid,
//   - `undefined` when the flag was not provided (so callers can fall back),
//   - `null` when the value was malformed; in that case they also emit the
//     standard error message to stderr so the caller only needs to return
//     exit code 2.

/**
 * Parses a positive-integer CLI flag. Emits a standard error to stderr on
 * malformed input. Returns `undefined` when the flag is absent.
 */
export function parsePositiveFlag(value: string | undefined, flagName: string): number | undefined | null {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`${flagName} must be a positive integer`);
    return null;
  }
  return n;
}

/**
 * Parses `--top-k`. Like {@link parsePositiveFlag} but does not emit a
 * message — `skills route` formats its own error so the wording is preserved.
 */
export function parseTopK(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/** Validates the `--confidence` flag for `skills dci select`. */
export function parseConfidence(value: string | undefined): Confidence | null {
  if (value === "high" || value === "medium" || value === "low") return value;
  return null;
}

/**
 * Resolves the route mode for `skills route`, preferring (in order):
 * the explicit `--mode` flag, the `AGENTIC_SKILL_ROUTER_ROUTE_MODE` env var, then
 * the configured default. Returns `null` when an explicit value is invalid.
 */
export function resolveRouteMode(cliValue: string | undefined, configValue: RouteMode): RouteMode | null {
  if (cliValue === undefined || cliValue === "") return parseRouteMode(process.env["AGENTIC_SKILL_ROUTER_ROUTE_MODE"]) ?? configValue;
  return parseRouteMode(cliValue);
}

/** Normalizes a `parseArgs` multi-value option into a `string[]`. */
export function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

// ────────────────── text printers ──────────────────

export function printDciMatches(matches: Array<{ ref?: string; id: string; score: number; reason: string; snippets: Array<{ line: number; text: string }> }>): void {
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

export function printDciFind(result: { ref: string; id: string; action: string; snippets: Array<{ line: number; text: string }> }): void {
  if (result.snippets.length === 0) {
    console.log(`no matches in ${result.ref}  ${result.id}`);
    return;
  }
  console.log(`${result.ref}  ${result.id}`);
  for (const snippet of result.snippets) {
    console.log(`  L${snippet.line}: ${snippet.text}`);
  }
}

export function printDciInspect(result: { id: string; name: string; description: string; skillMdPath: string }): void {
  console.log(`${result.id}`);
  console.log(`name: ${result.name}`);
  console.log(`path: ${result.skillMdPath}`);
  if (result.description) console.log(`description: ${result.description}`);
}

export function printCorpusSearch(result: {
  ranker: string;
  corpus: { scanned: number; totalMatches: number; returned: number; truncated: boolean };
  matches: Array<{
    ref: string;
    id: string;
    shortId: string;
    name: string;
    score: number;
    reason: string;
    description: string;
    snippets: Array<{ field: string; text: string }>;
  }>;
}): void {
  console.log(
    `ranker=${result.ranker} scanned=${result.corpus.scanned} totalMatches=${result.corpus.totalMatches} returned=${result.corpus.returned} truncated=${result.corpus.truncated}`,
  );
  if (result.matches.length === 0) {
    console.log("no disabled-skill metadata candidates found.");
    return;
  }
  for (const match of result.matches) {
    console.log(`${match.ref}  ${match.shortId}  ${match.id} (${match.score})`);
    console.log(`  ${match.reason}`);
    if (match.description) console.log(`  description: ${match.description}`);
    for (const snippet of match.snippets) {
      if (snippet.field === "description") continue;
      console.log(`  ${snippet.field}: ${snippet.text}`);
    }
  }
}

export function printCorpusInspect(result: {
  inspected: Array<{
    ref: string;
    id: string;
    shortId: string;
    name: string;
    description: string;
    metadata: Record<string, string[]>;
  }>;
}): void {
  for (const item of result.inspected) {
    console.log(`${item.ref}  ${item.shortId}  ${item.id}`);
    console.log(`name: ${item.name}`);
    if (item.description) console.log(`description: ${item.description}`);
    for (const [key, values] of Object.entries(item.metadata)) {
      if (values.length > 0) console.log(`${key}: ${values.join(", ")}`);
    }
  }
}

export function printSkillTable(skills: Skill[], usage: Map<string, UsageStat>): void {
  const rows = skills.map((s) => {
    const u = lookupUsage(s, usage, skills);
    return {
      id: s.id,
      source: s.source,
      disabled: s.conflict ? "CONFLICT"
        : s.outOfRoot ? "out-of-root"
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
    source: Math.max(7, ...rows.map((r) => r.source.length)),
    disabled: Math.max(10, ...rows.map((r) => r.disabled.length)),
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

export function printSuggestions(suggestions: Suggestion[], days: number): void {
  if (suggestions.length === 0) {
    console.log(`no suggestions (threshold: ${days} days unused).`);
    return;
  }
  console.log(`${suggestions.length} suggestion(s) (threshold: ${days} days unused):\n`);
  for (const s of suggestions) {
    const tag = `[${s.confidence}]`;
    const ambiguity = s.attributionAmbiguous ? "  (attribution ambiguous)" : "";
    console.log(`  ${tag.padEnd(8)} ${s.skill.id}${ambiguity}`);
    console.log(`           ${s.reason}: ${s.details}`);
  }
  console.log(`\nrun:  agentic-skill-router skills disable --all-suggested --unused-for=${days} --yes`);
}

export function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}
