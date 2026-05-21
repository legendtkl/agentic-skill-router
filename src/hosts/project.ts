import { stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface ProjectSkillRoot {
  root: string;
  relativeDir: string;
}

export async function projectSkillRoots(cwd: string, skillsDirName: string): Promise<ProjectSkillRoot[]> {
  const start = resolve(cwd);
  const repoRoot = await findRepoRoot(start);
  if (!repoRoot) {
    return [{ root: join(start, skillsDirName), relativeDir: "." }];
  }

  const dirs: string[] = [];
  let current = start;
  while (true) {
    dirs.push(current);
    if (current === repoRoot) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirs.reverse().map((dir) => ({
    root: join(dir, skillsDirName),
    relativeDir: normalizeRelativeDir(relative(repoRoot, dir)),
  }));
}

async function findRepoRoot(start: string): Promise<string | null> {
  let current = start;
  while (true) {
    if (await exists(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeRelativeDir(path: string): string {
  if (path === "") return ".";
  return path.split(sep).join("/");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
