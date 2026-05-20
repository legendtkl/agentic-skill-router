/**
 * Minimal YAML frontmatter parser for SKILL.md files.
 *
 * Handles only the subset SKILL.md actually uses: scalar `key: value` pairs
 * at the top level. Quoted strings (single or double), unquoted strings
 * (terminated at end of line), and `key:` lines opening a nested mapping
 * (which we skip — we don't need nested fields). Lines outside `---`
 * delimiters are ignored.
 */

export interface Frontmatter {
  [key: string]: string;
}

export function parseFrontmatter(content: string): Frontmatter {
  const out: Frontmatter = {};
  const lines = content.split(/\r?\n/);

  let inBlock = false;
  let i = 0;
  // Skip leading blank lines, then expect `---`
  while (i < lines.length && lines[i]?.trim() === "") i++;
  if (lines[i]?.trim() !== "---") return out;
  i++;
  inBlock = true;

  // Skip nested blocks (e.g. `metadata:` followed by indented children)
  let inNested = false;

  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") break;

    // Indented line: part of nested block; skip
    if (/^\s+\S/.test(line)) continue;

    inNested = false;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const rawValue = (m[2] ?? "").trim();

    if (rawValue === "") {
      // Opens a nested mapping; we don't capture it
      inNested = true;
      void inNested;
      continue;
    }

    out[key] = unquote(rawValue);
  }

  if (!inBlock) return {};
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
