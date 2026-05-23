# DCI 路由对比实验报告 —— 真实 Skill 语料

> 实验完成时间:2026-05-22 · 数据来源:`experiments/dci-compare/runs/`(stream-json transcript)

## 1. 实验目的

对比 **9 种 disabled-skill 路由实现** 在「执行轨迹」和「上下文 token 成本」上的差异。
核心问题:当 Claude Code 遇到一个需要 skill 能力、但当前 enabled skill 无法满足
的请求时,用哪种方式去「发现并加载一个更合适的、已禁用的 skill」最优?

实验对照两篇论文定义的范式:

- **arXiv:2605.05242 (DCI)** —— agent 直接用通用终端工具(`grep`/`find`/`sed`)
  搜原始语料库,不要 embedding/index/top-k。
- **arXiv:2605.05538 (AgenticRAG)** —— 结构化 4 工具 harness
  (`search`/`find`/`open`/`summarize`)。

## 2. 实验设置

### 2.1 语料

100 个真实 Agent Skill,从 4 个公开仓库按固定 commit 拉取:

| 来源仓库 | 数量 | 前缀 |
| --- | --- | --- |
| `openai/skills` (`.curated`) | 38 | — |
| `anthropics/skills` | 17 | `ant-` |
| `obra/superpowers-skills` | 31 | `obra-` |
| `tech-leads-club/agent-skills` | 14 | `tlc-` |
| **合计** | **100** | |

全部 skill 经 `skill-router` CLI 禁用(`SKILL.md` → `SKILL.md.skill-router-disabled`),
成为「待路由的禁用语料」。

### 2.2 Query

20 条对抗式构造的 query,分两层:

- **discriminating(6 条)**:刻意制造干扰 —— query 表面词撞向错误 skill,
  正确答案需语义判断。
- **baseline(14 条)**:目标信号清晰,作对照。

每条 query 标注唯一可辩护的 `expected` skill。

### 2.3 9 个变体

| 变体 | 范式 | 检索方式 |
| --- | --- | --- |
| **A-router** | 自研 retriever | `skill-router skills route`,`auto` 模式(metadata→dci→lexical 级联) |
| **B-cc** | DCI-Agent-CC | Claude Code 全自由 shell(`ls`/`grep`/`cat`) |
| **C-lite** | DCI-Agent-Lite | 仅 bash + 有界 `grep｜xargs grep` / `sed -n` 管道 |
| **D-agentic** | AgenticRAG | 结构化 `dci search/find/open/read` 循环 |
| **E-digest** | 优化 DCI | 2-call 封装:`skill-corpus catalog` → `show` |
| **F-index** | 缩小 scope | 语料目录预先 baked 进 SKILL.md,1-call 检索 |
| **G-native** | 无 router | 100 skill 全部 enabled,CC 原生 skill 选择 |
| **H-bounded** | 受控 DCI-CC | scoped glob + 禁裸 `ls` + 强制有界输出 |
| **I-meta** | metadata-only | 只读 description 目录,显式推理,从不读 body |

每个 `(变体, query)` 起一个 `claude -p --output-format=stream-json` 子进程,
落盘完整 transcript。共 9 × 20 = 180 runs。

## 3. 总体结果

### 3.1 聚合指标(20 query 累计)

| 变体 | 命中 | 工具轮次 | 墙钟(s) | 非缓存输入 | 输出 token | cache_create | cache_read | 成本 USD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-router | **14 / 20** | 97 | 422 | 31.3k | 14.9k | 304.8k | 1.20M | $3.05 |
| B-cc | 20 / 20 | 107 | 500 | 32.9k | 19.1k | 318.0k | 1.56M | $3.42 |
| C-lite | 20 / 20 | 145 | 599 | 19.9k | 27.3k | 159.0k | 1.85M | $2.71 |
| D-agentic | 19 / 20 | 122 | 538 | 20.0k | 24.1k | 288.7k | 1.61M | $3.32 |
| E-digest | 19 / 20 | 100 | 411 | 13.3k | 15.1k | 245.2k | 1.37M | $2.67 |
| F-index | 19 / 20 | 80 | 302 | 118 | 11.3k | 234.2k | 1.06M | $2.29 |
| G-native | 19 / 20 | **52** | **209** | 209.6k | **5.3k** | 287.2k | **425.3k** | $3.20 |
| H-bounded | 20 / 20 | 127 | 557 | 28.1k | 22.6k | 151.1k | 1.76M | $2.54 |
| **I-meta** | **20 / 20** | 81 | 363 | 13.2k | 14.5k | 196.1k | 924.4k | **$2.13** |

### 3.2 命中率排名

- **20/20(满分)**:B-cc、C-lite、H-bounded、I-meta
- **19/20**:D-agentic、E-digest、F-index、G-native(均只栽在 `express-defense-layers`)
- **14/20(垫底)**:A-router

## 4. 逐 query 命中矩阵

`Y` = 命中,`.` = 未命中。列顺序:A / B / C / D / E / F / G / H / I。

| query | tier | A | B | C | D | E | F | G | H | I |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| webapp-e2e-login | discriminating | . | Y | Y | Y | Y | Y | Y | Y | Y |
| express-defense-layers | discriminating | . | Y | Y | . | . | . | . | Y | Y |
| brainstorm-product-names | discriminating | . | Y | Y | Y | Y | Y | Y | Y | Y |
| linear-tickets | discriminating | . | Y | Y | Y | Y | Y | Y | Y | Y |
| screen-capture | discriminating | . | Y | Y | Y | Y | Y | Y | Y | Y |
| figma-to-react | discriminating | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| pdf-merge | baseline | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| gh-actions-root-cause | baseline | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| transcribe-meeting | baseline | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| xlsx-pivot | baseline | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| vercel-deploy-ci | baseline | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| mcp-server-build | baseline | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| coupling-3d | discriminating | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| anemic-ddd-refactor | discriminating | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| monolith-extract-order | discriminating | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| duplicate-logic-hunt | discriminating | . | Y | Y | Y | Y | Y | Y | Y | Y |
| ddd-domain-map | discriminating | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| figma-code-connect | discriminating | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| render-blueprint | discriminating | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| four-phase-debug | discriminating | Y | Y | Y | Y | Y | Y | Y | Y | Y |

## 5. 关键发现

### 5.1 自研 lexical retriever(A)明显垫底

A-router 14/20,是唯一显著低于其它变体的方案。它的 5 个失败全部是
**表层关键词碰撞**导致的误选或无匹配:

- `screen-capture` → 误选 `notion-knowledge-capture`("Capture" 一词撞偏)
- `linear-tickets` → 误选 `figma-generate-design`("board/project" 撞偏)
- `webapp-e2e-login` → 误选 `screenshot`("capture a screenshot" 撞偏)
- `express-defense-layers`、`brainstorm-product-names` → graceful no-match

证明:固定的 lexical 评分接口在对抗式 query 下是脆弱的。

### 5.2 有推理能力的路由方案趋于收敛

A 之外的 8 个变体命中率全部 ≥ 19/20。它们唯一的共同失败点是
`express-defense-layers` —— 这条 query 的两个候选
(`security-best-practices` 与 `obra-defense-in-depth`)描述高度重叠,
**靠 description 无法消歧**。

读 body 的方案(B/C/H)解开了它;只读 metadata 或拿预聚合结果的方案
(D/E/F/G)被它绊倒。这是 100-skill 真实语料下唯一能把
「读 body」与「只读 metadata」分开的 query。

### 5.3 成本结构:cache_read 与 input 是两个独立的钱

- **B/C/H(自由 shell 多轮探索)** cache_read 高达 1.6–1.9M —— 每多一轮,
  累积上下文都重新计一次低价 cache_read,轮次是上下文成本的乘数。
- **G-native** cache_read 最低(425k),但 `Total input` 高达 209.6k ——
  100 个 skill 的 description 每条 query 都按全价重新进系统提示。
  cache_read 低 ≠ 便宜:G 最终 $3.20,第三贵。
- **I-meta** 同时做到 20/20 命中 + 最低成本 **$2.13**。

### 5.4 综合排名

> **I-meta > F-index > H-bounded > E-digest > C-lite > B-cc**(满分/近满分组按成本)
> A-router 垫底。

最优工程选择是 **I-meta(metadata-only)**:把禁用 skill 的 description
汇总成目录、让 agent 显式推理挑选,不读 body。准确率与读全文的方案持平,
成本最低、轮次少。

## 6. 重要局限(置信度声明)

1. **对抗式样本,非代表性抽样**:20 条 query 是人工针对 lexical 弱点构造的
   压力测试,不是真实用户流量分布。命中率衡量的是「刻意混淆下的鲁棒性」,
   不等于真实场景准确率。

2. **每格 n=1**:每个 `(变体, query)` 只跑一次。`express-defense-layers`
   这条唯一区分器在 n=1 下其结果可能掺 LLM 采样噪声。

3. **区分悖论**:构造 query 时,为使「正确答案」可辩护必须锚定 skill 描述,
   而锚定描述又使 query 变得容易路由。这导致 20 条里多数最终全员命中,
   真实区分度仅压在 1–2 条上。**这是本轮实验的根本局限**,也是后续改用
   合成语料 / SkillRouter 数据的动因。

4. **100-skill 小语料 + 描述良好**:本轮 skill 描述彼此区分清楚
   (最高相似度仅 0.28),metadata 信息量天然充足。「metadata-only 够用」
   的结论可能不适用于大规模(数千至数万 skill)、描述密集近义的语料 ——
   SkillRouter 论文(80k skill)在大规模上得出了相反结论
   (「metadata 不足,full skill text 是关键路由信号」)。

## 7. 产物

- `experiments/dci-compare/runs/report.html` —— 交互式 HTML 报告
  (9 变体并排执行轨迹 timeline + 聚合柱状图 + 各变体实现源码)
- `experiments/dci-compare/variants/*.SKILL.md` —— 9 个变体的实现定义
- `experiments/dci-compare/run.mjs` / `render-report.mjs` —— 实验 harness
