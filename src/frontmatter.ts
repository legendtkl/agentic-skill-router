/**
 * Minimal YAML frontmatter parser for SKILL.md files.
 *
 * Handles the subset used by Codex/Claude skills: top-level scalar
 * `key: value` pairs, literal/folded multiline strings, and top-level arrays.
 * Nested mappings are skipped. Lines outside `---` delimiters are ignored.
 */

export interface Frontmatter {
  [key: string]: string | string[];
}

export function parseFrontmatter(content: string): Frontmatter {
  const out: Frontmatter = {};
  const lines = content.split(/\r?\n/);

  let closed = false;
  let i = 0;
  // Skip leading blank lines, then expect `---`
  while (i < lines.length && lines[i]?.trim() === "") i++;
  if (lines[i]?.trim() !== "---") return out;
  i++;

  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") {
      closed = true;
      break;
    }

    // Indented line at top level: part of a block we chose to skip.
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
          isArray = false;
          continue;
        }
        arr.push(unquote(item[1]!.trim()));
      }
      if (sawIndented && isArray) out[key] = arr;
      i = j - 1;
      continue;
    }

    if (/^\[.*\]$/.test(rawValue)) {
      const parsed = parseInlineArray(rawValue);
      if (parsed) {
        out[key] = parsed;
        continue;
      }
    }

    out[key] = unquote(rawValue);
  }

  return closed ? out : {};
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
