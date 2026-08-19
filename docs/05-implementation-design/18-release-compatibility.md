# Release、Migration 与 Compatibility

Status: Draft
Implements: Windows 发布、更新、兼容与 V1.0 验收
Depends On: Desktop、Persistence、Content、Platform Security、Testing
Consumed By: 发布维护者和用户支持

## 1. 版本

应用使用 SemVer。数据库、领域 JSON、内容格式、Prompt 和 Rule algorithm 分别版本化，不能用 appVersion 代替。版本支持矩阵随发布生成并进入文档。

## 2. 产物

Windows x64 每用户安装程序、更新元数据、SHA-256、SBOM、第三方许可证、变更说明。stable 产物必须代码签名；beta 使用相同签名但独立 channel；development 不进入自动更新源。

## 3. 更新状态机

```text
idle → checking → available → downloading → downloaded
 → awaiting_restart → installing → first_start_verification → complete
任一步 → failed
```

下载支持恢复但最终必须完整 hash 和签名验证。安装前关闭新写入，完成当前短事务，创建 pre_migration backup。首次启动先检查程序资源，再 migration，再打开主窗口。

## 4. 兼容策略

- 新应用读取并升级受支持旧 DB；
- 旧应用遇到新 DB 拒绝写入，可显示版本说明；
- V1.0 正式发布后至少支持从最近两个 minor 版本直接升级；
- 跨更老版本要求逐级 migration 或导出/导入；
- 绑定内容版本不随全局内容更新；
- Provider 配置 migration 不迁移或打印 secret；
- Prompt 版本变化不改写历史 Candidate/Narration。

## 5. 回滚

程序更新失败可恢复旧二进制；数据库 migration 成功后不承诺旧程序继续写入。用户通过 pre_migration backup 恢复为独立副本。自动更新器不得在 migration 成功后静默用旧应用打开新 DB。

## 6. 发布流程

1. 冻结版本和兼容矩阵；
2. 通过全部 CI/release gates；
3. 生成 SBOM 和许可证；
4. 构建干净 Windows x64 产物；
5. 签名并验证签名；
6. 在干净 Windows 用户安装；
7. 验证首次启动、创建、完整回合、恢复和卸载；
8. 从每个受支持旧版本更新；
9. 发布 beta；
10. 观察阻断指标后提升为 stable；
11. 发布 checksum、说明和已知问题。

## 7. V1.0 支持声明

UI 和文档明确列出：Windows x64；认证 Provider 及测试日期；Ollama 和 OpenAI-compatible 的支持等级；Scenario/Rule format version；已测试文字卡格式；不支持的 macOS、多人、真人 GM、可视化作者工具和任意代码插件。

## 8. 验收清单

- 新用户独立安装、配置、导入和开始；
- 正式 Scenario 从开场到结局；
- 自由行动完成理解、裁定、提交、叙事；
- 固定输入重放相同状态 hash；
- 崩溃和模型失败不损坏已提交状态；
- 备份、恢复、checkpoint 和 branch 可用；
- 至少一个云 Provider 与 Ollama 真实 E2E；
- 标为认证的所有 Provider 通过契约和 smoke；
- 恶意内容不能执行代码或越权读文件；
- secret 扫描存档、日志、导出和 Renderer 为零；
- 外部试玩者依据文档完成首次游玩；
- 所有 release blocker 为零。

## 9. 不兼容处理

任何无法安全迁移的数据都进入只读模式，提供诊断和导出，不猜测转换。内容、规则或 Provider 能力不足时显示具体缺失能力，不能把降级体验宣传为完整兼容。
