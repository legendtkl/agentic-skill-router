# skill-router

[English](README.md) | 简体中文

`skill-router` 是 Claude Code 和 Codex 的 Skill 管理 CLI 与插件资产。当前范围是从 `~/github/agent-cleaner` 迁移出来的 skill-only 核心：枚举已安装 skills、读取本地会话记录中的使用情况、建议过期或长期未使用的 skills，并通过重命名 `SKILL.md` 的方式安全禁用或恢复指定 skill。

Subagent 管理不属于本仓库范围。

## 快速开始

Claude Code：

```bash
npm install
npm run install:plugin
```

重启 Claude Code，然后让已安装的 `skill-router-skills` skill 审计或精简已安装 skills。

Codex：

```bash
npm install
npm run install:codex-plugin
```

重启 Codex，然后运行：

```text
/skill-router:skills
```

## CLI

同一份 bundle 也可以直接作为 CLI 使用。

Claude Code：

```bash
plugins/claude-code/bin/skill-router skills list
plugins/claude-code/bin/skill-router skills suggest
plugins/claude-code/bin/skill-router skills disable user:lark-mail --yes
plugins/claude-code/bin/skill-router skills enable user:lark-mail
plugins/claude-code/bin/skill-router skills status
```

Codex：

```bash
plugins/codex/bin/skill-router --host=codex skills list
plugins/codex/bin/skill-router --host=codex skills suggest --json
plugins/codex/bin/skill-router --host=codex skills route --query "draft a Lark mail reply" --json
plugins/codex/bin/skill-router --host=codex skills route --mode=metadata --query "draft a Lark mail reply" --json
plugins/codex/bin/skill-router --host=codex skills route --mode=body --query "draft a Lark mail reply" --json
plugins/codex/bin/skill-router --host=codex skills dci search --query "find a disabled skill for this request" --query "lark mail reply" --json
plugins/codex/bin/skill-router --host=codex skills dci open dci-abc123def0 --line=20 --window=80 --json
plugins/codex/bin/skill-router --host=codex skills disable user:codex:lark-mail --yes
plugins/codex/bin/skill-router --host=codex skills enable user:codex:lark-mail
plugins/codex/bin/skill-router --host=codex skills status
```

`--unused-for=<duration>` 支持 `30`、`30d`、`2w`、`3m` 和 `1y`。持久化默认配置位于 `~/.skill-router/config.json`：

```json
{ "unusedForDays": 60, "routeMode": "auto" }
```

## 工作原理

Skill 分发资产由同一个 Agent Skills 源生成：

- `shared/skills/skill-router-skills/SKILL.md` 是 source of truth。
- `shared/skills/skill-router-skills/references/` 存放共享工作流细节。
- `shared/host-overlays/` 定义 Claude Code 与 Codex 的分发输出。
- `plugins/*/skills/skill-router-skills/` 和 `plugins/codex/prompts/skill-router-skills.md` 由 `npm run generate:assets` 与 `npm run build` 生成。

不要直接编辑生成后的插件 skill 文件。应更新 shared skill 或 host overlay，然后重新生成资产。

Skill 来源：

| Host | Sources |
| --- | --- |
| Claude Code | `~/.claude/skills`、从 CWD 到 repo root 的 `.claude/skills`、插件 `skills/`、受保护内置 skills |
| Codex | 从 CWD 到 repo root 的 `.agents/skills`、`~/.agents/skills`、`/etc/codex/skills`、`~/.codex/skills`、`~/.codex/skills/.system`、插件 `skills/` |

使用信号：

- Claude Code transcripts：`~/.claude/projects/**/*.jsonl`
- Codex sessions：`~/.codex/sessions/**/*.jsonl`
- `Skill` 工具调用与 `<command-name>...</command-name>` 标签

禁用机制：

- 启用：`SKILL.md`
- 禁用：`SKILL.md.skill-router-disabled`
- 状态：`~/.skill-router/state-claude-code.json` 或 `~/.skill-router/state-codex.json`

内置和系统 skills 会被列出，但不能被禁用。

已禁用 skill 路由：

- `skills route --query "<request>" --json` 只搜索已禁用 skills。
- 路由模式可通过 `--mode=auto|metadata|body|lexical|dci`、`SKILL_ROUTER_ROUTE_MODE` 或 `~/.skill-router/config.json` 的 `"routeMode": "auto"` 设置。
- `metadata` 是主路由器。它只搜索已禁用 skill 元数据（`id`、`name`、`description`、aliases、tags、tools、domains、intents、examples），返回字段级证据，不使用 embeddings 或 free-form bash。
- `lexical` 是旧版快速 description / name 匹配器。
- `body` 搜索已禁用 skill 正文，并只选择置信度足够高的 top candidate。
- `dci` 是 body search / body verification 命令的旧别名，不是完整 autonomous DCI research agent。
- `auto` 是默认模式：先运行 metadata；当 metadata 低置信、歧义或指向宽泛 umbrella skill 时，再使用有界正文验证。
- 高置信路由会返回 `action: "read-skill-file"` 和 `selected.skillMdPath`。
- 返回路径可能以 `SKILL.md.skill-router-disabled` 结尾；它仍然可以作为指令安全读取。
- 路由使用会写入状态文件，便于后续识别频繁被代理调用的已禁用 skills。
- 如果 metadata 路由不够确定，Codex 可以使用有界 body-verification 工具：
  - `skills dci budget --json`
  - `skills dci search --query "<request>" [--query "<derived query>"] --json`
  - `skills dci grep --pattern "<phrase>" --json` 用于字面短语搜索；只有明确要使用正则时才加 `--regex`
  - `skills dci find <id-or-ref> --pattern "<phrase>" --json`
  - `skills dci open <id-or-ref> --line=N --window=N --json`
  - `skills dci inspect <id-or-ref> --json`
  - `skills dci read <id-or-ref> --json`
  - `skills dci select <id-or-ref...> --query "<request>" --confidence=high --reason "<evidence>" --json`
- DCI search 返回稳定候选引用（`dci-...`），可用于后续 `find`、`open`、`read` 和 `select`。
- `skills body ...` 可作为 `skills dci ...` 的别名。
- Body 工具会以有界 snippet、最多 8 个 candidates、有界 `open` window 和固定 prompt budget 搜索/读取已禁用 skill 正文，避免把所有 `SKILL.md` 都塞进上下文。

Skill metadata 编写建议：

- `name` 与 `description` 仍是 host 约定要求；额外路由元数据都是可选的，并保持向后兼容。
- 当 skill 经常被产品名、API 名、中文名、CLI 命令或任务意图引用，但这些词没有出现在短描述中时，建议补充 `aliases`、`tags`、`tools`、`domains`、`intents` 和 `examples`。

```yaml
---
name: lark-mail
description: 发送、回复、搜索飞书邮件
aliases:
  - 飞书邮箱
  - lark mail
domains:
  - lark
  - feishu
  - email
tools:
  - Lark Mail API
intents:
  - send_mail
  - reply_mail
  - search_mail
examples:
  - 给张三发一封飞书邮件
  - 搜索最近的邮件
---
```

## 开发

```bash
npm install
npm run generate:assets
npm run typecheck
npm test
npm run build
```

如果本地 proxy 变量影响 npm，可临时移除：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY npm test
```

目录结构：

```text
src/                         TypeScript source
  cli.ts                     skills command tree
  scan.ts                    SKILL.md enumeration
  metadata-route.ts          metadata-first disabled-skill router
  dci.ts                     bounded body search / verification tools
  usage.ts                   transcript usage parser
  policy.ts                  suggestion rules
  apply.ts                   disable / enable / reapply logic
  state.ts                   ~/.skill-router state files
  hosts/{base,claude-code,codex}.ts
plugins/claude-code/         Claude Code plugin asset
plugins/codex/               Codex plugin asset and slash command prompt
shared/                      Shared Agent Skill source and host overlays
scripts/                     build / install / uninstall helpers
tests/                       node:test suites and fixtures
```

`plugins/*/lib/` 下的 generated bundles 是构建产物，已被 gitignore。生成的 skill / prompt assets 会被跟踪，以便 fresh checkout 后可直接安装插件；请重新生成它们，而不是手工编辑。
