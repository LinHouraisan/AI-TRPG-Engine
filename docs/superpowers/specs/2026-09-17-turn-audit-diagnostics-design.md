# 回合全量审计、差评诊断与数据候选池设计

日期：2026-09-17  
状态：已确认设计，尚未实现

## 1. 目标

当玩家认为某次 GM 回复脱离上下文并点击“不满意”时，系统应能够回答：

1. 这一回合实际经历了哪些程序步骤、模型调用、检索、规则处理和状态提交；
2. 最终回复具体采用了哪一次模型输出；
3. 哪些环节可能导致问题，判断依据是什么；
4. 如何把该回合以稳定格式送入待人工复核的数据候选池。

系统对全部回合建立本地全量审计记录。差评不会回滚状态，也不会自动重新生成回复，只会追加用户反馈、运行粗粒度诊断并建立数据候选。后续由人工按独立的数据标准进行复核、修订和数据集导出。

## 2. 非目标

- 不实现状态回滚、自动重试或自动替换已展示的 GM 回复。
- 不建设多人协作、权限管理、任务分发或供应商管理平台。
- 不把自动诊断当作最终标注，也不自动决定样本是否可训练。
- 不记录每个函数调用、任意对象转储、凭据或供应商未返回的隐藏推理过程。
- 不在第一版建设复杂运营仪表盘。

## 3. 已有基础与关键假设

当前系统已经使用 `turnId`、`operationId`、`modelTaskId`、`stateVersion`、`promptVersion` 和 `narrationId` 标识回合、操作、模型任务、状态与最终叙述；现有 JobTrace 能展示提交后的 Information、Director、Memory 与 Context 冷路径。

模型调用不依赖供应商侧的持久会话。每次请求都由本地程序明确发送本次 `system` 与 `user` 消息；历史对话、可见事实、状态和检索内容均由本地程序重新组装。因此，保存实际请求、原始响应、上下文来源和程序中间结果后，可以复核当前应用可见的完整调用链。

现有 JobTrace 只覆盖部分提交后任务，不能解释热路径中的路由、上下文装配、检索、规则调用、模型重试、Guard 与最终 Narration 选择。本设计扩展该追踪体系，不创建第二条互不关联的诊断数据路径。

## 4. 方案选择

采用每个战役 `campaign.sqlite` 内以追加为主的审计表：

- 与已有回合、分支、事件、规则决定和叙述记录共享事务与标识；
- 便于按 `turnId` 和 `stateVersion` 核对事实；
- 战役备份和恢复时能够保留对应审计证据；
- 后续由统一导出器汇总多个战役的数据候选。

暂不采用逐回合 JSON 文件作为权威存储，因为其查询、关联和迁移能力不足；暂不增加全局 `audit.sqlite`，避免第一版处理跨库一致性、战役删除和分支恢复语义。

## 5. 追踪标识与因果模型

每个回合创建一个 `traceId`，并沿用现有标识：

```text
traceId
└─ turnId
   └─ operationId
      ├─ modelTaskId
      │  ├─ spanId: route attempt 1
      │  ├─ spanId: narration attempt 1
      │  └─ spanId: narration attempt 2
      ├─ spanId: context build
      ├─ spanId: retrieval
      ├─ spanId: rule decision
      ├─ spanId: state commit
      └─ narrationId
```

每个 Span 可以具有 `parentSpanId`，用于表示模型任务、工具调用、校验与重试的父子关系。Span 额外记录单调递增的 `sequence`，以便在没有时间精度假设的情况下重建顺序。

最终 Narration 完成前、确实影响其输入或选择的 Span 标记为 `causal=true`。回复完成后的 Information、Director、Memory 等任务继续关联同一回合，但标记为 `causal=false`。自动诊断只使用因果 Span；回看界面仍可展示全部关联步骤。

## 6. 审计数据结构

### 6.1 `audit_runs`

每个回合一行：

- `trace_id`
- `campaign_id`
- `branch_id`
- `turn_id`
- `operation_id`
- `base_state_version`
- `committed_state_version`
- `final_narration_id`
- `completeness`: `open | complete | partial | aborted | not_applicable`
- `gap_codes_json`
- `started_at`
- `finalized_at`
- `schema_version`

`finalized_at` 表示影响最终 Narration 的因果链已经结束；事后诊断和后台任务仍可继续追加 `causal=false` 的 Span。

### 6.2 `audit_spans`

保存影响业务语义的步骤，不记录普通内部函数调用：

- `span_id`
- `trace_id`
- `parent_span_id`
- `sequence`
- `kind`: `program | model | retrieval | tool | guard | persistence`
- `stage`
- `task_type`
- `attempt`
- `causal`
- `model_task_id`
- `based_on_state_version`
- `prompt_version`
- `model_id`
- `input_json`
- `output_json`
- `status`: `started | succeeded | rejected | failed | aborted | skipped`
- `error_code`
- `duration_ms`
- `prompt_tokens`
- `completion_tokens`
- `cached_tokens`
- `created_at`
- `completed_at`
- `payload_sha256`

`input_json` 和 `output_json` 保存应用实际使用的业务输入输出。模型 Span 保存实际发送的消息、生成参数、应用收到的原始消息内容以及解析结果；程序 Span 保存路由候选、上下文清单、检索命中、规则结果、状态变化或 Guard 判定。

### 6.3 `user_feedback`

- `feedback_id`
- `trace_id`
- `turn_id`
- `narration_id`
- `rating`: 第一版固定为 `dissatisfied`
- `note`
- `created_at`

同一 Narration 重复点击时复用已有反馈记录，避免重复创建数据候选。

### 6.4 `diagnosis_results`

- `diagnosis_id`
- `feedback_id`
- `source`: `rule | local_judge`
- `code`
- `confidence`
- `severity`
- `explanation`
- `evidence_span_ids_json`
- `rule_version`
- `created_at`

### 6.5 `dataset_candidates`

- `case_id`
- `feedback_id`
- `trace_id`
- `status`: `captured | auto_diagnosed | pending_review | reviewed | curated | exported | discarded`
- `confirmed_issue_tags_json`
- `review_note`
- `corrected_output`
- `dataset_usage`: `evaluation_only | sft | preference | discard`
- `reviewed_at`
- `export_batch_id`

模型或程序 Span 在 `started` 后允许被完成一次；进入终态后，其业务输入输出不可改写。诊断、人工标签和修订回复作为独立记录追加或写入数据候选记录，始终不覆盖原始模型输出。

## 7. 需要追踪的回合链路

第一版覆盖以下语义阶段：

1. 玩家输入与回合起始状态；
2. 确定性路由结果；
3. 必要时的模型路由请求、原始响应、解析及可用性校验；
4. Context Manifest，包括每个来源、最终文本、分栏字符数和裁剪数量；
5. RAG 查询、Top-K 命中、分数、来源和版本；
6. 规则候选、工具调用、RNG 证据和规则结果；
7. 状态提交前后版本及提交事件；
8. GM 叙述的每次模型请求、原始响应、Schema 校验、质量检查与 Guard；
9. 最终采用的 Narration 及其来源 Span；
10. 提交后的后台任务，作为非因果关联 Span。

模型请求前先写入 `started` Span，完成后补充响应和状态。这样即使网络失败或进程崩溃，仍能保留请求证据。修复重试必须创建新 Span，不能覆盖前一次输出。

## 8. 差评处理流程

点击“不满意”执行以下追加操作：

1. 以 `narrationId` 查找对应 `traceId`；
2. 写入或复用 `user_feedback`；
3. 创建 `dataset_candidates`，初始状态为 `captured`；
4. 仅对最终 Narration 之前的因果 Span 执行确定性诊断；
5. 可选执行独立本地 Judge，并将其记录为事后、非因果模型 Span；
6. 保存诊断结果，将候选推进至 `pending_review`；
7. 界面显示候选编号、疑似原因、可信度和证据摘要。

上述流程不修改游戏状态，不重新生成叙述，也不影响后续回合。

## 9. 自动诊断规则

第一版使用版本化规则集 `turn-diagnosis-v1`，按以下顺序检查：

| 代码 | 主要证据 | 默认可信度 |
| --- | --- | --- |
| `PROVIDER_FAILURE` | 超时、网络错误、空回复或模板回退 | 高 |
| `CONTRACT_FAILURE` | JSON 或 Schema 校验失败 | 高 |
| `GUARD_REJECTION` | 未授权事实、错误骰点、结构或质量检查被拒 | 高 |
| `STALE_STATE` | 调用状态版本与提交版本不一致 | 高 |
| `ROUTE_INVALID` | 模型目标或调查入口当前不可用并被程序作废 | 高 |
| `ROUTE_UNCERTAIN` | 明确输入最终进入 unclear、兜底或多次改判 | 中 |
| `CONTEXT_TRUNCATED` | Context Manifest 显示历史或线索被裁剪 | 中 |
| `CONTEXT_MISSING` | 玩家引用、路由目标或本回合事件所需实体未进入最终上下文 | 中至高 |
| `RETRIEVAL_MISS` | 应检索的已知事实未进入 Top-K，或相关查询零命中 | 中 |
| `RETRIEVAL_NOISE` | 命中来源过期、低分或与当前实体无关联 | 中 |
| `EVENT_NARRATION_MISMATCH` | 最终叙述与已提交事件、规则结果或允许事实冲突 | 中至高 |
| `GENERATION_DRIFT` | 状态、路由、上下文和程序结果均正常，回复仍偏离已提供证据 | 中 |
| `STYLE_OR_PREFERENCE` | 没有事实链路错误，仅有语气、节奏、重复或偏好问题 | 低至中 |
| `UNKNOWN` | 现有证据不足以解释差评 | 低 |

差评本身不能直接推出 `GENERATION_DRIFT`。系统先排查状态、路由、上下文、检索、规则和提交链路，只有这些证据正常时才提出生成漂移。

每条诊断必须引用具体 Span。`confidence` 表示规则证据强度，不代表统计概率；界面同时展示“高／中／低”和具体证据，避免只显示一个不透明分数。

## 10. 可选本地 Judge

确定性规则难以识别人物态度反转、叙事语义冲突等问题。可在差评后调用独立本地 Judge：

- 输入只包含该回合诊断所需的玩家输入、必要上下文、程序结果和最终回复；
- 温度为 0，使用受限 JSON Schema；
- 输出原因代码、解释和证据引用；
- 不得修改或覆盖确定性结论；
- 单独记录为 `diagnostic.judge`、`causal=false` 的模型 Span；
- Judge 单独提出的结论最高为中等可信；
- Judge 失败不影响反馈保存和数据候选创建。

第一版可以只实现确定性规则；本地 Judge 是独立增量，不是主链路前置条件。

## 11. 人工回看与数据用途

回看界面采用三部分：

1. 候选列表：按模型、Prompt 版本、任务类型、诊断原因、状态和时间筛选；
2. 链路证据：展示路由、上下文来源与裁剪、检索、规则、状态提交、各次模型响应和 Guard；
3. 人工处理：确认问题标签、记录说明、编辑正确回复并选择数据用途。

数据用途限定为：

- `evaluation_only`：原始坏回复作为回归 Bad Case；
- `sft`：必须存在人工修订后的正确回复；
- `preference`：修订回复为 chosen，原始坏回复为 rejected；
- `discard`：不进入数据集。

不满意的原始回复不能直接成为 SFT 目标。没有人工修订时，只能作为评测 Bad Case。后续可以新增“标记优质”入口采集正向样本，但不属于第一版必需范围。

## 12. 稳定导出格式

整理脚本不直接耦合内部数据库表。应用导出 `audit-case-v1` JSONL，每行包含：

```json
{
  "schema_version": "audit-case-v1",
  "case_id": "...",
  "trace_id": "...",
  "turn": {
    "player_input": "...",
    "base_state_version": 12,
    "committed_state_version": 13
  },
  "model_calls": [],
  "program_steps": [],
  "final_output": "...",
  "feedback": {
    "rating": "dissatisfied",
    "note": "人物行为与上一轮冲突"
  },
  "diagnoses": [],
  "manual_review": {
    "confirmed_tags": [],
    "corrected_output": null,
    "dataset_usage": "evaluation_only"
  }
}
```

后续脚本从该格式生成 SFT、评测、偏好数据及质量报告。每个导出批次记录 `exportBatchId`、筛选条件、Schema 版本、条数和 SHA-256；导出再次执行可见性和敏感字段检查。

## 13. 安全与隐私边界

全量审计保存完整业务链路，但明确排除：

- API Key、Authorization Header 和凭据对象；
- 与回合无关的本机绝对敏感路径；
- 任意进程内对象转储；
- 供应商没有返回给应用的隐藏推理过程。

系统保存应用实际发送的模型消息和实际收到的消息内容。可能包含 `gm_only` 信息的程序数据不得无差别写入模型输入或训练导出；审计层可以记录受控引用，但导出器必须根据可见性重新过滤。

## 14. 故障处理

- 审计写入失败不阻断游戏，但回合标记为 `partial` 并记录缺口代码；
- 未结束 Span 在应用重新启动后标记为 `aborted`；
- `partial` 或 `aborted` 候选可人工查看，但默认禁止进入 `sft`、`preference` 或正式评测集；
- 差评写入与候选创建应在同一事务中完成；
- 自动诊断或本地 Judge 失败不会丢失反馈；候选停留在 `captured` 或 `pending_review`；
- 同一 Narration 的重复差评操作必须幂等；
- 分支恢复后创建新的 Trace，不复制旧 Trace；旧审计继续保留原始分支与状态版本。

## 15. 最小验收标准

第一版通过以下局部测试与集成场景：

1. 自由文本回合的路由与叙述调用通过同一 `traceId/modelTaskId` 串联；
2. 确定性行动记录程序路由、规则结果、状态提交和叙述调用；
3. 两次模型重试均被保存，最终 Narration 指向实际采用的 Attempt；
4. Context Manifest 显示每个上下文来源及被裁剪内容；
5. 点击“不满意”后，候选准确关联 `turnId`、`narrationId` 和 Trace；
6. 每条自动诊断包含规则版本和有效证据 Span；
7. 应用重启后仍能打开完整追踪包；
8. 审计中断后标记为 `partial/aborted`，导出器默认拒绝；
9. 审计数据库中不存在测试 API Key 或 Authorization Header；
10. `audit-case-v1` 导出可被整理脚本重新读取并通过条数与哈希检查；
11. 追踪不增加新的生成前模型调用，本地 Judge 只在差评后运行；
12. 现有游戏状态、事件日志、Checkpoint 与 Narration 行为不因审计功能改变。

第一版的完成标准是：任意一次差评都能回答“这一轮经过了什么、哪里可能出错、证据是什么”，并形成供后续人工整理的稳定数据记录。
