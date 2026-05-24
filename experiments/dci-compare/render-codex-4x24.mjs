#!/usr/bin/env node
// Render the full Codex routing-only bench report.

process.env.CODEX_RUN_NAME ??= "codex-routing-only-4x24";

await import("./render-codex-4x5.mjs");
