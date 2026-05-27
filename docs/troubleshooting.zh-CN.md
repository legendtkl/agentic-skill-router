# `skills status` 异常排查（简体中文）

> 这是 [`docs/troubleshooting.md`](troubleshooting.md) 的中文版本。覆盖相同的恢复流程；如有差异以英文版为准。

## 安全第一

- **优先使用 rename，避免删除。** Agentic Skill Router 从不删除 `SKILL.md`。它通过 `rename(2)` 在
  `SKILL.md` 与 `SKILL.md.agentic-skill-router-disabled` 之间切换。
  恢复异常状态的安全原语永远是 `agentic-skill-router skills enable <id>`，而不是 `rm`。
- **不要手动编辑 `~/.agentic-skill-router/state-<host>.json`**，除非本文明确允许。需要变更 state 时
  使用 `skills enable` / `skills disable`。
- **修改后重启 host。** Claude Code 和 Codex 都在启动时加载 skills，文件系统变更要
  在下一个会话才生效。
- **内置 / 系统 skill 受保护。** 它们会出现在 `skills list`，但不能被禁用，因此不会
  出现在下文任何异常列表中。

## Out-of-root symlink skill

当 skills root 里某个 skill 本身是符号链接，指向 host skills tree 之外的位置
（例如 `~/.claude/skills/lark-mail` → `/shared/skills/lark-mail`），
`agentic-skill-router` **不会**默默 rename 链接的目标文件。disable / enable / status
都会以明确的错误信息拒绝，并要求显式确认。

要继续，重新执行命令并加 `--allow-symlink-target-mutation`：

```bash
agentic-skill-router skills disable user:codex:lark-mail --yes --allow-symlink-target-mutation
agentic-skill-router skills enable  user:codex:lark-mail --allow-symlink-target-mutation
```

- mutation 修改的是**链接目标文件**（例如
  `/shared/skills/lark-mail/SKILL.md` ↔
  `/shared/skills/lark-mail/SKILL.md.agentic-skill-router-disabled`），
  不是 in-root 的符号链接本身。
- `skills status`（内部调用 `reapplyMissing`）永远不会默默 mutate out-of-root target。
  如果 disable 之后目标文件被外部恢复，status 会在
  `skipped (out-of-root symlink, manual repair required)` 段落列出，并打印可直接执行的
  `--allow-symlink-target-mutation` 修复命令（若 id 有歧义，则给出包含 `instanceKey` 的手动修复提示）。
- state record 保存原始 mutate 的 canonical realpath。如果之后符号链接指向新位置，
  enable / reapply 会以 mismatch error 拒绝（并打印两个路径），而不是改动新目标。
  手动恢复：自己把 canonical disabled marker rename 回 `SKILL.md`，然后运行
  `agentic-skill-router skills enable <id>` 清理 state record。

### 如果误改了某个 symlink target

如果运行了 `--allow-symlink-target-mutation` 并禁用了不该禁用的文件，从警告里找到
canonical 路径，手动 rename 回来：

```bash
mv /shared/skills/lark-mail/SKILL.md.agentic-skill-router-disabled \
   /shared/skills/lark-mail/SKILL.md
agentic-skill-router skills enable user:codex:lark-mail   # 清理 state record
```

CLI 从不删除内容，文件始终可恢复。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| State (Claude Code) | `~/.agentic-skill-router/state-claude-code.json` |
| State (Codex) | `~/.agentic-skill-router/state-codex.json` |
| 启用的 skill 文件 | `<root>/<skill>/SKILL.md` |
| 禁用的 skill 文件 | `<root>/<skill>/SKILL.md.agentic-skill-router-disabled` |
| 损坏 state 备份 | `~/.agentic-skill-router/state-<host>.json.malformed.<ts>.bak` |

skill roots 由 host 提供，详见 `README.md` 的 "How It Works" 章节。

## `skills status` 输出字段

下面每节对应 `skills status` 文本输出中可能出现的一个异常段落，并给出推荐的恢复
步骤。完整字段列表见英文版；这里只覆盖恢复关键点。

### `recovered (in-flight ops committed from journal): <id...>`

上一次 disable/enable 在写完 journal 后崩溃，但 rename 已经发生。`status` 已经
将其推进到目标终态。**无须人工干预。**

### `rolled back (in-flight ops with no completed rename): <id...>`

上一次操作的 journal 还在，但 rename 没有发生。`status` 已经回滚意图。**无须
干预。**

### `reapplied (upstream restored these): <id...>`

state 中有 disable 记录，但外部流程把 `SKILL.md` 重新放了回来。`status` 又
rename 回 disabled marker，以保持 state record 与 disk 一致。如果你确实希望
re-enable，运行 `agentic-skill-router skills enable <id>`。

### `orphaned records (SKILL.md gone entirely; run \`enable <id>\` to clean state): <id...>`

state 仍有 disable record，但磁盘上两份文件都不在了（plugin 卸载、目录被删除等）。
推荐操作：

```bash
agentic-skill-router skills enable <id>   # 不会创建新文件；仅清理 state record
```

### `⚠ CONFLICTED — both SKILL.md and SKILL.md.agentic-skill-router-disabled present`

磁盘上同时存在 enabled 与 disabled 两份文件。`agentic-skill-router` 不会自己选择，需要
你手动决定保留哪份：

```bash
# 保留 enabled 版本：
rm <root>/<skill>/SKILL.md.agentic-skill-router-disabled
agentic-skill-router skills enable <id>

# 保留 disabled 版本：
rm <root>/<skill>/SKILL.md
# state record 已正确，无需进一步操作
```

如果不确定，先备份两份再做决定。

### `orphan disabled markers (no state record; left from a previous tool or crash)`

磁盘上有 disabled marker，但 state 不知道。可能来自旧工具或异常崩溃。因为没有
state record，`skills enable <id>` 不能直接恢复。安全做法是先手动 rename 回
`SKILL.md`，再按你的目标操作：

```bash
mv "<path>.agentic-skill-router-disabled" "<path-without-suffix>"
agentic-skill-router skills status
```

如果你仍希望保持 disabled，先按上面步骤恢复 `SKILL.md`，再运行
`agentic-skill-router skills disable <id> --yes`，让 CLI 重新写入 state record。

### `pending operations needing manual resolution (split-brain on disk)`

journal 里有 in-flight 操作，但 reconcile 无法判断终态（磁盘两份都在或两份都不在）。
按提示手动修复，然后再运行 `skills status` 让 journal 清空。

### `routed usage`

只是信息：列出最近被 router 命中的 skill。**无须干预。**

## state record 存在但文件丢失

通常对应 `orphaned records` 段落。运行 `agentic-skill-router skills enable <id>` 清理。

## state 文件损坏

常见有三种情况：

1. JSON 非法：报 `state file at <path> is not valid JSON` 并中止。
2. schema/host 不符合预期：报 `state file at <path> has unexpected schema` 并中止。
3. 只有部分记录损坏：打印 warning，并把原始快照写到
   `<path>.malformed.<ts>.bak`。

注意：出现第 3 种情况时，CLI 不会立刻重写磁盘上的 state 文件；只有后续执行
会写 state 的命令（如 `skills disable` / `skills enable` / `skills reset`）时，
才会把内存中的清理结果写回。若暂时不打算执行这些命令，请按英文版流程手动修复。

## Plugin 升级 + `skills reapply`

plugin 升级后 `SKILL.md` 可能被覆盖。运行 `agentic-skill-router skills status` 让
`reapplyMissing` 重新 rename 即可。

## 禁用 skill 后卸载 plugin

先 enable 再卸载，避免 state 留下 orphan record。

## 手动删除 `.agentic-skill-router-disabled` 何时安全

仅当满足全部条件：你已确认整个 plugin 目录会被删除；没有匹配的 state record；
你确认该文件确实是 disabled marker 而不是其他备份。

其他所有情况都优先用 `mv …/SKILL.md.agentic-skill-router-disabled …/SKILL.md` 或
`agentic-skill-router skills enable <id>`。

## 相关链接

- [README — Web UI safety](../README.md#web-ui-safety): bind 默认值、
  `--dangerously-bind-public` 流程、`--project-root` allowlist 语义。
- [English version](troubleshooting.md).
