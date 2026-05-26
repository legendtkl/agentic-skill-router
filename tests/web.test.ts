import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWebServer } from "../src/commands/web.ts";

interface SkillRecord {
  id: string;
  instanceKey: string;
  name: string;
  source: string;
  type: string;
  isDisabled: boolean;
  canDisable: boolean;
  outOfRoot: boolean;
}

interface SkillsResponse {
  host: "claude-code" | "codex";
  scope: "global" | "project";
  projectPath: string | null;
  skills: SkillRecord[];
}

async function makeWebFixture(): Promise<{
  root: string;
  claudeHome: string;
  codexHome: string;
  agentsHome: string;
  codexAdminSkillsRoot: string;
  externalSkillsRoot: string;
  stateDir: string;
  projectRoot: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-web-"));
  const claudeHome = join(root, ".claude");
  const codexHome = join(root, ".codex");
  const agentsHome = join(root, ".agents");
  const codexAdminSkillsRoot = join(root, "etc", "codex", "skills");
  const externalSkillsRoot = join(root, "shared-skills");
  const stateDir = join(root, ".agentic-skill-router");
  const projectRoot = join(root, "project");

  await mkdir(join(claudeHome, "skills", "global-skill"), { recursive: true });
  await writeFile(
    join(claudeHome, "skills", "global-skill", "SKILL.md"),
    "---\nname: global-skill\ndescription: Global skill description long enough for hover display\n---\n",
  );
  await mkdir(join(externalSkillsRoot, "linked-skill"), { recursive: true });
  await writeFile(
    join(externalSkillsRoot, "linked-skill", "SKILL.md"),
    "---\nname: linked-skill\ndescription: Symlinked skill description\n---\n",
  );
  await symlink(join(externalSkillsRoot, "linked-skill"), join(claudeHome, "skills", "linked-skill"));

  await mkdir(join(codexHome, "skills", "codex-skill"), { recursive: true });
  await writeFile(
    join(codexHome, "skills", "codex-skill", "SKILL.md"),
    "---\nname: codex-skill\ndescription: Codex global skill\n---\n",
  );
  await mkdir(join(externalSkillsRoot, "admin-linked"), { recursive: true });
  await writeFile(
    join(externalSkillsRoot, "admin-linked", "SKILL.md"),
    "---\nname: admin-linked\ndescription: Protected admin symlink\n---\n",
  );
  await mkdir(codexAdminSkillsRoot, { recursive: true });
  await symlink(join(externalSkillsRoot, "admin-linked"), join(codexAdminSkillsRoot, "admin-linked"));

  await mkdir(join(projectRoot, ".git"), { recursive: true });
  await mkdir(join(projectRoot, ".claude", "skills", "project-skill"), { recursive: true });
  await writeFile(
    join(projectRoot, ".claude", "skills", "project-skill", "SKILL.md"),
    "---\nname: project-skill\ndescription: Project skill description\n---\n",
  );

  await mkdir(stateDir, { recursive: true });
  return {
    root,
    claudeHome,
    codexHome,
    agentsHome,
    codexAdminSkillsRoot,
    externalSkillsRoot,
    stateDir,
    projectRoot,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function withEnv(env: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const prior = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    prior.set(key, process.env[key]);
    process.env[key] = env[key];
  }
  return fn().finally(() => {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readMutationToken(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers: extraHeaders });
  assert.equal(res.status, 200);
  const page = await res.text();
  const match = page.match(/<meta name="agentic-skill-router-token" content="([^"]+)">/);
  assert.ok(match);
  return match[1]!;
}

function mutationHeaders(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-agentic-skill-router-token": token,
  };
}

function basicAuthHeader(credential: { username: string; password: string } | null): Record<string, string> {
  if (!credential) return {};
  const encoded = Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64");
  return { authorization: `Basic ${encoded}` };
}

test("web UI serves logo asset and references it from the page", async () => {
  const { server, url } = await startWebServer({ hostName: "claude-code", port: 0 });
  try {
    const pageRes = await fetch(url);
    assert.equal(pageRes.status, 200);
    const page = await pageRes.text();
    assert.match(page, /<meta name="agentic-skill-router-token" content="[^"]+">/);
    assert.match(page, /<link rel="icon" type="image\/png" href="\/logo\.png">/);
    assert.match(page, /<img class="brand-mark" src="\/logo\.png"/);

    const logoRes = await fetch(`${url}/logo.png`);
    assert.equal(logoRes.status, 200);
    assert.equal(logoRes.headers.get("content-type"), "image/png");
    const logo = new Uint8Array(await logoRes.arrayBuffer());
    assert.deepEqual([...logo.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  } finally {
    await closeServer(server);
  }
});

test("web API lists global skills by default and project skills for a supplied path", async () => {
  const fixture = await makeWebFixture();
  try {
    await withEnv(
      {
        CLAUDE_HOME: fixture.claudeHome,
        CODEX_HOME: fixture.codexHome,
        AGENTS_HOME: fixture.agentsHome,
        CODEX_ADMIN_SKILLS_ROOT: fixture.codexAdminSkillsRoot,
        AGENTIC_SKILL_ROUTER_STATE_DIR: fixture.stateDir,
      },
      async () => {
        const { server, url } = await startWebServer({ hostName: "claude-code", port: 0 });
        try {
          const globalRes = await fetch(`${url}/api/skills?scope=global`);
          assert.equal(globalRes.status, 200);
          const globalData = await globalRes.json() as SkillsResponse;
          assert.equal(globalData.host, "claude-code");
          assert.equal(globalData.scope, "global");
          assert.equal(globalData.projectPath, null);
          assert.ok(globalData.skills.some((skill) => skill.id === "user:global-skill"));
          assert.ok(!globalData.skills.some((skill) => skill.source === "project"));
          const linked = globalData.skills.find((skill) => skill.id === "user:linked-skill");
          assert.ok(linked);
          assert.equal(linked.type, "symlink");
          assert.equal(linked.outOfRoot, true);
          assert.equal(linked.canDisable, false);

          const projectRes = await fetch(
            `${url}/api/skills?scope=project&projectPath=${encodeURIComponent(fixture.projectRoot)}`,
          );
          assert.equal(projectRes.status, 200);
          const projectData = await projectRes.json() as SkillsResponse;
          assert.equal(projectData.host, "claude-code");
          assert.equal(projectData.scope, "project");
          assert.equal(projectData.projectPath, fixture.projectRoot);
          assert.deepEqual(projectData.skills.map((skill) => skill.id), ["project:claude:.:project-skill"]);
          const codexRes = await fetch(`${url}/api/skills?agent=codex&scope=global`);
          assert.equal(codexRes.status, 200);
          const codexData = await codexRes.json() as SkillsResponse;
          assert.equal(codexData.host, "codex");
          assert.ok(codexData.skills.some((skill) => skill.id === "user:codex:codex-skill"));
          assert.ok(!codexData.skills.some((skill) => skill.id === "user:global-skill"));
        } finally {
          await closeServer(server);
        }
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test("web API disables a selected skill by instance key", async () => {
  const fixture = await makeWebFixture();
  try {
    await withEnv(
      {
        CLAUDE_HOME: fixture.claudeHome,
        CODEX_HOME: fixture.codexHome,
        AGENTS_HOME: fixture.agentsHome,
        CODEX_ADMIN_SKILLS_ROOT: fixture.codexAdminSkillsRoot,
        AGENTIC_SKILL_ROUTER_STATE_DIR: fixture.stateDir,
      },
      async () => {
        const { server, url } = await startWebServer({ hostName: "claude-code", port: 0 });
        try {
          const token = await readMutationToken(url);
          const listRes = await fetch(`${url}/api/skills?scope=global`);
          const listData = await listRes.json() as SkillsResponse;
          const target = listData.skills.find((skill) => skill.id === "user:global-skill");
          assert.ok(target);

          const disableRes = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: mutationHeaders(token),
            body: JSON.stringify({
              scope: "global",
              instanceKey: target!.instanceKey,
            }),
          });
          assert.equal(disableRes.status, 200);
          const disableData = await disableRes.json() as { skill: SkillRecord };
          assert.equal(disableData.skill.isDisabled, true);

          await stat(join(fixture.claudeHome, "skills", "global-skill", "SKILL.md.agentic-skill-router-disabled"));

          const codexListRes = await fetch(`${url}/api/skills?agent=codex&scope=global`);
          const codexListData = await codexListRes.json() as SkillsResponse;
          const codexTarget = codexListData.skills.find((skill) => skill.id === "user:codex:codex-skill");
          assert.ok(codexTarget);

          const codexDisableRes = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: mutationHeaders(token),
            body: JSON.stringify({
              agent: "codex",
              scope: "global",
              instanceKey: codexTarget!.instanceKey,
            }),
          });
          assert.equal(codexDisableRes.status, 200);
          const codexDisableData = await codexDisableRes.json() as { skill: SkillRecord };
          assert.equal(codexDisableData.skill.isDisabled, true);

          await stat(join(fixture.codexHome, "skills", "codex-skill", "SKILL.md.agentic-skill-router-disabled"));

          const linkedListRes = await fetch(`${url}/api/skills?scope=global`);
          const linkedListData = await linkedListRes.json() as SkillsResponse;
          const linkedTarget = linkedListData.skills.find((skill) => skill.id === "user:linked-skill");
          assert.ok(linkedTarget);
          assert.equal(linkedTarget!.type, "symlink");
          assert.equal(linkedTarget!.outOfRoot, true);

          const linkedDisableRes = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: mutationHeaders(token),
            body: JSON.stringify({
              scope: "global",
              instanceKey: linkedTarget!.instanceKey,
            }),
          });
          assert.equal(linkedDisableRes.status, 200);
          const linkedDisableData = await linkedDisableRes.json() as { skill: SkillRecord };
          assert.equal(linkedDisableData.skill.isDisabled, true);
          await stat(join(fixture.externalSkillsRoot, "linked-skill", "SKILL.md.agentic-skill-router-disabled"));

          const linkedEnableRes = await fetch(`${url}/api/skills/enable`, {
            method: "POST",
            headers: mutationHeaders(token),
            body: JSON.stringify({
              scope: "global",
              instanceKey: linkedTarget!.instanceKey,
            }),
          });
          assert.equal(linkedEnableRes.status, 200);
          await stat(join(fixture.externalSkillsRoot, "linked-skill", "SKILL.md"));
        } finally {
          await closeServer(server);
        }
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test("web API requires mutation token and JSON content type", async () => {
  const fixture = await makeWebFixture();
  try {
    await withEnv(
      {
        CLAUDE_HOME: fixture.claudeHome,
        CODEX_HOME: fixture.codexHome,
        AGENTS_HOME: fixture.agentsHome,
        CODEX_ADMIN_SKILLS_ROOT: fixture.codexAdminSkillsRoot,
        AGENTIC_SKILL_ROUTER_STATE_DIR: fixture.stateDir,
      },
      async () => {
        const { server, url } = await startWebServer({ hostName: "claude-code", port: 0 });
        try {
          const token = await readMutationToken(url);
          const listRes = await fetch(`${url}/api/skills?scope=global`);
          const listData = await listRes.json() as SkillsResponse;
          const target = listData.skills.find((skill) => skill.id === "user:global-skill");
          assert.ok(target);

          const missingToken = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scope: "global", instanceKey: target!.instanceKey }),
          });
          assert.equal(missingToken.status, 403);

          const wrongType = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: { "content-type": "text/plain", "x-agentic-skill-router-token": token },
            body: JSON.stringify({ scope: "global", instanceKey: target!.instanceKey }),
          });
          assert.equal(wrongType.status, 415);

          await stat(join(fixture.claudeHome, "skills", "global-skill", "SKILL.md"));
        } finally {
          await closeServer(server);
        }
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test("startWebServer refuses to bind a non-loopback interface without --dangerously-bind-public", async () => {
  await assert.rejects(
    () => startWebServer({ hostName: "claude-code", port: 0, bind: "0.0.0.0" }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /refusing to bind/i);
      assert.match(err.message, /--dangerously-bind-public/);
      return true;
    },
  );
});

test("startWebServer refuses an empty bind string (Node treats it as the wildcard)", async () => {
  await assert.rejects(
    () => startWebServer({ hostName: "claude-code", port: 0, bind: "" }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /refusing to bind/i);
      assert.match(err.message, /--dangerously-bind-public/);
      return true;
    },
  );
});

test("startWebServer with --dangerously-bind-public warns, requires basic auth, and gates /api/skills reads on the token", async () => {
  const fixture = await makeWebFixture();
  const originalWrite = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  (process.stderr as unknown as { write: (chunk: string | Uint8Array) => boolean }).write = (chunk) => {
    captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  try {
    await withEnv(
      {
        CLAUDE_HOME: fixture.claudeHome,
        CODEX_HOME: fixture.codexHome,
        AGENTS_HOME: fixture.agentsHome,
        CODEX_ADMIN_SKILLS_ROOT: fixture.codexAdminSkillsRoot,
        AGENTIC_SKILL_ROUTER_STATE_DIR: fixture.stateDir,
      },
      async () => {
        const { server, url, basicAuth } = await startWebServer({
          hostName: "claude-code",
          port: 0,
          bind: "0.0.0.0",
          dangerouslyBindPublic: true,
        });
        try {
          const warning = captured.join("");
          assert.match(warning, /WARNING: --dangerously-bind-public is set\./);
          assert.match(warning, /Anyone who can reach this port/);
          assert.ok(basicAuth);
          assert.match(warning, /HTTP Basic auth is required/);
          assert.match(warning, new RegExp(`username: ${basicAuth!.username}`));
          assert.match(warning, new RegExp(`password: ${basicAuth!.password.replace(/[-/\\]/g, "\\$&")}`));

          // GET / without basic auth must 401 (token in HTML is no longer free for LAN attackers).
          const noAuthRoot = await fetch(url);
          assert.equal(noAuthRoot.status, 401);
          assert.match(noAuthRoot.headers.get("www-authenticate") ?? "", /^Basic/);

          // GET /api/skills without basic auth must also 401.
          const noAuthApi = await fetch(`${url}/api/skills?scope=global`);
          assert.equal(noAuthApi.status, 401);

          const authHeaders = basicAuthHeader(basicAuth);
          const badUserAuthHeaders = basicAuthHeader({
            username: `${basicAuth!.username}-bad`,
            password: basicAuth!.password,
          });

          const badUserAuthApi = await fetch(`${url}/api/skills?scope=global`, { headers: badUserAuthHeaders });
          assert.equal(badUserAuthApi.status, 401);

          // With basic auth but without the mutation token, /api/skills still 403.
          const noToken = await fetch(`${url}/api/skills?scope=global`, { headers: authHeaders });
          assert.equal(noToken.status, 403);

          const token = await readMutationToken(url, authHeaders);
          const withToken = await fetch(`${url}/api/skills?scope=global`, {
            headers: { ...authHeaders, "x-agentic-skill-router-token": token },
          });
          assert.equal(withToken.status, 200);
          const data = await withToken.json() as SkillsResponse;
          assert.ok(data.skills.some((skill) => skill.id === "user:global-skill"));
        } finally {
          await closeServer(server);
        }
      },
    );
  } finally {
    (process.stderr as unknown as { write: typeof originalWrite }).write = originalWrite;
    await fixture.cleanup();
  }
});

test("public-bound mutation requests require a matching Origin header", async () => {
  const fixture = await makeWebFixture();
  const originalWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (chunk: string | Uint8Array) => boolean }).write = () => true;
  try {
    await withEnv(
      {
        CLAUDE_HOME: fixture.claudeHome,
        CODEX_HOME: fixture.codexHome,
        AGENTS_HOME: fixture.agentsHome,
        CODEX_ADMIN_SKILLS_ROOT: fixture.codexAdminSkillsRoot,
        AGENTIC_SKILL_ROUTER_STATE_DIR: fixture.stateDir,
      },
      async () => {
        const { server, url, basicAuth } = await startWebServer({
          hostName: "claude-code",
          port: 0,
          bind: "0.0.0.0",
          dangerouslyBindPublic: true,
        });
        try {
          const authHeaders = basicAuthHeader(basicAuth);
          const token = await readMutationToken(url, authHeaders);
          const parsedUrl = new URL(url);
          const listRes = await fetch(`${url}/api/skills?scope=global`, {
            headers: { ...authHeaders, "x-agentic-skill-router-token": token },
          });
          assert.equal(listRes.status, 200);
          const listData = await listRes.json() as SkillsResponse;
          const target = listData.skills.find((skill) => skill.id === "user:global-skill");
          assert.ok(target);

          const badOrigin = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: {
              ...authHeaders,
              ...mutationHeaders(token),
              origin: "http://evil.example.com",
            },
            body: JSON.stringify({ scope: "global", instanceKey: target!.instanceKey }),
          });
          assert.equal(badOrigin.status, 403);
          const badBody = await badOrigin.json() as { error: string };
          assert.match(badBody.error, /Origin/);

          // Cross-port Origin (same hostname, different port) must also be rejected.
          const crossPortOrigin = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: {
              ...authHeaders,
              ...mutationHeaders(token),
              origin: `${parsedUrl.protocol}//${parsedUrl.hostname}:1`,
            },
            body: JSON.stringify({ scope: "global", instanceKey: target!.instanceKey }),
          });
          assert.equal(crossPortOrigin.status, 403);

          // Bare-host Origin (no port) must be rejected even though the hostname matches.
          const portlessOrigin = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: {
              ...authHeaders,
              ...mutationHeaders(token),
              origin: `${parsedUrl.protocol}//${parsedUrl.hostname}`,
            },
            body: JSON.stringify({ scope: "global", instanceKey: target!.instanceKey }),
          });
          assert.equal(portlessOrigin.status, 403);

          // SKILL.md must still be on disk (not renamed to disabled).
          await stat(join(fixture.claudeHome, "skills", "global-skill", "SKILL.md"));

          const goodOrigin = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: {
              ...authHeaders,
              ...mutationHeaders(token),
              origin: `${parsedUrl.protocol}//${parsedUrl.host}`,
            },
            body: JSON.stringify({ scope: "global", instanceKey: target!.instanceKey }),
          });
          assert.equal(goodOrigin.status, 200);
          await stat(join(fixture.claudeHome, "skills", "global-skill", "SKILL.md.agentic-skill-router-disabled"));
        } finally {
          await closeServer(server);
        }
      },
    );
  } finally {
    (process.stderr as unknown as { write: typeof originalWrite }).write = originalWrite;
    await fixture.cleanup();
  }
});

test("loopback-bound mutation requests still succeed without Origin/Referer", async () => {
  const fixture = await makeWebFixture();
  try {
    await withEnv(
      {
        CLAUDE_HOME: fixture.claudeHome,
        CODEX_HOME: fixture.codexHome,
        AGENTS_HOME: fixture.agentsHome,
        CODEX_ADMIN_SKILLS_ROOT: fixture.codexAdminSkillsRoot,
        AGENTIC_SKILL_ROUTER_STATE_DIR: fixture.stateDir,
      },
      async () => {
        const { server, url } = await startWebServer({ hostName: "claude-code", port: 0 });
        try {
          const token = await readMutationToken(url);
          const listRes = await fetch(`${url}/api/skills?scope=global`);
          assert.equal(listRes.status, 200);
          const listData = await listRes.json() as SkillsResponse;
          const target = listData.skills.find((skill) => skill.id === "user:global-skill");
          assert.ok(target);

          // node fetch sends a Host header but no Origin or Referer for this request.
          // The loopback default must accept it.
          const disableRes = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: mutationHeaders(token),
            body: JSON.stringify({ scope: "global", instanceKey: target!.instanceKey }),
          });
          assert.equal(disableRes.status, 200);
          await stat(join(fixture.claudeHome, "skills", "global-skill", "SKILL.md.agentic-skill-router-disabled"));
        } finally {
          await closeServer(server);
        }
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test("web API rejects protected skill mutations as client errors", async () => {
  const fixture = await makeWebFixture();
  try {
    await withEnv(
      {
        CLAUDE_HOME: fixture.claudeHome,
        CODEX_HOME: fixture.codexHome,
        AGENTS_HOME: fixture.agentsHome,
        CODEX_ADMIN_SKILLS_ROOT: fixture.codexAdminSkillsRoot,
        AGENTIC_SKILL_ROUTER_STATE_DIR: fixture.stateDir,
      },
      async () => {
        const { server, url } = await startWebServer({ hostName: "claude-code", port: 0 });
        try {
          const token = await readMutationToken(url);
          const listRes = await fetch(`${url}/api/skills?scope=global`);
          const listData = await listRes.json() as SkillsResponse;
          const target = listData.skills.find((skill) => skill.id === "builtin:init");
          assert.ok(target);

          const disableRes = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: mutationHeaders(token),
            body: JSON.stringify({
              scope: "global",
              instanceKey: target!.instanceKey,
            }),
          });
          assert.equal(disableRes.status, 403);
          const body = await disableRes.json() as { error: string };
          assert.match(body.error, /protected/);

          const codexListRes = await fetch(`${url}/api/skills?agent=codex&scope=global`);
          const codexListData = await codexListRes.json() as SkillsResponse;
          const adminSymlink = codexListData.skills.find((skill) => skill.id === "builtin:codex-admin:admin-linked");
          assert.ok(adminSymlink);
          assert.equal(adminSymlink!.type, "symlink");
          assert.equal(adminSymlink!.outOfRoot, true);
          assert.equal(adminSymlink!.canDisable, false);

          const adminDisableRes = await fetch(`${url}/api/skills/disable`, {
            method: "POST",
            headers: mutationHeaders(token),
            body: JSON.stringify({
              agent: "codex",
              scope: "global",
              instanceKey: adminSymlink!.instanceKey,
            }),
          });
          assert.equal(adminDisableRes.status, 403);
          const adminBody = await adminDisableRes.json() as { error: string };
          assert.match(adminBody.error, /protected/);
          await stat(join(fixture.externalSkillsRoot, "admin-linked", "SKILL.md"));
        } finally {
          await closeServer(server);
        }
      },
    );
  } finally {
    await fixture.cleanup();
  }
});
