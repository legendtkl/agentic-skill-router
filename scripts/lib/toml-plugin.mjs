/**
 * Tiny, dependency-free TOML editor for the single use case we need: flip
 * the `enabled` flag inside a `[plugins."<key>"]` stanza in Codex's
 * `config.toml`. Designed to be idempotent and to leave the rest of the
 * file untouched (comments, whitespace, unrelated sections).
 */

/**
 * Set (or add) `enabled = <bool>` inside the `[plugins."<pluginKey>"]`
 * stanza of `config`. If the stanza does not exist, it is appended to the
 * end with a blank-line gap from any preceding content. The returned string
 * always ends with exactly one trailing newline.
 *
 * @param {string} config Original TOML content. May be empty.
 * @param {string} pluginKey Quoted plugin identifier (e.g. `skill-router@local`).
 * @param {boolean} enabled Desired flag value.
 * @returns {string} The rewritten TOML.
 */
export function setPluginEnabled(config, pluginKey, enabled) {
  const header = `[plugins."${pluginKey}"]`;
  const lines = config.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    const base = config.trimEnd();
    return `${base}${base ? "\n\n" : ""}${header}\nenabled = ${enabled}\n`;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  const block = lines.slice(start, end);
  const enabledIdx = block.findIndex((line) => /^\s*enabled\s*=/.test(line));
  if (enabledIdx >= 0) block[enabledIdx] = `enabled = ${enabled}`;
  else block.push(`enabled = ${enabled}`);
  lines.splice(start, end - start, ...block);
  return lines.join("\n").replace(/\n*$/, "\n");
}
