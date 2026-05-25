#!/usr/bin/env node
// Orchestrate a {J-bounded, J-bounded-v2} × {1K, 5K, 20K, full} sweep on
// a single query (default: 3d-scan-calc).
//
// For each scale: install corpus once (runs J-v1), then run J-v2 against
// the same HOME via --skip-install. Cells run sequentially to keep the
// Anthropic API pressure bounded.
//
// Usage:
//   node sweep.mjs [--query-id=3d-scan-calc] [--scales=1000,5000,20000,0]
//                  [--variants=J-bounded,J-bounded-v2]

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = {
    queryId: "3d-scan-calc",
    scales: [1000, 5000, 20000, 0],
    variants: ["J-bounded", "J-bounded-v2"],
  };
  for (const a of argv) {
    if (a.startsWith("--query-id=")) out.queryId = a.slice(11);
    else if (a.startsWith("--scales=")) out.scales = a.slice(9).split(",").map(Number);
    else if (a.startsWith("--variants=")) out.variants = a.slice(11).split(",");
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

const log = (m) => console.log(`[sweep ${new Date().toISOString().slice(11, 19)}] ${m}`);

function runProbe(probeArgs) {
  return new Promise((resolve, reject) => {
    log(`>> node probe.mjs ${probeArgs.join(" ")}`);
    const child = spawn("node", ["probe.mjs", ...probeArgs], {
      cwd: __dirname,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`probe exit=${code}`));
    });
    child.on("error", reject);
  });
}

const main = async () => {
  log(`scales=${args.scales.join(",")}  variants=${args.variants.join(",")}  query=${args.queryId}`);
  const cells = [];
  for (const scale of args.scales) {
    for (let i = 0; i < args.variants.length; i++) {
      const variant = args.variants[i];
      const skipInstall = i > 0; // first variant of each scale installs; rest reuse
      cells.push({ scale, variant, skipInstall });
    }
  }
  log(`total cells: ${cells.length}`);
  let done = 0;
  for (const cell of cells) {
    done++;
    log(`[${done}/${cells.length}] variant=${cell.variant} scale=${cell.scale} skipInstall=${cell.skipInstall}`);
    const probeArgs = [
      `--variant=${cell.variant}`,
      `--scale=${cell.scale}`,
      `--query-id=${args.queryId}`,
    ];
    if (cell.skipInstall) probeArgs.push("--skip-install");
    try {
      await runProbe(probeArgs);
    } catch (err) {
      log(`cell failed: ${err.message} — continuing`);
    }
  }
  log(`sweep done`);
};

main().catch((e) => { console.error(e); process.exit(1); });
