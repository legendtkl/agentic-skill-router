#!/usr/bin/env node
// Render the full 9-variant Codex routing-only bench report.

process.env.CODEX_RUN_NAME ??= "codex-routing-only-9x24";

await import("./render-codex-4x5.mjs");
