#!/usr/bin/env node
// Full Codex routing-only bench wrapper: 4 variants x all 24 queries.

process.env.CODEX_QUERY_SET ??= "all";
process.env.CODEX_RUN_NAME ??= "codex-routing-only-4x24";

await import("./codex-routing-only-4x5.mjs");
