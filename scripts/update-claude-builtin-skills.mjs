#!/usr/bin/env node
// Claude Code built-in skill list — maintainer helper (stub).
//
// Why this exists
// ---------------
// `src/hosts/claude-code.ts` hard-codes a `BUILTIN_SKILLS` snapshot of the
// skills shipped inside the Claude Code binary. Claude Code does not expose
// a queryable inventory of those builtins, so the list drifts whenever
// Anthropic adds or removes one. This script is a deliberate stub: it does
// NOT call out to the network or to a Claude Code binary. Updating the
// snapshot is a hand operation; this file just centralises the checklist so
// the procedure stays the same across maintainers.
//
// When to run
// -----------
// - A new Claude Code release ships and the `/help` or `/skills` surface
//   shows a builtin that is not in `BUILTIN_SKILLS`.
// - A previously listed builtin disappears from a Claude Code release.
// - The quarterly drift audit (see README "Claude Code builtin skill list
//   policy" section).
//
// What to do
// ----------
// 1. Open Claude Code with the version you want to verify against and list
//    the available skills. Typical sources, in rough order of reliability:
//      a. `claude --version` (record the version string).
//      b. The system prompt section that enumerates available skills (the
//         same list this repo's transcripts inject into `<system-reminder>`
//         under "The following skills are available for use with the Skill
//         tool:"). Capturing one fresh transcript is usually enough.
//      c. If a future Claude Code build exposes a plugin-loader manifest for
//         builtins, prefer that — and replace this stub with a real reader.
// 2. Diff that list against the `BUILTIN_SKILLS` array in
//    `src/hosts/claude-code.ts`. Add new entries with their short
//    description; remove entries that no longer exist.
// 3. Update `BUILTIN_SKILLS_VERSION` to the Claude Code version you verified
//    against (e.g. `"claude-code@2.4.1"` if you want to be precise, or
//    `"claude-code@2.x"` for a minor-version range).
// 4. Update `BUILTIN_SKILLS_VERIFIED_AT` to today's date in `YYYY-MM-DD`.
// 5. Run `npm run typecheck && npm test` and ship the change.
//
// Why no automation
// -----------------
// Reading the host's system prompt or scraping `/help` would require a live
// Claude Code session with auth, which is not safe to do from a build
// script. The runtime stays dependency-free and the maintainer step is
// short enough that automating it would cost more than it saves.

const lines = [
  "agentic-skill-router · update-claude-builtin-skills",
  "",
  "This script is a stub. Updating the Claude Code builtin skill snapshot is",
  "a hand operation — open the source file and follow the header checklist:",
  "",
  "  src/hosts/claude-code.ts",
  "    · BUILTIN_SKILLS              (the snapshot array)",
  "    · BUILTIN_SKILLS_VERSION      (host version it was verified against)",
  "    · BUILTIN_SKILLS_VERIFIED_AT  (ISO date YYYY-MM-DD)",
  "",
  "See the README section \"Claude Code builtin skill list policy\" for the",
  "rationale and the full checklist.",
  "",
];

process.stdout.write(lines.join("\n") + "\n");
