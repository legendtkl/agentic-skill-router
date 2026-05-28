import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  attachManagedMarker,
  extractManagedMarker,
  isManagedUnchanged,
  sha256Hex,
} from "../scripts/prompt-marker.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const execFileAsync = promisify(execFile);
const NPM_TEST_CACHE = join(tmpdir(), `agentic-skill-router-prompt-npm-cache-${process.pid}`);

test("attachManagedMarker produces a self-verifying body", () => {
  const body = "hello world\n";
  const stamped = attachManagedMarker(body);
  assert.ok(isManagedUnchanged(stamped));
  const parsed = extractManagedMarker(stamped);
  assert.ok(parsed);
  assert.equal(parsed.bodyWithoutMarker, body);
  assert.equal(sha256Hex(parsed.bodyWithoutMarker), parsed.recordedHash);
});

test("attachManagedMarker normalises trailing newline", () => {
  const stamped = attachManagedMarker("no trailing newline");
  assert.ok(isManagedUnchanged(stamped));
  assert.match(stamped, /no trailing newline\n<!-- agentic-skill-router-managed:/);
});

test("isManagedUnchanged rejects files without a marker", () => {
  assert.equal(isManagedUnchanged("plain content\n"), false);
});

test("isManagedUnchanged rejects user-edited managed files", () => {
  const stamped = attachManagedMarker("original body\n");
  const tampered = stamped.replace("original body", "user added words original body");
  assert.equal(isManagedUnchanged(tampered), false);
});

test("install reinstall over managed copy refreshes the file in place", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-install-prompt-managed-"));
  try {
    const codexHome = join(root, ".codex");
    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: codexInstallEnv(root, codexHome),
      maxBuffer: 4 * 1024 * 1024,
    });

    const promptPath = join(codexHome, "prompts", "agentic-skill-router.md");
    const first = await readFile(promptPath, "utf8");
    assert.ok(isManagedUnchanged(first));

    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: codexInstallEnv(root, codexHome),
      maxBuffer: 4 * 1024 * 1024,
    });
    const second = await readFile(promptPath, "utf8");
    assert.equal(second, first);
    assert.equal(await pathExists(`${promptPath}.user-modified.bak`), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install preserves a user-edited prompt and writes a backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-install-prompt-user-"));
  try {
    const codexHome = join(root, ".codex");
    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: codexInstallEnv(root, codexHome),
      maxBuffer: 4 * 1024 * 1024,
    });

    const promptPath = join(codexHome, "prompts", "agentic-skill-router.md");
    const userVersion = "user owned prompt body\nwith local edits\n";
    await writeFile(promptPath, userVersion);

    const result = await execFileAsync(
      process.execPath,
      ["scripts/install-codex.mjs"],
      {
        cwd: REPO_ROOT,
        env: codexInstallEnv(root, codexHome),
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    assert.equal(await readFile(promptPath, "utf8"), userVersion);
    const backupPath = `${promptPath}.user-modified.bak`;
    assert.ok(await pathExists(backupPath));
    assert.equal(await readFile(backupPath, "utf8"), userVersion);
    assert.match(result.stderr, /has local edits/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install removes the old managed slash prompt when installing the renamed prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-install-legacy-prompt-managed-"));
  try {
    const codexHome = join(root, ".codex");
    const legacyPromptPath = join(codexHome, "prompts", "agentic-skill-router-skills.md");
    await mkdir(dirname(legacyPromptPath), { recursive: true });
    await writeFile(legacyPromptPath, attachManagedMarker("legacy slash prompt\n"));

    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: codexInstallEnv(root, codexHome),
      maxBuffer: 4 * 1024 * 1024,
    });

    assert.equal(await pathExists(legacyPromptPath), false);
    assert.equal(await pathExists(`${legacyPromptPath}.user-modified.bak`), false);
    assert.equal(await pathExists(join(codexHome, "prompts", "agentic-skill-router.md")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install backs up and removes a user-edited old slash prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-install-legacy-prompt-user-"));
  try {
    const codexHome = join(root, ".codex");
    const legacyPromptPath = join(codexHome, "prompts", "agentic-skill-router-skills.md");
    const userVersion = "custom legacy slash prompt\n";
    await mkdir(dirname(legacyPromptPath), { recursive: true });
    await writeFile(legacyPromptPath, userVersion);

    const result = await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: codexInstallEnv(root, codexHome),
      maxBuffer: 4 * 1024 * 1024,
    });

    assert.equal(await pathExists(legacyPromptPath), false);
    const backupPath = `${legacyPromptPath}.user-modified.bak`;
    assert.equal(await readFile(backupPath, "utf8"), userVersion);
    assert.match(result.stderr, /has local edits/);
    assert.equal(await pathExists(join(codexHome, "prompts", "agentic-skill-router.md")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall removes a managed prompt copy", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-uninstall-prompt-managed-"));
  try {
    const codexHome = join(root, ".codex");
    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: codexInstallEnv(root, codexHome),
      maxBuffer: 4 * 1024 * 1024,
    });

    const promptPath = join(codexHome, "prompts", "agentic-skill-router.md");
    assert.ok(await pathExists(promptPath));

    await execFileAsync(process.execPath, ["scripts/uninstall-codex.mjs"], {
      cwd: REPO_ROOT,
      env: codexInstallEnv(root, codexHome),
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(await pathExists(promptPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall removes the old managed slash prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-uninstall-legacy-prompt-managed-"));
  try {
    const codexHome = join(root, ".codex");
    const legacyPromptPath = join(codexHome, "prompts", "agentic-skill-router-skills.md");
    await mkdir(dirname(legacyPromptPath), { recursive: true });
    await writeFile(legacyPromptPath, attachManagedMarker("legacy slash prompt\n"));

    await execFileAsync(process.execPath, ["scripts/uninstall-codex.mjs"], {
      cwd: REPO_ROOT,
      env: codexInstallEnv(root, codexHome),
      maxBuffer: 4 * 1024 * 1024,
    });

    assert.equal(await pathExists(legacyPromptPath), false);
    assert.equal(await pathExists(`${legacyPromptPath}.user-modified.bak`), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall preserves a user-edited prompt file", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-uninstall-prompt-user-"));
  try {
    const codexHome = join(root, ".codex");
    await execFileAsync(process.execPath, ["scripts/install-codex.mjs"], {
      cwd: REPO_ROOT,
      env: codexInstallEnv(root, codexHome),
      maxBuffer: 4 * 1024 * 1024,
    });

    const promptPath = join(codexHome, "prompts", "agentic-skill-router.md");
    const userVersion = "user owned prompt body\n";
    await writeFile(promptPath, userVersion);

    const result = await execFileAsync(
      process.execPath,
      ["scripts/uninstall-codex.mjs"],
      {
        cwd: REPO_ROOT,
        env: codexInstallEnv(root, codexHome),
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    assert.ok(await pathExists(promptPath));
    assert.equal(await readFile(promptPath, "utf8"), userVersion);
    assert.match(result.stderr, /has local edits/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall backs up and removes a user-edited old slash prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-skill-router-uninstall-legacy-prompt-user-"));
  try {
    const codexHome = join(root, ".codex");
    const legacyPromptPath = join(codexHome, "prompts", "agentic-skill-router-skills.md");
    const userVersion = "custom legacy slash prompt\n";
    await mkdir(dirname(legacyPromptPath), { recursive: true });
    await writeFile(legacyPromptPath, userVersion);

    const result = await execFileAsync(process.execPath, ["scripts/uninstall-codex.mjs"], {
      cwd: REPO_ROOT,
      env: codexInstallEnv(root, codexHome),
      maxBuffer: 4 * 1024 * 1024,
    });

    assert.equal(await pathExists(legacyPromptPath), false);
    const backupPath = `${legacyPromptPath}.user-modified.bak`;
    assert.equal(await readFile(backupPath, "utf8"), userVersion);
    assert.match(result.stderr, /has local edits/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function codexInstallEnv(root: string, codexHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    CODEX_HOME: codexHome,
    AGENTIC_SKILL_ROUTER_RUNTIME_ROOT: join(root, ".agentic-skill-router", "runtime"),
    npm_config_cache: NPM_TEST_CACHE,
  };
}
