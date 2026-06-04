# Safety

- Never disable without explicit user confirmation.
- Never delete skill directories or `SKILL.md` files.
- Built-in, system, and admin-managed skills are protected.
- A disabled skill is recoverable because the operation only renames
  `SKILL.md` to `SKILL.md.agentic-skill-router-disabled`.
- If a command reports a split-brain conflict, tell the user which skill needs
  manual repair and stop.
- Do not edit `~/.agentic-skill-router/state-*.json` by hand unless the user explicitly
  asks for manual recovery and the file contents have been inspected first.
- Do not disable a whole plugin when disabled skills still need that plugin's
  MCP/app tools.
