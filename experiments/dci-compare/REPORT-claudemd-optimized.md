# Disabled-Skill 路由策略实验报告

实验日期: 2026-05-23 至 2026-05-25
数据: SkillRouter eval-core (arXiv:2603.22455) 裁剪匿名化语料
范围: Claude Code paired 实验、Codex A-M 策略实验、J/L/M 规模扩展实验、论文 original Hard pool 对齐实验

---

## 摘要

`skill-router` 的目标是把低频 skill 从宿主常驻上下文中移出,在需要时再从 disabled-skill 语料中路由回来。本报告评估多轮策略迭代中的准确率、成本和可扩展性。

主要结论如下:

1. **Claude Code 下必须先处理 trigger noise,否则 retriever 对比会失真。** 在无额外提示时,router 变体有大量 cell 跳过 `skill-router-skills` 并直接输出 `xlsx`、`pptx`、`jax` 等不存在的 skill 名。注入 `<HOME>/.claude/CLAUDE.md` 后,排除 D-agentic 修复 rerun 的 7 个可比 router 变体中,trigger rate 从 78.0% 提升到 97.6%,hallucination 从 22.0% 降到 2.4%,accuracy 从 69.0% 提升到 86.9%。
2. **Claude Code 150-skill 实验中,B-cc 与 C-lite 最高准,J-bounded 是高准确率组里的最低成本 router。** B-cc / C-lite 均为 23/24;D-agentic / E-digest / H-bounded / J-bounded 为 22/24;在达到 22/24 的 router 变体中,J-bounded 成本最低($3.07)且 ctx_end 最低(30.7K)。
3. **Codex 150-skill 实验呈现不同排序。** 同一 24-query / 150-skill 语料上,Codex native G-native 与 D-agentic 均为 24/24;C-lite / E-digest / H-bounded 为 23/24;J-bounded 仍是低成本点但不是最高准确率点。后续 K-bounded、K-lite fixed、L-agentic、M-bm25 在 150-skill 上也达到 24/24。
4. **宿主差异显著。** Codex native G-native 为 24/24,Claude Code native G-native 为 15/24。抓包显示二者 skill 元数据呈现方式不同:Codex native 请求内联了更完整的 skill description,Claude Code native 使用更短的 skill listing 和独立 `Skill` tool。
5. **150 到 1K 扩展仍较稳,但不能外推到 79K Hard。** L-agentic 在 150-skill 为 24/24,在 1K synthetic corpus 上为 23/24,唯一 miss 是 `pptx-reference-formatting`。但 M-bm25 在 original 79,141 Hard pool 的当前 24-query 上为 11/24,在论文 paper-core single 24-query 上为 14/24;J-bounded-v2 在 paper-core single Hard 上 strict 为 11/24,alias-normalized 为 14/24。
6. **论文对照只能分维度比较,不能严格 apples-to-apples。** SkillRouter 论文公开了 75 core queries 的 `nd` Easy/Hard 指标,也公开了 24 single queries 的 full-text `Single Hit@1`,但没有公开 `Single x nd x Hard-only` 交叉表。本报告的 paper-core single Hard 复跑填补的是这个缺口,方法仍是 agentic router,不是论文的纯 BM25 / embedding baseline。
7. **A-router 不是可接受默认方案。** Claude Code with-CLAUDE.md 为 13/24,Codex 为 8/24。固定 lexical / 级联 scorer 在长 query 和针对性 distractor 下稳定落后于 LLM-driven keyword extraction。

本报告只评估路由层,不评估匹配 skill 后的下游执行成功率。所有排名都是单次运行的 strict-match routing-only 分数,默认包含 ambiguous 样本。

---

## 1. 研究问题

当已启用 skill 无法覆盖用户请求时,agent 需要从 disabled skill 中选择最合适的一个。本实验回答三个问题:

- **RQ1 准确率:** 哪种实现最可靠地选中 ground-truth skill?
- **RQ2 成本:** token、工具调用、耗时和美元成本如何权衡?
- **RQ3 机制:** 读 `SKILL.md` body 是否显著优于只看 metadata? 宿主原生 skill 选择与显式 router 的差异是什么?

---

## 2. 数据与语料

### 2.1 语料来源

语料来自 SkillRouter `eval-core`:

| 成分 | 数量 | 说明 |
| --- | ---: | --- |
| Ground-truth skill | 19 | 24 个 single-skill task 的 gt 实体,部分任务共享同一 gt |
| 针对性 distractor | 80 | SkillRouter 用 GPT-4o-mini 生成的同域近义干扰 |
| 噪声 skill | 51 | 从 easy pool 确定性随机抽样补齐 |
| 合计 | 150 | 150-skill 对比实验规模 |

首版语料曾保留 `gt-*` / `distractor-*` 目录名前缀,会泄露答案。修复后,所有目录名和 frontmatter `name` 均匿名化为 `skill-001` 到 `skill-150`,并在确定性洗牌后分配。映射只保存在 `corpus-manifest.json`,用于离线分析,不暴露给 agent。

### 2.2 查询集

24 个 query 直接使用 SkillsBench single-skill 任务的 `instruction_text`。这些 query 是完整任务描述,通常包含文件路径、输出格式和约束,不是为了本实验手写的短关键词查询。完整列表见 `queries.json`。

后续 paper-core single 对齐实验改用 SkillRouter 论文 75 core queries 中 `core_gt_ids.length == 1` 的 24 条。它与本报告初始 `queries.json` 的 24 条只有 16 条重叠;初始集合包含若干 generic file-type task,而论文 core single 集合包含 `flink-query`、`invoice-fraud-detection`、`latex-formula-extraction`、`manufacturing-*`、`paper-anonymizer`、`simpo-code-reproduction`、`xlsx-recover-data` 等任务。

需要注意两个数据层面的影响:

- `gh-repo-analytics` 的 gt 标注存在争议:gt skill 是工具中心描述,而多个 router 选择的 distractor 更贴近 query 的任务中心描述。
- `skill-105` 是通用 Excel skill,被 5 个 query 共用,会放大 spreadsheet 类描述质量对总分的影响。

---

## 3. 变体

| 类别 | 变体 | 路由方式 |
| --- | --- | --- |
| 自实现检索器 | A-router | 调 `skill-router skills route`,由 CLI 做 metadata / dci / lexical 级联评分 |
| DCI | B-cc | agent 自由使用 shell 搜索 disabled-skill 目录 |
| DCI | C-lite | 仅 bash,用有界 grep / sed 管道局部读取 |
| AgenticRAG | D-agentic | 结构化 `dci search/find/open/read` 循环 |
| Metadata-only | E-digest | `skill-corpus catalog` 拉取 description 目录后选择 |
| DCI bounded | H-bounded | 类似 B,但限制裸 `ls` 和输出规模 |
| Metadata-only | I-meta | 只读 description,禁止读取 body |
| Metadata-only bounded | J-bounded | 先抽 3-5 个关键词,grep 过滤 description 短列表 |
| Metadata-only bounded | K-bounded | J 的加强版:grep shortlist 后允许模型查看候选 frontmatter |
| Metadata-only lite | K-lite / K-lite fixed | 降低 K 的 shell 代码和工具成本;fixed 版修正准确率回退 |
| AgenticRAG CLI | L-agentic | `corpus search/inspect` 抽象,用 CLI 承担索引、分页和候选引用 |
| BM25 CLI | M-bm25 | L 的 BM25 ranker 版本:metadata BM25 shortlist + Codex metadata rerank |
| 宿主原生 | G-native | 不加载 router,150 个 skill 全启用,由宿主 native 选择 |

Router 变体使用 `variants/routing-only/<variant>.SKILL.md`。所有 router 变体共享相同 frontmatter;差异只在 body 工作流。

---

## 4. 实验设计

### 4.1 Routing-only 设置

每个 query 末尾追加 `STOP_TAIL`,要求 agent 只输出:

```json
{"matched_skill_name":"<skill-id>"}
```

然后停止。这样可以隔离路由步骤,避免下游文件处理、表格计算、PDF/PPTX 操作等执行质量污染路由指标。

### 4.2 Claude Code paired 实验

Claude Code 部分使用 `routing-only-paired.mjs`:

- 9 变体 x 24 query x 2 conditions = 432 cells。
- 两个 conditions: with-CLAUDE.md 与 without-CLAUDE.md。
- 每个 `(variant, condition)` 使用隔离 `$HOME`。
- G-native 例外:语料全启用,不加载 router plugin。
- Router 变体:语料全禁用,加载 `skill-router-skills`。
- 每 cell timeout 240s。

with-CLAUDE.md 写入:

```markdown
# Skill routing

`skill-router-skills` is a routing Skill that searches a catalog of
locally-installed disabled skills.

When no enabled Skill clearly matches the user's query, you must call
`skill-router-skills` before answering. Do not invent a Skill name or
fabricate `matched_skill_name` without a Skill/tool result.
```

在跑完整 paired 实验前,先用 64-cell gate probe 验证这段 CLAUDE.md 是否能提升 trigger,并预先设置 gate criteria:

```text
PASS = trigger_rate(with) >= 95%
     AND trigger_lift >= +20pp
     AND direct_match_preservation(with) >= 90%
     AND no degradation > 10pp vs without
```

probe 结果全部通过: fallback trigger lift +62.5pp,direct-match preservation 100%。

### 4.3 Codex 9x24 实验

Codex 部分使用同一 24-query、同一 150-skill 语料、同一 routing-only 输出 schema。它不是 Claude Code 的附录或次级验证,而是同等地位的宿主实验,用于比较不同宿主下同一组路由策略的排序。运行环境:

- `codex exec`
- model `gpt-5.5`
- reasoning effort `high`
- 9 变体 x 24 query = 216 cells

Codex 版 router 只做宿主路径适配: `.claude/skills` 改为 `.codex/skills`,并统一 skill id 前缀处理。

### 4.4 规模扩展实验

规模扩展分三层,验证 150-skill 结论是否能外推到更大 skill pool:

- 150-skill: 匿名化 150-skill 对比语料。
- 1K synthetic corpus: 150-skill 对比语料 + 850 synthetic noise skill,用于低成本观察索引和 prompt 的扩展趋势。
- 79,141-candidate Hard pool: SkillRouter eval-core Hard tier。
- 变体: J-bounded-v2、L-agentic、M-bm25。

79K original Hard pool 实验使用 SkillRouter 论文数据集原始 skill IDs 的 opaque 映射。agent 可见的候选 id 是 `sr-*`;metadata 中保留原始 name / description,因此这不是完全匿名化,但不会把 `gt/` 或 `distractor/` 目录前缀暴露为答案线索。

论文对照有两个口径:

- 论文 `nd` 指 name + description only,在 75 core queries 上报告 Easy / Hard / Avg,不拆 single-only。
- 论文 `Single Hit@1` 是 24 single queries,但属于 full skill text 主结果,不是 `nd`。

因此本报告的 `paper-core single x Hard x metadata-only` 复跑只能作为补充格子,不能和论文已发布表格做严格同分母对比。

---

## 5. 指标

- **Accuracy:** `matched_skill_name` 归一化后与 expected skill 严格相等。
- **Trigger rate:** router 变体是否调用了 `skill-router-skills`。
- **Hallucination:** 输出不存在的 skill 名,即不匹配 `^skill-\d{3}$` 或输出 router 自身。
- **Failure type:** 错选项映射为 distractor / noise / hallucinated / none。
- **ctx_end:** 最后一个 assistant message 的 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`。这是最终 turn 实际接收的上下文窗口占用。
- **Claude Code cost / duration / turns:** 从 stream-json `result.usage` 与 transcript 统计,使用 Claude Code 报告的 `total_cost_usd`。
- **Codex cost est.:** Codex 表中的美元成本是估算值,公式为 `(fresh_input_tokens * $5 + cached_input_tokens * $0.5 + output_tokens * $30) / 1M`,使用 2026-05-24 记录的 gpt-5.5 standard API list price。Codex `output_tokens` 已包含 reasoning token 口径。该列适合 Codex 内部量级比较,不应与 Claude Code `total_cost_usd` 做精确横向财务比较。

重要修正:不能把 `result.usage.cache_read` 当作上下文窗口占用。它是整段会话每轮重读的累计流量,会被 turn 数放大。旧稿曾混用该指标,导致 B-cc / C-lite 等多轮变体的 ctx_end 被高估。

---

## 6. 实验一: Claude Code

以下为 Claude Code with-CLAUDE.md 条件下的 strict-match 结果。D-agentic 使用 format 修复后的 rerun;因此 D 的绝对值可作为修复后结果读取,但不纳入 paired aggregate。

### 6.1 准确率

| rank | variant | accuracy | trigger | hallucination |
| ---: | --- | ---: | ---: | ---: |
| 1 | B-cc | 23/24 (95.8%) | 24/24 | 0/24 |
| 1 | C-lite | 23/24 (95.8%) | 24/24 | 0/24 |
| 3 | D-agentic | 22/24 (91.7%) | 23/24 | 1/24 |
| 3 | E-digest | 22/24 (91.7%) | 24/24 | 0/24 |
| 3 | H-bounded | 22/24 (91.7%) | 23/24 | 1/24 |
| 3 | J-bounded | 22/24 (91.7%) | 23/24 | 1/24 |
| 7 | I-meta | 21/24 (87.5%) | 23/24 | 1/24 |
| 8 | G-native | 15/24 (62.5%) | n/a | 0/24 |
| 9 | A-router | 13/24 (54.2%) | 23/24 | 1/24 |

解读:

- B-cc / C-lite 是 Claude Code 150-skill 上的最高准确率组。
- D / E / H / J 只低 1 cell,在 n=24 下不宜解读为稳定差异。
- A-router 是唯一低于 G-native 的 router。
- G-native 15/24 表明 Claude Code native 在该语料上的元数据选择不足以处理近义 distractor。

### 6.2 成本与上下文

| variant | accuracy | cost | duration | turns | avg ctx_end |
| --- | ---: | ---: | ---: | ---: | ---: |
| G-native | 15/24 | $2.98 | 130s | 24 | 36.5K |
| J-bounded | 22/24 | $3.07 | 374s | 96 | 30.7K |
| D-agentic | 22/24 | $3.65 | 467s | 100 | 34.1K |
| A-router | 13/24 | $3.90 | 499s | 96 | 35.3K |
| E-digest | 22/24 | $4.11 | 355s | 96 | 38.0K |
| H-bounded | 22/24 | $4.16 | 542s | 132 | 32.9K |
| I-meta | 21/24 | $4.16 | 404s | 93 | 38.0K |
| C-lite | 23/24 | $4.30 | 654s | 156 | 32.7K |
| B-cc | 23/24 | $5.56 | 896s | 197 | 34.3K |

Pareto 角度:

- 如果目标是 Claude Code 下的最高准确率,C-lite 比 B-cc 更便宜、更短。
- 如果目标是低成本和较高准确率,J-bounded 是更合适的默认点。
- G-native 成本低但准确率不足,不适合作为该语料上的唯一方案。

### 6.3 CLAUDE.md 的作用

| variant | acc with | acc without | trigger with | trigger without |
| --- | ---: | ---: | ---: | ---: |
| A-router | 13/24 | 10/24 | 23/24 | 20/24 |
| B-cc | 23/24 | 19/24 | 24/24 | 19/24 |
| C-lite | 23/24 | 16/24 | 24/24 | 16/24 |
| D-agentic (fixed rerun) | 22/24 | 19/24 | 23/24 | 20/24 |
| E-digest | 22/24 | 17/24 | 24/24 | 19/24 |
| H-bounded | 22/24 | 19/24 | 23/24 | 19/24 |
| I-meta | 21/24 | 17/24 | 23/24 | 19/24 |
| J-bounded | 22/24 | 18/24 | 23/24 | 19/24 |
| **paired aggregate, excl. D-agentic** | **146/168** | **116/168** | **164/168** | **131/168** |

G-native 两条 arm 均为 15/24。由于 G-native 不加载 `skill-router-skills`,CLAUDE.md 对它基本是 no-op;这支持一个结论:with-arm 提升主要来自 trigger 行为改变,而非单纯跨 run 随机波动。不过每 cell 仍只有一次运行,不能据此给出统计显著性结论。D-agentic 的 row 保留为修复后参考值,但因为它来自另一次 rerun,aggregate 不再混入 D-agentic。

### 6.4 失败构成

with-CLAUDE.md 下没有任何变体选到随机 noise skill。错误主要落在两类:

- **针对性 distractor:** G-native 9 次、A-router 10 次、其他强 router 1-2 次。
- **残余 hallucination:** router 聚合 5/192,多发生在强 keyword query 上,如 `.xlsx`、BibTeX、GitHub analytics。

这说明 SkillRouter 的 targeted distractor 设计确实构成主要难点;随机 easy noise 不是主导错误来源。

---

## 7. 实验二: Codex

### 7.1 结果

Codex 没有 paired with/without arm,因此本节只报告 9x24 宿主实验结果。`cost est.` 是估算值,口径见 §5。

| variant | accuracy | trigger | duration | tools | avg ctx_end | cost est. |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| G-native | 24/24 | n/a | 185s | 0 | 19.5K | $1.816 |
| A-router | 8/24 | 24/24 | 946s | 59 | 26.9K | $4.485 |
| B-cc | 22/24 | 24/24 | 718s | 84 | 30.8K | $4.853 |
| C-lite | 23/24 | 24/24 | 659s | 140 | 18.4K | $3.594 |
| D-agentic | 24/24 | 24/24 | 539s | 59 | 19.7K | $2.870 |
| E-digest | 23/24 | 24/24 | 638s | 48 | 20.3K | $2.946 |
| H-bounded | 23/24 | 24/24 | 751s | 130 | 19.9K | $4.348 |
| I-meta | 22/24 | 24/24 | 495s | 50 | 21.1K | $3.310 |
| J-bounded | 22/24 | 24/24 | 474s | 53 | 16.9K | $2.415 |

Codex 与 Claude Code 的主要差异:

- Codex native G-native 在 150-skill 基准上为 24/24;Claude Code native 为 15/24。
- Codex router 全部 24/24 触发,trigger noise 不是主要问题。
- Codex 下 D-agentic 达到 24/24,且成本低于 B/C/H。
- A-router 在两边都低,说明问题不只是宿主差异。

### 7.2 错误分布

除 A-router 外,Codex 的 miss 集中在少数边界样本:

| variant | miss |
| --- | --- |
| G-native | none |
| B-cc | `gh-repo-analytics`→`skill-046`, `virtualhome-agent-planning`→`skill-110` |
| C-lite | `enterprise-information-search`→`skill-087` |
| D-agentic | none |
| E-digest | `weighted-gdp-calc`→`skill-026` |
| H-bounded | `shock-analysis-supply`→`skill-080` |
| I-meta | `earthquake-plate-calculation`→`skill-092`, `gh-repo-analytics`→`skill-046` |
| J-bounded | `econ-detrending-correlation`→`skill-105`, `shock-analysis-supply`→`skill-080` |

A-router 的错误分布不在表中展开:16 个 miss 集中误选 `skill-043` / `skill-140` / `skill-037`,更像固定 scorer 偏置,而非少数边界样本。

### 7.3 Native 差异的证据

对 `weighted-gdp-calc` 抓取真实 native 请求后,观察到:

| host | endpoint | skill lines | skill section chars | avg desc chars | 执行机制 |
| --- | --- | ---: | ---: | ---: | --- |
| Codex | `/v1/responses` | 150 | 21,117 | 92 | instructions 中内联 available skills |
| Claude Code | `/v1/messages?beta=true` | 150 | 7,948 | 20 | `Skill` tool + budgeted skill listing |

这不是完整因果证明,因为抓包只覆盖一个代表 query 和当前 CLI / 模型版本。但它与 24-query 结果一致:同语料同 query 下,宿主呈现给模型的 skill 元数据不同,足以改变 native 选择质量。

### 7.4 Codex 后续策略迭代

在 A-J 之后,继续补跑了 D metadata-only 修复版、K、K-lite、L、M。下表仍使用同一 24-query / 150-skill routing-only 语料,除 L 1K 外都是 150-skill:

| variant | corpus | accuracy | trigger | duration | avg ctx_end | cost est. | 说明 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| D-agentic metadata-only | 150 | 24/24 | 24/24 | 578s | 19.1K | $3.595 | 去掉读 body 后仍全对 |
| K-bounded | 150 | 24/24 | 24/24 | 726s | 17.3K | $3.553 | grep shortlist + 候选 metadata |
| K-lite high | 150 | 21/24 | 24/24 | 606s | 16.7K | $3.516 | 成本下降但准确率回退 |
| K-lite fixed | 150 | 24/24 | 24/24 | 704s | 17.4K | $3.321 | 修复 K-lite 回退后全对 |
| L-agentic | 150 | 24/24 | 24/24 | 537s | 17.5K | $2.768 | CLI `corpus search/inspect` 抽象 |
| L-agentic | 1K synthetic | 23/24 | 24/24 | 637s | 17.9K | $3.442 | miss: `pptx-reference-formatting` -> `skill-103` |
| M-bm25 | 150 | 24/24 | 24/24 | 593s | 18.1K | $2.982 | BM25 index-fix run |

解读:

- 150-skill 上,Codex 的 metadata-only / metadata-first 策略已经很容易达到 24/24,不能仅凭该规模判断可扩展性。
- L-agentic 在 1K synthetic 上只掉 1 cell,且上下文几乎不涨,说明 CLI 抽象比手写 shell 更适合承载索引和分页。
- K-lite 的 21/24 说明压缩 prompt 和 shell 代码会影响模型的候选生成质量;fixed 版恢复到 24/24,但仍依赖 shell 文本管道。
- M-bm25 在 150 上低成本全对,但它是 BM25 shortlist + Codex metadata rerank,不是论文里的纯 BM25 top-1 baseline。

### 7.5 L 方案实现要点

L-agentic 将检索能力下沉到 CLI:

- `corpus search`: 返回稳定 `ref`、`shortId`、score、description 摘要和分页元信息。
- `corpus inspect`: 对少量候选返回完整 metadata,避免模型自己拼 shell 管道和解析路径。
- 模型职责从“写 grep/awk/sed 检索器”变成“生成 query terms、比较候选证据、做最终选择”。

这和纯 shell 的最大差异是扩展边界更清楚:大语料索引、缓存、分页、top-k、JSON schema、fingerprint 都由 CLI 负责,模型只消费有界结构化候选。1K 结果支持这个方向,但 79K original Hard 仍需要继续验证。

---

## 8. 规模扩展: J-bounded

### 8.1 为什么扩展

150-skill 对比实验能比较变体,但不能代表真实大规模安装场景。J-bounded 在 Claude Code router 变体中、且达到 22/24 的组里成本最低,因此需要验证它在更大 skill pool 上是否仍可靠。

### 8.2 v1 失效机制

J-bounded v1 的模板存在两个规模问题:

1. **shell glob 撞 `ARG_MAX`:** `~/.claude/skills/*/SKILL.md.skill-router-disabled` 在约 13K paths 后超过 Linux argv 限制。
2. **`head -20` 截断正确答案:** 在 79K Hard pool 上,关键词可能匹配几十到上百个候选;gt 若排在第 20 位之后会被系统性切掉。

### 8.3 v2 修复

J-bounded-v2 只改 body workflow,frontmatter description 保持不变:

| 项 | v1 | v2 |
| --- | --- | --- |
| 枚举 | shell glob | `find -print0 | xargs -0` |
| 候选上限 | `head -20` | 不截断;太多时收窄关键词重跑 |
| 关键词指导 | distinctive keywords | narrow technical terms,避免 broad words |
| shortlist payload | description 文本 | path-only 后再查 description |

### 8.4 结果

| 配置 | accuracy | trigger | cost | avg cost/cell | duration | avg ctx_end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| J-v1 x 150 (Claude Code) | 22/24 | 23/24 | $3.07 | $0.128 | 374s | 30.7K |
| J-v2 x 150 | 22/24 | 23/24 | $3.95 | $0.164 | 665s | 30.8K |
| J-v2 x 79K Hard | 12/24 | 23/24 | $5.33 | $0.222 | 1577s | 36.6K |
| J-v2 x paper-core single Hard (Codex) | 11/24 strict; 14/24 alias-normalized | 24/24 | $12.44 | $0.518 | 3056s | 30.3K |

解释:

- v2 在 150 上没有损失准确率,但更慢、更贵。
- v2 在 79K 上仍能保持 bounded payload,成本只上升约 35%,ctx_end 上升约 19%。
- 准确率从 22/24 降到 12/24 或 11/24,主要是 description-only 在大量近义 / catch-all skill 面前不足。
- Codex paper-core single run 中,J-v2 有 3 条输出了原始 skill name alias 而非 `sr-*` opaque id;strict 计 11/24,若把这些 alias 映射回 gt id 则为 14/24。这暴露了 metadata 文件物化时 `name:` 可见带来的输出格式风险。

这修正了 150-skill 结论的外推边界:J-bounded 是 Claude Code 150-skill router 变体中的低成本 Pareto 点,但不能直接等价为 80K 规模的高准确率方案。生产方向应是 metadata-first + body-on-tie,而不是永久 metadata-only。

### 8.5 论文 metadata-only 对照

SkillRouter 论文公开的 `nd` 指标使用 name + description only,但分母是 75 core queries,不是 single-only:

| source | method | input | query / corpus | Hard Hit@1 | Avg Hit@1 |
| --- | --- | --- | --- | ---: | ---: |
| Paper Table 9 | BM25 | nd | 75 core, Easy/Hard | 0.0% | 0.0% |
| Paper Table 9 | Qwen3-Emb-0.6B | nd | 75 core, Easy/Hard | 14.7% | 18.7% |
| Paper Table 9 | Qwen3-Emb-8B | nd | 75 core, Easy/Hard | 20.0% | 25.3% |
| Paper Table 21 | Qwen3-Emb-8B x Qwen3-Rank-8B | nd | 75 core, Easy/Hard | 18.7% | 24.0% |
| Paper Table 21 | Qwen3-Emb-0.6B x GPT-5.4-mini | nd | 75 core, Easy/Hard | 29.3% | 33.3% |

论文 `Single Hit@1` 是另一个口径,属于 full skill text 主结果:

| source | method | input | Single Hit@1 |
| --- | --- | --- | ---: |
| Paper Table 4 / 22 | Qwen3-Emb-0.6B x Qwen3-Rank-0.6B | full | 62.5% |
| Paper Table 4 / 22 | Qwen3-Emb-8B x Qwen3-Rank-8B | full | 66.7% |
| Paper Table 4 / 22 | SR-Emb-0.6B x SR-Rank-0.6B | full | 72.9% |

我们的补充复跑填的是论文没有公开的 `paper-core single x Hard x metadata-only agentic router` 格子:

| method | input | query / corpus | accuracy | trigger | duration | cost est. |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| M-bm25 | metadata-only | 24 paper-core single, 79,141 Hard | 14/24 (58.3%) | 24/24 | 964s | $6.822 |
| J-bounded-v2 | metadata-only | 24 paper-core single, 79,141 Hard | 11/24 strict; 14/24 alias-normalized | 24/24 | 3056s | $12.436 |
| M-bm25 | metadata-only | 当前 24-query subset, 79,141 Hard | 11/24 (45.8%) | 24/24 | 1016s | $6.347 |

这些结果说明:agentic metadata-only router 可以显著高于论文 BM25-nd top-1 的 0%,但仍明显低于论文 full-text single routing 的 62.5%-72.9% 区间。真正需要补齐的是 body-on-tie 或 full-text rerank,而不是继续把 metadata-only 做成唯一决策源。

---

## 9. 关键失败案例

### 9.1 `gh-repo-analytics`

8 个 Claude router 变体在两条 arm 下均未命中。gt `skill-021` 的 description 是工具中心:gh CLI 用于操作 repo / issue / PR。多个变体选择的 `skill-046` 是任务中心:追踪和可视化 GitHub 贡献、PR、issue resolved over time。query 要求写 December community pulse,统计 PR、issue、top contributor。按 description 语义,`skill-046` 更贴近 query。该样本应标注为 ambiguous,不宜用来单独否定 router 设计。

主表采用 strict gt,且默认包含该 ambiguous 样本。敏感性上,如果仅从 Claude Code router 表中剔除这一条,所有 router 的分母都会变为 23;B-cc / C-lite 将变为 23/23,D / E / H / J 变为 22/23,I-meta 变为 21/23,A-router 变为 13/23。因此 1-cell 排名差异应按“含争议样本的 strict score”解读,不应过度放大。

### 9.2 `shock-analysis-supply`

gt 为通用 Excel skill `skill-105`。with-CLAUDE.md 强制路由后,部分 metadata-only 变体被更专精的 economics / timeseries skill 吸引;without-arm 中一些零工具直接输出 `skill-105` 反而碰巧命中。读 body 的 B-cc / C-lite 能恢复正确选择。这是 body-on-tie 的典型适用场景。

### 9.3 A-router

A-router 直接把长 query 交给固定 scorer。真实 query 中大量步骤说明、路径和格式约束会稀释高信号关键词。相比之下,J / B / C / H 都让 LLM 先做 query rewrite 或 keyword extraction。A-router 后续应改为返回候选证据并交给 LLM rerank,而不是由 CLI 直接 commit。

---

## 10. 局限性

1. **每 cell 只跑一次。** 24 query 下 1 cell 即 4.2pp,23/24 与 22/24 不能视为统计显著差异。
2. **CLAUDE.md 不是 system prompt。** 它是 user-message context block,效果强但仍不能等同于强制 `tool_choice`。
3. **150-skill 对比实验规模有限。** scaling 实验显示 metadata-only 准确率会随规模明显下降。
4. **只测路由,不测执行。** 下游 skill body 是否能完成任务未纳入本报告指标。
5. **Codex cost 为估算。** Codex 表中的 `cost est.` 不是同一计费口径下的真实账单值,适合比较量级,不适合做精确财务结论。
6. **数据存在 ambiguous / overloaded 样本。** `gh-repo-analytics` 和 Excel 相关 query 会影响总体排名。
7. **宿主版本会漂移。** Claude Code / Codex 的 native skill 展示策略可能随版本变化。
8. **语言覆盖不足。** 24 个 query 均为英文任务描述,未测中文或混合语言请求。
9. **论文对照口径不完全一致。** 论文未公开 `Single x nd x Hard-only` 指标;本报告的 paper-core single Hard 复跑是补充实验,不是论文 BM25 / embedding pipeline 的复现。

---

## 11. 建议

短期工程建议:

- **Claude Code 默认:** J-bounded-v2 作为低成本默认,失败或低置信时升级到 body-on-tie;准确率优先场景用 C-lite。
- **Codex 默认:** 150-skill 到 1K 规模下,L-agentic / M-bm25 比手写 shell 更适合继续产品化;150-skill 下 D-agentic metadata-only、K-lite fixed、L、M 都达到 24/24。
- **所有宿主:** 对 `matched_skill_name` 做 regex 校验和存在性校验;若不是合法已安装 disabled skill,自动 retry 或走 rescue fallback。
- **A-router:** 不再作为默认路径;改造为 candidate generator + LLM reranker。
- **大规模方向:** metadata-first 可保留为快路径,但 79K Hard 结果显示必须增加 body-on-tie / full-text rerank,否则近义自然 pool skill 会稳定吸走流量。

后续实验建议:

1. 对边界 query 做 N=3 或 N=5 重复,给出置信区间。
2. 扩展到 SkillRouter 75 core queries,实现 multi-label Hit@1;不要用单 expected strict equality 评估 multi-skill query。
3. 实现 metadata-first + body-on-tie 变体,与 J-v2、L-agentic、M-bm25 对比。
4. 增加端到端执行验证,至少覆盖 Excel、PDF、PPTX、GitHub analytics 四类。
5. 将 `gh-repo-analytics` 标注为 ambiguous 或重标 gt,避免把数据争议解释为 retriever 失败。

---

## 12. 文件索引

| 内容 | 路径 |
| --- | --- |
| Claude paired driver | `experiments/dci-compare/routing-only-paired.mjs` |
| Claude paired raw summary | `experiments/dci-compare/runs/routing-only-9x24-claudemd/summary.json` |
| Claude paired HTML report | `experiments/dci-compare/runs/routing-only-9x24-claudemd/report.html` |
| Codex 9x24 summary | `experiments/dci-compare/runs/codex-routing-only-9x24/summary.json` |
| Codex D-agentic metadata-only | `experiments/dci-compare/runs/codex-routing-only-d-agentic-metadata-24-20260524/summary.json` |
| Codex K-bounded | `experiments/dci-compare/runs/codex-routing-only-k-24-20260524/summary.json` |
| Codex K-lite fixed | `experiments/dci-compare/runs/codex-routing-only-k-lite-fix-24-20260524/summary.json` |
| Codex L-agentic 150 | `experiments/dci-compare/runs/codex-routing-only-l-agentic-24-20260525-v2/summary.json` |
| Codex L-agentic 1K | `experiments/dci-compare/runs/codex-routing-only-l-agentic-1k-24-20260525/summary.json` |
| Codex M-bm25 150 | `experiments/dci-compare/runs/codex-routing-only-m-bm25-index-fix-24-20260525/summary.json` |
| Codex M-bm25 original Hard current 24 | `experiments/dci-compare/runs/codex-routing-only-m-bm25-skillrouter-hard-24-20260525/summary.json` |
| Codex M-bm25 paper-core single Hard | `experiments/dci-compare/runs/codex-routing-only-paper-single-hard-m-bm25-24-20260525/summary.json` |
| Codex J-v2 paper-core single Hard | `experiments/dci-compare/runs/codex-routing-only-paper-single-hard-j-v2-24-20260525/summary.json` |
| Native prompt capture | `experiments/dci-compare/runs/native-prompt-capture/analysis.md` |
| Query set | `experiments/dci-compare/queries.json` |
| Corpus manifest | `experiments/dci-compare/corpus-manifest.json` |
| Router variants | `experiments/dci-compare/variants/routing-only/*.SKILL.md` |
| Codex router variants | `experiments/dci-compare/variants/routing-only-codex/*.SKILL.md` |
| Scaling notes | `experiments/scaling-jbounded/EXPERIMENT_NOTES.md` |
| J-bounded-v2 | `experiments/scaling-jbounded/variants/J-bounded-v2.SKILL.md` |
| 150-scale v2 report | `experiments/scaling-jbounded/runs/sweep24-v2-150-cmd/report.md` |
| 79K-scale v2 report | `experiments/scaling-jbounded/runs/sweep24-v2-full-cmd/report.md` |
