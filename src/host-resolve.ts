import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeHost } from "./hosts/claude-code.ts";
import { CodexHost } from "./hosts/codex.ts";
import type { Host } from "./hosts/base.ts";
import type { HostName } from "./types.ts";

/**
 * Returns the deprecated `--host` flag string if it appears anywhere in argv,
 * or `null` otherwise. Used by `src/cli.ts` to short-circuit with a friendly
 * error before any command dispatch.
 */
export function findDeprecatedHostFlag(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg === "--host") return "--host";
    if (arg.startsWith("--host=")) return "--host";
  }
  return null;
}

/**
 * Resolves the host the CLI should operate against. Order of precedence:
 *   1. Installed plugin bundle (auto-detected from this module's path).
 *   2. `AGENTIC_SKILL_ROUTER_HOST` env var (`claude-code` or `codex`).
 *   3. Default `claude-code` for unpacked source / repo checkouts.
 *
 * Returns `null` when `AGENTIC_SKILL_ROUTER_HOST` is set to an unknown value so the
 * caller can surface a usage error.
 */
export function resolveHostName(): HostName | null {
  const installedHost = detectInstalledHost();
  if (installedHost) return installedHost;

  const raw = process.env["AGENTIC_SKILL_ROUTER_HOST"];
  if (raw === undefined || raw === "") return "claude-code";
  const hostName = parseHostName(raw);
  if (!hostName) console.error(`unknown AGENTIC_SKILL_ROUTER_HOST: ${raw}`);
  return hostName;
}

function detectInstalledHost(): HostName | null {
  const modulePath = fileURLToPath(import.meta.url);
  const pluginRoot = dirname(dirname(modulePath));
  if (existsSync(join(pluginRoot, ".codex-plugin", "plugin.json"))) return "codex";
  if (existsSync(join(pluginRoot, ".claude-plugin", "plugin.json"))) return "claude-code";
  return null;
}

function parseHostName(value: string | undefined): HostName | null {
  if (value === "claude-code" || value === "codex") return value;
  return null;
}

export interface CreateHostOptions {
  /** Project directory used for project-scope skill discovery. */
  cwd?: string;
}

/** Constructs the appropriate {@link Host} implementation for `hostName`. */
export function createHost(hostName: HostName, opts: CreateHostOptions = {}): Host {
  if (hostName === "codex") {
    const codexOpts: { cwd?: string } = {};
    if (opts.cwd) codexOpts.cwd = opts.cwd;
    return new CodexHost(codexOpts);
  }
  const claudeHome = process.env["CLAUDE_HOME"];
  const hostOpts: { claudeHome?: string; cwd?: string } = {};
  if (claudeHome) hostOpts.claudeHome = claudeHome;
  if (opts.cwd) hostOpts.cwd = opts.cwd;
  return new ClaudeCodeHost(hostOpts);
}

/** User-facing display name for the host (used in CLI messages). */
export function displayHost(hostName: HostName): string {
  return hostName === "codex" ? "Codex" : "Claude Code";
}
