# AI TRPG 秋招冲刺技术实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. 默认由接手的一个 agent 连续执行，不主动为每个小任务创建新 agent。
>
> **执行指令（可直接复制）：** 请执行本文件的首轮范围 T1–T3。先检查当前分支与本文件相关的变化，然后直接实现、运行最小相关验证、生成演示材料并交付。复用现有代码和依赖，不重新讨论方案、不要求用户手工造数据、标注、跑测试或截图。遇到缺少模型、密钥或界面工具时完成可独立执行的工作，准确列出受限项。不要启动后置范围、训练、付费资源、推送或发布。

**Goal:** 在已有审计、诊断、复核和导出能力上，交付可复跑的数据质量报告、可读的标注辅助界面和无需真实模型的求职演示。
**Architecture:** 保持 Electron 权威状态和 Python 网关边界不变。TypeScript 纯函数只读分析既有 audit-case-v1 导出文件；Bun 生成 JSON、Markdown、HTML 报告；现有 React 审计面板增加标签解释和当前筛选结果统计。
**Tech Stack:** 现有 Bun、TypeScript、React、Zod、SQLite、bun:test；不新增运行时依赖。
**Spec:** 本文第 1–4 节是冻结的首轮设计，第 5–7 节是实施与验收计划。接到“按本文执行”后即可实施，无需再要求用户在设计、测试或演示阶段逐次确认。
**项目根目录:** C:\Users\35029\Documents\GitHub\AI TRPG Enginee
**编制日期:** 2026-09-25
**事实依据:** 当前源码与最近提交；未在方案编制时运行桌面试玩或真实模型。

## 1. 时间与范围

第一轮秋招晚期，以尽快交付可讲清、可验证的增量为目标。首轮仅 T1–T3；每项通过相关验收后进入下一项，不做无关重构。文中样例数量是有限验收夹具规模，不是人工任务配额或业务准确率目标。

首轮交付：
1. 一条命令生成数据质量报告，打开 HTML 即可展示。
2. 在既有审计面板中解释标签、展示当前筛选结果数量，降低演示门槛。
3. agent 自动生成合成样例、执行离线合同测试、整理真实结果与讲解材料。

明确后置：重新训练 LoRA/Embedding、扩大模型、完整 A/B 生成实验、全局运营监控、流式输出改造、任务队列、多人权限、多用户标注平台、Spark/Kafka/pgvector、通用模组编辑器。

交付与取舍：
- 样例自动生成，标记 synthetic；不等用户手工收集或标注。
- 自动校验只证明结构、流程、规则和口径正确，不宣称叙事质量或模型收益。
- 现有真实训练与历史评测保留原始边界，不改写历史报告。
- 核心实现预算分配建议：数据质量报告 50%，审计界面 20%，验证和材料 30%。不是工期保证。

## 2. 当前事实与必须保持的边界

已存在：
- electron/src/core/audit/types.ts：审计、候选状态和数据用途类型。
- electron/src/core/audit/export.ts：exportAuditCases、AuditCaseV1、manifest 校验和及脱敏。
- electron/src/main/services/audit-service.ts：反馈、复核和导出业务。
- electron/src/renderer/ui/AuditReviewPanel.tsx：数据池、过滤、复核、导出界面。
- electron/src/renderer/ui/audit-feedback-state.ts：分页与复核校验。
- electron/scripts/export-audit-cases.ts：现有战役导出脚本。
- electron/src/core/audit/export.test.ts 和 main/services/audit-service.test.ts：已有合同及工作流测试。

容易误判的限制：
1. 导出集合是合格的问题样本，不是全部运行记录，不能推导全局成功率、用户满意度或线上问题率。
2. audit-case-v1.model_calls 含 tokens.prompt/completion/cached，但不含 durationMs；本轮不输出平均耗时或 P95。
3. 导出文件不含全部候选状态；不能用它推导待审核总量。界面的候选统计来自当前已加载且筛选后的列表。
4. 已有人工复核、用途区分和导出，不重复开发新平台。
5. 旧 Windows 安装包不自动包含本轮修改，不将旧包描述成新交付。

## 3. Global Constraints

- 只修改本方案列出的相关区域；不改变游戏规则、权威状态提交、数据库表结构或现有导出格式。
- 不新增依赖；确需新增时先尝试现有库和标准库，无法替代才汇总一次原因。
- 保留现有隐私清洗；新公开报告采用字段白名单，不直接展示 input、output、玩家正文或模型正文。
- 不从用户真实战役数据库自动导出；现有导出操作会标记 export 状态，不是纯读。默认仅分析用户指定的已导出文件或合成夹具。
- 不扫描、输出、复制密钥；本轮默认不调用真实模型，不购买算力，不重新训练。
- 合成样例的“复核字段”是测试数据，不能描述成真实用户反馈或人工标注成果。
- 无模型、无 GPU、无第二标注人均不阻塞首轮。无浏览器或桌面控制时如实记录界面检查未执行，不转交用户做例行验收。
- 执行前只检查 git status 和相关文件；不要求清空工作区，不覆盖其他修改。存在同文件冲突且无法安全合并才询问。
- 若已在独立工作树直接使用；需要隔离时按工具能力创建工作树。不要把新建工作树当成产出本身。
- 不主动提交、推送、发布或覆盖旧发布目录；提交遵循接手任务中的明确授权。
- 达到第 6 节验收后立即停止，不追加全项目回归或“顺便优化”。

## 4. 技术设计

### 4.1 数据质量报告

新增只读处理链：

合成夹具或已脱敏的 JSONL + 可选 manifest
→ 按行解析与结构校验
→ 重复 case_id 与用途约束校验
→ 指标汇总
→ quality-report.json / quality-report.md / quality-report.html

输入以现有 AuditCaseV1 为准。通过 Zod 在本模块验证要消费的字段；不要修改现有 parseAuditCaseLine 的宽松行为或顺便做全库 Schema 重构。

校验规则：
- 空白行忽略；其他每行计入 totalLines。
- 非法 JSON、未知 schema_version、缺少 case_id/trace_id 或被消费字段类型非法：拒绝该行。
- dataset_usage 只接受 evaluation_only、sft、preference。
- sft 和 preference 的 corrected_output 必须为非空字符串；preference 还要求 final_output 非空且与 corrected_output.trim() 不同。
- 重复 case_id 只接收第一条通过上述校验的记录；后续同 ID 拒绝，保留行号。
- 检测 player_input/final_output/corrected_output/usage 归一化后相同的内容，生成 possible_duplicate_content 警告，不自动剔除；不同游戏上下文可能合理重复。
- reviewed_at 为 null 可以导入，输出 review_timestamp_missing 警告；不能据此虚构审阅人或审阅次数。
- tokens 中存在的数值要求为有限非负整数；缺失则记为未报告，不填成真实零。
- manifest 若提供，校验原始文件字节 SHA-256、schemaVersion、声明 count 和按原始顺序的 caseIds；额外的 exportBatchId 等字段忽略。无法全部解析时 manifestVerified=false 并解释。未提供则为 null。
- manifest 不通过或存在拒绝行：报告仍生成，CLI 返回 2；文件无法读写或参数错误返回 1；完整通过返回 0。

报告接口在新文件中定义，JSON 中不输出原始正文：

~~~ts
export type QualityIssue = {
  line: number;
  caseId?: string;
  code: string;
  severity: "error" | "warning";
};

export type QualityReport = {
  schemaVersion: "audit-quality-v1";
  sourceKind: "synthetic" | "export";
  inputSha256: string;
  totalLines: number;
  accepted: number;
  rejected: number;
  manifestVerified: boolean | null;
  byUsage: Record<string, number>;
  byConfirmedTag: Record<string, number>;
  tokens: {
    prompt: number;
    completion: number;
    cached: number;
    reportedCalls: number;
    missingUsageCalls: number;
  };
  issues: QualityIssue[];
};

export function analyzeAuditJsonl(
  raw: string,
  options: { sourceKind: "synthetic" | "export"; manifest?: unknown },
): QualityReport;

export function renderQualityMarkdown(report: QualityReport): string;
export function renderQualityHtml(report: QualityReport): string;
~~~

SHA-256 按实际 UTF-8 文件字节计算。CLI 用 Buffer 读取，并用 new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }) 解码，保留 BOM 且拒绝非法 UTF-8；analyzeAuditJsonl 对原始 raw 的 UTF-8 字节计算 hash，仅在逐行解析副本中移除开头 BOM。这样接口不需要隐藏的 hash 参数。

指标口径：
- accepted + rejected = totalLines，一行多个问题仍只计一次 rejected。
- byUsage 和 byConfirmedTag 仅统计 accepted；同一条中同名确认标签去重。
- Token 仅汇总 accepted 中实际报告的模型调用；cached 单列，不另加进 prompt + completion。
- 不计算全局成功率、效果提升或不具备字段支持的耗时。
- HTML 使用转义后的文本、内联 CSS，无外部 CDN，无脚本执行需要，无原始正文。

### 4.2 自动夹具

在 electron/scripts/fixtures/audit-quality.ts 中定义 buildAuditQualityFixture()，返回 { cleanJsonl, dirtyJsonl, cleanManifest }。

通过既有 exportAuditCases 构造公开虚构数据：
- 8 条 evaluation_only、8 条 sft、4 条 preference，共 20 条有效记录。
- 每条唯一 ID、公开虚构输入和不同修订文本，固定时间、无真实凭据。
- dirtyJsonl 在这 20 条后依次附加：1 条重复 ID、1 条缺少 SFT 修订文本、1 条错误 schema_version、1 行损坏 JSON。
- dirty 报告应为 totalLines=24、accepted=20、rejected=4。
- dirty 不附 cleanManifest，以免把预期坏行问题与清单不匹配混为一谈；清单篡改另做测试。
- clean 导出清单必须经真实 exporter 生成，不能手写一个总是通过的假校验和。
- provenance 写在独立 README/报告 sourceKind 中，不破坏 audit-case-v1。
- 合成案例不进入训练目录，不覆盖已有评测文件。

### 4.3 审计界面的小改进

仅调整已有 AuditReviewPanel：
- 将已有 DIAGNOSIS_CODES 的显示信息移到新 diagnosis-labels.ts，保留所有现有枚举值。
- 中文解释覆盖供应商失败、合同失败、守卫拒绝、旧状态、路由、上下文、检索、事实/叙述不一致、生成偏离、风格偏好和未知。
- 加一个可折叠“标签说明”，每类一句解释；不要替代人工选择或自动批准。
- 从 filtered 数组生成只读统计：当前结果总数、待处理、已复核、已入选、已导出、已丢弃。待处理包含 captured、auto_diagnosed、pending_review。
- 明示“当前筛选结果”，切换状态过滤后不要把局部数字当全战役总量。
- 在未选择案例时也能看到加载、错误和无结果状态；不新增复杂组件库。
- 保持原复核按钮、导出行为、用途校验及分页语义。

## 5. 执行任务

### T1：数据质量分析、自动夹具与报告命令

**文件**
- 新建 electron/src/core/audit/quality.ts、quality.test.ts。
- 新建 electron/src/core/audit/quality-report.ts、quality-report.test.ts。
- 新建 electron/scripts/fixtures/audit-quality.ts。
- 新建 electron/scripts/audit-quality-report.ts、audit-quality-report.test.ts。
- 修改 electron/package.json，仅增加 audit:quality 脚本，不更新依赖。
- 只读参考 electron/src/core/audit/export.ts 和 export.test.ts。

**接口**：消费 AuditCaseV1 和 exporter；产出第 4.1 节接口及下列 CLI。

~~~powershell
# 从仓库根目录执行
bun --cwd electron run audit:quality -- --demo --out ../artifacts/portfolio/autumn-2026
# 可选：分析明确指定的既有导出；不能自动打开真实战役数据库
bun --cwd electron run audit:quality -- --input <已有导出文件的绝对路径> --manifest <对应清单的绝对路径> --out <输出目录的绝对路径>
~~~

CLI --demo 不与 --input 同用。demo 生成 clean 与 dirty 两套报告；它主动验证 dirty 的预期结果和错误退出路径，整体正确时 demo 命令返回 0。对普通 --input 不豁免错误。相对 --out 按实际进程 cwd 解析，报告标注解析后的输出位置。

- [ ] 编写上述夹具生成函数和局部测试，先验证以下断言失败。
~~~ts
import { expect, test } from "bun:test";
import { analyzeAuditJsonl } from "./quality";
import { buildAuditQualityFixture } from "../../../scripts/fixtures/audit-quality";

test("accepts clean exports and separates rejected rows", () => {
  const data = buildAuditQualityFixture();
  const good = analyzeAuditJsonl(data.cleanJsonl, {
    sourceKind: "synthetic", manifest: data.cleanManifest,
  });
  expect(good.manifestVerified).toBe(true);
  expect(good.accepted).toBe(20);
  const bad = analyzeAuditJsonl(data.dirtyJsonl, { sourceKind: "synthetic" });
  expect([bad.totalLines, bad.accepted, bad.rejected]).toEqual([24, 20, 4]);
});
~~~
- [ ] 最小实现第 4.1–4.2 节算法；按独立错误行为写补充测试：空文件、缺失 usage、负 Token、同 ID、同文不同 ID、坏清单、BOM、cached 不重复计费。
- [ ] 实现 Markdown/HTML。HTML 测试输入含脚本标签的 caseId，验证转义且不会输出模型正文。
- [ ] 实现 CLI 和 package script。使用临时目录测试成功、坏行返回 2、无输入返回 1，不依赖 shell 全局路径。
- [ ] 只运行本任务测试及现有 exporter 测试，记录结果。

~~~powershell
bun --cwd electron test src/core/audit/quality.test.ts src/core/audit/quality-report.test.ts src/core/audit/export.test.ts scripts/audit-quality-report.test.ts
~~~

### T2：既有审计界面的说明和筛选统计

**文件**
- 新建 electron/src/renderer/ui/audit-review-summary.ts、audit-review-summary.test.ts。
- 新建 electron/src/renderer/ui/diagnosis-labels.ts。
- 修改 electron/src/renderer/ui/AuditReviewPanel.tsx。
- 不修改 IPC、数据库、AuditService 或权威状态。

**接口**
~~~ts
import type { CandidateStatus } from "@core/audit/types";

export function summarizeCandidates(
  items: ReadonlyArray<{ status: CandidateStatus }>,
): {
  total: number;
  pending: number;
  reviewed: number;
  curated: number;
  exported: number;
  discarded: number;
};
~~~

- [ ] 先写测试：captured/auto_diagnosed/pending_review 都属于 pending；空输入全部为 0；筛选后只统计传入元素。
~~~ts
import { expect, test } from "bun:test";
import { summarizeCandidates } from "./audit-review-summary";

test("counts only the supplied candidates", () => {
  expect(summarizeCandidates([
    { status: "pending_review" }, { status: "curated" },
  ])).toEqual({ total: 2, pending: 1, reviewed: 0, curated: 1, exported: 0, discarded: 0 });
});
~~~
- [ ] 以一次遍历实现统计，不能发起逐条 API 请求。
- [ ] 实现标签文案和折叠说明，沿用已有 Tailwind 样式。
- [ ] 把统计接到 filtered，补无选择时也可见的错误和空状态。
- [ ] 运行本任务测试和现有复核状态测试，再执行一次 Electron TypeScript 检查。失败只追踪与改动有关的问题。

~~~powershell
bun --cwd electron test src/renderer/ui/audit-review-summary.test.ts src/renderer/ui/audit-feedback-state.test.ts
bun run --cwd electron typecheck
~~~

### T3：自动验收、演示和求职证据包

**文件**
- 新建 docs/portfolio/autumn-2026/README.md、acceptance.md、interview-notes.md。
- 修改 README.md 和 docs/CURRENT-STATUS.md：增加新入口并明确合成演示边界。
- 生成 artifacts/portfolio/autumn-2026/ 下的报告；遵循现有忽略规则，不为了提交产物修改 .gitignore。

- [ ] 运行一次 demo 命令生成报告，检查 20 条 clean、24 条 dirty 及对应 manifest 行为。
- [ ] 运行既有 audit-service.test.ts 验证真实业务对象的反馈→复核→导出流程；不重复搭建一个“假 UI 流程”代替它。
~~~powershell
bun --cwd electron test src/main/services/audit-service.test.ts
bun run --cwd electron build:renderer
~~~
- [ ] 可用浏览器/桌面工具由 agent 自己检查 HTML 报告；若能访问 Electron，再检查审计面板筛选、空结果及一次复核交互。无控制工具则在 acceptance.md 写明未执行，不让用户补手工步骤，不宣称端到端 UI 已通过。
- [ ] 仅使用临时演示数据，不打开或修改用户真实战役。不要为截图安装新的浏览器自动化框架。
- [ ] 生成 3 分钟演示路线：原有可控游戏架构说明→审计数据池→干净/含错样例报告→一条失败原因追踪。
- [ ] 生成 interview-notes.md：已有架构、此次改动、指标口径、为什么不重训、当前限制；简历表述只使用已运行验证的事实。
- [ ] 不默认重打 Windows 包。交付 bun run desktop 开发入口与独立 HTML 报告，明确旧 exe 不包含本轮 UI 改动；用户后续要求新 exe 时再使用 packaging-ai-trpg-windows 技能。
- [ ] 检查 git diff --check 及本轮文件清单，记录已存在但无关的问题后停止。

## 6. Review Focus 与最终验收

下列五类输入由对应任务覆盖，不扩展为全项目审计：
1. 坏行与重复 ID：T1 验证 accepted/rejected 数量和错误行号，不静默吞掉。
2. 缺失统计字段：T1 缺失 Token 单列；绝不生成耗时或全局成功率。
3. 可执行 HTML 文本：T1 转义并采用报告白名单，正文不进入公开报告。
4. 已过滤的候选列表：T2 显示当前范围，不冒充总量。
5. synthetic 与真实效果混淆：T3 页面、报告和说明一致标注来源，训练收益仍保持待验证状态。

交付通过条件：
- [ ] T1、T2 的新增测试与指定相关原测试通过。
- [ ] TypeScript 检查和 renderer 构建完成；如有既有失败，给出未改动基线证据，不能直接略过。
- [ ] demo 命令可无密钥、无 GPU 地完成；报告可本地打开。
- [ ] 没有新增运行时依赖、数据库迁移或原始私密数据公开。
- [ ] acceptance.md 分开记录代码合同、合成流程、实际 UI、真实模型四类证据。
- [ ] 真实模型未运行必须明确写“未运行”；不因此把离线工程交付说成训练效果已验证。

## 7. 接手 agent 的自动执行与交付规范

自动完成：样例制作、相关测试、报告、演示文件、可用工具下的截图、文档更新。无需用户准备样例或手工验收。

只在这些情况下请求用户输入：需要新付费资源；必须访问未获授权的私人内容；存在无法安全处理的同文件并发改动；所有可执行替代方案都失败且缺少必要外部资源。先完成未受影响部分，再一次性提出具体缺项。

每个测试首次通过后不重复运行，除非后续改动影响它。某工具不可用时只做一次合理替代；不得长时间排查与作品无关的环境问题。测试失败不能靠删用例、降低口径或把所有状态改成成功解决。

最终回复必须包含：
1. 完成的 T1–T3 和真实修改文件。
2. 可点击的报告与演示说明路径。
3. 测试通过/失败/未执行及原因。
4. 本轮未覆盖的模型效果与 UI 限制。
5. 可直接用于简历的两条事实陈述；无实测数字时不填提升百分比。

完成即停止。首轮目的：把已有复杂能力变成可验证的求职证据，不启动下一轮平台建设。
