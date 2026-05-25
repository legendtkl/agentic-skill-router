/**
 * Cross-host helpers shared between every install/uninstall script.
 *
 * Kept intentionally tiny so the install scripts stay dependency-free and
 * any future host can pull in just what it needs.
 */
import { spawnSync } from "node:child_process";

export const PLUGIN_NAME = "agentic-skill-router";
export const MARKETPLACE = "local";
export const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE}`;

/**
 * Strip proxy environment variables from a copy of `env` so the install
 * step's `npm run build` invocation is not derailed by a corporate proxy
 * that npm cannot reach.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function stripProxy(env) {
  const out = { ...env };
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
    delete out[k];
  }
  return out;
}

/**
 * Write a single line to stdout. Matches the legacy log() helpers used by
 * the install/uninstall scripts so refactors can keep their output verbatim.
 *
 * @param {string} msg
 */
export function log(msg) {
  process.stdout.write(msg + "\n");
}

/**
 * Lightweight type guard for "is `value` a plain JSON object?". Mirrors the
 * helper that the install/uninstall scripts had inlined.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Run `npm run build` in the repo so the installed plugin always ships a
 * freshly produced bundle. Throws on non-zero exit.
 *
 * @param {object} options
 * @param {string} options.repoRoot Directory containing the project's
 *   package.json.
 * @param {(message: string) => void} [options.log] Logger used for the
 *   "building bundle" status line.
 */
export function ensureBuild({ repoRoot, log: logFn = log }) {
  logFn("  building bundle (npm run build)...");
  const r = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: stripProxy(process.env),
  });
  if (r.status !== 0) {
    throw new Error(`npm run build failed (exit ${r.status})`);
  }
}
