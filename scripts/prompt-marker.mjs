/**
 * Helpers for the managed-marker block we embed in the installed Codex slash
 * prompt. The marker lets install/uninstall tell apart a pristine file we
 * shipped from one the user has hand-edited, so we never silently clobber
 * local changes.
 *
 * Format: a single trailing line of the form
 *   <!-- skill-router-managed: sha256=<64 lowercase hex chars> -->
 *
 * The checksum is computed over the file content with the marker line (and
 * the single newline immediately preceding it, when present) stripped out.
 * That way a freshly generated file is self-consistent: stripping the marker
 * yields the same body that produced the recorded hash.
 */
import { createHash } from "node:crypto";

const MARKER_PREFIX = "<!-- skill-router-managed: sha256=";
const MARKER_SUFFIX = " -->";
const MARKER_REGEX = /^<!-- skill-router-managed: sha256=([0-9a-f]{64}) -->$/m;

/**
 * Compute the sha256 hex digest of a body string.
 * @param {string} body
 * @returns {string}
 */
export function sha256Hex(body) {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * Attach the managed marker to a freshly generated prompt body.
 * If body does not end with a newline, we add one so the marker sits on its
 * own line.
 * @param {string} body
 * @returns {string}
 */
export function attachManagedMarker(body) {
  const normalized = body.endsWith("\n") ? body : body + "\n";
  const hash = sha256Hex(normalized);
  return `${normalized}${MARKER_PREFIX}${hash}${MARKER_SUFFIX}\n`;
}

/**
 * Parse a file's content. Returns the recorded hash if a marker is present
 * and the body (content with the marker line removed) so callers can verify
 * it matches.
 *
 * @param {string} content
 * @returns {{ recordedHash: string, bodyWithoutMarker: string } | null}
 */
export function extractManagedMarker(content) {
  const match = content.match(MARKER_REGEX);
  if (!match) return null;
  const recordedHash = match[1];
  const markerLine = match[0];

  // Remove the marker line. If a single newline immediately precedes the
  // marker, drop it too so the body looks like the pre-marker file we
  // originally hashed (which ended in "\n").
  const idx = content.indexOf(markerLine);
  let before = content.slice(0, idx);
  let after = content.slice(idx + markerLine.length);
  if (after.startsWith("\n")) after = after.slice(1);

  return { recordedHash, bodyWithoutMarker: before + after };
}

/**
 * Returns true when `content` is an unmodified managed prompt file: it has a
 * marker line, and the body without the marker hashes to the recorded value.
 *
 * @param {string} content
 * @returns {boolean}
 */
export function isManagedUnchanged(content) {
  const parsed = extractManagedMarker(content);
  if (!parsed) return false;
  return sha256Hex(parsed.bodyWithoutMarker) === parsed.recordedHash;
}
