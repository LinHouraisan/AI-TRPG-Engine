# Rule Engine 与 RNG

Status: Draft
Implements: 规则系统与确定性裁定
Depends On: [公共约定](00-common-conventions.md)、[事件与状态](04-event-state.md)、Content System
Consumed By: Application Runtime、Character、Item、Scenario

## 1. 职责

Rule Engine 解析已绑定 Rule Pack，选择明确规则，计算派生值、条件、检定、资源效果和状态效果。RNG Service 只产生可复现随机序列。二者不调用模型、不写数据库、不生成叙事。

## 2. Rule Pack AST

```ts
type Expression =
  | { op: "literal"; value: number | boolean | string }
  | { op: "read"; path: AllowedStatePath }
  | { op: "add" | "sub" | "mul" | "min" | "max"; args: Expression[] }
  | { op: "div"; left: Expression; right: Expression }
  | { op: "compare"; comparator: "eq"|"ne"|"lt"|"lte"|"gt"|"gte"; left: Expression; right: Expression }
  | { op: "all" | "any"; args: Expression[] }
  | { op: "not"; arg: Expression }
  | { op: "dice"; count: Expression; sides: Expression };
```

最大 AST 深度 32、节点数 1000、骰子数量 100、骰面 10000。除零、非整数骰子、NaN、Infinity 和越界立即返回规则错误。`AllowedStatePath` 在包校验时编译为白名单访问器，不允许任意字符串路径。

## 3. 规则定义

```ts
interface CheckDefinition {
  ruleId: string;
  inputSchemaId: string;
  eligibility: Expression;
  roll: Expression;
  difficulty: Expression;
  outcomes: Array<{
    outcomeId: string;
    when: Expression;
    effects: EffectDefinition[];
  }>;
}
```

Effect 仅允许内置操作：adjustResource、applyCondition、moveEntity、transferItem、setScenarioFlag、advanceTime、emitMarker。Effect 生成领域命令/候选，不绕过领域不变量。

## 4. 裁定接口

```ts
interface RuleEngine {
  evaluateCheck(input: EvaluateCheckInput, snapshot: StateSnapshot, rng: RandomSource): Result<RuleDecision>;
}

interface RuleDecision {
  decisionId: DecisionId;
  ruleReference: { packId: ContentId; version: string; ruleId: string };
  inputs: JsonValue;
  randomDraws: RandomDraw[];
  modifiers: ModifierTrace[];
  outcomeId: string;
  generatedCommands: CommandEnvelope<string, unknown>[];
}
```

ModifierTrace 按 priority、source ID 稳定排序，记录表达式输入、值和最终贡献，供 UI 解释。

## 5. RNG

使用明确版本化的 PRNG 算法；V1.0 初始算法 ID `xoshiro256ss-v1`。战役首次创建生成 campaign seed；每个 Decision seed 由 HMAC-SHA256(campaignSeed, branchId + turnId + decisionId) 派生，不依赖调用顺序。

`RandomDraw` 保存 draw index、表达式、原始 64-bit 值和映射结果。同一 decision 已存在时返回原记录。campaign seed 属于系统数据，不发送给模型或 Renderer。

## 6. 规则选择

UI 明确操作携带 ruleId；自然语言 Candidate 提供 actionType 和目标，由确定性 RuleResolver 基于 Rule Pack action mapping 选择。零个匹配返回 `RULE_NOT_APPLICABLE`；多个同优先级匹配返回 `RULE_AMBIGUOUS` 并要求澄清，AI 不自行选择高风险解释。

## 7. 错误与测试

错误码：`RULE_PACK_NOT_BOUND`、`RULE_NOT_FOUND`、`RULE_NOT_APPLICABLE`、`RULE_AMBIGUOUS`、`RULE_EXPRESSION_INVALID`、`RULE_LIMIT_EXCEEDED`、`RULE_STATE_PATH_DENIED`、`RNG_DECISION_CONFLICT`。

测试包括 AST 每个操作符、限制、性质测试、golden Rule Pack、固定 seed 重放、modifier trace、同 decision 幂等、不同 branch 分离、Effect 仍被领域拒绝的集成测试。验收要求相同快照、输入、Rule Pack 版本和 Decision ID 产生字节等价 Decision。
