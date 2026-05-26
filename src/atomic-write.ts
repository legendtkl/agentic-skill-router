import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Options for {@link atomicWriteFile} and {@link atomicWriteJson}.
 */
export interface AtomicWriteOptions {
  /** File mode for the created file. Default 0o600. */
  mode?: number;
  /**
   * When true (default), `fsync` the file data before rename and `fsync` the
   * parent directory after rename so the write survives an abrupt power loss.
   * Set to false when crash durability is not required (e.g. caches).
   */
  durable?: boolean;
}

/**
 * Options for {@link atomicWriteJson}.
 */
export interface AtomicWriteJsonOptions extends AtomicWriteOptions {
  /** When true (default), pretty-print with 2-space indent and trailing newline. */
  pretty?: boolean;
}

const DEFAULT_MODE = 0o600;

/**
 * Atomically write `content` to `targetPath`.
 *
 * Algorithm (POSIX):
 *   1. Open a uniquely-named temp file (`${target}.tmp.${pid}.${ts}.${uuid}`)
 *      in the same directory with `O_CREAT|O_EXCL|O_WRONLY` and the requested
 *      mode.
 *   2. Write the content via the file handle.
 *   3. If `durable !== false`: fsync the file handle so the data hits disk
 *      before the rename. Then close the handle, rename the temp into place,
 *      and best-effort fsync the parent directory so the rename itself is
 *      durable. Directory fsync is silently skipped on platforms where
 *      opening a directory fd is not supported (notably Windows).
 *   4. On any error: best-effort unlink the temp file, then rethrow.
 *
 * The temp filename includes `randomUUID()` so two concurrent writers in the
 * same process within the same millisecond cannot collide on the temp path.
 */
export async function atomicWriteFile(
  targetPath: string,
  content: string | Uint8Array,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  const mode = opts.mode ?? DEFAULT_MODE;
  const durable = opts.durable !== false;
  const tempPath = buildTempPath(targetPath);

  let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
  let renamed = false;
  try {
    // O_CREAT|O_EXCL via 'wx' guards against accidentally reopening a temp
    // path that another (extremely unlikely) writer just created.
    fileHandle = await open(tempPath, "wx", mode);
    await fileHandle.writeFile(content);
    if (durable) {
      await fileHandle.sync();
    }
    await fileHandle.close();
    fileHandle = null;

    await rename(tempPath, targetPath);
    renamed = true;

    if (durable) {
      await fsyncDirectory(dirname(targetPath));
    }
  } catch (err) {
    // Best-effort cleanup. If close failed but write didn't, the handle is
    // still owned by us; release it before unlinking. Swallow secondary
    // errors so the original failure reaches the caller.
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
        // ignore
      }
    }
    if (!renamed) {
      try {
        await unlink(tempPath);
      } catch {
        // ignore — temp may not exist, or we never created it.
      }
    }
    throw err;
  }
}

/**
 * Atomically write `value` as JSON to `targetPath`. By default pretty-prints
 * with a 2-space indent and a trailing newline, matching the historical
 * format used by state and config files in this project.
 */
export async function atomicWriteJson(
  targetPath: string,
  value: unknown,
  opts: AtomicWriteJsonOptions = {},
): Promise<void> {
  const pretty = opts.pretty !== false;
  const body = pretty ? JSON.stringify(value, null, 2) + "\n" : JSON.stringify(value);
  await atomicWriteFile(targetPath, body, opts);
}

function buildTempPath(targetPath: string): string {
  // Per-process uniqueness via `process.pid`, monotonic-ish ordering via
  // `Date.now()`, and intra-millisecond collision avoidance via
  // `randomUUID()`. The UUID is what makes #108 (same-ms collisions) safe.
  return `${targetPath}.tmp.${process.pid}.${Date.now()}.${randomUUID()}`;
}

/**
 * Best-effort fsync of a directory so a rename within it is durable. On
 * platforms that do not allow opening a directory fd (e.g. Windows) this is
 * a no-op: the durability guarantee degrades to "file content is on disk,
 * directory entry may not be" which is the same as what existed before this
 * helper landed.
 */
async function fsyncDirectory(dirPath: string): Promise<void> {
  let dirHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    dirHandle = await open(dirPath, "r");
    await dirHandle.sync();
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // EISDIR / EPERM / EINVAL / ENOTSUP / ENOSYS — any of these mean the
    // platform refused to fsync the directory. Treat as best-effort.
    if (
      code === "EISDIR" ||
      code === "EPERM" ||
      code === "EINVAL" ||
      code === "ENOTSUP" ||
      code === "ENOSYS" ||
      code === "EACCES"
    ) {
      return;
    }
    throw err;
  } finally {
    if (dirHandle) {
      try {
        await dirHandle.close();
      } catch {
        // ignore
      }
    }
  }
}
