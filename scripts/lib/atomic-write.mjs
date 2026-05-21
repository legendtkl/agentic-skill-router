/**
 * Atomic file write helper used by install/uninstall scripts.
 *
 * Writes to a unique temp file in the same directory, then renames into place.
 * Renaming on the same filesystem is atomic on POSIX, which gives us the
 * "tmp + rename" guarantee callers expect when updating host config/state
 * files in-place.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Write `content` to `path` atomically. The parent directory is created if it
 * does not already exist.
 *
 * @param {string} path
 * @param {string} content
 * @returns {Promise<void>}
 */
export async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}
