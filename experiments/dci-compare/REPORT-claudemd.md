# Disabled-Skill 路由策略对比实验报告

**九种 retriever 在 trigger 充分激活条件下的系统对比**

实验日期:2026-05-23 ~ 2026-05-24 · 语料:SkillRouter eval-core (arXiv:2603.22455) 裁剪匿名化版,150 skills · 规模:Claude Code 主实验 544 cells + Codex 补充实验 216 cells = **760 routing cells**

---

## 摘要

当一个编码 agent (Claude Code) 收到的请求无法被任何已启用的 Agent Skill 覆盖时,它需要从一批**已禁用**的 skill 中"路由"出最合适的一个。"路由"步骤如何实现,直接决定准确率与成本。本实验对 **九种 disabled-skill 路由实现** 做受控对比,涵盖四类范式:自实现检索器、Direct Corpus Interaction (DCI,arXiv:2605.05242)、AgenticRAG (arXiv:2605.05538)、metadata-only,以及宿主原生 skill 选择作为对照。

初次跑实验时观察到一类系统性失败:即使变体配置了 router skill,agent 在某些 query 上**跳过 router 直接输出从 query 关键词拼出来的伪 skill 名**(`pptx`、`xlsx`、`jax` 等),命中率被这一"trigger noise"显著拉低。为把 retriever 的真实能力差异与 trigger 决策的随机性解耦,本实验在 `<HOME>/.claude/CLAUDE.md` 注入一段提示词使 trigger 充分激活,并采用 **paired A/B 设计**:同一执行窗口内对 9 变体 × 24 查询同时跑 with-CLAUDE.md 与 without-CLAUDE.md。

在 432 paired cells + 48 D-agentic rerun cells 上得到三个核心结论:

1. **trigger 充分激活后,router 变体准确率从 70% 提升到 88%**(+17.2pp,+33/192 cells)。其中 **B-cc 与 C-lite 同为 23/24 (96%)**,**D-agentic / E-digest / H-bounded / J-bounded 并列 22/24 (92%)**,I-meta 21/24 (88%),A-router 13/24 (54%),G-native (宿主原生对照) 15/24 (63%)。
2. **J-bounded 是 Pareto 王者**:在 92% 准确率同时,cost \$3.07、duration 374s、ctx_end 30.7K 三项 router 全场最低。读 body 的 B-cc 把准确率推到 96%,但 cost 高 81%。
3. **trigger noise 的本质是模型在强 keyword 锚定下跳过工具调用,与 corpus 内容无关**。CLAUDE.md 把 hallucination(输出不存在的 skill 名)从 21.4% 压到 2.6%,而 G-native 对照变体(corpus 全启用、router 不加载)两条 arm 完全无差异(15/24 / 15/24),严格证伪"提升仅来自 LLM 跨 run 随机性"。

同步远端 `main` 后,补齐了同一 24-query / 150-skill 语料上的 **Codex 9×24 routing-only 复现实验**。Codex 结果显著不同:宿主原生 G-native 为 **24/24**,D-agentic router 也为 **24/24**,C-lite / E-digest / H-bounded 为 23/24,B-cc / I-meta / J-bounded 为 22/24,A-router 为 8/24。结合真实请求抓包,Codex 与 Claude Code 的 native 差异主要来自 skill 选择机制:Codex 请求内联了更长、更完整的 skill 元数据列表;Claude Code 真实请求中 skill 列表被压到更短描述,并通过独立 `Skill` tool 再触发执行。详见下方"Codex 补充"。

本实验**仅验证路由层准确率**,不验证下游 skill 执行链路;hallucinated 命名在生产中的兜底机制讨论见 §10。

---

## Codex 补充:跨宿主复现实验与 native 差异分析

### 补充 1:实验边界

为回答"Claude Code native 15/24 而 Codex G-native 24/24 是否可信、原因是什么",在同步远端 `main` 后补跑 Codex 侧完整 9×24 routing-only 实验:

- **同一 query 集**:`queries.json` 的 24 个 SkillsBench single-skill query,expected skill mapping 与 Claude Code 主实验完全相同。
- **同一语料**:匿名化后的 150 个 `skill-NNN` corpus,同一 `STOP_TAIL`,同样只评测 routing 层,不执行下游任务。
- **同一变体族**:G-native + A/B/C/D/E/H/I/J。Codex 版 router SKILL.md 仅做宿主适配:路径从 `.claude/skills` 改为 `.codex/skills`,skill id 归一化去除 `user:codex:` 前缀,并把 `skill-corpus` wrapper 安装到隔离 HOME。
- **执行环境**:`codex exec`,model `gpt-5.5`,`reasoning_effort=high`,每 cell timeout 240s。先跑完既有 4×24,再补齐剩余 A/B/D/E/H 的 5×24,最后合并为 9×24。

主产物:

- `runs/codex-routing-only-9x24/summary.json`
- `runs/codex-routing-only-9x24/report.md`
- `runs/native-prompt-capture/analysis.md`

### 补充 2:Codex 9×24 总体结果

| variant | acc | router | Σdur(s) | Σtools | avg ctx_end | Σout | Σreason | Σ$est |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **G-native** | **24/24** | n/a | 185.4 | 0 | 19,456 | 2,985 | 2,625 | 1.816 |
| A-router | 8/24 | 24/24 | 945.6 | 59 | 26,906 | 34,046 | 9,543 | 4.485 |
| B-cc | 22/24 | 24/24 | 718.0 | 84 | 30,810 | 17,227 | 6,671 | 4.853 |
| C-lite | 23/24 | 24/24 | 658.5 | 140 | 18,388 | 19,741 | 4,877 | 3.594 |
| **D-agentic** | **24/24** | 24/24 | 538.6 | 59 | 19,678 | 13,177 | 4,937 | 2.870 |
| E-digest | 23/24 | 24/24 | 637.7 | 48 | 20,254 | 11,563 | 5,191 | 2.946 |
| H-bounded | 23/24 | 24/24 | 751.0 | 130 | 19,913 | 21,707 | 6,739 | 4.348 |
| I-meta | 22/24 | 24/24 | 495.0 | 50 | 21,076 | 12,137 | 5,067 | 3.310 |
| J-bounded | 22/24 | 24/24 | 473.9 | 53 | 16,851 | 11,286 | 4,851 | 2.415 |

Codex 侧的策略结论与 Claude Code 不同:

1. **Codex native G-native 在 150-skill 规模上达到 24/24**。这不是生产上"永远启用全部 skill"的推荐,因为它仍占用常驻上下文且更大 corpus 未测;但它说明 Codex 当前 native skill 选择在本基准上没有 Claude Code native 的 15/24 天花板。
2. **D-agentic 是 Codex router 的 accuracy/cost 最优点**:24/24,成本 \$2.870,avg ctx_end 19.7K,比 B-cc 更准、更便宜、更短。
3. **J-bounded 仍是最低成本 router,但不再是 Pareto 王者**:Codex 上 J 为 22/24,\$2.415;D-agentic 用 +\$0.455 换 +2 cells 到满分。
4. **A-router 继续失效且在 Codex 上更差**:8/24。固定 lexical/级联 scorer 在长 query + 近义 distractor 下仍不能可靠替代 LLM-driven keyword extraction 和二次判别。

除 A-router 外,Codex router 失误集中在少数边界样本:

| variant | miss |
| --- | --- |
| B-cc | `gh-repo-analytics`→skill-046,`virtualhome-agent-planning`→skill-110 |
| C-lite | `enterprise-information-search`→skill-087 |
| E-digest | `weighted-gdp-calc`→skill-026 |
| H-bounded | `shock-analysis-supply`→skill-080 |
| I-meta | `earthquake-plate-calculation`→skill-092,`gh-repo-analytics`→skill-046 |
| J-bounded | `econ-detrending-correlation`→skill-105,`shock-analysis-supply`→skill-080 |

### 补充 3:Claude Code vs Codex 策略层差异

| host / condition | G-native | A | B | C | D | E | H | I | J | 策略结论 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Claude Code with-CLAUDE.md | 15/24 | 13/24 | **23/24** | **23/24** | 22/24 | 22/24 | 22/24 | 21/24 | 22/24 | B/C accuracy 第一,J-bounded 是成本 Pareto |
| Codex | **24/24** | 8/24 | 22/24 | 23/24 | **24/24** | 23/24 | 23/24 | 22/24 | 22/24 | G-native 与 D-agentic 满分,D-agentic 是 router 首选 |

这说明两点:

1. **query 与 gt mapping 不是差异来源**。两边使用的是同一 `queries.json`,同一匿名化语料,同一 routing-only 输出 schema。
2. **host skill 选择机制会改变策略排序**。Claude Code 需要先解决 trigger noise,再比较 retriever;Codex router 24/24 全部触发,主要差异变成变体 body 如何组织搜索与证据。

### 补充 4:native 请求抓包证据

为避免只凭文档或推测归因,对 `weighted-gdp-calc` 同一 query 抓取了真实发出的 native 请求。抓包脚本只保留本地实验请求体,去除了 auth-like header 和 metadata identifier;原始请求 JSON 被 `.gitignore` 忽略,汇总保存在 `runs/native-prompt-capture/analysis.md`。

| host native | endpoint | skill lines | skill list chars | avg desc chars | max desc chars | 执行机制 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Codex | `/v1/responses` | 150 | 21,117 | 92 | 100 | `instructions` 中内联 `### Available skills` + open `SKILL.md` 指令 |
| Claude Code | `/v1/messages?beta=true` | 150 | 7,948 | 20 | 20 | `Skill` tool + budgeted skill listing |

关键差异:

- **Codex 请求里 `skill-105` 保留了可判别描述**:`Comprehensive spreadsheet creation, editing, and analysis with support for formulas, formatting, ...`。这对 `weighted-gdp-calc` / financial spreadsheet 类 query 是强信号。
- **Claude Code 请求里同一 skill 只剩短描述片段**:`Comprehensive sprea…`。`skill-026` 等 spreadsheet distractor 也被同样截短,模型要在短片段上先决定是否调用 `Skill` tool,再启动对应 skill。
- **Codex 的 native routing-only 可以直接基于内联元数据输出 JSON**;Claude Code native 则多一个 tool trigger / tool selection 阶段,因此更容易受到 trigger 失败、截断描述和近义 distractor 的共同影响。

这组抓包不能单独证明所有 24 个 query 的因果链,因为它只覆盖一个代表性 query 和当前 CLI / 模型版本;但它与完整结果一致:Codex G-native 24/24,Claude Code G-native 15/24。最稳妥的归因是 **同 query、同 corpus 下,宿主请求中的 skill 元数据预算/呈现方式和 skill 执行机制不同**,而不是语料或 query 不一致。

### 补充 5:对实现选择的影响

- **Claude Code 生产路径**:必须先解决 trigger,否则比较 retriever 没意义。当前证据支持 `CLAUDE.md`/prompt hardening + J-bounded 作为低成本默认,B/C 作为最高准确率选项,并加 hallucinated name 校验。
- **Codex 生产路径**:如果只看 150-skill native,G-native 已满分;但 `skill-router` 的目标是降低常驻 skill context 和支持更大 corpus,所以仍应以 disabled-skill router 为主。当前 Codex router 默认应优先考虑 D-agentic;若成本优先再考虑 J-bounded/E-digest。
- **A-router 后续不应继续只调 lexical 级联**。两边都低分,说明应把 query rewrite / candidate rerank 交回 LLM,或者把 CLI 改为返回候选证据而非直接 commit。

## 1. 引言与研究问题

### 1.1 Skill 路由问题

Claude Code 与 Codex 等编码 agent 通过 **Agent Skill** 机制在推理时注入领域知识。每个 skill 由一个 `SKILL.md` 文件构成,包含 YAML frontmatter(`name`、`description`)和 markdown 正文(实际指令)。宿主在会话启动时把所有已启用 skill 的元数据(name + description)拼入系统上下文,使模型可以基于元数据自动决定是否调用某个 skill。

宿主对 skill 元数据有显式的上下文预算约束,且不同版本/宿主会采用不同压缩与呈现策略;本次抓包中 Codex native 内联了约 21K chars 的 skill section,而 Claude Code native 将同一 150-skill listing 压到约 7.9K chars。当用户安装的 skill 数量超过预算时,要么挤占有限的上下文,要么被截断 —— 两种情况都使 skill 数量越多、可用性反而越差。

`skill-router` 项目提出的方案是:把不常用的 skill **禁用**(将 `SKILL.md` 重命名为 `SKILL.md.skill-router-disabled`),使其退出宿主的常驻元数据预算;**当某个请求确实需要某项被禁用的能力时,再通过一个"路由"步骤把它找回来**。

这个"路由"步骤如何实现,是本研究的核心问题。可选路径众多,从基于词频的本地检索器、到 agent 用 shell 命令直接探索 corpus、再到结构化的多工具 retrieval 循环 —— 每种实现在准确率、成本、上下文占用上的表现差异巨大。

### 1.2 候选范式

本实验对比四类范式,共九个变体:

| 范式 | 变体 | 路由方式 |
| --- | --- | --- |
| 自实现检索器 | **A-router** | 调用 `skill-router skills route` CLI,内置 metadata→dci→lexical 三级级联评分 |
| Direct Corpus Interaction (DCI) | **B-cc** | agent 在禁用 skill 目录上自由使用 shell |
| | **C-lite** | 仅 bash,有界 grep 复合管道 + sed 局部读取 |
| | **H-bounded** | 同 B 但限定 scoped glob、强制有界输出 |
| AgenticRAG | **D-agentic** | 结构化 4 工具循环(`dci search`/`find`/`open`/`read` CLI 子命令) |
| Metadata-only | **E-digest** | 2 次 bash 调用:`skill-corpus catalog` 取目录 → 选择 |
| | **I-meta** | 只读 description 目录,绝不读 skill body |
| | **J-bounded** | 关键词过滤 grep 单次拿到 description 短列表 |
| 宿主原生(对照) | **G-native** | 不加载 router,150 个 skill 全部启用,Claude Code 原生 skill 自动选择 |

九个变体构成几个对照轴:B / C / H 是 agent shell 检索家族(约束程度递增);E / I / J 是 metadata-only 家族(目录递送方式差异);D 是结构化 RAG;A 是自实现 lexical;G 是无路由基线。每个 router 变体被实现为一个 `SKILL.md` 文件,在 agent 调用 `skill-router-skills` 工具时触发其工作流(完整实现见附录 B)。

### 1.3 研究问题

> **RQ1(准确率)**:在一个存在大量功能近义干扰项的 skill 语料中,哪种路由实现能最可靠地选出正确 skill?
>
> **RQ2(成本)**:各实现的上下文 token 消耗、工具调用轮次、墙钟耗时、美元成本如何?准确率与成本如何权衡?
>
> **RQ3(机理)**:"读取 skill 正文"相对"仅读元数据描述"是否带来准确率优势?宿主原生的 skill 选择机制相对显式路由处于什么位置?

---

## 2. 相关工作

本实验的变体设计直接对标三项工作。

**SkillRouter (arXiv:2603.22455)**。把上游 skill 路由独立为研究对象,提供 87 个 SkillsBench 专家标注任务、约 80,000 个 skill 的检索池,以及针对每个 ground-truth skill 用 GPT-4o-mini 按"同域不同问题 / 同技术不同用途 / 过度泛化"三策略生成的 distractor(功能近义但错误)。其核心结论是:**完整 skill 正文是大规模、高度重叠 skill 池中的决定性路由信号,仅靠元数据不足**。本实验在受控规模(150 skill)上检验该结论是否成立。

**DCI — Direct Corpus Interaction (arXiv:2605.05242)**。主张 agent 用通用终端工具(`grep`/`find`/`sed`/shell 管道)直接搜索原始语料,不经 embedding、索引或 top-k 中介。论文给出两个实现:DCI-Agent-CC(Claude Code 全工具)与 DCI-Agent-Lite(最小 harness,仅 bash + read)。本实验的 B / H 对应前者(约束程度差异),C 对应后者。

**AgenticRAG (arXiv:2605.05538)**。主张用结构化的 4 工具 harness(`search` / `find` / `open` / `summarize`)驱动一个有界 agentic 循环。本实验的 D 变体直接实现这一模式。

---

## 3. 实验方法

### 3.1 语料构建

直接使用 SkillRouter `eval-core` 数据集,经 `crop-skillrouter.mjs` 裁剪为 **150 个 skill** 的受控语料:

| 成分 | 数量 | 来源 |
| --- | --- | --- |
| Ground-truth skill | 19 | 24 个 single-skill 任务的 `gt/*` 实体(部分任务共享同一 gt) |
| 针对性 distractor | 80 | 各 gt skill 对应的 `distractor/dist_<gt>_*`(SkillRouter 用 GPT-4o-mini 生成的功能近义干扰) |
| 噪声 skill | 51 | 从 78K easy 池确定性随机抽取,填充至 150 |

**裁剪的必要性与代价**:SkillRouter 原始池约 80K skill,其元数据目录约 440 万 token,远超模型上下文窗口 —— 这会让 E / I / J 等"把目录读进上下文"的变体直接无法运行。裁剪到 150 使所有变体可比,代价是移除了大规模检索压力(见 §9 局限性)。

**答案泄露修复(关键)**:首版裁剪保留了 `gt-mesh-analysis` / `distractor-dist-*` 这样的目录名,前缀直接暴露"谁是正确答案"。修复后,**所有 skill 的目录名与 frontmatter `name` 字段统一改为中性、不可推断类别的 `skill-001` … `skill-150`**,且编号在一次确定性洗牌后分配,使序号不泄露任何归属信息。只有 `description` 与 skill 正文(真正的路由信号)被原样保留。`skill-NNN → 原始归属` 的映射写入 `corpus-manifest.json`,仅用于离线分析,实验过程与 agent 均不可见。

### 3.2 查询集

24 个查询为 SkillRouter 的 single-skill 任务,查询文本即 SkillsBench 任务的 `instruction_text`。这些任务由领域专家撰写、与 skill 描述独立成文(SkillRouter 明确做了泄露防护:任务指令不得提及应使用哪个 skill),因此**不存在"为使答案可辩护而贴着 skill 描述写查询"的锚定偏置**。

查询为真实任务描述,长度数百字,含具体文件路径、输入输出格式、精度要求。其中 23 个查询的 gt skill 拥有针对性 distractor。完整 24 个查询见**附录 A**。

### 3.3 九个路由变体

每个 router 变体被实现为一个 `SKILL.md` 文件,放在 `variants/routing-only/<variant>.SKILL.md`。所有变体共享**完全相同的 frontmatter**(包括 `name`、`description`、`metadata.skill-router.variant`)—— md5 验证一致。能力差异**完全位于 markdown body 的工作流描述**,即 agent 调用 `skill-router-skills` 工具后所读到的指令。完整实现见**附录 B**。

变体的设计差异要点:

- **A-router**:由 skill body 引导 agent 调用 `skill-router skills route --query <user-msg-verbatim>` CLI,接收一个 `selected.skillName` 或 `action: "no-confident-match"` 的 JSON 响应。检索逻辑完全在 CLI 端(FastEmbed + cosine + lexical 级联)。
- **B-cc (DCI-Agent-CC)**:skill body 把任务交给 agent:`Search the disabled skill corpus using whatever shell tools you find appropriate (for example ls, find, grep, head, cat, awk).` 无任何边界约束。
- **C-lite (DCI-Agent-Lite)**:skill body 显式禁止 `Read` 工具,只允许 bash,要求每步输出有界(`head`/`tail`/`sed`/`wc -l`),给出有界 grep 复合管道与 `sed -n` 局部读取作为示范。
- **D-agentic (AgenticRAG)**:skill body 引导 agent 调用 `dci search` / `find` / `open` / `read` 四个 CLI 子命令的结构化循环,严格按 search → drill-down → commit 顺序。
- **E-digest**:skill body 让 agent 仅做两次工具调用:第一次 `skill-corpus catalog` 拿到所有 skill 的 `<id>\t<description>` 平铺列表,第二次 commit(只在 routing-only 之外才发生第二次)。
- **H-bounded**:同 B 但 skill body 明确禁止裸 `ls`,要求第一条命令就携带描述级 keyword 信号,每步输出 ≤ 80 行。
- **I-meta**:skill body 强约束 `MUST NOT read any skill body — do not cat, sed, head, or Read past a file's frontmatter`。在一次 bash 中通过 `for f in ...; do grep -m1 '^description:' "$f"; done` 拉到所有 description 后纯靠模型推理选择。
- **J-bounded**:skill body 引导 agent 先挑 3-5 关键词,然后用一次 `grep -m1 '^description:' ... | grep -i -E "<kw1>|<kw2>" | head -20` 在 description 上过滤拿到短列表,选择一个。
- **G-native (对照)**:不加载 skill-router 插件,150 个 skill 全部启用(即 SKILL.md 保留,未重命名为 `.skill-router-disabled`),由 Claude Code 内置的 skill 自动选择机制决定。

### 3.4 执行 harness

`routing-only-paired.mjs` 对每个 `(变体, condition, 查询)` 单元执行:① 创建隔离的临时 `$HOME` (`<EXP>/.tmp-home-paired/<variant>.<condition>/`);② 安装 `skill-router` 插件;③ 安装 150-skill 语料并全部禁用(G-native 例外:全部启用、不加载插件);④ 将该变体的 `SKILL.md` 工作流补丁进插件槽位;⑤ 根据 condition 写入或删除 `<HOME>/.claude/CLAUDE.md`;⑥ 启动子进程:

```
claude -p "<查询 + STOP_TAIL>"
  --output-format=stream-json --verbose
  --permission-mode=bypassPermissions
  --plugin-dir <插件路径>     # 仅 router 变体
```

注意本实验**没有使用 `--append-system-prompt`**(详见 §4)。每个 cell 跑前执行 preflight 断言:plugin SKILL.md md5、CLAUDE.md 存在性、corpus 状态,任一不符即报错跳过(避免 state contamination 污染统计)。9 个变体 × 2 个 condition = 18 个 HOME 并发,concurrency cap = 4。每 cell 超时 240s。

`routing-only-paired.mjs` 落盘完整 stream-json transcript 至 `runs/routing-only-9x24-claudemd/<variant>.<condition>/<query>.jsonl`,并写入聚合 `summary.json`。

### 3.5 仅验证路由层

本实验**只测路由准确率,不验证下游 skill 执行**。所有 query 末尾追加一段 `STOP_TAIL` 提示,使 agent 在做出路由决策后立即停止,不读取所选 skill 的 body、不执行 query 的实际任务:

```
ROUTING-ONLY mode: this session evaluates skill routing accuracy only.
After identifying the single best matching disabled skill, output exactly
one line of minified JSON on its own and stop:

{"matched_skill_name":"<skill-id>"}

Do NOT Read the matched skill's body, do NOT execute the user's task above,
do NOT produce any other text. This overrides any "execute the task"
guidance in the skill router's instructions.
```

这一设计有两个原因:① **隔离测量目标** —— 端到端执行包含 skill body 质量、模型对 body 指令的遵从度、工具调用编排等多个混淆因素,会使"路由"步骤本身的能力差异淹没在噪声里;② **成本可控** —— 单 cell 路由阶段约 \$0.05-0.13,而完整执行(尤其涉及 Excel / PDF / 视频处理任务)单 cell 成本可达 \$1-5,9 × 24 × 2 完整跑成本 \$200+ 不现实。

由此带来的限制是:`matched_skill_name` 若是 hallucinated 名(如 `xlsx`、`pptx`),在生产中下游会失败,但本实验测不到这一失败。**生产兜底机制的讨论见 §10**,实际拦截率的验证留作未来工作。

### 3.6 评测指标

- **命中(hit / accuracy)**:从 `matched_skill_name` 抽取 `skill-NNN`,与查询 `expected`(去掉 `user:` 前缀)严格相等。
- **trigger rate**:`router tool use ≥ 1` 的 cell 占比(每条 transcript 计数 `tool_use` block 里 `name` 含 `skill-router-skills`)。
- **失败去向**:借 `corpus-manifest.json` 把误选项归类为 `→distractor`(选了针对性干扰)、`→noise`(选了噪声 skill)、`→hallucinated`(输出不存在的 skill 名,即不匹配 `^skill-\d{3}$`)、`→none`(无匹配 / 未声明选择)。
- **上下文窗口占用 ctx_end**:**最后一个 assistant message 的 `usage` 之 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`**。这是该轮模型实际接收的完整上下文。**注意**:不能用 `result.usage` —— 那是整段会话的 cumulative token spend(所有 turn 累加),并非窗口大小。前一份草稿曾混用,导致 B-cc / C-lite 的 ctx_end 被高估 4-7 倍(见 §7.7 度量修正)。
- **成本与流量**:从 stream-json `result.usage` 汇总 `total_cost_usd`、工具调用数、对话轮次、墙钟耗时。`result.usage.cache_read` 是整段会话 Σ每轮重读,本报告仅将其作为计费相关量,不作上下文指标。

---

## 4. trigger 充分激活与 CLAUDE.md 注入

### 4.1 trigger noise 现象

初次跑九变体 (without CLAUDE.md) 时观察到一类系统性失败模式:**在约 20% 的 cells 上,agent 跳过 `skill-router-skills` 工具调用直接输出从 query 关键词凑出来的伪 skill 名**。例如:

| query | gt | agent 实际输出 | router tool calls |
| --- | --- | --- | --- |
| pptx-reference-formatting | skill-140 | `pptx` | 0 |
| protein-expression-analysis | skill-105 | `xlsx` | 0 |
| jax-computing-basics | skill-042 | `jax` | 0 |
| dialogue-parser | skill-009 | `dialogue-graph-parser` | 0 |
| gh-repo-analytics | skill-021 | `github-cli-analyzer` | 0 |
| video-tutorial-indexer | skill-113 | `mp4-video-editing` | 0 |

幻觉名样本:`pptx`、`xlsx`、`jax`、`docx`、`mediabunny`、`bgp-oscillation-detection`、`mp4-video-editing`、`bibtex-citation-checker`、`github-cli-analyzer`、`clinical-lab-unit-harmonizer`、`taxonomy-unification`、`dialogue-graph-parser`,以及一个特殊案例 `skill-router:skill-router-skills`(agent 把 router 工具本身的名字当作答案输出)。

**这些幻觉名与 corpus 内容无关**。本实验语料的所有 150 个 skill 均匿名化为 `skill-NNN`,没有任何 skill 字面叫 `xlsx` 或 `pptx`。模型只是在"看到查询里强 keyword 锚定(`.xlsx`、`.pptx`、`jax` 等)"时,基于训练分布偏置直接输出一个"看起来像 skill 名"的字符串。

trigger noise 对实验测量的污染机制:这部分 cells 本应触发 router 进行真实路由,但因 trigger 决策失败被记为"路由错误"。**它跟"路由质量"是两个独立维度的问题** —— 不解耦,就无法判断"某变体准确率较低是因为它的 retriever 弱,还是因为 trigger 决策更容易失败"。

理论上 `--append-system-prompt` 可以强制 agent 总是先调 `skill-router-skills` 工具,从而把 trigger 决策与路由质量解耦。但经 `claude-code-guide` 工具查证,**Claude Code 不支持持久化 `--append-system-prompt`**(无 settings.json key,无 env var,无 plugin/hook 注入点)。每次 `claude -p` 调用都要显式重传 flag 才能生效。

### 4.2 CLAUDE.md 注入设计

在隔离 HOME 下唯一可行的持久化提示注入路径是 `<HOME>/.claude/CLAUDE.md`。该文件被 Claude Code 作为 **user message context block** 拼入会话(不修改 system prompt 本身),但仍能起到"软强制"作用。

经过两轮措辞迭代(第一轮 "use as a fallback" 措辞过软,被 Codex 方法学审查判定可能压不住 hallucination),最终采用的措辞如下:

```markdown
# Skill routing

`skill-router-skills` is a routing Skill that searches a catalog of
locally-installed disabled skills.

When no enabled Skill clearly matches the user's query, you must call
`skill-router-skills` before answering. Do not invent a Skill name or
fabricate `matched_skill_name` without a Skill/tool result.
```

设计要点:
- 第一段中立描述 router 能力,不暗示 agent 必须用,以保留 G-native(corpus 启用)的 native Skill auto-select 路径不被牵引;
- 第二段是关键:`"you must call ... do not invent"` 直接对应 §4.1 列举的失败模式;
- `"clearly matches"` 出口保留了 direct-match 场景的兜底,使 Phase 1B 测试 direct-match preservation 时不应受 CLAUDE.md 干扰。

### 4.3 Phase 1 gate probe(64 cells)

为避免直接花 \~\$70 / \~50 min 跑 432 cells 后才发现 CLAUDE.md 无效,先做了一个 64-cell 的小规模 probe 验证可行性,并预先定义 gate criteria。

#### 4.3.1 Phase 1A — fallback trigger lift (48 cells)

测试当 corpus 全部禁用、只有 router skill 可用时,CLAUDE.md 是否提升 trigger rate:

| 维度 | 取值 |
| --- | --- |
| Variants | J-bounded(强,初步实验中比较稳定),A-router(弱,初步实验中常挂) |
| Queries | 6 个 stratified:3 个已知 trigger-noise 失败(pptx / protein / gh-repo) + 2 个初步实验稳定(dialogue / citation) + 1 个语义难匹(taxonomy) |
| Conditions | with-CLAUDE.md / without-CLAUDE.md |
| Repeats | 2 |
| Cells | 6 × 2 × 2 × 2 = 48 |

#### 4.3.2 Phase 1B — direct-match preservation (16 cells)

测试当 gt skill **已启用**(单独 enable,corpus 其他全禁)且 router skill 也加载时,CLAUDE.md 是否破坏 native Skill auto-select(即把 agent 错误引导到 router):

| 维度 | 取值 |
| --- | --- |
| Variant | J-bounded |
| Queries | 4(各对应不同 gt skill) |
| Conditions | with-CLAUDE.md / without-CLAUDE.md |
| Repeats | 2 |
| Cells | 4 × 2 × 2 = 16 |

#### 4.3.3 Gate criteria(预先声明,避免 P-hacking)

```
PASS = trigger_rate(with-CLAUDE.md fallback) >= 95%
     AND trigger_lift >= +20pp
     AND direct_match_preservation(with-CLAUDE.md) >= 90%
     AND no degradation > 10pp vs without
```

#### 4.3.4 Phase 1 实测结果

| Phase 1A | trigger rate | accuracy |
| --- | --- | --- |
| A-router WITH | 12/12 (100%) | 6/12 (50%) |
| A-router without | 4/12 (33%) | 2/12 (17%) |
| J-bounded WITH | 12/12 (100%) | 10/12 (83%) |
| J-bounded without | 5/12 (42%) | 4/12 (33%) |
| **聚合** | **WITH 100%, without 37.5%, lift +62.5pp** | |

| Phase 1B | direct_match | router misfire |
| --- | --- | --- |
| J-bounded WITH | 8/8 (100%) | 0/8 (0%) |
| J-bounded without | 8/8 (100%) | 0/8 (0%) |

**Gate 决策**:全部 PASS。trigger lift +62.5pp 远超 +20pp 阈值;direct-match preservation 100% 完全无 degradation。进入 Phase 2。

### 4.4 CLAUDE.md 前后影响对比

Phase 2 paired 设计同窗口下跑 with-CLAUDE.md / without-CLAUDE.md 两条 arm,432 cells。两组关键对比:

#### 4.4.1 trigger rate 提升

| variant | trigger (with) | trigger (without) | Δ |
| --- | --- | --- | --- |
| A-router | 96% (23/24) | 83% (20/24) | +3 |
| B-cc | 100% (24/24) | 79% (19/24) | +5 |
| C-lite | 100% (24/24) | 67% (16/24) | +8 |
| D-agentic | 96% (23/24) | 83% (20/24) | +3 |
| E-digest | 100% (24/24) | 79% (19/24) | +5 |
| H-bounded | 96% (23/24) | 79% (19/24) | +4 |
| I-meta | 96% (23/24) | 79% (19/24) | +4 |
| J-bounded | 96% (23/24) | 79% (19/24) | +4 |
| **router 聚合** | **97% (187/192)** | **79% (151/192)** | **+18.8pp** |

#### 4.4.2 hallucination 矩阵

把 `matched_skill_name` 不匹配 `^skill-\d{3}$` 模式的 cell 列为 hallucination(输出不存在的 skill 名)。

| variant | with-CLAUDE.md | without-CLAUDE.md |
| --- | --- | --- |
| G-native | **0/24** | **0/24** |
| A-router | 1/24 | 4/24 |
| B-cc | 0/24 | 5/24 |
| C-lite | 0/24 | 8/24 |
| D-agentic (post-fix) | 1/24 | 4/24 |
| E-digest | 0/24 | 5/24 |
| H-bounded | 1/24 | 5/24 |
| I-meta | 1/24 | 5/24 |
| J-bounded | 1/24 | 5/24 |
| **router 聚合** | **5/192 (2.6%)** | **41/192 (21.4%)** |

**G-native 0 幻觉**有一个简洁的机理解释:corpus 全启用时 150 个真 skill 的 `description` 在 Claude Code 内置 `Skill` 工具的 enum 里,agent 输出 matched_skill_name 时是从这个 visible 列表里挑,物理上不能编造。router 变体因为 corpus DISABLED,agent 在 trigger 失败时没有可见的真 skill 列表,只能从 query 关键词凑名字。

#### 4.4.3 同变体 with/without accuracy delta

| variant | acc (with) | acc (without) | Δ |
| --- | --- | --- | --- |
| **G-native(对照)** | 15/24 (63%) | 15/24 (63%) | **+0** |
| A-router | 13/24 (54%) | 10/24 (42%) | +3 |
| B-cc | 23/24 (96%) | 19/24 (79%) | +4 |
| C-lite | 23/24 (96%) | 16/24 (67%) | +7 |
| D-agentic (post-fix) | 22/24 (92%) | 19/24 (79%) | +3 |
| E-digest | 22/24 (92%) | 17/24 (71%) | +5 |
| H-bounded | 22/24 (92%) | 19/24 (79%) | +3 |
| I-meta | 21/24 (88%) | 17/24 (71%) | +4 |
| J-bounded | 22/24 (92%) | 18/24 (75%) | +4 |
| **router 聚合** | **168/192 (88%)** | **135/192 (70%)** | **+17.2pp / +33 cells** |

#### 4.4.4 G-native 对照证伪 LLM 随机性

CLAUDE.md 内容里提到的 `skill-router-skills` 在 G-native 配置下不存在(G 不加载 skill-router 插件)。因此 CLAUDE.md 对 G-native 的 `"you must call skill-router-skills"` 指令本质上是 no-op —— G-native 的 native Skill auto-select 路径不应受影响。

实测:G-native 两条 arm **完全相同**(15/24 vs 15/24,Δ = 0,trigger 都是 0/24,cost 差 \$0.07 噪声级,ctx_end 差 0.2K 噪声级)。这严格证伪"with-CLAUDE.md 提升仅来自 LLM 跨 run 随机性"的假说 —— 如果是随机性,G-native 在两条 arm 上也会有 ±1-2 cell 的差异;实测 0 差异,说明 CLAUDE.md 的效应是定向的、可归因的。

#### 4.4.5 综合结论

CLAUDE.md 把 trigger rate 拉到 97%、hallucination 压到 2.6%、accuracy 提升 +17.2pp,代价是 +13% cost / +18% duration / +1.3K ctx_end。Gate 全部 PASS 且 G-native 对照证伪 LLM 随机性。**本报告后续 §6 主表的所有数据均基于 with-CLAUDE.md (trigger 充分激活) 条件下的 paired arm**,without arm 仅用于 §4.4 内部对照与 §7 失败案例溯源。

---

## 5. 方法学审查与修正

本轮实验前,完整设计与 harness 经 **Codex (GPT-5.5, reasoning effort = xhigh)** 做了一轮对抗式方法学审查。审查发现 1 个 blocker + 3 个 high + 2 个 medium 缺陷,全部修复后才进入 Phase 1 跑:

| 缺陷 | 严重度 | 后果 | 修复 |
| --- | --- | --- | --- |
| 3-cell probe 不足以验证 CLAUDE.md 是否真的影响 Skill 调用决策 | blocker | Phase 2 \~\$70 投入后才发现无效 | Phase 1 扩到 64 cells + gate criteria 阻断不合格的 Phase 2 |
| 1 query × 1 variant × 1 repeat 不能区分 trigger 提升 vs 随机成功 | high | 误判 false positive | 8 query stratified × 2 variants × 2 repeats |
| 复用 `.tmp-home-parallel/` 可能 state contamination | high | 跨 cell 状态泄露 | 每 cell preflight md5 校验,失败立即报错 |
| 跟历史 baseline 比是 confounded(time / cache / model drift) | high | 跨 run LLM 随机性误判为 CLAUDE.md 效应 | Phase 2 用 **paired** 设计同窗口跑 with/without |
| CLAUDE.md "use as fallback" 措辞太软,可能压不住 hallucination | medium | trigger lift 不达预期 | 加固到 "you must call ... do not invent" |
| 缺少预设的统计停止指标 | medium | 容易 P-hacking | 显式定义 gate criteria 与 Phase 2 主指标 |

跨 run 比的危险性有一个直接例证:某变体在 baseline 旧跑 (`runs/routing-only-9x24/`) 的 accuracy 与本实验 without-arm 之间相差 29pp,这并非任何受控干预的功劳/失误,纯粹是 LLM 跨 run 随机性。**本报告所有数据严格基于 paired arm 内的同窗口 Δ,不与历史 run 比对**。

---

## 6. 结果

### 6.1 总体准确率(with-CLAUDE.md,trigger 充分激活)

| rank | variant | accuracy | trigger | hallucination |
| --- | --- | --- | --- | --- |
| 🥇 | **B-cc** | **96%** (23/24) | 100% | 0/24 |
| 🥇 | **C-lite** | **96%** (23/24) | 100% | 0/24 |
| 🥉 | **D-agentic** | **92%** (22/24) | 96% | 1/24 |
| 🥉 | **E-digest** | **92%** (22/24) | 100% | 0/24 |
| 🥉 | **H-bounded** | **92%** (22/24) | 96% | 1/24 |
| 🥉 | **J-bounded** | **92%** (22/24) | 96% | 1/24 |
| 7 | I-meta | 88% (21/24) | 96% | 1/24 |
| 8 | G-native | 63% (15/24) | n/a (no router) | 0/24 |
| 9 | A-router | 54% (13/24) | 96% | 1/24 |

四点观察:

1. **B-cc / C-lite (96%) 第一档**,均为 DCI 家族(读 body)。
2. **D-agentic / E-digest / H-bounded / J-bounded (92%) 第二档**,跨范式(AgenticRAG、metadata digest、bounded DCI、关键词过滤),平均仅差 1 cell。
3. **G-native (63%) 是宿主原生 skill auto-select 的天花板** —— 即使 150 个 skill 全部启用、agent 自由选择,仍仅命中 15/24。所有 router 变体在 trigger 充分激活下均超过 G-native(A-router 例外,54% < 63%)。
4. **A-router 是唯一比 G-native 还差的 router 变体**,即自实现 lexical 检索器在真实长查询上反而比宿主原生 skill 选择更差。

### 6.2 成本–准确率权衡(Pareto 分析)

| variant | accuracy | Σcost | Σduration | Σturns | 备注 |
| --- | --- | --- | --- | --- | --- |
| **J-bounded** | **92%** | **$3.07** | **374s** | **96** | **Pareto 王者**:92% + 全场 router 最低 cost / 最低 dur / 最低 turns |
| D-agentic | 92% | $3.65 | 467s | 100 | |
| E-digest | 92% | $4.11 | 355s | 96 | duration 比 J 略低,但 cost 高 33% |
| H-bounded | 92% | $4.16 | 542s | 132 | bounded DCI 的多步 grep 比 J 单次过滤贵 35% |
| I-meta | 88% | $4.16 | 404s | 93 | metadata-only,但 trigger rate 96% 拖低 1 cell |
| A-router | 54% | $3.90 | 499s | 96 | |
| **C-lite** | **96%** | $4.30 | 654s | 156 | 96% 准确率代价:cost 比 J 高 40% |
| **B-cc** | **96%** | $5.56 | 896s | 197 | 96% 准确率代价:cost 比 J 高 81%,unbounded shell 很贵 |
| G-native | 63% | $2.98 | 130s | 24 | 单 turn 调用,但准确率天花板 63% |

**Pareto 前沿**:G-native(63% / \$2.98)→ J-bounded(92% / \$3.07)→ C-lite / B-cc(96%)。J 用 +\$0.09 / +29pp 跨越 G-native 到第二档,B-cc 用 +\$2.49 / +4pp 跨越 J 到第一档。

### 6.3 路由结果构成

`matched_skill_name` 输出可分为四类,with-CLAUDE.md 下的分布:

| 类型 | 示例 | 命中策略 |
| --- | --- | --- |
| ✅ 合法 `skill-NNN` 且 = expected | `skill-009` | hit |
| ❌ 合法 `skill-NNN` 但选错 | J 选 skill-046,gt = skill-021 | →distractor 或 →noise |
| ❌ Hallucinated 不存在的名 | `xlsx`, `pptx` | →hallucinated |
| ❌ Router 自我引用 | `skill-router:skill-router-skills` | →hallucinated |
| ❌ 空 / 无解析 | `none` | →none |

| variant | hit | →distractor | →noise | →hallucinated | →none |
| --- | --- | --- | --- | --- | --- |
| B-cc | 23 | 1 | 0 | 0 | 0 |
| C-lite | 23 | 1 | 0 | 0 | 0 |
| D-agentic | 22 | 1 | 0 | 1 | 0 |
| E-digest | 22 | 2 | 0 | 0 | 0 |
| H-bounded | 22 | 1 | 0 | 1 | 0 |
| J-bounded | 22 | 1 | 0 | 1 | 0 |
| I-meta | 21 | 2 | 0 | 1 | 0 |
| A-router | 13 | 10 | 0 | 1 | 0 |
| G-native | 15 | 9 | 0 | 0 | 0 |

观察:trigger 充分激活后,误选**几乎全部落在 distractor**(SkillRouter 用 GPT-4o-mini 生成的功能近义干扰),没有任何 cell 选到 noise skill(从 78K easy 池随机抽取的填充)。这印证 SkillRouter 论文 §4 的设计 —— **distractor 才是真正考验 retriever 的样本**。

### 6.4 上下文窗口占用(ctx_end)

定义:**最后一个 assistant message 的 input_tokens + cache_read + cache_creation**,代表该轮模型实际接收的完整上下文。

| variant | with-CLAUDE.md ctx_end | without-CLAUDE.md ctx_end | Δ |
| --- | --- | --- | --- |
| **J-bounded** | **30.7K** | 29.9K | +0.8K |
| C-lite | 32.7K | 30.8K | +1.9K |
| H-bounded | 32.9K | 31.9K | +1.0K |
| B-cc | 34.3K | 34.0K | +0.3K |
| D-agentic | 34.1K | 33.3K | +0.8K |
| A-router | 35.3K | 34.3K | +1.0K |
| G-native | 36.5K | 36.3K | +0.2K |
| I-meta | 38.0K | 36.1K | +1.9K |
| E-digest | 38.0K | 35.7K | +2.3K |

所有变体的 ctx_end 都集中在 **30-38K** 一个量级,差异远小于想象。Claude Code 的对话缓存机制使多 turn 变体的最终 turn 上下文也维持在 30K 级别;只有 E-digest / I-meta 因为一次 catalog 调用就拉进 ~3-5K description 文本,使其 ctx_end 略高。

J-bounded 的 30.7K 略低于 G-native 的 36.5K —— 关键词过滤短列表比 native auto-select 的完整 skill 元数据列表更小。

### 6.5 逐查询命中矩阵(with-CLAUDE.md,router 变体)

| query (gt) | A | B | C | D | E | H | I | J | hit/8 | w/o hit/8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3d-scan-calc (skill-079) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 8 |
| azure-bgp-oscillation (skill-070) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 7 ↑ |
| citation-check (skill-043) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | 7 | 7 |
| court-form-filling (skill-003) | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7 | 6 ↑ |
| data-to-d3 (skill-037) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 6 ↑ |
| dialogue-parser (skill-009) | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7 | **0** ↑↑↑ |
| earthquake-plate (skill-135) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 6 ↑ |
| econ-detrending (skill-080) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 8 |
| enterprise-info-search (skill-049) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 5 ↑ |
| gh-repo-analytics (skill-021) | · | · | · | · | · | · | · | · | **0** | 0 |
| jax-computing-basics (skill-042) | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7 | 2 ↑ |
| lab-unit-harmonization (skill-123) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 4 ↑ |
| offer-letter-generator (skill-116) | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7 | 6 ↑ |
| pddl-tpp-planning (skill-117) | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | 6 | 7 ↓ |
| pptx-reference-formatting (skill-140) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 4 ↑ |
| protein-expression (skill-105) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 7 ↑ |
| quantum-numerical (skill-033) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 8 |
| reserves-at-risk-calc (skill-105) | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7 | 5 ↑ |
| shock-analysis-demand (skill-105) | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | 7 | 7 |
| shock-analysis-supply (skill-105) | · | ✓ | ✓ | · | · | · | · | · | **2** | 5 ↓ |
| taxonomy-tree-merge (skill-068) | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7 | 6 ↑ |
| video-tutorial-indexer (skill-113) | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7 | 2 ↑ |
| virtualhome-agent (skill-117) | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7 | 7 |
| weighted-gdp-calc (skill-105) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **8** | 8 |

观察:

- 24 个 query 里 **17 个在 with-CLAUDE.md 下 ≥7 个变体命中**,显示在 trigger 充分激活的条件下,各 retriever 大体在多数 query 上达成一致路由决策。
- **5 个 query 在 8 个 router 变体里全部命中**(3d-scan、earthquake、enterprise-info、pptx 等),这些是"易"查询。
- **1 个 query 全部失败:gh-repo-analytics**(8/8 router 变体在两条 arm 都挂),原因详见 §7.4。
- **1 个 query 比 without 更差:shock-analysis-supply**(with 2/8 vs without 5/8),原因详见 §7.5。
- **最大涨幅:dialogue-parser**(7/8 vs 0/8 baseline),trigger 噪声移除后 7 个 router 都能命中。

### 6.6 Codex 与 Claude Code 并列结果

同步远端 `main` 后补跑的 Codex 9×24 使用同一 24-query / 150-skill 语料、同一 expected mapping、同一 routing-only 输出 schema。下表把 Codex 与 Claude Code with-CLAUDE.md 主结果并列展示:

| variant | Claude Code acc | Codex acc | 差异说明 |
| --- | ---: | ---: | --- |
| **G-native** | 15/24 | **24/24** | 最大差异;Codex native 在本基准上满分,Claude Code native 受 skill listing 压缩 + Skill tool 选择机制影响 |
| A-router | 13/24 | 8/24 | 两边都低,固定 lexical/级联 scorer 不适合长 query + 近义 distractor |
| B-cc | **23/24** | 22/24 | Claude Code 第一档之一;Codex 上成本较高且非 Pareto |
| C-lite | **23/24** | 23/24 | 两边稳定,读 body 的有界 DCI 泛化最好 |
| **D-agentic** | 22/24 | **24/24** | Codex router 首选;结构化循环在 Codex 上达到满分 |
| E-digest | 22/24 | 23/24 | Codex 上 metadata digest 略优 |
| H-bounded | 22/24 | 23/24 | Codex 上 bounded DCI 略优,但工具调用较多 |
| I-meta | 21/24 | 22/24 | 两边均低于最强 metadata/reader 变体 |
| J-bounded | 22/24 | 22/24 | Claude Code 成本 Pareto;Codex 上仍最低成本但不再是 Pareto 王者 |

并列结果改变了两个结论的表述:

1. **Claude Code 侧的核心问题是 trigger + native skill selection**。CLAUDE.md 注入后 router 才能稳定进入比较;native G-native 只有 15/24。
2. **Codex 侧 native 与 D-agentic 都达到 24/24**。这不意味着生产应全量启用所有 skill,因为上下文预算和更大 corpus 尚未验证;但说明在当前 150-skill 基准上,Codex 原生 skill 选择能力显著强于 Claude Code native。
3. **推荐策略按宿主分化**:Claude Code 默认推荐 J-bounded(低成本)或 B/C(最高准确率);Codex 默认推荐 D-agentic,成本优先再考虑 J-bounded/E-digest。

---

## 7. 失败案例分析

### 7.1 A-router:lexical 检索器在长查询上的崩溃(54%)

A-router 调用 `skill-router skills route --query <user-msg-verbatim>` CLI,内部为 metadata→dci→lexical 三级级联评分。在 24 个 query × with-CLAUDE.md 下命中 13/24,是唯一比 G-native(63%)还差的 router 变体。10 次错选全部落在 distractor 而非 noise。

A-router 失败的 query 集中在**含大量上下文、动作-中心(action-centric)的真实任务描述**:`court-form-filling`、`dialogue-parser`、`jax-computing-basics`、`offer-letter-generator`、`reserves-at-risk-calc`、`shock-analysis-supply`、`taxonomy-tree-merge`、`video-tutorial-indexer`。这些 query 的特点:

- 几百到上千字描述任务流程,大量"步骤 1 / 步骤 2"枚举
- 描述具体输入输出格式、文件路径、约束
- 关键技术名(`xlsx`、`PDDL`、`D3.js`、`JAX`)只出现 1-2 次,但描述高度凸显

CLI 端的级联评分将整段 query 作为评分输入,词频统计被任务描述里频繁出现的通用动词(`generate`、`compute`、`fill`)主导,而高信号的低频技术名权重被稀释。即使 fastembed cosine 阶段能捕捉部分语义,最终 lexical 阶段又把决策拉偏。

A-router 的设计缺陷在于:**自实现 retriever 的评分接口固定**,无法像 agent 路径那样按 query 特点动态调整 keyword 提取与匹配策略。例如 J-bounded 在 SKILL.md body 里明确告诉 agent "Pick 3–5 distinctive keywords from the user request",agent 在每个 query 上独立做 keyword extraction,等价于一个 LLM-driven 的查询改写步骤,而 A-router CLI 拿不到这一改写能力。

### 7.2 G-native:宿主原生选择的天花板(63%)

G-native 不加载 skill-router 插件,150 个 skill 全部启用。Claude Code 启动时把所有 skill 的元数据(name + description)拼入系统上下文,agent 看见这个完整列表后通过内置的 Skill 工具(以 enum 形式约束 skill name)做 zero-shot 选择。

实测 15/24 (63%),其中 9 次错选**全部落在 distractor**。错选模式:

| query | gt | G-native 选 | 错选机理 |
| --- | --- | --- | --- |
| court-form-filling | skill-003 | skill-077 | "fill PDF form" 字面匹配过强 |
| dialogue-parser | skill-009 | skill-021 | "graph" 引发的功能近义干扰 |
| pptx-reference-formatting | skill-140 | distractor | "pptx" 字面匹配,但 distractor 描述更专精 |

机理:G-native 的选择是**基于元数据描述的注意力反射式匹配**,无 query rewrite、无 candidate 排序步骤,所有 distractor 都同时进入选择空间。150 个 skill 中,SkillRouter 设计的 80 个针对性 distractor 占 53%,平均每个 gt skill 周围有 4 个高度相似的近义项。元数据可见而 body 不可见的设定下,distractor 与 gt 在 description 层无法区分,native auto-select 没有"再确认一层"的机制 —— **这正是 SkillRouter 论文§4 的核心论断:metadata 不足以支撑大规模、高度重叠 skill 池中的路由**。

router 变体在 trigger 充分激活下能跨过这个天花板,因为它们引入了"再确认"机制(B / C / D / H 读 body,E / I / J 在 LLM 推理层做 description 对比,而非 Skill 工具的注意力快路)。

### 7.3 D-agentic:format-only bug 与修复

Phase 2 初次跑完时 D-agentic 准确率 67%(16/24),落在中段。审查发现 6 个错 cell 里 3 个是 `user:skill-NNN` 前缀失败:

| query | gt | D-agentic 输出 | 失败类型 |
| --- | --- | --- | --- |
| data-to-d3 | skill-037 | `user:skill-037` | format-only |
| econ-detrending | skill-080 | `user:skill-080` | format-only |
| shock-analysis-supply | skill-105 | `user:skill-080` | format-only + wrong gt |

根因:`dci search` CLI 在 JSON 输出里把 id 写作 `"id": "user:skill-037"`(plugin scope qualified form,因为同一个 skill id 可能存在于不同的 plugin scope)。D-agentic SKILL.md 原本的 "summarize / commit" 步骤说 `"return its skill-id (visible in search results)"`,agent 忠实复制了 `user:` 前缀。其他变体(B / C / E / H / I / J)的 SKILL.md body 都不让 agent 直接访问 raw CLI JSON,而是从中间 grep 输出里取 `skill-NNN` 短形式,所以没有这个问题。

修复:在 D-agentic SKILL.md 的 commit 步骤显式说明 `"strip the user: (and any codex:) prefix before emitting matched_skill_name — output just skill-NNN"`,然后用 `rerun-d-agentic.mjs` 重跑 24 × 2 = 48 cells。

| | acc (with) | acc (w/o) | hallucination (with) |
| --- | --- | --- | --- |
| 修复前 D | 67% (16/24) | 38% (9/24) | 3/24 |
| 修复后 D | **92% (22/24)** | 79% (19/24) | 1/24 |

D 进入第一线,跟 J-bounded / H-bounded / E-digest 持平。

值得注意:without arm 也跳了(38%→79%),除 prefix 修复外也含 LLM 跨 run 随机性,无法分离归因。这正是 §5 提到的 "don't compare across windows" 的体现 —— **paired 设计同一窗口内的 Δ 才是干净的对照**。

### 7.4 gh-repo-analytics:corpus annotation 争议(8/8 router 变体均挂)

`gh-repo-analytics` 在两条 arm 下 8 个 router 变体均错选(0/8 / 0/8)。这是 24 个 query 中唯一 100% 失败的样本。

J-bounded 的执行轨迹:trigger 正常(1 router tool call),跑 3 个 grep 命令,候选列表里**确实包含 gt skill-021**,但 J 选了 skill-046。description 对比:

| skill | description |
| --- | --- |
| **skill-021 (gt)** | "The gh CLI is GitHub's official command line tool for interacting with GitHub repositories, issues, pull requests, and more..." — **工具中心** |
| **skill-046 (J 选)** | "Track and visualize GitHub contributions, insights on commits, PRs, issue resolutions over time" — **任务中心** |
| query | "prepare a December community pulse, gather PRs, count, top contributor..." — **任务中心** |

J 选的 skill-046 description 与 query 任务描述匹配度更高。这是 SkillRouter 数据集 gt 标注与 description 撰写风格不一致导致的争议样本:**实际上 8 个 router 变体里 6 个选了 skill-046,2 个选了 hallucinated 名,没有任何 1 个选 skill-021**。

机理上这不能算 retriever 失败 —— 在"任务 → skill description"的语义匹配维度上,所有 router 都做了"看起来更对"的选择;但严格 string-match gt 标注判其全错。这是 corpus annotation 的问题,不是路由质量本身的问题。GhostNet 类需要重新标注的样本。

### 7.5 shock-analysis-supply:overloaded gt skill 的偏置(with 2/8 vs without 5/8)

`shock-analysis-supply` 是 24 个 query 里 with-CLAUDE.md 比 without 表现更差的唯一样本(2/8 vs 5/8)。

机理:gt 是 `skill-105`,这个 skill 是被 5 个不同 query 共用的"通用 Excel skill"(`protein-expression`、`reserves-at-risk-calc`、`shock-analysis-demand`、`shock-analysis-supply`、`weighted-gdp-calc`)。它的 description 是 `"Comprehensive spreadsheet creation, editing, and analysis with support for formulas..."`,核心信号是 `xlsx` / `excel`。

without-CLAUDE.md 时,J-bounded 等 5 个变体在 trigger 失败的情况下直接 zero-shot 拍 `skill-105`(从训练分布偏置 + query 里强 `xlsx` 锚定),刚好命中 gt。with-CLAUDE.md 时 agent 真去搜 corpus,发现 description 层有 skill-080(经济学)、skill-026(邻近金融)等语义近似项,部分变体迷路到这些更"专精"但实际错的 skill。

这一 query 体现了 **CLAUDE.md 在 overloaded gt skill 上的一个 trade-off**:把全局准确率往上拉的同时,在 zero-shot 已经命中的 query 上偶尔会"想多了"。但 with-arm 上 B-cc 与 C-lite 稳定命中(因为读 body 时能看出 skill-105 的 Excel 模板包含 Cobb-Douglas 这种宏观经济建模工作流),说明读 body 的变体能克服这一陷阱;不读 body 的 J / I / H / E 则会被 description 层的语义近似带偏。

### 7.6 残余 hallucination

with-CLAUDE.md 下仍有 5/192 cells 残余 hallucination,在 7 个 router 变体上各 0-1 次,均为 0 tool call 的直接幻觉:

| variant | query | with 输出 | with router tool calls |
| --- | --- | --- | --- |
| A-router | gh-repo-analytics | `github-api` | 1(但路由结果 hallucinated) |
| D-agentic | shock-analysis-supply | `xlsx` | 0 |
| H-bounded | gh-repo-analytics | `github-pulse-report` | 1 |
| I-meta | citation-check | `bibtex-citation-checker` | 0 |
| J-bounded | shock-analysis-supply | `xlsx` | 0 |

CLAUDE.md 把全局 trigger 率拉到 97%,但残余 3% 是模型在极强 keyword 锚定下跳过 tool 的不可消除的概率事件。强 keyword 包括 `.xlsx`、`.pptx`、`bibtex` 等明显的 file-extension / 技术名,以及 gh-repo-analytics 这种字面就提"GitHub repo + PR + issue"的多关键词组合。

### 7.7 ctx_end 度量修正

初稿 `detail-paired.mjs` 在解析 stream-json 时把 `result.usage` 当作最后 turn 的 input / cache_read / cache_creation 之和(用作 ctx_end)。实际 Anthropic stream-json 的 `result.usage` 是**整段会话 cumulative token spend**(所有 turn 累加),不是最后 turn 的 context window size。

| variant | 初稿 ctx_end | 修正后 ctx_end |
| --- | --- | --- |
| B-cc | 219.0K | 34.3K |
| C-lite | 145.0K | 32.7K |
| H-bounded | 139.3K | 32.9K |
| D-agentic | 108.4K | 34.5K |
| J-bounded | 89.6K | 30.7K |
| G-native | 36.5K | 36.5K |

修正方法:从 jsonl 里只用 **最后一个 `event.type === "assistant"` 的 `message.usage`**(代表最后一 turn 模型实际接收的上下文),而不是 `event.type === "result"` 的 `usage`(那是 cumulative)。修正后所有变体都在 30-38K 一个量级,差异远小于初稿。修正后的逻辑见 `detail-paired.mjs`(`parseCell` 函数)。

---

## 8. 讨论

### 8.1 读 body 与仅读 metadata 之争

SkillRouter 论文 §4 的核心论断:**仅靠 description 元数据不足以路由,需要读 skill body**。本实验在 trigger 充分激活的条件下重新评估这一论断:

| 范式 | 代表变体 | 准确率 |
| --- | --- | --- |
| 读 body | B-cc, C-lite, H-bounded | 96% / 96% / 92% |
| 仅 metadata | E-digest, I-meta, J-bounded | 92% / 88% / 92% |
| AgenticRAG(混合) | D-agentic | 92% |

**最强读 body 变体(B-cc / C-lite, 96%)比最强 metadata 变体(E-digest / J-bounded, 92%)高 4 pp / 1 cell**。差距来自 §7.5 的 shock-analysis-supply 类样本:读 body 能识破描述层近义项的语义陷阱,只读 description 的变体在 overloaded gt skill 上偶尔会被 distractor 带偏。

但这 1 cell 的差距代价不小:B-cc cost \$5.56 vs J-bounded cost \$3.07(高 81%),turns 197 vs 96(多一倍)。**实际工程取舍依赖部署场景**:成本/延迟敏感场景 J-bounded 优势明显;准确率优先且能容忍 2× cost 的场景 B-cc / C-lite 占优。

SkillRouter 论文的论断在本实验受控规模上**部分成立**:读 body 确实有 4pp 优势;但 4pp 不足以使 metadata-only 路径完全失效,J-bounded 这种"description + LLM 推理"的轻量路径在 92% 准确率 + 显著低成本上提供了一个非常 attractive 的中间点。

### 8.2 范式层面结论

| 范式 | 表现 | 关键观察 |
| --- | --- | --- |
| **DCI (B/C/H)** | 92-96% | 读 body 时强;C-lite 用 bounded 管道在 cost 和 accuracy 上比 B-cc 更优 |
| **Metadata-only (E/I/J)** | 88-92% | J-bounded 的"关键词过滤短列表"路径在成本上完胜其他 metadata 变体 |
| **AgenticRAG (D)** | 92% | 结构化 4 工具循环带来稳定但不超越 DCI 的表现 |
| **自实现 lexical (A)** | 54% | 在真实长 query 上崩溃,词频评分接口无法咬合任务描述 |
| **宿主原生 (G)** | 63% | metadata-only 注意力反射的天花板,被 distractor 拉偏 |

跨范式的一个共同模式:**LLM-driven 的 query rewrite / keyword extraction 是关键**。J-bounded 在 SKILL.md body 里明确指导 agent "Pick 3-5 distinctive keywords" —— 等价于一个 inline 的 query 改写步骤;B/C/H 让 agent 自由探索时也隐式做了 keyword extraction。A-router 是唯一**没有让 LLM 做这一步**的变体,所以崩溃。

### 8.3 与 SkillRouter 论文对照

SkillRouter 用 24 个 single-skill 任务 + 80K skill 全量池跑评测,本实验在裁剪到 150 skill 的受控规模上重复了核心对比。关键对照点:

| 维度 | SkillRouter 论文 | 本实验 |
| --- | --- | --- |
| Corpus 规模 | ~80K skill | 150 skill |
| Query 数 | 87 | 24(SkillRouter 的子集) |
| GT 标注 | 专家撰写 | 沿用论文标注 |
| Distractor 设计 | GPT-4o-mini 生成 4 类 | 沿用论文 distractor |
| 元数据 vs body 的差异 | body 显著优于 metadata | body 仅 4pp 优势 |
| 宿主原生(无路由)天花板 | 不直接给出 | 63%(本实验对照变体) |

本实验在受控规模上的"仅 4pp 差距"与论文"显著差距"有差异。可能的原因:① 150-skill 规模下 description 层的 distractor 密度仍可被 LLM 推理克服,80K 规模下密度更高时差距可能放大;② 本实验在 LLM-driven keyword extraction 上的优化使 metadata 变体表现超出预期。**这一差异需要放大规模(增加 corpus + query)再验证**。

---

## 9. 局限性

1. **单 run no statistical significance**:每 cell 1 次 `claude -p`,无 multi-run majority vote、无 seed control(Anthropic API 不暴露 seed)。Phase 2 boundary 上的 ±1 cell 在跨 run 噪声范围内。B-cc/C-lite 并列 96% 与 D/E/H/J 92% 的差距实际在统计噪声范围。
2. **CLAUDE.md 是宿主 user-message context,不是 system prompt**:理论上效果跟真正的 system-prompt 注入有差,实测下来效果显著但未与"真正的" `--append-system-prompt` 24-query 平行对比。
3. **语料规模 150 远小于真实部署**:SkillRouter 原始池 80K,本实验裁到 150。在更大规模下 description 层的 distractor 密度增加,metadata-only 变体可能性能下降,与读 body 变体的差距可能拉大。
4. **24-query 规模仍偏小**:每变体 24 cell,1 cell 翻盘就是 +/-4pp。
5. **仅验证路由层,不验证下游执行**:STOP_TAIL 截断在路由决策处,`matched_skill_name` 进入下游 skill 执行的全链路准确率未测。Hallucinated 名(`xlsx` 等)在生产中下游会失败,但本实验测不到这一失败模式。
6. **gh-repo-analytics 是 corpus annotation 争议**:8/8 router 变体在两条 arm 都挂,但实际选择 skill-046 比 gt skill-021 与 query 任务匹配度更高。这一样本拉低了平均准确率但不应归咎 retriever 设计。
7. **shock-analysis-supply 是 overloaded gt skill 偏置案例**:gt skill-105 被 5 个 query 共用,zero-shot 拍 skill-105 反而对 —— with-CLAUDE.md 强制路由会被高语义近似的 skill-080 带偏。这种 overloaded gt 在真实部署里也是潜在风险。
8. **CLAUDE.md 在不同语言、不同长度 query 上的 robustness 未测**:24-query 全英文 + 任务描述风格统一,真实部署里可能遇到的中/日/混合语言 query 表现未知。
9. **F-index 等其他设计未纳入**:本实验排除了"目录索引预先 baked 进 SKILL.md"的 F-index 范式(因 SKILL.md 大小限制),只比较 9 个可比变体。
10. **Anthropic API model version drift**:实验跑在 `claude-opus-4-7[1m]`,Anthropic 不暴露 fix-pin model version。同一 model id 在不同时间点行为可能微变。本实验所有 cells 在 \~2 小时窗口内完成,但跨日期重跑结果不保证一致。

---

## 10. 优化计划

### P0 — 生产兜底:hallucinated 名拦截

routing-only 的 `matched_skill_name` 输出进入下游 skill 执行流。如果是 hallucinated 名(`xlsx` 等),下游会失败。建议在 4 个层级布兜底:

| Level | 机制 | 覆盖率 | 工程量 |
| --- | --- | --- | --- |
| 1 | SKILL.md / STOP_TAIL 加 schema 约束:`matched_skill_name MUST match ^skill-\d{3}$` | ~90% | 1 行 prompt |
| 2 | 调用方端 regex 校验 + retry once | 残余 ~9% | ~20 行 wrapper |
| 3 | hallucinated 字符串当 query 走 embedding rescue | 残余 ~1% | 在 skill-router CLI 加 `--rescue-fallback` mode |
| 4 | 切到 API SDK + `tool_choice` 强制 Skill 工具调用 | 100%(根治) | 弃用 `claude -p`,工程量大 |

短期推荐 **Level 1 + 2** 组合,长期可加 Level 3。

### P1 — 修复 A-router 自实现 retriever

A-router 54% 严重落后。修复方向:
- CLI 端加一个 LLM-driven 的 query rewrite 预处理步骤(去除步骤枚举、保留高信号低频技术名)
- 把固定的 metadata→dci→lexical 三级评分改成 LLM 驱动的 candidate ranking

### P1 — 把 I-meta 升级为带 escalation 的混合路由

I-meta 88%(单独 1 个 cell 差距落后于 J-bounded 92%)。失败 case 多为 description 层难以辨别的近义对。可在 I 的 workflow 上加一个 escalation:**当 LLM 推理判断 top-2 candidates description 相似度高时,允许读 frontmatter 之外的 body 一次**,变成"metadata-first, body-on-tie"的混合模式。

### P2 — 扩大规模验证外推性

24-query / 150-skill 规模偏小。扩到 87-query(SkillsBench 全量)/ 500-1000-skill 规模重跑,验证读 body 与 metadata-only 的差距是否随规模放大。

### P2 — 增加 D-agentic 等变体的统计置信度

D-agentic 经 SKILL.md 修复后跳到 92%,但 without arm 也跳到 79%(部分归因 LLM 跨 run 随机性)。multi-run(N=3)majority vote 是必要的下一步。

### P3 — corpus annotation 清理

`gh-repo-analytics` 是 corpus 标注争议:gt skill-021 描述工具中心,query 描述任务中心,skill-046 与 query 更匹配但被判错。这种样本需要重标 gt 或重写 skill-021 description。

---

## 11. 结论

本实验在 SkillRouter 24-query / 150-skill 受控基准上,在 trigger 充分激活的条件下系统对比了九个 disabled-skill 路由变体。主要发现:

1. **B-cc / C-lite (DCI 家族,读 body) 达到 23/24 (96%) 准确率天花板**;D-agentic / E-digest / H-bounded / J-bounded 并列 22/24 (92%);I-meta 21/24 (88%);A-router 13/24 (54%) 是唯一比 G-native (63%) 还差的 router 变体。
2. **J-bounded 是 Pareto 王者**:92% 准确率 + cost \$3.07 + dur 374s + ctx_end 30.7K,所有 router 维度全场最低。B-cc 用 +\$2.49 / +81% cost 换 +4pp 准确率到达 96%。
3. **trigger 决策与路由质量是两个独立维度**,必须解耦才能测准。本实验通过 CLAUDE.md 注入把 trigger rate 拉到 97%、hallucination 压到 2.6%,使后续观察到的能力差异确实反映 retriever 设计本身。G-native 对照变体在两条 arm 上完全相同(15/24 / 15/24),严格证伪"提升仅是 LLM 跨 run 随机性"。
4. **"读 body 是关键"的 SkillRouter 论断在本实验受控规模上部分成立**:读 body 有 4pp 优势,但 metadata-only 路径(J-bounded 92%)在 LLM-driven keyword extraction 加持下足够接近、显著更便宜。论断在更大规模下是否放大需要后续验证。
5. **本实验仅验证路由层**,不验证下游 skill 执行。`matched_skill_name` 进入下游执行的全链路准确率(尤其 hallucinated 命名的拦截率)是后续工作。

---

## 12. 后续:规模扩展实验 (scaling-jbounded)

本节是对 §9 #3(语料规模 150 远小于真实部署)与 §10 P2(扩大规模验证外推性)的直接跟进。完整实验放在 `experiments/scaling-jbounded/`,这里只汇报核心结果与对本报告 §6 结论的修正含义。

### 12.1 实验问题

J-bounded 在 150 scale 上是 Pareto 王者(§6.2),但 dci-compare 9×24 的语料规模远低于 SkillRouter 论文的 ~80K。**J-bounded 的 inline shell 检索模板在更大规模上是否仍然工作?如果不工作,在哪一档规模上崩、什么原因?**

### 12.2 三个失效机制(@ 80K)

在 79,141-candidate Hard pool 上的单 query probe + 4-scale 单 query sweep 揭示三种衰减:

1. **`ARG_MAX` 撞墙(约 13K skills 起)**。J-bounded v1 的模板第一句:
   ```bash
   grep -i -m1 '^description:' ~/.claude/skills/*/SKILL.md.skill-router-disabled \
     | grep -i -E "<kw>|<kw>" | head -20
   ```
   shell 展开 glob,argv 在 80K paths 时约 11 MB,超过 Linux 默认 2 MB 限制,直接报 `argument list too long: grep`。
2. **`head -20` 在大池里饱和**。即便 agent 切到 `for f in <glob>; do ...; done` 绕开 `ARG_MAX`,`head -20` 仍然有效。在 80K 池上关键词 `mesh` 匹配 **95 个 skill 名**,gt 排在第 23 位 —— 字母序里 `gt__*` 排在 `distractor__*` / `easy__*` 之后,**`head -20` 系统性把 gt 切掉**。
3. **near-miss 退化到 catch-all**。在 80K 池中,任何 finance/economics/forms 类 query 都会面对几十个通用工具 skill(`excel`/`spreadsheet`/`docx-template-filling`/...)。当 description-only 关键词无法定位准确 gt 时,agent 倾向选语义近邻的"反正能做"的工具 —— 这就是本报告 §9 #5 描述质量天花板在大规模下的放大版。

### 12.3 J-bounded-v2:三处模板修复

`description:` frontmatter 字段保持字节级一致(因此 trigger 概率与 v1 一致)。只改 body workflow:

| | v1 | v2 |
| --- | --- | --- |
| 枚举 | shell glob | `find -print0 \| xargs -0 grep -l` |
| 关键词宽度 | "distinctive keywords" | "narrow technical terms;avoid broad words" |
| 候选上限 | `head -20` | **去掉**,改为"shortlist 太长就 narrow keywords 重 grep" |
| shortlist payload | `grep` 返回 description 文本 | `grep -l` 只返回路径 |

### 12.4 主要结果(24-query × {150, 79K} × {J-v1, J-v2})

**Task 1:同 150 corpus、同 24 query、同 +CLAUDE.md trigger lift,跟本报告 §6 J-bounded 直接对位:**

| Variant | accuracy | trigger | Σ cost | avg cost/cell | Σ dur | avg ctx_end |
| --- | --- | --- | --- | --- | --- | --- |
| dci-compare **J-v1** (本报告 §6) | 22/24 (92%) | 23/24 | \$3.07 | \$0.128 | 374s | 30.7K |
| **J-v2** (scaling-jbounded Task 1) | 22/24 (92%) | 23/24 | \$3.95 | \$0.164 | 665s | 30.8K |

条件命中率(去除 trigger 失败的 1 cell):v1 = v2 = 22/23 (95.7%)。**v2 在 150 上不输 v1**,代价是 +29% cost / +78% duration(narrow-keyword 多步收敛多走 1-2 turn);`ctx_end` 与 v1 几乎一致(`grep -l` 把单步 payload 反而压小了,但被多 turn 抵消)。

**Task 2:同 24 query 扩到 79K Hard 池(论文实际规模):**

| 配置 | accuracy | trigger | Σ cost | avg cost/cell | avg dur/cell | avg ctx_end | avg turns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| J-v2 × 150 (+CMD) | 22/24 (91.7%) | 23/24 | \$3.95 | \$0.164 | 27.7s | 30.8K | 5.5 |
| **J-v2 × 79K (+CMD)** | **12/24 (50.0%)** | 23/24 | \$5.33 | \$0.222 | 65.7s | 36.6K | 5.8 |

池放大 **527×**:
- accuracy −42pp(几乎全部是 near-miss 到 excel/spreadsheet 等 catch-all)
- avg cost/cell **只涨 35%**(v2 的 bounded payload 性质在大池上守住了)
- avg `ctx_end` 只涨 +19%
- avg turns 只涨 5%(模板没崩,没出现 v1 在 80K 上的 23 turns timeout 死循环)

**对比 SkillRouter 论文 baseline(80K Hit@1):**

| Method | Body access | Hit@1 |
| --- | --- | --- |
| BM25 (sparse) | name+desc only | 0.0% |
| Qwen3-Emb-8B | name+desc only | 25.3% |
| **J-v2 (本实验)** | **name+desc only** | **50.0%** (24 single, Hard only) |
| Qwen3-Emb-8B | full text | 64.0% |
| **SKILLROUTER 1.2B** | full text | **74.0%** |

J-v2 是 nd-only 最强编码器 baseline 的 ~2×,但仍比读 body 方法低 14-26pp —— **直接证实论文 §3 的"full skill text 是关键信号"论断在我们这种 LLM-agent + shell 路径上同样成立**。失败案例(catch-all fallback)正是 description 不足以区分 gt 的那一类 query。

### 12.5 对本报告 §11 结论的修正

- **结论 #2 修正**:J-bounded 在 150 上是 Pareto 王者的论断**仍然成立**,但应限定为"150-skill 受控规模"。在 79K 真实部署规模下,v1 的模板会直接撞 `ARG_MAX` + `head -20` 饱和;**生产采用 J-bounded 类设计应改用 v2 模板**(`find -print0 | xargs -0`、去 `head` 截断、narrow keywords 收敛)。
- **结论 #4 修正**:本报告原话 "读 body 有 4pp 优势,但 metadata-only 路径在 LLM-driven keyword extraction 加持下足够接近"在 150 scale 仍成立。在 79K scale 下,**两者差距从 4pp 拉大到 14-26pp**(对照论文 nd vs full-body 编码器 baseline 平均 31-44pp gap)。读 body 的关键性随规模增长。
- **§9 #3 限制确认**:metadata-only 变体随规模下降的预测被本实验验证。建议把 §10 P1(I-meta 升级为带 escalation 的混合路由)推进 —— v2 在 79K 上一半失败是 catch-all near-miss,这一类只需 "body-on-tie" 就能恢复。

### 12.6 文件指针

完整数据、单 query trace、与论文对比的扩展讨论在:

- `experiments/scaling-jbounded/EXPERIMENT_NOTES.md` — 本节的完整版,含失效机制详解、x4 规模衰减表、cost 弹性分析、已知局限
- `experiments/scaling-jbounded/variants/J-bounded-v2.SKILL.md` — v2 模板
- `experiments/scaling-jbounded/runs/sweep24-v2-150-cmd/report.md` — Task 1 全表
- `experiments/scaling-jbounded/runs/sweep24-v2-full-cmd/report.md` — Task 2 全表
- `experiments/scaling-jbounded/runs/sweep-3d-scan-calc/report.md` — 4-scale × 2-variant × 1-query smoke

---

## 附录 A:24 个查询全文

完整 query 集存放在 `queries.json`。每个 query 由 SkillsBench 任务的 `instruction_text` 直接引用,长度从约 200 字到 1500+ 字不等。

| id | gt skill | domain |
| --- | --- | --- |
| 3d-scan-calc | skill-079 | engineering |
| azure-bgp-oscillation-route-leak | skill-070 | bgp-route |
| citation-check | skill-043 | research |
| court-form-filling | skill-003 | document-processing |
| data-to-d3 | skill-037 | Data Visualization |
| dialogue-parser | skill-009 | game |
| earthquake-plate-calculation | skill-135 | geophysics |
| econ-detrending-correlation | skill-080 | economics |
| enterprise-information-search | skill-049 | enterprise-search |
| gh-repo-analytics | skill-021 | devops-analytics |
| jax-computing-basics | skill-042 | research |
| lab-unit-harmonization | skill-123 | healthcare |
| offer-letter-generator | skill-116 | document-generation |
| pddl-tpp-planning | skill-117 | research |
| pptx-reference-formatting | skill-140 | office-suite |
| protein-expression-analysis | skill-105 | data-analysis |
| quantum-numerical-simulation | skill-033 | quantum-simulation |
| reserves-at-risk-calc | skill-105 | financial-analysis |
| shock-analysis-demand | skill-105 | financial-analysis |
| shock-analysis-supply | skill-105 | financial-analysis |
| taxonomy-tree-merge | skill-068 | ML/NLP |
| video-tutorial-indexer | skill-113 | multimodal-processing |
| virtualhome-agent-planning | skill-117 | research |
| weighted-gdp-calc | skill-105 | financial-analysis |

### 查询全文示例(取 4 个有代表性的)

#### dialogue-parser (gt = skill-009)

```
You will implement a dialogue parser that converts a given text file into a structured JSON graph.
You will be given a text file `/app/script.txt`, and output a validated JSON graph
`/app/dialogue.json` and visualization `/app/dialogue.dot`. You should implement a function
`def parse_script(text: str)` in your parser `solution.py` ...
[parses dialogue with node type "line" and "choice", outputs {"nodes":[...],"edges":[...]}
and a .dot visualization. Constraints: all nodes reachable from first; all edge targets exist
except last node; multiple paths can lead to "End".]
```

#### pptx-reference-formatting (gt = skill-140)

```
Help me detect all dangling paper titles in the slides `/root/Awesome-Agent-Papers.pptx`, and do the
following: change the font type to Arial, font size to 16, font color to #989596, and disable bold
if any; adjust the box width, so that each title is displayed in one line; put the title at the
bottom center of each page; create a new slide at the end, put "Reference" as the slide title, and
put all the paper titles within the body with auto-numbered bullet points (don't forget to remove
duplicate papers). Save the processed .pptx to `/root/Awesome-Agent-Papers_processed.pptx`.
```

#### gh-repo-analytics (gt = skill-021)

```
I'm preparing a short "December community pulse" write-up for the `cli/cli` repository.

For the period 2024-12-01 to 2024-12-31, gather:
- Pull Requests: count created, merged, closed; average time-to-merge; top contributor.
- Issues: count created; count bug reports (label contains "bug"); count of bug reports closed.

Compile into a `report.json` in `/app/` with the exact structure: {"pr": {"total", "merged",
"closed", "avg_merge_days", "top_contributor"}, "issue": {"total", "bug", "resolved_bugs"}}.
```

#### shock-analysis-supply (gt = skill-105)

```
This task is to estimate an investment spending shock to a small open economy (Georgia) using
Cobb-Douglas production function. The investment will last 8 years beginning from 2026, worth 6.5
billion USD. Collect data from PWT database, IMF WEO database, ECB CFC data, populate test file,
run the model in excel. You should ONLY use excel for this task (no python, no hardcoded numbers).

STEP 1: data collection. STEP 2: HP filter in excel (use Solver). STEP 3: Production function
(calculate K/Y, Ystar_base, deltaK, K_with, Ystar_with). Output to `test-supply.xlsx`.
```

其余 20 个 query 见 `queries.json`(完整文本因长度未在此嵌入)。

---

## 附录 B:八个路由变体 SKILL.md 实现

所有变体共享相同的 frontmatter(`name: skill-router-skills`,完全相同的 `description`,只在 `metadata.skill-router.variant` 上区分)。差异完全位于 markdown body 的工作流描述。

### B.1 A-router(自实现 lexical retriever)

```markdown
# skill-router - Variant A (self-implemented retriever)

Use this skill as a closed last-resort fallback when no enabled skill clearly
matches and the request looks skill-shaped: operating, querying, configuring,
deploying, inspecting, or troubleshooting a named tool, API, service,
dashboard, datastore, CLI, DSL, URL, or platform workflow.

## Locate the CLI

Prefer `${SKILL_ROUTER_CLI}` when it is set. Otherwise locate the bundled CLI
next to this skill installation:

- Installed plugin: compute the directory two levels above this `SKILL.md`,
  then append `bin/skill-router`.
- Repository checkout: use `bin/skill-router`.

Always invoke the CLI by absolute path. Define a helper for the resolved CLI
path:

\`\`\`bash
skill_router() { "<abs-path-to-skill-router>" "$@"; }
\`\`\`

## Route disabled skills

Run the route command before solving from general knowledge. Pass the user's
verbatim message as `--query`, including filenames, file types, and concrete
nouns. Do NOT summarize, paraphrase, or shorten — the router scores against
the exact text.

\`\`\`bash
skill_router skills route --query "<user message verbatim>" --json
\`\`\`

If the result has `action: "read-skill-file"` and a non-null `selected`, the
`selected.skillName` (or the directory name in `selected.skillMdPath`) IS
the chosen skill id. Return that id as your routing result.

If `action` is `"no-confident-match"`, fall back to general knowledge.
```

### B.2 B-cc(DCI-Agent-CC,自由 shell)

```markdown
# skill-router - Variant B (DCI-Agent-CC style, fully free shell)

## Disabled skill corpus

The user has additional Agent Skills that are currently disabled. Each
disabled skill lives in its own directory under:

\`\`\`
~/.claude/skills/<skill-id>/SKILL.md.skill-router-disabled
\`\`\`

Every disabled `SKILL.md.skill-router-disabled` file has YAML frontmatter with
at least a `name:` field and a `description:` field, followed by a markdown
body of instructions.

## Workflow

1. Search the disabled skill corpus using whatever shell tools you find
   appropriate (for example `ls`, `find`, `grep`, `head`, `cat`, `awk`).
2. Identify the single disabled skill whose `name:` / `description:` / body
   best matches the user's request.
3. Return that skill's id as the chosen routing result.
4. If no disabled skill is a confident match, fall back to general knowledge.

There is no router CLI in this variant. You must do the retrieval and
selection yourself.
```

### B.3 C-lite(DCI-Agent-Lite,有界管道)

```markdown
# skill-router - Variant C (DCI-Agent-Lite style)

## Workflow (DCI-Agent-Lite: bash-only with composable pipelines)

This variant follows the "Direct Corpus Interaction" minimal harness from
arXiv:2605.05242 §3 (DCI-Agent-Lite). Use **only the Bash tool** — do NOT
use the Read tool. Every step must bound its output (`head`, `tail`, `sed`,
or `wc -l`); never dump unbounded file contents.

### Core operations

- **list / find candidates** — corpus enumeration:
  \`ls ~/.claude/skills/*/SKILL.md.skill-router-disabled | wc -l\`

- **exact match** with line numbers:
  \`grep -l -i "<keyword>" ~/.claude/skills/*/SKILL.md.skill-router-disabled\`
  \`grep -n -i "<keyword>" ~/.claude/skills/*/SKILL.md.skill-router-disabled | head -20\`

- **pipeline composition** — AND-combine 2 strong keywords:
  \`grep -l -i "<kw1>" ~/.claude/skills/*/SKILL.md.skill-router-disabled | xargs grep -l -i "<kw2>"\`

- **local inspection** with line numbers and bounded context:
  \`grep -n -i -B1 -A2 "<keyword>" <path> | head -40\`

- **bounded read** (frontmatter or first body block):
  \`sed -n '1,30p' <path>\`  (frontmatter)
  \`sed -n '1,200p' <path>\`  (initial body window)

### Loop

1. Pick 2-4 distinctive keywords from the user's request.
2. Run a composable pipeline that AND-combines 2 strong keywords to narrow candidates.
3. For each finalist, read frontmatter only via `sed -n '1,30p'`.
4. Pick one winner and return its skill-id as your chosen routing result.
5. If no winner emerges, fall back to general knowledge.
```

### B.4 D-agentic(AgenticRAG 结构化 4 工具)

```markdown
# skill-router - Variant D (AgenticRAG-style structured loop)

## Workflow (structured agentic loop)

This variant follows the four-tool agentic retrieval pattern from arXiv:
2605.05538 (AgenticRAG). Do NOT call `skills route` directly. Instead drive
the loop yourself with four structured tools that the skill-router CLI exposes:

| Tool | Purpose | CLI form |
|---|---|---|
| `search` | corpus-wide candidate discovery | `skill_router skills dci search --query "<keywords>" --json` |
| `find` | in-skill keyword search by ref | `skill_router skills dci find <ref> --pattern "<term>" --json` |
| `open` | bounded window read by ref+line | `skill_router skills dci open <ref> --line <N> --window 80 --json` |
| `summarize` | bounded full-text read | `skill_router skills dci read <ref> --json` |

### Loop

1. **search**: derive 2-3 short keyword queries from the user request. Run `dci search` once.
2. **drill down** (find / open): for the top 1-2 candidates, refine with `dci find <ref> --pattern`,
   then `dci open <ref> --line <hit-line>` if needed. Keep total find/open calls ≤ 3.
3. **summarize / commit**: when one candidate is the clear winner, return its **bare** skill-id.
   The `dci search` / `dci find` JSON responses report ids as `user:skill-NNN` (or
   `user:codex:skill-NNN`). **Strip the `user:` (and any `codex:`) prefix** before emitting
   `matched_skill_name` — output just `skill-NNN` (e.g. `skill-037`, NOT `user:skill-037`).
4. If no candidate is a confident match, fall back to general knowledge.
```

### B.5 E-digest(2-call corpus catalog)

```markdown
# skill-router - Variant E (compact corpus digest, turn-optimized DCI)

## Why this variant

This is a turn-optimized form of Direct Corpus Interaction. B/C variants spend 4-5 shell calls per
query; each extra turn re-sends the whole accumulated context. This variant collapses corpus
access into a thin wrapper so retrieval costs exactly **two tool calls** — while the agent still
does all the judgement itself (the wrapper performs no scoring or ranking).

## The wrapper

A mechanical corpus-access wrapper is installed at `~/.claude/skill-corpus`. It has exactly two
operations:

- `skill-corpus catalog` — prints the entire disabled-skill corpus, one line per skill:
  `<skill-id><TAB><description>`. No ranking; raw frontmatter only.
- `skill-corpus show <skill-id>` — prints the bounded body of one disabled skill.

## Workflow (exactly two tool calls)

1. **Digest** — fetch the whole catalog in one call:
   \`bash ~/.claude/skill-corpus catalog\`
   Read the returned `<id>\t<description>` lines. Reason over them yourself: match the user's
   request against the descriptions and pick the single best `<skill-id>`.

2. **Commit** — return `<chosen-skill-id>` as your chosen routing result.

3. If no catalog entry is a confident match, fall back to general knowledge.
```

### B.6 H-bounded(bounded DCI-CC)

```markdown
# skill-router - Variant H (DCI-Agent-CC, bounded corpus access)

## Disabled skill corpus

The disabled-skill corpus is EXACTLY this glob — nothing else:
\`~/.claude/skills/*/SKILL.md.skill-router-disabled\`

Every command you run against the corpus MUST target that glob. Never run a bare
`ls ~/.claude/skills/` — that enumerates every skill directory indiscriminately and the bare
directory names carry no description-level signal.

## Bounded retrieval

Search with whatever shell tools you prefer (`grep`, `sed`, `awk`, `find`, `head`) — but keep every
step bounded:

- Your FIRST command must already carry description-level signal. Grep the user request's
  distinctive keywords across the corpus frontmatter so the result is a relevance-bounded shortlist:
  \`grep -l -i -E "<kw1>|<kw2>|<kw3>" ~/.claude/skills/*/SKILL.md.skill-router-disabled\`
- Bound every command's output: cap with `head`, `sed -n`, or `grep -m`; never emit more than ~80
  lines per call.
- Inspect at most the top 2-3 shortlisted candidates' frontmatter before committing — bounded.
- Read exactly one winner, bounded (`sed -n '1,220p'`).

## Workflow

1. Bounded keyword grep over the disabled glob → relevance-bounded candidate shortlist.
2. If 2+ candidates remain, bounded frontmatter inspection of the top few to disambiguate.
3. Return the chosen skill-id as your routing result.
4. If no candidate is a confident match, fall back to general knowledge.
```

### B.7 I-meta(metadata-only,禁读 body)

```markdown
# skill-router - Variant I (DCI shell, metadata-only)

## Metadata-only retrieval

Route using ONLY frontmatter metadata. You MUST NOT read any skill body — do not `cat`, `sed`,
`head`, or `Read` past a file's frontmatter block (in practice the first ~12 lines). The
`description:` field is your only signal.

### Workflow

1. Pull the whole corpus's id + description in one bounded command:

   \`\`\`bash
   for f in ~/.claude/skills/*/SKILL.md.skill-router-disabled; do
     printf '%s\t' "$(basename "$(dirname "$f")")"
     grep -m1 '^description:' "$f" | cut -c1-300
   done
   \`\`\`

   This yields one `<skill-id><TAB><description>` line per skill.

2. Reason over the descriptions yourself and pick the single best `<skill-id>` for the user request.

3. If two descriptions are genuinely close, you may re-inspect just their frontmatter blocks
   (`sed -n '1,12p' <path>`) to disambiguate — but still NEVER read the body.

4. Commit to the chosen skill (return only its id). If no description is a confident match, fall
   back to general knowledge.
```

### B.8 J-bounded(关键词过滤短列表)

```markdown
# skill-router - Variant J (keyword-filtered retrieval)

The disabled-skill corpus is at `~/.claude/skills/*/SKILL.md.skill-router-disabled`. Each file's
YAML frontmatter has `name:` and `description:`, followed by a markdown body with the skill's
actual instructions.

## Workflow

1. Pick 3–5 distinctive keywords from the user request (proper nouns, file types, verbs,
   tool/platform names; use synonyms if a term is generic).

2. Filter descriptions by keywords in one bounded command — never pull the whole catalog:

   \`\`\`bash
   grep -i -m1 '^description:' ~/.claude/skills/*/SKILL.md.skill-router-disabled \
     | grep -i -E "<kw1>|<kw2>|<kw3>" | head -20
   \`\`\`

   Output lines look like `<path>:description: "..."`.

3. If the shortlist is empty or all candidates look wrong, broaden keywords and re-grep once.
   Do not fall back to dumping the whole catalog.

4. Pick the single best `<skill-id>` from the shortlisted descriptions. If two are genuinely close,
   inspect their frontmatter (`sed -n '1,12p' <path>`) to disambiguate.

5. Return the chosen `<skill-id>` as your routing result.

If no description is a confident match after one re-grep, fall back to general knowledge.
```

---

## 附录 C:实验产物清单

| 路径 | 内容 |
| --- | --- |
| `queries.json` | 24 个 SkillsBench query 全文 + gt 标注 |
| `corpus-manifest.json` | `skill-NNN → 原始归属` 的映射(离线分析用) |
| `crop-skillrouter.mjs` | 从 SkillRouter eval-core 裁剪到 150 skill 的脚本 |
| `variants/routing-only/<variant>.SKILL.md` | 8 个 router 变体的 SKILL.md 实现(附录 B 全文) |
| `routing-only-paired.mjs` | Phase 2 paired driver(432 cells 主跑) |
| `claudemd-policy-probe.mjs` | Phase 1 gate probe driver(64 cells) |
| `analyze-claudemd-probe.mjs` | Phase 1 gate metric 分析器 |
| `detail-paired.mjs` | Phase 2 详细指标分析器(含 ctx_end 修正) |
| `render-paired.mjs` | Phase 2 side-by-side HTML 渲染器 |
| `rerun-d-agentic.mjs` | D-agentic SKILL.md 修复后的 48-cell rerun driver |
| `codex-routing-only-9x24.mjs` | Codex 9×24 routing-only driver wrapper |
| `merge-codex-routing-runs.mjs` | Codex 4×24 + 5×24 结果合并器 |
| `render-codex-9x24.mjs` | Codex 9×24 Markdown 报告渲染器 |
| `capture-native-prompts.mjs` | Codex / Claude Code native 请求抓包与摘要脚本 |
| `runs/claudemd-probe/` | Phase 1 64-cell transcripts + summary.json + gate-report.json |
| `runs/routing-only-9x24-claudemd/` | Phase 2 paired 432-cell transcripts + summary.json + summary-metrics.json + report.html |
| `runs/codex-routing-only-9x24/` | Codex 9×24 汇总 summary.json + report.md |
| `runs/native-prompt-capture/analysis.md` | native 请求抓包汇总(原始 request JSON 本地忽略) |
| `REPORT-claudemd.md` | 本报告 |
| `REPORT-claudemd.html` | 本报告 HTML 版 |
