# Observability、Testing 与质量门槛

Status: Draft
Implements: 日志、指标、测试、故障注入与性能
Depends On: 所有模块设计
Consumed By: CI、发布、故障支持

## 1. 结构化日志

Pino JSON 字段：timestamp、level、category、event、operationId、campaignIdHash、branchId、turnId、modelTaskId、durationMs、errorCode、appVersion。禁止动态字段名和任意对象 dump。

category：application、ipc、runtime、domain、persistence、provider、content、security、update。日志滚动单文件 10 MiB、最多 10 个、默认 30 天；先满足者清理。

## 2. 指标

本地指标保存聚合值，不默认上报：启动时长、DB query/commit P50/P95/P99、回合各阶段耗时、Provider 首包/总耗时、token/费用、context size、后台队列、备份时长、恢复结果。高基数字段如完整 ID 不作指标 label。

## 3. 测试层级

| 层级 | 范围 | 网络/磁盘 |
|---|---|---|
| Unit | 纯函数、领域、AST、状态机 | 无真实网络，按需临时磁盘 |
| Contract | IPC、Provider、内容 schema | fixture server |
| Integration | SQLite、Repository、Runtime | 临时 DB、fake provider |
| Replay | 固定 Candidate/RNG/事件/hash | 临时 DB |
| E2E | Electron 用户流程与安全 | fake provider |
| Live smoke | 认证 Provider | 受保护真实网络 |

## 4. 固定 fixture

最小战役、标准短剧本、长战役、每个旧 DB 版本、每个内容格式版本、恶意内容包、Provider 流和错误。Fixture 有 README、生成来源、schema version 和期望 hash；禁止测试运行时静默重写 golden。

## 5. 故障注入矩阵

- Runtime 每一持久化状态前后 kill；
- SQLite busy、constraint、disk full、WAL 损坏；
- Provider timeout、429、401、断流、重复 complete、超大响应；
- 内容解压中断、hash mismatch、路径穿越；
- 备份复制中断、恢复目标冲突；
- 更新下载中断、签名失败、migration 失败；
- Renderer 刷新和订阅丢失。

每个故障断言数据是否变化、允许何种重试、operation status、用户消息和日志 errorCode。

## 6. AI 评测

数据集按任务版本化。interpretation 指标：actor/target/action/risk/source 准确率和澄清率；narration 指标：事实一致性、隐藏信息泄漏、无来源变化、语言质量；Memory 指标：source precision、遗漏和冲突处理。

结构化安全指标必须 100%：不得把无来源 Candidate 提交，不得泄漏 gm_only。叙事质量采用人工评分阈值，不伪装为确定性单元测试。

## 7. CI

PR：format、lint、typecheck、unit、contract、SQLite integration、replay、内容 fixture、Windows x64 package smoke、许可证/SBOM。正式发布额外跑完整 E2E、旧版本 migration、安装/更新/卸载、安全测试和 live Provider smoke。

外部 PR 不获得发布证书或 Provider keys。依赖安装脚本使用 allowlist，lockfile 变化必须评审来源、许可证和原生二进制。

## 8. 性能门槛

- 冷启动 < 5 s；中型战役打开 < 3 s；
- 状态查询 P95 < 100 ms；提交 P95 < 250 ms；
- Context 本地构建 P95 < 200 ms；
- 10k 事件正常交互，50k 事件可恢复；
- UI 长任务不阻塞输入和滚动；
- 单次内存持续增长测试 100 回合后无无界增长。

性能基线机器记录 CPU、RAM、SSD 和 Windows 版本。未指定机器的数字不作为可比较结果。

## 9. 发布阻断

Critical 安全/数据损坏、重放不确定、migration 失败、secret 泄漏、认证 Provider 核心路径失败、主流程 E2E 失败均阻断。Flaky test 不允许简单重跑隐藏；必须隔离、记录 owner 和修复期限，核心数据测试不得 quarantine。
