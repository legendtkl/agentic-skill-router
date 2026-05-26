/**
 * Minimal YAML frontmatter parser for SKILL.md files.
 *
 * Supported subset (see README "SKILL.md frontmatter support"):
 *   - Top-level scalar `key: value` pairs (quoted or unquoted, with trailing
 *     `# comment` stripped on unquoted scalars).
 *   - Literal (`|`) and folded (`>`) block strings as the value of a top-level
 *     key.
 *   - Top-level arrays: either inline `[a, b]` or block `- item` lists.
 *
 * Not supported (intentionally):
 *   - Nested mappings under any key. When encountered the key is dropped and a
 *     warning is emitted so callers (and ultimately the user) can spot the
 *     silently-skipped metadata.
 *   - Lists of mappings (block `- key: value` items or inline `[{...}]`).
 *     Treated the same way as nested mappings: the key is dropped and a
 *     warning is emitted.
 *   - Anchors, aliases, tags, multi-document streams, flow mappings.
 *
 * Lines outside the `---` delimiters are ignored. If the opening `---` exists
 * but no closing `---` is found, parsing yields an empty result.
 */

export interface Frontmatter {
  [key: string]: string | string[];
}

export interface FrontmatterParseResult {
  data: Frontmatter;
  warnings: string[];
}

/**
 * Backward-compatible entry point: returns only the parsed scalars/arrays.
 * Callers that need warnings should use {@link parseFrontmatterWithWarnings}.
 */
export function parseFrontmatter(content: string): Frontmatter {
  return parseFrontmatterWithWarnings(content).data;
}

/**
 * Parse SKILL.md frontmatter and return both the data and a list of human-
 * readable warnings about unsupported constructs (e.g. nested mappings) that
 * were skipped during parsing. Warnings include the offending key path and
 * 1-based line number so users can fix their `SKILL.md`.
 */
export function parseFrontmatterWithWarnings(content: string): FrontmatterParseResult {
  const out: Frontmatter = {};
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  let closed = false;
  let i = 0;
  // Skip leading blank lines, then expect `---`
  while (i < lines.length && lines[i]?.trim() === "") i++;
  if (lines[i]?.trim() !== "---") return { data: out, warnings };
  i++;

  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") {
      closed = true;
      break;
    }

    // Indented line at top level: part of a block we chose to skip. The owning
    // key already emitted a warning (if applicable) before we advanced here.
    if (/^\s+\S/.test(line)) continue;

    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const rawValue = (m[2] ?? "").trim();

    if (rawValue === "|" || rawValue === ">") {
      const block: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j] ?? "";
        if (next.trim() === "---") break;
        if (next.trim() !== "" && !/^\s+/.test(next)) break;
        block.push(next);
      }
      out[key] = rawValue === "|" ? normalizeLiteralBlock(block) : normalizeFoldedBlock(block);
      i = j - 1;
      continue;
    }

    if (rawValue === "") {
      const arr: string[] = [];
      let j = i + 1;
      let sawIndented = false;
      let isArray = true;
      let nestedMappingAt = -1;
      let listOfMappingAt = -1;
      for (; j < lines.length; j++) {
        const next = lines[j] ?? "";
        if (next.trim() === "---") break;
        if (next.trim() === "") {
          sawIndented = true;
          continue;
        }
        if (!/^\s+/.test(next)) break;
        sawIndented = true;
        const item = next.match(/^\s*-\s*(.*)$/);
        if (!item) {
          // Indented non-list line under an empty-value key looks like a nested
          // mapping (e.g. `key:\n  sub: value`). Capture the first such line so
          // we can warn even after we keep scanning to skip the whole block.
          isArray = false;
          if (nestedMappingAt === -1 && /^\s+[A-Za-z0-9_-]+\s*:/.test(next)) {
            nestedMappingAt = j;
          }
          continue;
        }
        // A `- key: value` item is the start of a list-of-mapping (a YAML
        // sequence of maps). We don't support those: silently treating the
        // raw line text as a string would produce bogus routing metadata.
        // Drop the whole key and remember the line for a warning. The match
        // accepts both bare `- key: value` and `- key: value` followed by
        // further indented child lines (`  child: ...`).
        if (/^[A-Za-z0-9_-]+\s*:(\s|$)/.test(item[1]!)) {
          isArray = false;
          if (listOfMappingAt === -1) listOfMappingAt = j;
          continue;
        }
        arr.push(unquote(item[1]!.trim()));
      }
      if (sawIndented && isArray) out[key] = arr;
      if (sawIndented && !isArray && listOfMappingAt >= 0) {
        warnings.push(formatListOfMappingWarning(key, listOfMappingAt + 1));
      } else if (sawIndented && !isArray && nestedMappingAt >= 0) {
        warnings.push(formatNestedMappingWarning(key, nestedMappingAt + 1));
      }
      i = j - 1;
      continue;
    }

    if (/^\[.*\]$/.test(rawValue)) {
      // Inline flow arrays that contain `{` or `}` are list-of-mapping in
      // disguise (e.g. `examples: [{input: foo, output: bar}]`). Drop the
      // key and warn, mirroring the block-array case.
      if (/[{}]/.test(rawValue)) {
        warnings.push(formatListOfMappingWarning(key, i + 1));
        continue;
      }
      const parsed = parseInlineArray(rawValue);
      if (parsed) {
        out[key] = parsed;
        continue;
      }
    }

    out[key] = unquote(rawValue);
  }

  if (!closed) return { data: {}, warnings: [] };
  return { data: out, warnings };
}

function formatNestedMappingWarning(key: string, line: number): string {
  return `frontmatter: skipped nested mapping under \`${key}\` (line ${line})`;
}

function formatListOfMappingWarning(key: string, line: number): string {
  return `frontmatter: skipped list-of-mapping under \`${key}\` (line ${line})`;
}

function normalizeLiteralBlock(lines: string[]): string {
  return stripCommonIndent(lines).join("\n").trimEnd();
}

function normalizeFoldedBlock(lines: string[]): string {
  return stripCommonIndent(lines).map((line) => line.trim()).filter(Boolean).join(" ");
}

function stripCommonIndent(lines: string[]): string[] {
  const nonBlank = lines.filter((line) => line.trim() !== "");
  const minIndent = nonBlank.reduce((min, line) => {
    const indent = line.match(/^ */)?.[0].length ?? 0;
    return Math.min(min, indent);
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(minIndent)) return [];
  return lines.map((line) => line.slice(minIndent));
}

function parseInlineArray(raw: string): string[] | null {
  const body = raw.slice(1, -1).trim();
  if (body === "") return [];
  const out: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;
  for (const ch of body) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ",") {
      out.push(unquote(current.trim()));
      current = "";
      continue;
    }
    current += ch;
  }
  if (quote) return null;
  out.push(unquote(current.trim()));
  return out;
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\")
        .replace(new RegExp(`\\\\${first}`, "g"), first);
    }
  }
  // Strip trailing inline comment (` # ...`) per YAML spec for unquoted scalars
  const hashIdx = s.search(/\s+#/);
  if (hashIdx >= 0) return s.slice(0, hashIdx).trim();
  return s;
}
