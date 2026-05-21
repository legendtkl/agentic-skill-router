# skill-router

[English](README.md) | 简体中文

`skill-router` 是面向受支持宿主的 Agent Skills 管理 CLI 与安装资产。它会枚举已安装 skills、读取本地会话记录中的使用情况、建议过期或长期未使用的 skills，并通过重命名 `SKILL.md` 的方式安全禁用或恢复指定 skill。

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

已安装的插件 bundle 也会提供 `bin/skill-router`。在已安装插件根目录下运行以下命令，或使用安装脚本输出的绝对路径。

已安装的 Claude Code 插件：

```bash
bin/skill-router skills list
bin/skill-router skills suggest --json
bin/skill-router skills route --query "draft a Lark mail reply" --json
bin/skill-router skills route --mode=metadata --query "draft a Lark mail reply" --json
bin/skill-router skills route --mode=body --query "draft a Lark mail reply" --json
bin/skill-router skills dci search --query "find a disabled skill for this request" --query "lark mail reply" --json
bin/skill-router skills dci open dci-abc123def0 --line=20 --window=80 --json
bin/skill-router skills disable user:lark-mail --yes
bin/skill-router skills enable user:lark-mail
bin/skill-router skills status
```

已安装的 Codex 插件：

```bash
bin/skill-router skills list
bin/skill-router skills suggest --json
bin/skill-router skills route --query "draft a Lark mail reply" --json
bin/skill-router skills route --mode=metadata --query "draft a Lark mail reply" --json
bin/skill-router skills route --mode=body --query "draft a Lark mail reply" --json
bin/skill-router skills dci search --query "find a disabled skill for this request" --query "lark mail reply" --json
bin/skill-router skills dci open dci-abc123def0 --line=20 --window=80 --json
bin/skill-router skills disable user:codex:lark-mail --yes
bin/skill-router skills enable user:codex:lark-mail
bin/skill-router skills status
```

`--unused-for=<duration>` 支持 `30`、`30d`、`2w`、`3m` 和 `1y`。持久化默认配置位于 `~/.skill-router/config.json`：

```json
{ "unusedForDays": 60, "routeMode": "auto" }
```

已安装的插件 CLI 会自动识别宿主；从仓库 checkout 直接运行 CLI 时默认目标是 Claude Code，主要用于本地开发。

## 工作原理

同一个 Agent Skills 源通过多种宿主安装入口分发：

- `skills/skill-router-skills/SKILL.md` 是唯一 source of truth。
- `skills/skill-router-skills/references/` 存放共享工作流细节。
- `bin/skill-router` 和 `lib/skill-router.mjs` 是共享 CLI runtime。
- `plugins/claude-code/` 与 `plugins/codex/` 只提供宿主 manifest 和宿主入口。
- 安装脚本会把同一份 `skills/`、`bin/` 和 `lib/` 复制到目标宿主的本地插件缓存中。
- 安装后的 manifest 会被规范化为 `./skills/`，源码和 npm 包中的 manifest 则指向顶层统一 `skills/`。
- `plugins/codex/prompts/skill-router-skills.md` 是 Codex slash command 的生成 shim。

不要创建宿主专属的 `SKILL.md` 副本；应更新统一 skill 源，然后重新安装或构建。

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
- `lexical` 是快速 description / name 匹配器。
- `body` 搜索已禁用 skill 正文，并只选择置信度足够高的 top candidate。
- `dci` 是有界 body search / body verification 的兼容命令组。
- `auto` 是默认模式：先运行 metadata；当 metadata 低置信、歧义或指向宽泛 umbrella skill 时，再使用有界正文验证。
- 高置信路由会返回 `action: "read-skill-file"` 和 `selected.skillMdPath`。
- 返回路径可能以 `SKILL.md.skill-router-disabled` 结尾；它仍然可以作为指令安全读取。
- 路由使用会写入状态文件，便于后续识别频繁被代理调用的已禁用 skills。
- 如果 metadata 路由不够确定，Skill Router 可以使用有界 body-verification 工具：
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

### SKILL.md frontmatter 支持范围

`skill-router` 内置一个零依赖的最小 YAML parser，只处理 Claude Code / Codex
SKILL.md 实际使用的子集。支持的写法：

- 顶层标量 `key: value`，可加引号 (`"..."`/`'...'`)；未加引号的标量会去除行尾
  ` # comment`。
- 顶层 key 的字面量 (`|`) 与折叠 (`>`) block 字符串（如多行 `description`）。
- 顶层数组：内联 `tags: [feishu, email]` 或 block list `- item`。

**不支持**：嵌套 mapping（例如 `metadata.routing.aliases`）、anchors/aliases、
tags、flow mappings、多文档流。遇到嵌套 mapping 时该 key 会被丢弃，并产生如下
警告：

```
frontmatter: skipped nested mapping under `metadata` (line 7)
```

警告会附加在 skill 记录的可选字段 `frontmatterWarnings` 上，并在
`skills list --json` 输出中体现，便于发现被静默跳过的字段。请把所有路由相关
metadata 放在顶层（参考上面的 `lark-mail` 示例）。

## 故障排查

参见 [`docs/troubleshooting.md`](docs/troubleshooting.md)（暂为英文，中文版后续补齐），
覆盖 `skill-router skills status` 可能打印的每一类异常段落的恢复流程：split-brain 冲突、
孤立的禁用标记文件、孤立的 state 记录、损坏的 state 文件、插件升级后的 reapply 行为、
以及禁用 skill 后再卸载的安全顺序。能用 `skill-router skills enable <id>` 解决就不要直接 `rm`。

## 开发

需要 Node.js >= 20（与 CI 保持一致）。

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

本地复现 CI（与 `.github/workflows/ci.yml` 一致）：

```bash
npm ci
npm run check:assets
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

需要联网的端到端套件（`npm run test:e2e`、`npm run test:e2e:codex`、
`npm run test:e2e:claude`）不会在 CI 中运行；需要时在本地手动执行。

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
bin/                         共享 CLI wrapper
lib/                         生成的共享 CLI bundle
skills/                      统一 Agent Skill 源
plugins/claude-code/         Claude Code plugin manifest
plugins/codex/               Codex plugin manifest and slash command prompt
scripts/                     build / install / uninstall helpers
tests/                       node:test suites and fixtures
```

`lib/` 下的 generated bundle 是构建产物，已被 gitignore。Codex slash prompt 是生成资产，以便 fresh checkout 后可直接安装插件；请重新生成它，而不是手工编辑。
