import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { atomicWrite } from "../scripts/lib/atomic-write.mjs";
import {
  PLUGIN_KEY,
  PLUGIN_NAME,
  MARKETPLACE,
  isPlainObject,
  stripProxy,
} from "../scripts/lib/common.mjs";
import {
  HOST_ENTRY_ASSET_DIRS,
  RUNTIME_ASSET_DIRS,
  cleanupOldVersions,
  copyPluginAssets,
  copyRuntimeAssets,
  normalizeManifestSkills,
  warnAboutDisabledSkills,
  writeHostWrapper,
} from "../scripts/lib/plugin-install.mjs";
import { setPluginEnabled } from "../scripts/lib/toml-plugin.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);

test("common: PLUGIN_KEY is composed from PLUGIN_NAME and MARKETPLACE", () => {
  assert.equal(PLUGIN_NAME, "skill-router");
  assert.equal(MARKETPLACE, "local");
  assert.equal(PLUGIN_KEY, "skill-router@local");
});

test("common: stripProxy drops all four proxy env vars and preserves the rest", () => {
  const env = {
    HOME: "/home/test",
    HTTP_PROXY: "http://x:1",
    HTTPS_PROXY: "http://x:2",
    http_proxy: "http://x:3",
    https_proxy: "http://x:4",
    PATH: "/usr/bin",
  };
  const out = stripProxy(env);
  assert.equal(out.HTTP_PROXY, undefined);
  assert.equal(out.HTTPS_PROXY, undefined);
  assert.equal(out.http_proxy, undefined);
  assert.equal(out.https_proxy, undefined);
  assert.equal(out.HOME, "/home/test");
  assert.equal(out.PATH, "/usr/bin");
  // Source env must not be mutated.
  assert.equal(env.HTTP_PROXY, "http://x:1");
});

test("common: isPlainObject rejects arrays, null, and primitives", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(undefined), false);
  assert.equal(isPlainObject("foo"), false);
  assert.equal(isPlainObject(42), false);
});

test("atomicWrite creates parent directories and writes content", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-atomic-"));
  try {
    const path = join(root, "a/b/c/file.json");
    await atomicWrite(path, "{\"hello\":true}\n");
    assert.equal(await readFile(path, "utf8"), "{\"hello\":true}\n");
    // No stray .tmp files should remain after a successful write.
    const siblings = await readdir(dirname(path));
    assert.deepEqual(siblings.sort(), ["file.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomicWrite overwrites existing files in place", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-atomic-overwrite-"));
  try {
    const path = join(root, "file.txt");
    await writeFile(path, "old");
    await atomicWrite(path, "new");
    assert.equal(await readFile(path, "utf8"), "new");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normalizeManifestSkills rewrites skills field to ./skills/", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-normalize-"));
  try {
    const manifestPath = join(root, "plugin.json");
    await writeFile(
      manifestPath,
      JSON.stringify({ name: "x", version: "1.0.0", skills: "../../skills/" }, null, 2),
    );
    await normalizeManifestSkills(manifestPath);
    const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(parsed.skills, "./skills/");
    assert.equal(parsed.name, "x", "unrelated fields are preserved");
    assert.equal(parsed.version, "1.0.0", "unrelated fields are preserved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("copyPluginAssets copies manifest + host entry dirs only", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-copy-"));
  try {
    const repoRoot = join(root, "repo");
    const pluginSrc = join(repoRoot, "plugins/host");
    const installPath = join(root, "cache", "1.0.0");

    // Fabricate a repo layout
    await mkdir(join(pluginSrc, ".host-plugin"), { recursive: true });
    await writeFile(
      join(pluginSrc, ".host-plugin/plugin.json"),
      JSON.stringify({ name: "x", version: "1.0.0", skills: "../../skills/" }, null, 2),
    );
    for (const dir of [...HOST_ENTRY_ASSET_DIRS, ...RUNTIME_ASSET_DIRS]) {
      await mkdir(join(repoRoot, dir), { recursive: true });
    }
    await writeFile(join(repoRoot, "bin", "skill-router"), "#!/bin/sh\necho hi\n", { mode: 0o644 });
    await writeFile(join(repoRoot, "lib", "skill-router.mjs"), "// bundle\n");
    await writeFile(join(repoRoot, "skills", "stub.txt"), "stub\n");

    // Pre-create installPath with junk to confirm we wipe it.
    await mkdir(installPath, { recursive: true });
    await writeFile(join(installPath, "stale.txt"), "stale");

    await copyPluginAssets({ pluginSrc, repoRoot, installPath });

    assert.equal(
      JSON.parse(await readFile(join(installPath, ".host-plugin/plugin.json"), "utf8")).name,
      "x",
      "plugin manifest copied",
    );
    for (const dir of HOST_ENTRY_ASSET_DIRS) {
      const entries = await readdir(join(installPath, dir));
      assert.ok(entries.length > 0, `${dir} copied with content`);
    }
    await assert.rejects(stat(join(installPath, "bin")), /ENOENT/);
    await assert.rejects(stat(join(installPath, "lib")), /ENOENT/);
    try {
      await stat(join(installPath, "stale.txt"));
      assert.fail("install path should have been wiped before copy");
    } catch {
      // expected
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("copyRuntimeAssets copies shared runtime dirs and marks bin executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-runtime-"));
  try {
    const repoRoot = join(root, "repo");
    const runtimePath = join(root, "runtime", "1.0.0");

    await mkdir(join(repoRoot, "bin"), { recursive: true });
    await mkdir(join(repoRoot, "lib"), { recursive: true });
    await writeFile(join(repoRoot, "bin", "skill-router"), "#!/bin/sh\necho hi\n", { mode: 0o644 });
    await writeFile(join(repoRoot, "lib", "skill-router.mjs"), "// bundle\n");
    await mkdir(runtimePath, { recursive: true });
    await writeFile(join(runtimePath, "stale.txt"), "stale");

    await copyRuntimeAssets({ repoRoot, runtimePath });

    for (const dir of RUNTIME_ASSET_DIRS) {
      const entries = await readdir(join(runtimePath, dir));
      assert.ok(entries.length > 0, `${dir} copied with content`);
    }
    const binStat = await stat(join(runtimePath, "bin", "skill-router"));
    assert.ok((binStat.mode & 0o111) !== 0, "runtime bin is executable");
    await assert.rejects(stat(join(runtimePath, "stale.txt")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeHostWrapper delegates to shared runtime with host and asset root", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-wrapper-"));
  try {
    const wrapperPath = join(root, "plugin", "bin", "skill-router");
    await writeHostWrapper({
      wrapperPath,
      runtimeBin: "/tmp/runtime bin/skill-router",
      hostName: "codex",
      assetRoot: "/tmp/plugin assets",
    });

    const content = await readFile(wrapperPath, "utf8");
    assert.match(content, /^#!\/usr\/bin\/env sh/);
    assert.match(content, /export SKILL_ROUTER_HOST='codex'/);
    assert.match(content, /export SKILL_ROUTER_ASSET_ROOT='\/tmp\/plugin assets'/);
    assert.match(content, /exec '\/tmp\/runtime bin\/skill-router' "\$@"/);
    const wrapperStat = await stat(wrapperPath);
    assert.ok((wrapperStat.mode & 0o111) !== 0, "wrapper is executable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanupOldVersions removes siblings but keeps the current version", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-cleanup-"));
  try {
    const cacheRoot = join(root, "cache");
    await mkdir(join(cacheRoot, "1.0.0"), { recursive: true });
    await mkdir(join(cacheRoot, "0.9.0"), { recursive: true });
    await mkdir(join(cacheRoot, "0.8.0"), { recursive: true });

    const messages: string[] = [];
    await cleanupOldVersions(cacheRoot, "1.0.0", { log: (m) => messages.push(m) });

    const remaining = (await readdir(cacheRoot)).sort();
    assert.deepEqual(remaining, ["1.0.0"]);
    assert.ok(messages.some((m) => /cleaned cache: 0\.8\.0, 0\.9\.0/.test(m)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanupOldVersions with keepOld preserves siblings", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-cleanup-keep-"));
  try {
    const cacheRoot = join(root, "cache");
    await mkdir(join(cacheRoot, "1.0.0"), { recursive: true });
    await mkdir(join(cacheRoot, "0.9.0"), { recursive: true });

    const messages: string[] = [];
    await cleanupOldVersions(cacheRoot, "1.0.0", { keepOld: true, log: (m) => messages.push(m) });

    const remaining = (await readdir(cacheRoot)).sort();
    assert.deepEqual(remaining, ["0.9.0", "1.0.0"]);
    assert.ok(messages.some((m) => /kept old versions: 0\.9\.0/.test(m)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanupOldVersions only unlinks symlinks pointing outside cache root", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-cleanup-symlink-"));
  try {
    const cacheRoot = join(root, "cache");
    const outside = join(root, "outside");
    await mkdir(cacheRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    const sentinel = join(outside, "keep.txt");
    await writeFile(sentinel, "must survive");

    const linkPath = join(cacheRoot, "0.0.1");
    await symlink(outside, linkPath, "dir");

    await cleanupOldVersions(cacheRoot, "1.0.0", { log: () => {} });

    // symlink gone but the outside tree must survive.
    try {
      await stat(linkPath);
      assert.fail("symlink should have been removed");
    } catch {
      // expected
    }
    assert.equal((await readFile(sentinel, "utf8")), "must survive");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanupOldVersions is a no-op when cache root does not exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-cleanup-missing-"));
  try {
    const messages: string[] = [];
    await cleanupOldVersions(join(root, "nope"), "1.0.0", { log: (m) => messages.push(m) });
    assert.equal(messages.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("warnAboutDisabledSkills emits a warning when state has disabled records", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-warn-"));
  try {
    const statePath = join(root, "state.json");
    await writeFile(
      statePath,
      JSON.stringify({
        disabledSkills: [
          { id: "user:foo", originalPath: "/a", disabledAt: "now" },
          { id: "user:bar", originalPath: "/b", disabledAt: "now" },
        ],
      }),
    );
    const messages: string[] = [];
    await warnAboutDisabledSkills({
      statePath,
      warnPrefix: "⚠",
      formatRestoreHint: (records) => records.map((r) => `  enable ${r.id}`),
      log: (m) => messages.push(m),
    });
    const joined = messages.join("\n");
    assert.match(joined, /⚠ 2 skill\(s\) are still disabled/);
    assert.match(joined, /enable user:foo/);
    assert.match(joined, /enable user:bar/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("warnAboutDisabledSkills is silent when state file is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-warn-absent-"));
  try {
    const messages: string[] = [];
    await warnAboutDisabledSkills({
      statePath: join(root, "missing.json"),
      warnPrefix: "⚠",
      formatRestoreHint: () => ["nope"],
      log: (m) => messages.push(m),
    });
    assert.equal(messages.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("warnAboutDisabledSkills reportMalformed surfaces invalid records", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-warn-malformed-"));
  try {
    const statePath = join(root, "state.json");
    await writeFile(
      statePath,
      JSON.stringify({
        disabledSkills: [
          { id: "user:foo" },
          { id: "" },
          { notAnId: "x" },
          "string-not-record",
        ],
      }),
    );
    const messages: string[] = [];
    await warnAboutDisabledSkills({
      statePath,
      warnPrefix: "⚠",
      reportMalformed: true,
      formatRestoreHint: (records) => records.map((r) => `enable ${r.id}`),
      log: (m) => messages.push(m),
    });
    const joined = messages.join("\n");
    assert.match(joined, /⚠ 3 malformed disable record\(s\) ignored/);
    assert.match(joined, /⚠ 1 skill\(s\) are still disabled/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("warnAboutDisabledSkills without reportMalformed stays quiet about invalid records", async () => {
  const root = await mkdtemp(join(tmpdir(), "sr-warn-no-malformed-"));
  try {
    const statePath = join(root, "state.json");
    await writeFile(
      statePath,
      JSON.stringify({
        disabledSkills: [{ id: "" }, { notAnId: "x" }],
      }),
    );
    const messages: string[] = [];
    await warnAboutDisabledSkills({
      statePath,
      warnPrefix: "!",
      formatRestoreHint: () => ["should not appear"],
      log: (m) => messages.push(m),
    });
    assert.equal(messages.length, 0, "no records to warn about, no output");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setPluginEnabled adds a stanza when none exists", () => {
  const out = setPluginEnabled("", "skill-router@local", true);
  assert.equal(out, "[plugins.\"skill-router@local\"]\nenabled = true\n");
});

test("setPluginEnabled preserves preceding content with a blank-line gap", () => {
  const out = setPluginEnabled(
    "model = \"gpt-5\"\n\n[plugins.\"other@local\"]\nenabled = true\n",
    "skill-router@local",
    true,
  );
  assert.match(out, /model = "gpt-5"/);
  assert.match(out, /\[plugins\."other@local"\]/);
  assert.match(out, /\[plugins\."skill-router@local"\]\nenabled = true\n$/);
});

test("setPluginEnabled flips an existing enabled flag in place", () => {
  const out = setPluginEnabled(
    "[plugins.\"skill-router@local\"]\nenabled = true\n\n[other]\nx = 1\n",
    "skill-router@local",
    false,
  );
  const stanzaLines = out
    .split(/\r?\n/)
    .filter((l) => /^enabled\s*=/.test(l));
  assert.deepEqual(stanzaLines, ["enabled = false"]);
  assert.match(out, /\[other\]/);
  assert.match(out, /x = 1/);
});

test("setPluginEnabled is idempotent for repeated writes", () => {
  let cfg = "";
  cfg = setPluginEnabled(cfg, "skill-router@local", true);
  cfg = setPluginEnabled(cfg, "skill-router@local", true);
  const headers = cfg.match(/\[plugins\."skill-router@local"\]/g) ?? [];
  const enableds = cfg.match(/enabled = true/g) ?? [];
  assert.equal(headers.length, 1);
  assert.equal(enableds.length, 1);
});

test("install scripts route through the shared lib helpers", async () => {
  const claudeInstall = await readFile(join(REPO_ROOT, "scripts", "install.mjs"), "utf8");
  const codexInstall = await readFile(join(REPO_ROOT, "scripts", "install-codex.mjs"), "utf8");
  const claudeUninstall = await readFile(join(REPO_ROOT, "scripts", "uninstall.mjs"), "utf8");
  const codexUninstall = await readFile(join(REPO_ROOT, "scripts", "uninstall-codex.mjs"), "utf8");

  for (const content of [claudeInstall, codexInstall]) {
    assert.match(content, /from "\.\/lib\/atomic-write\.mjs"/);
    assert.match(content, /from "\.\/lib\/common\.mjs"/);
    assert.match(content, /from "\.\/lib\/plugin-install\.mjs"/);
    assert.match(content, /copyPluginAssets/);
    assert.match(content, /ensureBuild/);
    assert.match(content, /cleanupOldVersions/);
  }
  for (const content of [claudeUninstall, codexUninstall]) {
    assert.match(content, /from "\.\/lib\/atomic-write\.mjs"/);
    assert.match(content, /from "\.\/lib\/common\.mjs"/);
    assert.match(content, /warnAboutDisabledSkills/);
  }
  // Only the Codex scripts depend on the TOML helper.
  assert.match(codexInstall, /from "\.\/lib\/toml-plugin\.mjs"/);
  assert.match(codexUninstall, /from "\.\/lib\/toml-plugin\.mjs"/);
  assert.doesNotMatch(claudeInstall, /toml-plugin/);
  assert.doesNotMatch(claudeUninstall, /toml-plugin/);
});
