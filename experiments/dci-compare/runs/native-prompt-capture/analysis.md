# Native Prompt Capture

Generated: 2026-05-24T04:53:17.926Z

Query: weighted-gdp-calc (expected user:skill-105)

## Summary

| Host | Captured endpoint | Skill list lines | Skill list chars | Avg desc chars | Max desc chars | Skill execution mechanism |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Codex native | `/v1/responses` | 150 | 21117 | 92 | 100 | Inline skills section + open `SKILL.md` instruction |
| Claude Code native | `/v1/messages?beta=true` | 150 | 7948 | 20 | 20 | `Skill` tool + budgeted skill listing |

## Codex Native

- Request top-level keys: `model`, `instructions`, `input`, `tools`, `tool_choice`, `parallel_tool_calls`, `reasoning`, `store`, `stream`, `include`, `prompt_cache_key`, `text`, `client_metadata`
- Prompt input messages: 3
- Request contains `### Available skills`: true
- Request contains open-SKILL instruction: true
- `skill-105` line: - skill-105: Comprehensive spreadsheet creation, editing, and analysis with support for formulas, formatting, (file: r0/skill-105/SKILL.md)
- `skill-026` line: - skill-026: A skill for generating and automating Excel spreadsheet (.xlsx) creation and modification for da (file: r0/skill-026/SKILL.md)

## Claude Code Native

- Model: claude-sonnet-4-6
- Request top-level keys: `model`, `messages`, `system`, `tools`, `metadata`, `max_tokens`, `thinking`, `context_management`, `output_config`, `stream`
- Tool count: 26
- Has `Skill` tool: true
- Skill tool description chars: 1498
- Skill tool text contains launch-before-answer semantics: true
- Request contains skill listing system-reminder: true
- `skill-105` line: - skill-105: Comprehensive sprea…
- `skill-026` line: - skill-026: A skill for generat…

Raw request bodies are stored next to this file for local inspection and are
ignored by git; auth-like headers and metadata identifiers are redacted.
