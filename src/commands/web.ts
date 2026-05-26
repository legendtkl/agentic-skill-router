import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { basename, dirname, join, resolve, sep as pathSep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrict } from "../args.ts";
import { disableSkill, enableSkill } from "../apply.ts";
import { createHost } from "../host-resolve.ts";
import { projectSkill } from "../output.ts";
import { skillInstanceKey, statePathForHost } from "../state.ts";
import type { Host } from "../hosts/base.ts";
import {
  BuiltinSkillCannotDisableError,
  SkillConflictError,
  SkillOutOfRootError,
  type HostName,
  type Skill,
} from "../types.ts";

type WebScope = "global" | "project";

interface WebSkill {
  id: string;
  instanceKey: string;
  name: string;
  description: string;
  source: string;
  type: string;
  pluginKey: string | null;
  isDisabled: boolean;
  isPluginDisabled: boolean;
  canDisable: boolean;
  conflict: boolean;
  outOfRoot: boolean;
}

interface WebServerOptions {
  hostName: HostName;
  port?: number;
  bind?: string;
  dangerouslyBindPublic?: boolean;
  /**
   * Allowlist of directories that may be used as `projectPath` for
   * project-scope `/api/skills` requests. Each entry is canonicalized
   * (`resolve()` + `realpath()`) at server start. When omitted, defaults
   * to `[process.cwd()]`.
   */
  projectRoots?: string[];
}

export async function cmdWeb(argv: string[], hostName: HostName): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`agentic-skill-router skills web [--port=N] [--bind=ADDR] [--dangerously-bind-public] [--project-root=DIR ...]

Starts a localhost web UI for viewing, disabling, and enabling skills.

By default --bind is restricted to loopback addresses (127.0.0.1, ::1, localhost).
Pass --dangerously-bind-public together with a non-loopback --bind to expose the
UI on a public or LAN interface. Doing so allows anyone on the network to read
and mutate local skill files; --dangerously-bind-public also requires the
mutation token for read endpoints and enforces Origin/Referer/Host checks on
mutations.

Project-scope API requests (\`/api/skills?scope=project&projectPath=...\`) are
restricted to an allowlist of directories. The allowlist defaults to the
current working directory; pass --project-root=<dir> one or more times to
override it. Each accepted path must equal or be a subdirectory of one of
the allowed roots (after symlink resolution).
`);
    return 0;
  }

  const { values } = parseStrict({
    commandName: "agentic-skill-router skills web",
    config: {
      args: argv,
      options: {
        port: { type: "string", short: "p" },
        bind: { type: "string" },
        "dangerously-bind-public": { type: "boolean" },
        "project-root": { type: "string", multiple: true },
      },
    },
  });

  const port = parsePort(values.port as string | undefined);
  if (port === null) return 2;
  const bind = (values.bind as string | undefined) ?? "127.0.0.1";
  const dangerouslyBindPublic = values["dangerously-bind-public"] === true;
  const projectRootValues = values["project-root"] as string[] | undefined;

  try {
    const serverOpts: WebServerOptions = {
      hostName,
      port: port ?? 8787,
      bind,
      dangerouslyBindPublic,
    };
    if (projectRootValues && projectRootValues.length > 0) {
      serverOpts.projectRoots = projectRootValues;
    }
    const { server, url } = await startWebServer(serverOpts);
    console.log(`agentic-skill-router web UI listening on ${url}`);
    console.log("Press Ctrl+C to stop.");

    await waitForShutdown(server);
    return 0;
  } catch (err) {
    if (err instanceof PublicBindRefusedError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }
}

export interface StartWebServerResult {
  server: Server;
  url: string;
  basicAuth: BasicAuthCredential | null;
}

export async function startWebServer(opts: WebServerOptions): Promise<StartWebServerResult> {
  const bind = opts.bind ?? "127.0.0.1";
  const dangerouslyBindPublic = opts.dangerouslyBindPublic === true;
  const loopback = isLoopbackBind(bind);
  if (!loopback && !dangerouslyBindPublic) {
    throw new PublicBindRefusedError(
      `refusing to bind \`${bind}\`: only loopback addresses (127.0.0.1, ::1, localhost) are allowed by default. ` +
        `Re-run with --dangerously-bind-public if you really want to expose the local skill manager to the network.`,
    );
  }
  const projectRootAllowlist = await canonicalizeProjectRoots(
    opts.projectRoots && opts.projectRoots.length > 0 ? opts.projectRoots : [process.cwd()],
  );
  const basicAuth: BasicAuthCredential | null = !loopback
    ? { username: "agentic-skill-router", password: randomBytes(24).toString("base64url") }
    : null;
  if (!loopback && dangerouslyBindPublic) {
    process.stderr.write(
      "WARNING: --dangerously-bind-public is set.\n" +
        `         The web UI is binding ${bind}, which is reachable from other hosts on the network.\n` +
        "         Anyone who can reach this port can read your installed skill metadata and, with\n" +
        "         the in-page mutation token, disable or restore skill files on this machine.\n" +
        "         Run on a trusted network only, and stop the server when you are done.\n",
    );
    if (basicAuth) {
      process.stderr.write(
        `         HTTP Basic auth is required for every request.\n` +
          `         username: ${basicAuth.username}\n` +
          `         password: ${basicAuth.password}\n`,
      );
    }
  }

  const mutationToken = randomBytes(32).toString("base64url");
  const requireTokenForReads = !loopback;
  const enforceOriginChecks = !loopback;
  const security: SecurityOptions = {
    requireTokenForReads,
    enforceOriginChecks,
    expectedHosts: enforceOriginChecks ? computeExpectedHosts(bind, opts.port ?? 8787) : null,
    basicAuth,
    projectRootAllowlist,
  };
  const server = createServer((req, res) => {
    void handleRequest(req, res, opts.hostName, mutationToken, security);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      rejectListen(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(opts.port ?? 8787, bind);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : opts.port ?? 8787;
  if (enforceOriginChecks) {
    // Refresh expected host set with the actual bound port for ephemeral-port cases.
    security.expectedHosts = computeExpectedHosts(bind, actualPort);
  }
  const displayHost = bind === "0.0.0.0" || bind === "::" ? "localhost" : bind;
  return { server, url: `http://${displayHost}:${actualPort}`, basicAuth };
}

interface SecurityOptions {
  requireTokenForReads: boolean;
  enforceOriginChecks: boolean;
  expectedHosts: Set<string> | null;
  basicAuth: BasicAuthCredential | null;
  /**
   * Canonicalized list of directories accepted as `projectPath` for
   * project-scope requests. Any request whose `projectPath` does not
   * resolve to a path equal to or beneath one of these entries is
   * rejected with HTTP 403.
   */
  projectRootAllowlist: string[];
}

interface BasicAuthCredential {
  username: string;
  password: string;
}

function isLoopbackBind(bind: string): boolean {
  // NOTE: empty string is intentionally treated as non-loopback. Node's
  // `server.listen(port, "")` binds the wildcard (`0.0.0.0`), which would
  // silently expose the UI to the network if we treated "" as loopback.
  const normalized = bind.trim().toLowerCase();
  if (normalized === "") return false;
  if (normalized === "localhost") return true;
  if (normalized === "127.0.0.1") return true;
  if (normalized === "::1") return true;
  if (normalized === "[::1]") return true;
  return false;
}

function computeExpectedHosts(bind: string, port: number): Set<string> {
  // Only include `host:port` forms. A bare `host` entry would let a request
  // whose Host/Origin header omitted the port (i.e. targeted a different
  // process on port 80) pass the same-origin check.
  const hosts = new Set<string>();
  const portSuffix = `:${port}`;
  const candidates = new Set<string>();
  candidates.add(bind.toLowerCase());
  if (bind === "0.0.0.0" || bind === "::") {
    candidates.add("localhost");
    // Wildcard binds answer on every local interface, so a browser opened on
    // another machine will send `Host: <interface-ip>:<port>`. Without these
    // entries the Origin/Host check would reject every cross-network mutation
    // and make dangerous public mode effectively read-only.
    for (const address of localInterfaceAddresses()) {
      candidates.add(address.toLowerCase());
    }
  }
  for (const candidate of candidates) {
    const host = candidate.includes(":") && !candidate.startsWith("[") ? `[${candidate}]` : candidate;
    hosts.add(`${host}${portSuffix}`);
  }
  return hosts;
}

function localInterfaceAddresses(): string[] {
  const addresses: string[] = [];
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const entry of list) {
      if (!entry.address) continue;
      addresses.push(entry.address);
    }
  }
  return addresses;
}

class PublicBindRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicBindRefusedError";
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  hostName: HostName,
  mutationToken: string,
  security: SecurityOptions,
): Promise<void> {
  try {
    if (security.basicAuth && !checkBasicAuth(req, security.basicAuth)) {
      sendBasicAuthChallenge(res);
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/") {
      sendHtml(res, pageHtml(hostName, mutationToken));
      return;
    }
    if (req.method === "GET" && url.pathname === "/logo.png") {
      await sendLogo(res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/skills") {
      if (security.requireTokenForReads) assertReadToken(req, mutationToken);
      const requestedHost = parseWebHost(url.searchParams.get("agent") ?? url.searchParams.get("host"), hostName);
      const scope = parseScope(url.searchParams.get("scope"));
      const projectPath = url.searchParams.get("projectPath") ?? "";
      const result = await listWebSkills(requestedHost, scope, projectPath, security.projectRootAllowlist);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/skills/disable") {
      assertMutationRequest(req, mutationToken, security);
      const body = await readJsonBody(req);
      const result = await mutateWebSkill(hostName, body, "disable", security.projectRootAllowlist);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/skills/enable") {
      assertMutationRequest(req, mutationToken, security);
      const body = await readJsonBody(req);
      const result = await mutateWebSkill(hostName, body, "enable", security.projectRootAllowlist);
      sendJson(res, 200, result);
      return;
    }
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    const status = err instanceof WebHttpError ? err.status : statusForDomainError(err);
    sendJson(res, status, { error: (err as Error).message });
  }
}

async function listWebSkills(
  hostName: HostName,
  scope: WebScope,
  projectPath: string,
  projectRootAllowlist: string[],
): Promise<{
  host: HostName;
  scope: WebScope;
  projectPath: string | null;
  skills: WebSkill[];
}> {
  const host = await createScopedHost(hostName, scope, projectPath, projectRootAllowlist);
  const skills = filterScope(await host.listSkills(), scope);
  const usage = await host.usageStats();
  const projected = skills.map((skill) => ({
    ...projectSkill(skill, usage, skills),
    instanceKey: skillInstanceKey(skill.id, skill.skillMdPath),
    type: skill.outOfRoot ? "symlink" : skill.source,
  }));
  projected.sort((a, b) => {
    const bySource = sourceRank(a.source) - sourceRank(b.source);
    if (bySource !== 0) return bySource;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return {
    host: hostName,
    scope,
    projectPath: scope === "project" ? resolve(projectPath) : null,
    skills: projected,
  };
}

async function mutateWebSkill(
  defaultHostName: HostName,
  body: unknown,
  operation: "disable" | "enable",
  projectRootAllowlist: string[],
): Promise<{ ok: true; skill: WebSkill; skills: WebSkill[] }> {
  if (!isRecord(body)) throw new WebHttpError(400, "request body must be a JSON object");
  const hostName = parseWebHost(readString(body, "agent") ?? readString(body, "host"), defaultHostName);
  const scope = parseScope(readString(body, "scope"));
  const projectPath = readString(body, "projectPath") ?? "";
  const instanceKey = readString(body, "instanceKey");
  if (!instanceKey) throw new WebHttpError(400, "instanceKey is required");

  const host = await createScopedHost(hostName, scope, projectPath, projectRootAllowlist);
  const skills = filterScope(await host.listSkills(), scope);
  const target = skills.find((skill) => skillInstanceKey(skill.id, skill.skillMdPath) === instanceKey);
  if (!target) throw new WebHttpError(404, "skill not found");
  assertCanMutate(target);

  const statePath = statePathForHost(host.name);
  const allowOutOfRoot = canMutateSymlink(target);
  if (operation === "disable") {
    await disableSkill(target, "web", { statePath, host: host.name, allowOutOfRoot });
  } else {
    await enableSkill(target, { statePath, host: host.name, allowOutOfRoot });
  }

  const refreshed = await listWebSkills(hostName, scope, projectPath, projectRootAllowlist);
  const changed = refreshed.skills.find((skill) => skill.instanceKey === instanceKey);
  if (!changed) throw new WebHttpError(500, "skill changed but could not be reloaded");
  return { ok: true, skill: changed, skills: refreshed.skills };
}

function assertCanMutate(skill: Skill): void {
  if (skill.conflict) throw new WebHttpError(409, "skill has conflicting enabled and disabled files");
  if (!skill.canDisable && !canMutateSymlink(skill)) {
    throw new WebHttpError(403, "skill is protected and cannot be changed");
  }
}

function canMutateSymlink(skill: Skill): boolean {
  return skill.outOfRoot === true && skill.source !== "builtin";
}

function assertMutationRequest(req: IncomingMessage, expectedToken: string, security: SecurityOptions): void {
  const contentType = req.headers["content-type"] ?? "";
  const rawContentType = Array.isArray(contentType) ? contentType.join(",") : contentType;
  if (!rawContentType.toLowerCase().startsWith("application/json")) {
    throw new WebHttpError(415, "mutation requests must use application/json");
  }
  const token = req.headers["x-agentic-skill-router-token"];
  if (token !== expectedToken) throw new WebHttpError(403, "invalid mutation token");
  if (security.enforceOriginChecks) assertSameOriginRequest(req, security);
}

function assertReadToken(req: IncomingMessage, expectedToken: string): void {
  const token = req.headers["x-agentic-skill-router-token"];
  if (token !== expectedToken) throw new WebHttpError(403, "invalid mutation token");
}

function assertSameOriginRequest(req: IncomingMessage, security: SecurityOptions): void {
  const expected = security.expectedHosts;
  if (!expected) return;
  const hostHeader = singleHeader(req.headers["host"]);
  if (!hostHeader || !expected.has(hostHeader.toLowerCase())) {
    throw new WebHttpError(403, "Host header missing or does not match the bound address");
  }
  const origin = singleHeader(req.headers["origin"]);
  const referer = singleHeader(req.headers["referer"]);
  if (!origin && !referer) {
    throw new WebHttpError(403, "Origin or Referer header is required for cross-network requests");
  }
  if (origin && !originMatches(origin, expected)) {
    throw new WebHttpError(403, "Origin header does not match the bound address");
  }
  if (!origin && referer && !originMatches(referer, expected)) {
    throw new WebHttpError(403, "Referer header does not match the bound address");
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function checkBasicAuth(req: IncomingMessage, credential: BasicAuthCredential): boolean {
  const header = singleHeader(req.headers["authorization"]);
  if (!header) return false;
  const match = /^Basic\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  const userMatches = constantTimeEquals(user, credential.username);
  const passwordMatches = constantTimeEquals(pass, credential.password);
  return userMatches && passwordMatches;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still do a comparison against bufA to keep timing roughly stable.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function sendBasicAuthChallenge(res: ServerResponse): void {
  const body = "Authentication required.";
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="agentic-skill-router", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function originMatches(raw: string, expected: Set<string>): boolean {
  const value = raw.trim();
  if (value === "" || value === "null") return false;
  try {
    const parsed = new URL(value);
    return expected.has(parsed.host.toLowerCase());
  } catch {
    return false;
  }
}

function statusForDomainError(err: unknown): number {
  if (err instanceof BuiltinSkillCannotDisableError) return 403;
  if (err instanceof SkillOutOfRootError || err instanceof SkillConflictError) return 409;
  return 500;
}

async function createScopedHost(
  hostName: HostName,
  scope: WebScope,
  projectPath: string,
  projectRootAllowlist: string[],
): Promise<Host> {
  if (scope === "global") return createHost(hostName);
  const trimmed = projectPath.trim();
  if (trimmed === "") throw new WebHttpError(400, "projectPath is required for project scope");
  const resolved = resolve(trimmed);
  // Canonicalize via the nearest existing ancestor so a missing leaf cannot
  // hide a symlink jump (e.g. `/allowed/link/missing` where `link -> /outside`
  // must NOT pass the allowlist check just because realpath of the full path
  // throws and we fall back to the unresolved input).
  const canonical = await canonicalizeWithMissingTail(resolved);
  assertProjectPathAllowed(canonical, projectRootAllowlist, resolved);
  // P1.B: the project host walks UP from cwd to the nearest `.git` ancestor
  // and scans `<dir>/<skillsDir>` at every level on the way. A request inside
  // an allowlisted subtree could otherwise reach skills directories above
  // that subtree. Reject if any ancestor the project host would scan is
  // outside the allowlist. When no `.git` ancestor exists, the production
  // host only scans the start dir itself, so no parent check is required.
  await assertProjectAncestorsAllowed(canonical, projectRootAllowlist, resolved);
  // P1.D: pass the canonical (OS-resolved) cwd into the host. The host
  // re-`resolve()`s but does NOT realpath, so passing the resolved-but-not-
  // canonicalized form leaves a TOCTOU window in which a writable path
  // component under the allowlist can be swapped to a symlink pointing
  // outside between our validation and the scan. Passing the canonical
  // path closes that window because the discovery walk runs on a path
  // string that has already been OS-resolved against the allowlist.
  return createHost(hostName, { cwd: canonical });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    if ((err as NodeJS.ErrnoException).code === "ENOTDIR") return false;
    return false;
  }
}

/**
 * Canonicalize `input` for the allowlist containment check.
 *
 * If `input` itself exists, returns `realpath(input)`. Otherwise walks up
 * parents until one exists, realpaths that ancestor, then re-appends the
 * missing tail. This prevents a missing-leaf realpath failure from masking
 * a symlink jump along the requested path: e.g. when `/allowed/link` is a
 * symlink to `/outside` and the caller asks for `/allowed/link/missing`,
 * naive realpath throws and a fallback to the unresolved input would
 * incorrectly pass `startsWith("/allowed/")`.
 */
async function canonicalizeWithMissingTail(input: string): Promise<string> {
  // Fast path: the target exists; realpath gives the full canonical form.
  try {
    return await realpath(input);
  } catch {
    // Fall through to ancestor walk.
  }
  const tail: string[] = [];
  let current = input;
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      // Reached the filesystem root without finding any existing ancestor.
      // Nothing useful to canonicalize against; return the resolved input so
      // the allowlist check sees the exact requested path (and rejects it
      // unless it literally matches an allowlist entry).
      return input;
    }
    tail.unshift(basename(current));
    if (await pathExists(parent)) {
      try {
        const canonicalParent = await realpath(parent);
        return tail.length === 0 ? canonicalParent : join(canonicalParent, ...tail);
      } catch {
        return input;
      }
    }
    current = parent;
  }
}

async function canonicalizeProjectRoots(roots: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of roots) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const resolved = resolve(trimmed);
    const canonical = await canonicalizeWithMissingTail(resolved);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

function isWithinAllowlist(canonical: string, projectRootAllowlist: string[]): boolean {
  for (const root of projectRootAllowlist) {
    if (canonical === root) return true;
    if (canonical.startsWith(root + pathSep)) return true;
  }
  return false;
}

function assertProjectPathAllowed(
  canonical: string,
  projectRootAllowlist: string[],
  originalResolved: string,
): void {
  if (projectRootAllowlist.length === 0) {
    throw new WebHttpError(
      403,
      `projectPath \`${originalResolved}\` is outside the allowed project roots. ` +
        `No project roots are configured; restart the web server with --project-root=<dir> to allow project-scope scans.`,
    );
  }
  if (isWithinAllowlist(canonical, projectRootAllowlist)) return;
  throw new WebHttpError(
    403,
    `projectPath \`${originalResolved}\` is outside the allowed project roots. ` +
      `Allowed roots: ${projectRootAllowlist.join(", ")}`,
  );
}

/**
 * Reject requests whose project host would walk UP into a directory outside
 * the allowlist. Mirrors `src/hosts/project.ts:projectSkillRoots` exactly:
 *
 *   - If no `.git` ancestor exists at or above `canonicalStart`, the host
 *     scans ONLY the start dir. No parent check is required.
 *   - If a `.git` ancestor is found, the host scans every directory from
 *     `canonicalStart` up to and including the repo root. Each of those
 *     directories must be inside the allowlist.
 *
 * Because `canonicalStart` is already realpath-ed, pure-string `dirname()`
 * walks the real filesystem tree (no symlinks remain in the prefix), so we
 * don't need to realpath each parent again.
 */
async function assertProjectAncestorsAllowed(
  canonicalStart: string,
  projectRootAllowlist: string[],
  originalResolved: string,
): Promise<void> {
  const repoRoot = await findRepoRootLike(canonicalStart);
  if (repoRoot === null) {
    // Production semantics: no `.git` ancestor -> the host only scans
    // `<canonicalStart>/<skillsDir>`. We already validated `canonicalStart`.
    return;
  }
  // Walk the same `[canonicalStart ... repoRoot]` range the host will scan.
  let current = canonicalStart;
  while (true) {
    if (!isWithinAllowlist(current, projectRootAllowlist)) {
      throw new WebHttpError(
        403,
        `projectPath \`${originalResolved}\` would cause project skill discovery to scan ` +
          `\`${current}\`, which is outside the allowed project roots. ` +
          `Allowed roots: ${projectRootAllowlist.join(", ")}`,
      );
    }
    if (current === repoRoot) return;
    const parent = dirname(current);
    if (parent === current) return; // safety: never happens because repoRoot is an ancestor
    current = parent;
  }
}

/**
 * Mirror of `findRepoRoot` in `src/hosts/project.ts`: walk parents by
 * pure-string `dirname` until a directory containing `.git` is found, or
 * return `null` at the filesystem root. We operate on the canonical input
 * so the walk matches what the production host will see when given the
 * same canonical cwd.
 */
async function findRepoRootLike(start: string): Promise<string | null> {
  let current = start;
  while (true) {
    if (await pathExists(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function filterScope(skills: Skill[], scope: WebScope): Skill[] {
  return skills.filter((skill) => scope === "project" ? skill.source === "project" : skill.source !== "project");
}

function parseScope(value: string | null): WebScope {
  if (value === null || value === "" || value === "global") return "global";
  if (value === "project") return "project";
  throw new WebHttpError(400, "scope must be global or project");
}

function parseWebHost(value: string | null, fallback: HostName): HostName {
  if (value === null || value === "") return fallback;
  if (value === "claude-code" || value === "codex") return value;
  throw new WebHttpError(400, "agent must be claude-code or codex");
}

function parsePort(value: string | undefined): number | null | undefined {
  if (value === undefined || value === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("--port must be an integer from 0 to 65535");
    return null;
  }
  return port;
}

function sourceRank(source: string): number {
  switch (source) {
    case "user": return 0;
    case "plugin": return 1;
    case "project": return 2;
    case "builtin": return 3;
    default: return 4;
  }
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1_000_000) throw new WebHttpError(413, "request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new WebHttpError(400, "request body is not valid JSON");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function sendLogo(res: ServerResponse): Promise<void> {
  const logo = await readFile(resolveAssetPath("agentic-skill-router-logo.png"));
  res.writeHead(200, {
    "content-type": "image/png",
    "cache-control": "public, max-age=86400",
    "content-length": logo.byteLength,
  });
  res.end(logo);
}

function resolveAssetPath(fileName: string): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    const candidate = join(current, "assets", fileName);
    if (existsSync(candidate)) return candidate;
    current = dirname(current);
  }
  return join(dirname(fileURLToPath(import.meta.url)), "assets", fileName);
}

function waitForShutdown(server: Server): Promise<void> {
  return new Promise((resolveShutdown) => {
    const close = () => {
      server.close(() => resolveShutdown());
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

class WebHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "WebHttpError";
  }
}

function escapeHtmlAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function pageHtml(defaultHost: HostName, mutationToken: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="agentic-skill-router-token" content="${escapeHtmlAttr(mutationToken)}">
  <title>Agentic Skill Router</title>
  <link rel="icon" type="image/png" href="/logo.png">
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f2;
      --panel: rgba(255, 255, 255, 0.82);
      --panel-strong: #ffffff;
      --ink: #161616;
      --ink-soft: #363a3f;
      --muted: #686c73;
      --line: rgba(22, 22, 22, 0.12);
      --accent: #1f7a5a;
      --accent-soft: #dcece5;
      --danger: #b73c38;
      --danger-soft: #f7dfdc;
      --field: rgba(255, 255, 255, 0.72);
      --field-disabled: rgba(255, 255, 255, 0.42);
      --button-muted: #eee;
      --tooltip: #fffdf7;
      --segmented: #f2f3ee;
      --shadow: 0 18px 50px rgba(20, 30, 25, 0.08);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 20% 12%, rgba(31, 122, 90, 0.10), transparent 28rem),
        linear-gradient(180deg, #fbfbf8 0%, var(--bg) 52%, #f0f1eb 100%);
      color: var(--ink);
    }
    body.dark {
      color-scheme: dark;
      --bg: #10110f;
      --panel: rgba(26, 28, 25, 0.86);
      --panel-strong: #1d201c;
      --ink: #f4f3ee;
      --ink-soft: #d7d9d2;
      --muted: #a2a79f;
      --line: rgba(255, 255, 255, 0.14);
      --accent: #86d8aa;
      --accent-soft: rgba(134, 216, 170, 0.16);
      --danger: #e06b64;
      --danger-soft: rgba(224, 107, 100, 0.18);
      --field: rgba(255, 255, 255, 0.08);
      --field-disabled: rgba(255, 255, 255, 0.05);
      --button-muted: rgba(255, 255, 255, 0.08);
      --tooltip: #22251f;
      --segmented: rgba(255, 255, 255, 0.06);
      --shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
      background:
        radial-gradient(circle at 18% 10%, rgba(134, 216, 170, 0.10), transparent 27rem),
        linear-gradient(180deg, #151713 0%, var(--bg) 55%, #0c0d0b 100%);
    }
    button, input, select { font: inherit; }
    .shell {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 26px 0 48px;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding: 18px 20px;
      border: 1px solid var(--line);
      border-radius: 8px;
      margin-bottom: 12px;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
    }
    .brand {
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr);
      grid-template-areas:
        "mark title"
        "copy copy";
      gap: 10px 14px;
      min-width: 0;
    }
    .brand-mark {
      grid-area: mark;
      width: 52px;
      height: 52px;
      flex: 0 0 auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-strong);
      object-fit: cover;
    }
    .brand-title {
      grid-area: title;
      align-self: center;
      min-width: 0;
    }
    .brand-copy {
      grid-area: copy;
      max-width: 760px;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
      letter-spacing: 0;
      color: var(--accent);
    }
    .sub {
      margin-top: 4px;
      color: var(--muted);
      font-size: 14px;
    }
    .hero-copy {
      max-width: 680px;
      margin: 0;
      color: var(--ink-soft);
      font-size: 14px;
      line-height: 1.45;
    }
    .header-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      padding-top: 2px;
    }
    .view { display: block; }
    .view[hidden] { display: none; }
    .intro-panel {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.8fr);
      gap: 14px;
      align-items: stretch;
      margin-top: 14px;
    }
    .intro-main,
    .intro-aside {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      backdrop-filter: blur(16px);
    }
    .intro-main {
      padding: 24px;
    }
    .intro-aside {
      padding: 20px;
    }
    .intro-title {
      margin: 0 0 12px;
      font-size: 22px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    .intro-text {
      margin: 0;
      color: var(--ink-soft);
      line-height: 1.65;
    }
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }
    .feature {
      min-height: 112px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.34);
    }
    body.dark .feature {
      background: rgba(255, 255, 255, 0.04);
    }
    .feature strong {
      display: block;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .feature span {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .intro-aside dl {
      display: grid;
      gap: 14px;
      margin: 0;
    }
    .intro-aside dt {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .intro-aside dd {
      margin: 4px 0 0;
      color: var(--ink);
      font-weight: 650;
    }
    .controls {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) 260px 220px minmax(280px, 0.9fr) 112px;
      gap: 12px;
      align-items: end;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--field);
      box-shadow: none;
      backdrop-filter: none;
    }
    .control-group {
      min-width: 0;
    }
    .controls:has(#projectPathGroup[hidden]) {
      grid-template-columns: minmax(280px, 1fr) 260px 220px 112px;
    }
    .control-group[hidden] {
      display: none;
    }
    .control-label {
      display: block;
      margin: 0 0 7px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 750;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .manager-panel {
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
    }
    .manager-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 16px;
    }
    .manager-title {
      margin: 0;
      font-size: 20px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    .manager-copy {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .segmented {
      display: grid;
      grid-template-columns: 1fr 1fr;
      height: 42px;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--segmented);
    }
    .segmented button {
      border: 0;
      border-radius: 6px;
      padding: 8px 14px;
      color: var(--muted);
      background: transparent;
      cursor: pointer;
      line-height: 1;
      white-space: nowrap;
    }
    .segmented button.active {
      color: var(--ink);
      background: var(--panel-strong);
      box-shadow: 0 1px 8px rgba(20, 30, 25, 0.08);
    }
    .select-input,
    .search-input,
    .project-path {
      min-width: 0;
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      height: 42px;
      padding: 0 11px;
      color: var(--ink);
      background: var(--field);
    }
    .select-input {
      appearance: none;
      padding-right: 34px;
      background:
        linear-gradient(45deg, transparent 50%, var(--muted) 50%) calc(100% - 18px) 18px / 6px 6px no-repeat,
        linear-gradient(135deg, var(--muted) 50%, transparent 50%) calc(100% - 12px) 18px / 6px 6px no-repeat,
        var(--field);
      cursor: pointer;
    }
    .project-path[disabled] {
      color: var(--muted);
      background: var(--field-disabled);
    }
    .icon-button {
      width: 38px;
      height: 38px;
      display: inline-grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--ink);
      background: var(--panel-strong);
      cursor: pointer;
    }
    .theme-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: auto;
      min-width: 42px;
      padding: 0 12px;
      gap: 7px;
    }
    .theme-button span {
      font-size: 13px;
      color: var(--muted);
    }
    .refresh-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: auto;
      height: 42px;
      min-width: 104px;
      padding: 0 12px;
      gap: 8px;
    }
    .refresh-button span {
      font-size: 13px;
      color: var(--muted);
    }
    .summary {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      justify-content: flex-start;
      gap: 2px;
      min-width: 220px;
      padding-top: 2px;
      color: var(--muted);
      font-size: 13px;
      text-align: right;
    }
    #count {
      color: var(--muted);
      font-size: 13px;
      font-weight: 650;
      line-height: 1.3;
    }
    .status {
      min-height: 20px;
      color: var(--muted);
      font-size: 12px;
    }
    .status.error { color: var(--danger); }
    .list {
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: visible;
      background: var(--panel);
      margin-top: 16px;
    }
    .list-head,
    .row {
      display: grid;
      grid-template-columns: minmax(180px, 1.2fr) minmax(220px, 2fr) 96px 96px;
      gap: 16px;
      align-items: center;
    }
    .list-head {
      min-height: 42px;
      padding: 0 14px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: 11px;
      font-weight: 750;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .list-head span:last-child {
      text-align: right;
    }
    .row {
      min-height: 64px;
      padding: 12px 14px;
      border-top: 1px solid var(--line);
    }
    .list-head + .row { border-top: 0; }
    .row:hover {
      background: rgba(31, 122, 90, 0.045);
    }
    body.dark .row:hover {
      background: rgba(134, 216, 170, 0.045);
    }
    .name {
      min-width: 0;
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .id {
      margin-top: 4px;
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .desc-wrap {
      position: relative;
      min-width: 0;
    }
    .desc {
      color: var(--ink-soft);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: default;
    }
    .desc-wrap:hover .tooltip,
    .desc-wrap:focus-within .tooltip {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    .tooltip {
      position: absolute;
      left: 0;
      top: calc(100% + 8px);
      z-index: 10;
      width: min(520px, 80vw);
      padding: 12px;
      border: 1px solid rgba(22, 22, 22, 0.14);
      border-radius: 8px;
      color: var(--ink);
      background: var(--tooltip);
      box-shadow: 0 16px 36px rgba(20, 30, 25, 0.14);
      white-space: normal;
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 140ms ease, transform 140ms ease;
      pointer-events: none;
    }
    .badge {
      width: fit-content;
      max-width: 100%;
      padding: 4px 8px;
      border-radius: 999px;
      color: var(--accent);
      background: var(--accent-soft);
      font-size: 12px;
      font-weight: 650;
      text-transform: capitalize;
    }
    .badge.disabled {
      color: var(--danger);
      background: var(--danger-soft);
    }
    .action {
      justify-self: end;
      min-width: 82px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      color: var(--ink);
      background: var(--panel-strong);
      cursor: pointer;
    }
    .action.disable {
      color: var(--danger);
      border-color: var(--danger-soft);
      background: var(--danger-soft);
    }
    .action.enable {
      color: var(--accent);
      border-color: var(--accent-soft);
      background: var(--accent-soft);
    }
    .action:disabled {
      color: var(--muted);
      background: var(--button-muted);
      cursor: not-allowed;
    }
    .empty {
      padding: 38px 18px;
      text-align: center;
      color: var(--muted);
    }
    .top-tabs {
      display: flex;
      gap: 22px;
      width: 100%;
      padding: 0 4px;
      border-bottom: 1px solid var(--line);
      margin: 0 0 18px;
    }
    .top-tabs button {
      border: 0;
      border-bottom: 2px solid transparent;
      padding: 13px 0 12px;
      color: var(--muted);
      background: transparent;
      cursor: pointer;
      font-weight: 650;
    }
    .top-tabs button.active {
      color: var(--ink);
      border-bottom-color: var(--accent);
    }
    @media (max-width: 760px) {
      .shell { width: min(100vw - 20px, 1120px); padding-top: 22px; }
      header { display: block; padding: 18px; }
      .brand { grid-template-columns: 46px minmax(0, 1fr); gap: 9px 12px; }
      .brand-mark { width: 46px; height: 46px; }
      h1 { font-size: 24px; }
      .header-actions { margin-top: 16px; }
      .top-tabs { width: 100%; }
      .intro-panel { grid-template-columns: 1fr; }
      .feature-grid { grid-template-columns: 1fr; }
      .manager-head { display: block; }
      .summary { align-items: flex-start; min-width: 0; margin-top: 14px; text-align: left; }
      .controls { grid-template-columns: 1fr; }
      .controls:has(#projectPathGroup[hidden]) { grid-template-columns: 1fr; }
      .refresh-button { width: 100%; }
      .list-head { display: none; }
      .row {
        grid-template-columns: 1fr auto;
        gap: 10px 12px;
      }
      .desc-wrap { grid-column: 1 / -1; }
      .badge { grid-column: 1; }
      .action { grid-column: 2; grid-row: 1; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div class="brand">
        <img class="brand-mark" src="/logo.png" alt="" aria-hidden="true">
        <div class="brand-title">
          <h1>Agentic Skill Router</h1>
          <div class="sub">No-embedding skill router for modern agent.</div>
        </div>
        <p class="hero-copy brand-copy">
          Keep large skill libraries available without loading every instruction into the active agent context.
          Browse installed skills, switch between agent hosts, and disable noisy entries from one local page.
        </p>
      </div>
      <div class="header-actions">
        <button id="themeBtn" class="icon-button theme-button" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">◐ <span id="themeLabel">Dark</span></button>
      </div>
    </header>

    <nav class="top-tabs" aria-label="Primary views">
      <button id="introTab" type="button">Overview</button>
      <button id="skillsTab" class="active" type="button">Skill manager</button>
    </nav>

    <section id="introView" class="view" hidden>
      <div class="intro-panel">
        <div class="intro-main">
          <h2 class="intro-title">Route only the skill an agent actually needs.</h2>
          <p class="intro-text">
            Agentic Skill Router scans Codex and Claude Code skill roots, reads local usage signals, and keeps disabled skills discoverable through a lightweight router instead of always injecting every SKILL.md into context.
          </p>
          <div class="feature-grid">
            <div class="feature"><strong>No embeddings</strong><span>Selection uses deterministic local matching and routing data, so setup stays simple and offline-friendly.</span></div>
            <div class="feature"><strong>Host aware</strong><span>Codex and Claude Code skills stay separated, including global, plugin, builtin, and project scopes.</span></div>
            <div class="feature"><strong>Reversible</strong><span>Disable and enable operations rename skill files and preserve state for safe restoration.</span></div>
          </div>
        </div>
        <aside class="intro-aside" aria-label="Project facts">
          <dl>
            <div><dt>Scope</dt><dd>Global and project skills</dd></div>
            <div><dt>Agents</dt><dd>Codex and Claude Code</dd></div>
            <div><dt>Runtime</dt><dd>Local localhost web UI</dd></div>
          </dl>
        </aside>
      </div>
    </section>

    <section id="skillsView" class="view">
      <section class="manager-panel" aria-label="Skill manager">
        <div class="manager-head">
          <div>
            <h2 class="manager-title">Skill management</h2>
            <p class="manager-copy">Inspect local skill inventory by agent and scope, then disable or restore entries in place.</p>
          </div>
          <div class="summary">
            <div id="count">0 skills</div>
            <div id="status" class="status"></div>
          </div>
        </div>

        <section class="controls" aria-label="Skill scope controls">
          <div class="control-group">
            <label class="control-label" for="searchInput">Search</label>
            <input id="searchInput" class="search-input" type="search" placeholder="Name, id, or description">
          </div>
          <div class="control-group">
            <label class="control-label" for="agentSelect">Agent</label>
            <select id="agentSelect" class="select-input" aria-label="Code agent">
              <option value="codex">Codex</option>
              <option value="claude-code">Claude Code</option>
            </select>
          </div>
          <div class="control-group">
            <label class="control-label">Scope</label>
            <div class="segmented" role="tablist" aria-label="Scope">
              <button id="globalBtn" class="active" type="button">Global</button>
              <button id="projectBtn" type="button">Project</button>
            </div>
          </div>
          <div id="projectPathGroup" class="control-group" hidden>
            <label class="control-label" for="projectPath">Project path</label>
            <input id="projectPath" class="project-path" type="text" placeholder="/path/to/project">
          </div>
          <div class="control-group">
            <label class="control-label" aria-hidden="true">&nbsp;</label>
            <button id="refreshBtn" class="icon-button refresh-button" type="button" aria-label="Refresh" title="Refresh">↻ <span>Refresh</span></button>
          </div>
        </section>

        <section id="list" class="list" aria-label="Skills"></section>
      </section>
    </section>
  </main>

  <script>
    const savedTheme = localStorage.getItem("agentic-skill-router-theme");
    const mutationToken = document.querySelector('meta[name="agentic-skill-router-token"]').content;
    const state = {
      agent: "${defaultHost}",
      scope: "global",
      projectPath: "",
      query: "",
      skills: [],
      busy: new Set(),
      requestId: 0,
      view: "skills",
      theme: savedTheme === "dark" ? "dark" : "light",
    };
    const els = {
      themeBtn: document.getElementById("themeBtn"),
      themeLabel: document.getElementById("themeLabel"),
      introView: document.getElementById("introView"),
      skillsView: document.getElementById("skillsView"),
      introTab: document.getElementById("introTab"),
      skillsTab: document.getElementById("skillsTab"),
      searchInput: document.getElementById("searchInput"),
      agentSelect: document.getElementById("agentSelect"),
      globalBtn: document.getElementById("globalBtn"),
      projectBtn: document.getElementById("projectBtn"),
      projectPathGroup: document.getElementById("projectPathGroup"),
      projectPath: document.getElementById("projectPath"),
      refreshBtn: document.getElementById("refreshBtn"),
      count: document.getElementById("count"),
      status: document.getElementById("status"),
      list: document.getElementById("list"),
    };

    els.themeBtn.addEventListener("click", toggleTheme);
    els.introTab.addEventListener("click", () => setView("intro"));
    els.skillsTab.addEventListener("click", () => setView("skills"));
    els.agentSelect.addEventListener("change", () => setAgent(els.agentSelect.value));
    els.globalBtn.addEventListener("click", () => setScope("global"));
    els.projectBtn.addEventListener("click", () => setScope("project"));
    els.refreshBtn.addEventListener("click", () => loadSkills());
    els.searchInput.addEventListener("input", () => {
      state.query = els.searchInput.value;
      render();
    });
    els.projectPath.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        state.projectPath = els.projectPath.value;
        loadSkills();
      }
    });
    els.projectPath.addEventListener("blur", () => {
      if (state.scope === "project" && state.projectPath !== els.projectPath.value) {
        state.projectPath = els.projectPath.value;
        loadSkills();
      }
    });

    function toggleTheme() {
      setTheme(state.theme === "dark" ? "light" : "dark");
    }

    function setTheme(theme) {
      state.theme = theme;
      document.body.classList.toggle("dark", theme === "dark");
      els.themeLabel.textContent = theme === "dark" ? "Light" : "Dark";
      localStorage.setItem("agentic-skill-router-theme", theme);
    }

    function setView(view) {
      state.view = view;
      els.introView.hidden = view !== "intro";
      els.skillsView.hidden = view !== "skills";
      els.introTab.classList.toggle("active", view === "intro");
      els.skillsTab.classList.toggle("active", view === "skills");
    }

    function setAgent(agent) {
      state.agent = agent;
      els.agentSelect.value = agent;
      loadSkills();
    }

    function setScope(scope) {
      state.scope = scope;
      els.globalBtn.classList.toggle("active", scope === "global");
      els.projectBtn.classList.toggle("active", scope === "project");
      els.projectPathGroup.hidden = scope !== "project";
      if (scope === "project") els.projectPath.focus();
      loadSkills();
    }

    async function loadSkills() {
      state.projectPath = els.projectPath.value;
      const requestId = state.requestId + 1;
      state.requestId = requestId;
      if (state.scope === "project" && !state.projectPath.trim()) {
        state.skills = [];
        render();
        setStatus("");
        return;
      }
      setStatus("Loading...");
      const params = new URLSearchParams({ agent: state.agent, scope: state.scope });
      if (state.scope === "project") params.set("projectPath", state.projectPath);
      try {
        const res = await fetch("/api/skills?" + params.toString(), {
          headers: { "x-agentic-skill-router-token": mutationToken },
        });
        const data = await readResponse(res);
        if (requestId !== state.requestId) return;
        state.skills = data.skills || [];
        render();
        setStatus("");
      } catch (err) {
        if (requestId !== state.requestId) return;
        state.skills = [];
        render();
        setStatus(err.message, true);
      }
    }

    async function mutate(skill) {
      if (skill.outOfRoot) {
        const ok = window.confirm(
          "This skill is a symlink. Changing it will rename SKILL.md at the linked target, outside this agent's skills root. Continue?"
        );
        if (!ok) return;
      }
      state.busy.add(skill.instanceKey);
      render();
      const endpoint = skill.isDisabled ? "/api/skills/enable" : "/api/skills/disable";
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-agentic-skill-router-token": mutationToken,
          },
          body: JSON.stringify({
            agent: state.agent,
            scope: state.scope,
            projectPath: state.projectPath,
            instanceKey: skill.instanceKey,
          }),
        });
        const data = await readResponse(res);
        state.skills = data.skills || [];
        setStatus(skill.isDisabled ? "Enabled." : "Disabled.");
      } catch (err) {
        setStatus(err.message, true);
      } finally {
        state.busy.delete(skill.instanceKey);
        render();
      }
    }

    async function readResponse(res) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    }

    function render() {
      const visibleSkills = filteredSkills();
      els.count.textContent = countLabel(visibleSkills.length, state.skills.length);
      if (state.scope === "project" && !state.projectPath.trim()) {
        els.list.innerHTML = '<div class="empty">Enter a project path to inspect project skills.</div>';
        return;
      }
      if (visibleSkills.length === 0) {
        els.list.innerHTML = '<div class="empty">' + (state.skills.length === 0 ? "No skills found." : "No skills match this search.") + '</div>';
        return;
      }
      els.list.replaceChildren(renderListHeader(), ...visibleSkills.map(renderRow));
    }

    function filteredSkills() {
      const query = state.query.trim().toLowerCase();
      if (!query) return state.skills;
      return state.skills.filter((skill) => {
        const haystack = [
          skill.name,
          skill.id,
          skill.description,
          skill.type,
          skill.source,
          skill.pluginKey,
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(query);
      });
    }

    function countLabel(visible, total) {
      const count = visible === 1 ? "1 skill" : visible + " skills";
      const scope = state.scope === "project" ? "Project" : "Global";
      const agent = state.agent === "codex" ? "Codex" : "Claude Code";
      if (visible !== total) return count + " of " + total + " · " + agent + " · " + scope;
      return count + " · " + agent + " · " + scope;
    }

    function renderListHeader() {
      const header = document.createElement("div");
      header.className = "list-head";
      for (const label of ["Skill", "Description", "Type", "Action"]) {
        const span = document.createElement("span");
        span.textContent = label;
        header.appendChild(span);
      }
      return header;
    }

    function renderRow(skill) {
      const row = document.createElement("article");
      row.className = "row";

      const title = document.createElement("div");
      title.className = "name";
      title.textContent = skill.name || skill.id;
      const id = document.createElement("div");
      id.className = "id";
      id.textContent = skill.id;
      title.appendChild(id);

      const descWrap = document.createElement("div");
      descWrap.className = "desc-wrap";
      descWrap.tabIndex = 0;
      const desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = skill.description || "No description";
      const tooltip = document.createElement("div");
      tooltip.className = "tooltip";
      tooltip.textContent = skill.description || "No description";
      descWrap.append(desc, tooltip);

      const badge = document.createElement("div");
      badge.className = "badge" + (skill.isDisabled ? " disabled" : "");
      badge.textContent = skill.type || (skill.outOfRoot ? "symlink" : skill.source);

      const action = document.createElement("button");
      action.className = "action " + (skill.isDisabled ? "enable" : "disable");
      action.type = "button";
      action.textContent = skill.isDisabled ? "Enable" : "Disable";
      const canMutate = (skill.canDisable || canMutateSymlink(skill)) && !skill.conflict;
      action.disabled = state.busy.has(skill.instanceKey) || !canMutate;
      action.title = actionTitle(skill, action.textContent);
      action.addEventListener("click", () => mutate(skill));

      row.append(title, descWrap, badge, action);
      return row;
    }

    function actionTitle(skill, label) {
      if (skill.conflict) return "Resolve conflicting skill files first";
      if (skill.outOfRoot && skill.source === "builtin") return "Protected symlink";
      if (skill.outOfRoot) return "Symlink: changes apply to the linked target";
      if (!skill.canDisable) return "Protected skill";
      return label;
    }

    function canMutateSymlink(skill) {
      return skill.outOfRoot && skill.source !== "builtin";
    }

    function setStatus(message, isError = false) {
      els.status.textContent = message;
      els.status.classList.toggle("error", isError);
    }

    els.agentSelect.value = state.agent;
    setTheme(state.theme);
    setView(state.view);
    loadSkills();
  </script>
</body>
</html>`;
}
