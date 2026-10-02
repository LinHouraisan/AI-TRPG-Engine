# 旧 V1.0 模块实现设计索引

状态：历史参考。2026-09-29 起，部署归属、V1.0 范围及数据标注设计由 [新架构手册](../ARCHITECTURE-V1.md)替代。当前交付移除作者产品，加入数据工作台；不要按本文旧目录重新建设 Electron 业务后端。

## 1. 定位

本目录把产品、逻辑架构和 V1.0 总体技术基线细化为可直接指导开发和评审的模块设计。文档规定模块职责、接口、数据结构、事务、状态机、错误、测试和验收，不包含产品代码。

权威优先级：

1. 用户最新要求和当前产品路线图；
2. `docs/ARCHITECTURE-V1.md` 的目标架构、数据标注与验收；
3. 产品原则及 01–04 中不与新手册冲突的逻辑约束；
4. 本目录中仍适用的历史实现素材；
5. 基于新手册编写的具体实施计划。

下层若发现上层不可实现，必须先修改上层，不能在代码中静默改变事实权威、提交顺序或安全边界。

## 2. 文档状态

本目录文档初始状态均为 `Draft`。开发团队评审后改为 `Accepted`；被替代的文档改为 `Superseded` 并链接继任文档。状态变更不删除历史 Git 记录。

每份模块文档包含：

- Status：设计状态；
- Implements：落实的上层设计；
- Depends On：上游模块；
- Consumed By：下游消费者。

## 3. 推荐阅读顺序

1. [公共约定](00-common-conventions.md)
2. [桌面壳与进程](01-desktop-shell.md)
3. [IPC 契约](02-ipc-contracts.md)
4. [Persistence](03-persistence.md)
5. [事件与状态](04-event-state.md)
6. [Character 与 NPC](05-character-npc-domain.md)
7. [Item](06-item-domain.md)
8. [Scene 与 World](07-scene-world-domain.md)
9. [Rule Engine](08-rule-engine.md)
10. [Scenario Runtime](09-scenario-runtime.md)
11. [Application Runtime](10-application-runtime.md)
12. [AI Orchestrator](11-ai-orchestrator.md)
13. [Model Providers](12-model-providers.md)
14. [Context 与 Memory](13-context-memory.md)
15. [Content System](14-content-system.md)
16. [Player UI](15-player-ui.md)
17. [Platform Security](16-platform-security.md)
18. [Observability 与 Testing](17-observability-testing.md)
19. [Release 与 Compatibility](18-release-compatibility.md)

## 4. 模块依赖

```text
Renderer
  ↓
IPC Contracts
  ↓
Application Runtime
  ├── Game Domains ── Rule Engine ── Scenario Runtime
  ├── AI Orchestrator ── Model Providers
  ├── Context / Memory
  └── Content System
        ↓
Persistence + Platform Services
```

依赖只允许向下。Renderer 不访问 SQLite、文件、凭据和 Provider；领域模块不依赖 Electron、React、SQLite 或供应商 SDK；Provider、Memory 和 Content Importer 不直接写权威状态。

## 5. 全局不变量

- AI 输出只是 Candidate，不能直接成为事实；
- 权威状态、事件和规则裁定在一个 SQLite 事务中提交；
- 正式叙事只读取已提交结果；
- 同一 `turnId` 的同一提交最多成功一次；
- 同一 Decision 重试不得重新生成 RNG；
- 所有跨信任边界数据经过运行时 schema 校验；
- 任何派生数据必须可由权威数据重建；
- API Key 不进入 Renderer、SQLite 战役、日志、内容包或导出；
- V1.0 仅正式支持 Windows x64；
- 不实现多人网络、真人 GM 工作台、可视化作者工具或任意代码插件。

## 6. 文档完成标准

历史模块若重新采用，必须先按新手册修订并标明适用范围；只有同时满足以下条件才能标为 `Accepted`：

- 公共接口及消费者明确；
- 所有持久化字段、索引和事务边界明确；
- 状态转换及非法转换明确；
- 错误码、重试和恢复语义明确；
- 安全边界和敏感字段明确；
- 单元、集成、契约和故障测试明确；
- 性能目标可测量；
- 没有未决占位标记或互相矛盾的字段定义。
