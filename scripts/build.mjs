#!/usr/bin/env node
import { build } from "esbuild";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const out = resolve(root, "lib/agentic-skill-router.mjs");
const binWrapper = resolve(root, "bin/agentic-skill-router");
const obsoleteOut = resolve(root, "lib/skill-router.mjs");

await mkdir(dirname(out), { recursive: true });
await rm(obsoleteOut, { force: true });

await build({
  entryPoints: [resolve(root, "src/cli.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: out,
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: false,
  minify: false,
  legalComments: "none",
});

await chmod(out, 0o755);
await chmod(binWrapper, 0o755);

console.log(`built ${out}`);
