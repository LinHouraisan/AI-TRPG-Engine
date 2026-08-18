# Application Runtime 与回合编排

Status: Draft
Implements: Runtime、Turn Router、原子提交流程
Depends On: IPC、Persistence、Event/State、所有 Game Domains、Rule Engine、Scenario Runtime、AI Orchestrator、Context/Memory
Consumed By: Desktop Main、Player UI

## 1. 职责

Runtime 实现应用用例和回合状态机，确保正确组件在正确阶段使用同一版本。它不拥有领域事实、规则定义、Prompt 或 SQL。

## 2. 回合状态

```ts
type TurnStatus =
  | "received" | "needs_clarification" | "preparing_context"
  | "interpreting" | "adjudicating" | "awaiting_commit"
  | "committed" | "narrating" | "completed"
  | "context_failed" | "interpretation_failed" | "validation_failed"
  | "commit_failed" | "narration_failed" | "cancelled";
```

状态转换由 `TurnStateMachine.transition(turnId, expectedStatus, nextStatus)` 执行并持久化。非法转换返回 `TURN_INVALID_TRANSITION`。

## 3. 路由

```ts
type TurnRoute = "clarification" | "roleplay_only" | "structured_action" | "free_action" | "mechanical_action";
```

明确 UI command 优先；自由文本先使用确定性启发式识别纯控制命令，再由 GM interpretation task 分类。高风险目标、不可逆选择、多个合法规则或未知实体进入 clarification。澄清前不掷骰、不提交。

## 4. 用例接口

```ts
interface TurnApplicationService {
  submitAction(input: SubmitActionInput): Promise<Result<OperationAccepted>>;
  submitClarification(input: SubmitClarificationInput): Promise<Result<OperationAccepted>>;
  retryNarration(turnId: TurnId): Promise<Result<OperationAccepted>>;
  cancel(operationId: OperationId): Promise<Result<CancelResult>>;
  recoverIncompleteTurns(campaignId: CampaignId): Promise<RecoveryReport>;
}
```

`submitAction` 在写入 received turn 后立即返回 operationId，实际流程异步推进。每个阶段结束持久化状态，防止崩溃后只存在内存 Promise。

## 5. 标准执行

1. 校验 controller、branch 和 expectedStateVersion；
2. 以 commandId 幂等创建 Turn；
3. 路由并构建 ContextPackage；
4. 必要时调用 `gm.interpret_action`；
5. 解析实体和 Rule；
6. Rule Engine/RNG 产生 Decision；
7. 领域模块产生事件和 mutations；
8. Scenario Runtime 扩展 bundle；
9. Validator 执行 schema、来源、权限、领域和跨领域检查；
10. Persistence 原子提交；
11. 发布 stateVersion changed；
12. 调用 `gm.narrate_result`；
13. 保存 NarrationRecord；
14. 发布后台 Memory/Director jobs；
15. 标记 completed。

## 6. Validator

验证顺序固定：schema → ID/reference → visibility/authority → state version → domain invariants → cross-domain invariants → event/source completeness → commit limits。返回全部独立错误，最多 50 个；版本冲突立即短路。

## 7. 取消与恢复

- received 至 interpreting：可取消并标记 cancelled；
- adjudicating 至 awaiting_commit：请求取消，但必须等当前同步步骤到安全点；
- committed 后：事实不可取消，只能停止叙事流；
- narration_failed：从同一 committed state 重试；
- 启动恢复：committed 之前的 AI 阶段回到安全前一状态；awaiting_commit 检查 command 是否已经提交；committed/narrating 重启叙事；completed 不处理。

## 8. 并发

同一 branch 同时只允许一个写回合；后台只读任务可并行。不同 campaign 可并行，但 SQLite connection 各自串行写。切换 branch、读档或关闭 campaign 会取消绑定旧活动上下文的未提交任务。

## 9. 错误码

`TURN_VERSION_CONFLICT`、`TURN_ALREADY_PROCESSING`、`TURN_INVALID_TRANSITION`、`TURN_CLARIFICATION_REQUIRED`、`TURN_CONTEXT_FAILED`、`TURN_INTERPRETATION_FAILED`、`TURN_VALIDATION_FAILED`、`TURN_COMMIT_FAILED`、`TURN_NARRATION_FAILED`、`TURN_CANCEL_TOO_LATE`、`TURN_RECOVERY_FAILED`。

## 10. 测试与验收

- 每条状态转换和非法转换；
- 五条路由路径；
- 每阶段崩溃恢复；
- 提交后 narration 重试不重复 RNG/事件；
- command 幂等；
- branch 写串行和版本冲突；
- Validator 顺序和错误上限；
- fake model + fixture scenario 完成完整回合；
- 故障测试证明不存在部分提交和静默状态漂移。
