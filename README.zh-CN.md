# skill-router

[English](README.md) | 简体中文

`skill-router` 是面向受支持宿主的 Agent Skills 管理 CLI 与安装资产。它会枚举已安装 skills、读取本地会话记录中的使用情况、建议过期或长期未使用的 skills，并通过重命名 `SKILL.md` 的方式安全禁用或恢复指定 skill。

Subagent 管理不属于本仓库范围。

## 快速开始

推荐通过 npm 全局安装：

```bash
npm install -g skill-router
skill-router init
```

`skill-router init` 会交互式选择目标 agent（`codex` 或 `claude-code`）和安装范围（`project` 或 `global`）。非交互示例：

```bash
skill-router init codex project
skill-router init codex global
skill-router init claude-code project
skill-router init claude-code global
```

init 完成后，如果目标 agent 已在运行，请重启它，然后让已安装的 `skill-router-skills` skill 审计、精简或路由已安装 skills。

也可以用 `npx` 做一次性项目初始化试用；但推荐全局安装，这样生成的 skill 能引用稳定的 CLI 路径：

```bash
npx --package skill-router skill-router init codex project
```

从源码 checkout 安装插件仍然可用，适合本地开发或需要 Codex slash-command shim 的场景：

```bash
npm install
npm run install:plugin        # Claude Code plugin
npm run install:codex-plugin  # Codex plugin 和 /skill-router:skills prompt
```

安装 Codex 插件后，重启 Codex，然后运行：

```text
/skill-router:skills
```

## CLI

已安装的插件 bundle 会提供一个轻量 `bin/skill-router` wrapper。在已安装插件根目录下运行以下命令，或使用安装脚本输出的绝对路径。

已安装的 Claude Code 插件：

```bash
bin/skill-router skills list
bin/skill-router skills suggest --json
bin/skill-router skills corpus search --all mail --any lark --limit 30 --json
bin/skill-router skills corpus inspect corpus-abc123def0 --json
bin/skill-router skills corpus select corpus-abc123def0 --query "draft a Lark mail reply" --confidence high --reason "metadata mentions Lark mail" --json
bin/skill-router skills disable user:lark-mail --yes
bin/skill-router skills enable user:lark-mail
bin/skill-router skills status
```

已安装的 Codex 插件：

```bash
bin/skill-router skills list
bin/skill-router skills suggest --json
bin/skill-router skills corpus search --all mail --any lark --limit 30 --json
bin/skill-router skills corpus inspect corpus-abc123def0 --json
bin/skill-router skills corpus select corpus-abc123def0 --query "draft a Lark mail reply" --confidence high --reason "metadata mentions Lark mail" --json
bin/skill-router skills disable user:codex:lark-mail --yes
bin/skill-router skills enable user:codex:lark-mail
bin/skill-router skills status
```

`--unused-for=<duration>` 支持 `30`、`30d`、`2w`、`3m` 和 `1y`。持久化默认配置位于 `~/.skill-router/config.json`：

```json
{ "unusedForDays": 60 }
```

已安装的插件 CLI 会自动识别宿主；从仓库 checkout 直接运行 CLI 时默认目标是 Claude Code，主要用于本地开发。

## 工作原理

同一个 Agent Skills 源通过多种宿主安装入口分发：

- `skills/skill-router-skills/SKILL.md` 是唯一 source of truth。
- `skills/skill-router-skills/references/` 存放共享工作流细节。
- `bin/skill-router` 和 `lib/skill-router.mjs` 是共享 CLI runtime。
- `plugins/claude-code/` 与 `plugins/codex/` 只提供宿主 manifest 和宿主入口。
- 安装脚本会把共享 runtime 复制到 `~/.skill-router/runtime/<version>/`，再把宿主 manifest、skills 和一个很小的宿主 wrapper 复制到目标宿主的本地插件缓存中。wrapper 会设置 `SKILL_ROUTER_HOST`，再转发到共享 runtime。
- `plugins/codex/prompts/skill-router-skills.md` 是 Codex slash command 的生成 shim。
- `skill-router init` 可以在不安装宿主插件的情况下，为 Codex 或 Claude Code 创建项目级或全局 skill 入口。

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

- 默认 agent workflow 是 L-agentic：agent 先从用户请求里构造 must/probe terms，用 `skills corpus search` 搜索已禁用 skill 元数据；必要时用 `skills corpus inspect` 检查小候选集；最后用 `skills corpus select` 记录且只选择一个 skill。
- 检索阶段不能读取已禁用 skill 正文；选择依据只来自元数据。
- `skills corpus search` 读取 `id`、`name`、`description`、aliases、tags、tools、domains、intents 和 examples，返回稳定 `corpus-...` refs，不暴露本地文件路径。
- `skills corpus select <ref>` 会写入路由使用记录，并返回 `selected.skillMdPath`；返回路径可能以 `SKILL.md.skill-router-disabled` 结尾，仍可作为指令安全读取。
- 如果元数据证据弱或歧义，应停止 router 路径，正常继续处理，不选择已禁用 skill。

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
npm run check:pack
```

`npm run check:pack` 会在 `npm run build` 之后运行，校验
`bin/skill-router --help` 退出码为 0 且输出非空，并解析
`npm pack --dry-run` 文件列表，确认 `bin/`、`lib/`、`skills/`、两个插件
manifest 以及 Codex 的 prompt 文件都被包含。

端到端测试按外部依赖分为三层，便于 CI 默认只跑不依赖网络/agent 的部分：

| 层级 | 脚本 | 依赖 | CI 默认 |
| --- | --- | --- | --- |
| Offline | `npm run test:e2e:offline` | 仅需要 `node` / `npm` 和打包后的 CLI，不联网、不需要任何鉴权 | 每个 PR 与推 `main` |
| Network | `npm run test:e2e:network`（别名：`npm run test:e2e`） | 需要联网拉取固定 ref 的 `openai/skills` 仓库 | Nightly 定时任务 + 手动 `workflow_dispatch` |
| Agent | `npm run test:e2e:agent`（或单 host 的 `npm run test:e2e:codex` / `npm run test:e2e:claude`） | 需要本地存在 `codex` / `claude` CLI 及其鉴权文件 | 仅手动 `workflow_dispatch`，且必须由带 `skill-router-agent-e2e` label 的 self-hosted runner 承接（缺少二进制时测试会自动跳过） |

涉及 host 安装、插件加载、slash prompt 或面向 agent 的工作流时，请在本地
跑相应的更高层。Agent 层在缺少二进制或鉴权文件时会自动跳过。

CI 中的 `e2e-agent` job 使用 `runs-on: [self-hosted, skill-router-agent-e2e]`。
若未配置带这个 label 的 self-hosted runner，手动触发的 agent 层任务会一直
排队、不会真正运行 —— 这是有意的，因为 GitHub 托管 runner 不具备本地
`codex` / `claude` 二进制和鉴权文件，跑下去也只是测试自跳过。要真正在 CI
里跑 agent 层，请注册一台 self-hosted runner，打上 `skill-router-agent-e2e`
label，并把 `codex`、`claude` 放进 PATH 配好对应鉴权。

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
