#!/usr/bin/env node
// Multi-query end-to-end comparison: native (corpus enabled, no plugin) vs
// J-bounded (corpus disabled, skill-router plugin loaded). Runs each query
// twice, once in each mode, capturing full stream-json so the report can
// show the routing chain and final context size side-by-side.
//
// Picks 3 queries with simple, stageable fixtures across distinct domains.

import { spawn } from "node:child_process";
import { mkdir, writeFile, readdir, rename, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = __dirname;
const HOME = join(EXP_DIR, ".tmp-home");
const SKILLS_ROOT = join(HOME, ".claude", "skills");
const PLUGIN_DIR = join(HOME, ".claude", "plugins", "cache", "local", "skill-router", "0.1.0");
const PLUGIN_SKILL_MD = join(PLUGIN_DIR, "skills", "skill-router-skills", "SKILL.md");
const J_SKILL_MD = join(EXP_DIR, "variants", "J-bounded.SKILL.md");
const PROJECT = join(HOME, "project-e2e-multi");
const OUT_DIR = join(EXP_DIR, "runs", "e2e-multi");
const TIMEOUT_MS = Number(process.env.CLAUDE_RUN_TIMEOUT_MS) || 600_000;

const DIALOGUE_SCRIPT = `[GateScene]
Guard: Halt! State your name and business. -> NameChoice

[NameChoice]
1. I am Sir Aldric, Knight of the Realm. -> KnightPath
2. Just a humble traveler seeking shelter. -> TravelerPath
3. [Lie] I'm a merchant with important goods. -> MerchantPath
4. [Attack] Draw your sword! -> CombatStart

[KnightPath]
Guard: Welcome, sir knight. -> End

[TravelerPath]
Guard: Pass through. -> End

[MerchantPath]
Guard: I do not believe you. -> End

[CombatStart]
Guard: Defend! -> End

[End]
Story: Story ends here.
`;

const BIBTEX = `@article{einstein1905,
  author = {Einstein, Albert},
  title = {Zur Elektrodynamik bewegter K{\\"o}rper},
  journal = {Annalen der Physik},
  volume = {322},
  number = {10},
  pages = {891--921},
  year = {1905}
}

@article{turing1950,
  author = {Turing, A. M.},
  title = {Computing Machinery and Intelligence},
  journal = {Mind},
  volume = {LIX},
  number = {236},
  pages = {433--460},
  year = {1950}
}

@inproceedings{vaswani2017attention,
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N and Kaiser, {\\L}ukasz and Polosukhin, Illia},
  title = {Attention Is All You Need},
  booktitle = {Advances in Neural Information Processing Systems},
  year = {2017}
}

@article{zhang2024quantum,
  author = {Zhang, Wei and Liu, Hao and Chen, Min},
  title = {Quantum Entanglement in Distributed Blockchain Consensus Protocols},
  journal = {Nature Communications},
  volume = {15},
  year = {2024}
}

@inproceedings{patel2023holographic,
  author = {Patel, Rajesh and Kumar, Sunita},
  title = {Holographic Memory Allocation for Persistent Neural Architectures},
  booktitle = {Proceedings of the 47th International Conference on Machine Learning},
  year = {2023}
}

@article{lecun2015deep,
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  title = {Deep learning},
  journal = {Nature},
  volume = {521},
  number = {7553},
  pages = {436--444},
  year = {2015}
}

@article{takahashi2024sentient,
  author = {Takahashi, Kenji and Yamada, Akira},
  title = {Sentient Latent Spaces: Self-Aware Embeddings in Large Language Models},
  journal = {Journal of Artificial Consciousness},
  year = {2024}
}
`;

const TAXO_AMAZON = `category_path
Electronics > Computers > Laptops
Electronics > Computers > Tablets
Electronics > Phones > Smartphones
Home & Kitchen > Appliances > Refrigerators
Home & Kitchen > Cookware > Pots
Clothing > Mens > Shirts
Clothing > Womens > Dresses
Books > Fiction > Mystery
Toys & Games > Outdoor > Bikes
`;

const TAXO_FB = `category_path
electronics > computer > notebook
electronics > mobile > cellphone
appliances > kitchen > fridge
cookware > pot
fashion > men > shirt
fashion > women > dress
books > novel > thriller
toys > outdoor > bicycle
`;

const TAXO_GOOGLE = `category_path
Electronics/Computers/Notebooks
Electronics/Mobile Phones/Smart Phones
Home Appliances/Kitchen/Refrigerators
Cookware/Pots & Pans
Apparel/Men's Clothing/Shirts
Apparel/Women's Clothing/Dresses
Media/Books/Mystery
Sports & Outdoors/Cycling/Bikes
`;

const QUERIES = [
  {
    id: "dialogue-parser",
    expected: "skill-009",
    fixtures: { "script.txt": DIALOGUE_SCRIPT },
    query: (P) => [
      "You will implement a dialogue parser that converts a text file into a",
      "structured JSON graph.",
      "",
      `Input: ${join(P, "script.txt")}`,
      `Output JSON graph: ${join(P, "dialogue.json")}`,
      `Output Graphviz visualization: ${join(P, "dialogue.dot")}`,
      `Parser source: ${join(P, "solution.py")}`,
      "",
      "Implement `def parse_script(text: str)` in solution.py. Output JSON shape:",
      '{"nodes":[{"id":"","text":"","speaker":"","type":""}],"edges":[{"from":"","to":"","text":""}]}',
      "Node types: 'line' and 'choice'.",
    ].join("\n"),
  },
  {
    id: "citation-check",
    expected: "skill-043",
    fixtures: { "test.bib": BIBTEX },
    query: (P) => [
      "Verify the integrity of a bibliography. Some citations in the",
      "BibTeX file may be fake or hallucinated.",
      "",
      `BibTeX file: ${join(P, "test.bib")}`,
      `Write findings to: ${join(P, "answer.json")}`,
      "",
      "Format:",
      '{"fake_citations": ["Title of first fake paper", "Title of second fake paper"]}',
      "",
      "Return only the titles of fake citations, cleaned (no BibTeX braces),",
      "sorted alphabetically.",
    ].join("\n"),
  },
  {
    id: "taxonomy-tree-merge",
    expected: "skill-068",
    fixtures: {
      "data/amazon_product_categories.csv": TAXO_AMAZON,
      "data/fb_product_categories.csv": TAXO_FB,
      "data/google_shopping_product_categories.csv": TAXO_GOOGLE,
    },
    query: (P) => [
      "Unify product category taxonomies from three e-commerce platforms",
      "(Amazon, Facebook, Google Shopping) into a single 5-level taxonomy.",
      "",
      `Input directory: ${join(P, "data/")}`,
      `Output directory: ${join(P, "output/")}`,
      "",
      "Files in input dir:",
      "  amazon_product_categories.csv",
      "  fb_product_categories.csv",
      "  google_shopping_product_categories.csv",
      "",
      "Each CSV has hierarchical category paths under `category_path`.",
      "",
      "Produce:",
      "  unified_taxonomy_full.csv (columns: source, category_path, depth,",
      "    unified_level_1..unified_level_5)",
      "  unified_taxonomy_hierarchy.csv (columns: unified_level_1..unified_level_5)",
    ].join("\n"),
  },
];

async function toggleCorpus(target) {
  const dirs = (await readdir(SKILLS_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  let n = 0;
  for (const id of dirs) {
    const en = join(SKILLS_ROOT, id, "SKILL.md");
    const dis = join(SKILLS_ROOT, id, "SKILL.md.skill-router-disabled");
    if (target === "enabled" && existsSync(dis) && !existsSync(en)) { await rename(dis, en); n++; }
    else if (target === "disabled" && existsSync(en) && !existsSync(dis)) { await rename(en, dis); n++; }
  }
  console.log(`[corpus] -> ${target} (${n} renamed)`);
}

async function stageFixtures(query) {
  await rm(PROJECT, { recursive: true, force: true });
  await mkdir(PROJECT, { recursive: true });
  for (const [rel, content] of Object.entries(query.fixtures)) {
    const dst = join(PROJECT, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, content);
  }
  console.log(`[fixture] ${query.id} -> ${PROJECT} (${Object.keys(query.fixtures).length} files)`);
}

async function runClaude(query, mode) {
  const env = { ...process.env, HOME };
  const args = [
    "-p", query.query(PROJECT),
    "--output-format=stream-json",
    "--verbose",
    "--permission-mode=bypassPermissions",
    "--max-turns=20",
  ];
  if (mode === "j-prod") args.push("--plugin-dir", PLUGIN_DIR);
  const out = join(OUT_DIR, mode, `${query.id}.jsonl`);
  await mkdir(dirname(out), { recursive: true });
  const events = [];
  let stdoutBuf = "", stderrBuf = "", timedOut = false;
  const t0 = Date.now();
  console.log(`[${mode}] ${query.id} spawn`);
  const child = spawn("claude", args, { env, cwd: PROJECT, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk;
    let nl;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.trim()) {
        try { events.push(JSON.parse(line)); } catch { events.push({ type: "_raw", line }); }
      }
    }
  });
  child.stderr.on("data", (chunk) => { stderrBuf += chunk; });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5000);
  }, TIMEOUT_MS);
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  if (stdoutBuf.trim()) {
    try { events.push(JSON.parse(stdoutBuf)); } catch { events.push({ type: "_raw", line: stdoutBuf }); }
  }
  if (stderrBuf) events.push({ type: "_stderr", text: stderrBuf.slice(0, 4000) });
  if (timedOut) events.push({ type: "_run_error", error: `claude -p timed out after ${TIMEOUT_MS}ms` });
  await writeFile(out, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[${mode}] ${query.id} done exit=${exitCode} timedOut=${timedOut} duration=${dur}s events=${events.length}`);
  return { mode, queryId: query.id, exitCode, timedOut, durationMs: Date.now() - t0, transcriptPath: out };
}

async function patchPluginSkillMd() {
  await copyFile(J_SKILL_MD, PLUGIN_SKILL_MD);
  console.log(`[plugin] J SKILL.md -> ${PLUGIN_SKILL_MD}`);
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const results = [];

  // --- NATIVE pass (corpus enabled, no plugin) ---
  try {
    await toggleCorpus("enabled");
    for (const q of QUERIES) {
      await stageFixtures(q);
      results.push(await runClaude(q, "native"));
    }
  } finally {
    await toggleCorpus("disabled");
  }

  // --- J-PROD pass (corpus disabled, plugin loaded with production J body) ---
  await patchPluginSkillMd();
  for (const q of QUERIES) {
    await stageFixtures(q);
    results.push(await runClaude(q, "j-prod"));
  }

  // Persist run metadata
  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({
    home: HOME,
    project: PROJECT,
    queries: QUERIES.map((q) => ({ id: q.id, expected: q.expected })),
    runs: results,
  }, null, 2));
  console.log(`\nsummary -> ${join(OUT_DIR, "summary.json")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
