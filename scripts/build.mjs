#!/usr/bin/env node
import { build } from "esbuild";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outputs = [
  resolve(root, "plugins/claude-code/lib/skill-router.mjs"),
  resolve(root, "plugins/codex/lib/skill-router.mjs"),
];

for (const out of outputs) {
  await mkdir(dirname(out), { recursive: true });

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

  console.log(`built ${out}`);
}
