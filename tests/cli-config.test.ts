import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const CLI_PATH = join(REPO_ROOT, "src", "cli.ts");

interface Fixture {
  env: NodeJS.ProcessEnv;
  configPath: string;
  cleanup: () => Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "skill-router-cli-config-"));
  const configDir = join(root, ".skill-router");
  const stateDir = configDir;
  const configPath = join(configDir, "config.json");
  await mkdir(configDir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SKILL_ROUTER_HOST: "codex",
    SKILL_ROUTER_CONFIG_PATH: configPath,
    SKILL_ROUTER_STATE_DIR: stateDir,
  };

  return {
    env,
    configPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, ["--import", "tsx", CLI_PATH, ...args], { env });
}

async function runCliExpectExit(
  args: string[],
  env: NodeJS.ProcessEnv,
  expectedCode: number,
): Promise<{ stdout: string; stderr: string }> {
  let caught: unknown;
  let ok: { stdout: string; stderr: string } | undefined;
  try {
    ok = await runCli(args, env);
  } catch (err) {
    caught = err;
  }
  if (expectedCode === 0) {
    assert.ok(ok, `expected exit 0 for ${args.join(" ")}, got error: ${JSON.stringify(caught)}`);
    return ok;
  }
  assert.ok(caught, `expected exit ${expectedCode} for ${args.join(" ")}, got success`);
  const e = caught as { code?: number; stdout?: string; stderr?: string };
  assert.equal(
    e.code,
    expectedCode,
    `expected exit ${expectedCode} for ${args.join(" ")}, got ${e.code}; stderr: ${e.stderr}`,
  );
  return { stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
}

test("skills config path prints the active config file path", async () => {
  const fx = await makeFixture();
  try {
    const { stdout, stderr } = await runCli(["skills", "config", "path"], fx.env);
    assert.equal(stderr, "");
    assert.equal(stdout.trim(), fx.configPath);
  } finally {
    await fx.cleanup();
  }
});

test("skills config get prints defaults when no file exists", async () => {
  const fx = await makeFixture();
  try {
    // No config file created — should print defaults.
    assert.equal(existsSync(fx.configPath), false);
    const { stdout, stderr } = await runCli(["skills", "config", "get", "--json"], fx.env);
    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout) as { path: string; config: Record<string, unknown> };
    assert.equal(parsed.path, fx.configPath);
    assert.equal(parsed.config.unusedForDays, 30);
    assert.equal(parsed.config.routeMode, "auto");
  } finally {
    await fx.cleanup();
  }
});

test("skills config get text output includes default markers", async () => {
  const fx = await makeFixture();
  try {
    const { stdout, stderr } = await runCli(["skills", "config", "get"], fx.env);
    assert.equal(stderr, "");
    assert.match(stdout, /unusedForDays: 30\s+\(default\)/);
    assert.match(stdout, /routeMode:\s+auto\s+\(default\)/);
    assert.match(stdout, new RegExp(`path: ${fx.configPath.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}`));
  } finally {
    await fx.cleanup();
  }
});

test("skills config set unusedForDays writes file and config get reflects it", async () => {
  const fx = await makeFixture();
  try {
    const { stdout, stderr } = await runCli(
      ["skills", "config", "set", "unusedForDays", "60"],
      fx.env,
    );
    assert.equal(stderr, "");
    assert.match(stdout, /set unusedForDays = 60/);

    // File on disk has the value.
    const raw = await readFile(fx.configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.unusedForDays, 60);

    // And config get reflects it.
    const got = await runCli(["skills", "config", "get", "--json"], fx.env);
    const gotParsed = JSON.parse(got.stdout) as { config: Record<string, unknown> };
    assert.equal(gotParsed.config.unusedForDays, 60);
  } finally {
    await fx.cleanup();
  }
});

test("skills config set routeMode writes a valid mode", async () => {
  const fx = await makeFixture();
  try {
    const { stdout, stderr } = await runCli(
      ["skills", "config", "set", "routeMode", "metadata"],
      fx.env,
    );
    assert.equal(stderr, "");
    assert.match(stdout, /set routeMode = "metadata"/);

    const got = await runCli(["skills", "config", "get", "--json"], fx.env);
    const gotParsed = JSON.parse(got.stdout) as { config: Record<string, unknown> };
    assert.equal(gotParsed.config.routeMode, "metadata");
  } finally {
    await fx.cleanup();
  }
});

test("skills config set routeMode invalid rejects, exits 1, file unchanged", async () => {
  const fx = await makeFixture();
  try {
    // Seed an existing valid file so we can check it is not corrupted.
    await writeFile(fx.configPath, JSON.stringify({ unusedForDays: 90, routeMode: "auto" }, null, 2) + "\n");
    const before = await readFile(fx.configPath, "utf8");

    const result = await runCliExpectExit(
      ["skills", "config", "set", "routeMode", "bogus"],
      fx.env,
      1,
    );
    assert.match(result.stderr, /routeMode must be one of/);

    // File is unchanged byte-for-byte.
    const after = await readFile(fx.configPath, "utf8");
    assert.equal(after, before);
  } finally {
    await fx.cleanup();
  }
});

test("skills config set unusedForDays with non-integer rejects, exits 1, file unchanged", async () => {
  const fx = await makeFixture();
  try {
    await writeFile(fx.configPath, JSON.stringify({ unusedForDays: 30 }, null, 2) + "\n");
    const before = await readFile(fx.configPath, "utf8");

    const result = await runCliExpectExit(
      ["skills", "config", "set", "unusedForDays", "abc"],
      fx.env,
      1,
    );
    assert.match(result.stderr, /unusedForDays must be a non-negative integer/);

    const after = await readFile(fx.configPath, "utf8");
    assert.equal(after, before);
  } finally {
    await fx.cleanup();
  }
});

test("skills config set unusedForDays with negative value rejects", async () => {
  const fx = await makeFixture();
  try {
    // `-5` looks like a short option to node:util.parseArgs strict mode, so
    // we have to disambiguate with `--`. The CLI must still reject the value.
    const result = await runCliExpectExit(
      ["skills", "config", "set", "unusedForDays", "--", "-5"],
      fx.env,
      1,
    );
    assert.match(result.stderr, /unusedForDays must be a non-negative integer/);
    assert.equal(existsSync(fx.configPath), false, "no file should be written on bad value");
  } finally {
    await fx.cleanup();
  }
});

test("skills config set unknown key rejects with exit 2", async () => {
  const fx = await makeFixture();
  try {
    const result = await runCliExpectExit(
      ["skills", "config", "set", "unknownKey", "foo"],
      fx.env,
      2,
    );
    assert.match(result.stderr, /unknown config key: unknownKey/);
    assert.match(result.stderr, /Known keys:/);
    assert.equal(existsSync(fx.configPath), false, "no file should be written on unknown key");
  } finally {
    await fx.cleanup();
  }
});

test("skills config set without value exits 2", async () => {
  const fx = await makeFixture();
  try {
    const result = await runCliExpectExit(
      ["skills", "config", "set", "routeMode"],
      fx.env,
      2,
    );
    assert.match(result.stderr, /specify <key> <value>/);
  } finally {
    await fx.cleanup();
  }
});

test("skills config set keepNames accepts JSON array", async () => {
  const fx = await makeFixture();
  try {
    const { stdout, stderr } = await runCli(
      ["skills", "config", "set", "keepNames", '["foo","bar"]'],
      fx.env,
    );
    assert.equal(stderr, "");
    assert.match(stdout, /set keepNames = \["foo","bar"\]/);

    const got = await runCli(["skills", "config", "get", "--json"], fx.env);
    const parsed = JSON.parse(got.stdout) as { config: { keepNames?: unknown } };
    assert.deepEqual(parsed.config.keepNames, ["foo", "bar"]);
  } finally {
    await fx.cleanup();
  }
});

test("skills config set keepIds rejects non-JSON-array value", async () => {
  const fx = await makeFixture();
  try {
    const result = await runCliExpectExit(
      ["skills", "config", "set", "keepIds", "user:foo"],
      fx.env,
      1,
    );
    assert.match(result.stderr, /keepIds must be a JSON array of strings/);
    assert.equal(existsSync(fx.configPath), false);
  } finally {
    await fx.cleanup();
  }
});

test("skills config set preserves unknown sibling keys", async () => {
  const fx = await makeFixture();
  try {
    // Pre-seed with a future / unknown key the CLI doesn't know about.
    await writeFile(
      fx.configPath,
      JSON.stringify({ unusedForDays: 30, futureKey: "preserve me" }, null, 2) + "\n",
    );

    const { stdout } = await runCli(
      ["skills", "config", "set", "routeMode", "lexical"],
      fx.env,
    );
    assert.match(stdout, /set routeMode = "lexical"/);

    const raw = await readFile(fx.configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.routeMode, "lexical");
    assert.equal(parsed.unusedForDays, 30);
    assert.equal(parsed.futureKey, "preserve me");
  } finally {
    await fx.cleanup();
  }
});

test("skills config unknown subcommand exits 2", async () => {
  const fx = await makeFixture();
  try {
    const result = await runCliExpectExit(["skills", "config", "bogus"], fx.env, 2);
    assert.match(result.stderr, /unknown config subcommand/);
  } finally {
    await fx.cleanup();
  }
});

test("skills config set rejects extra trailing argument", async () => {
  const fx = await makeFixture();
  try {
    const result = await runCliExpectExit(
      ["skills", "config", "set", "unusedForDays", "60", "extra"],
      fx.env,
      2,
    );
    assert.match(result.stderr, /unexpected extra argument/);
  } finally {
    await fx.cleanup();
  }
});
