# Player UI

Status: Draft
Implements: 首页、主持桌、时间线、内容库和设置
Depends On: IPC Contracts、公共约定
Consumed By: 玩家

## 1. 技术与状态

React + Vite + CSS Modules。React local state 保存输入和折叠；Zustand 保存主题、布局和未提交 UI 草稿；TanStack Query 保存 IPC 读取缓存。任何权威状态 mutation 必须等待 Main 返回新 StateVersion 后刷新，禁止乐观修改生命、道具和剧情。

## 2. 路由

```text
/
/campaigns/new
/campaigns/:campaignId/play
/campaigns/:campaignId/timeline
/campaigns/:campaignId/branches
/content
/settings/providers
/settings/models
/settings/storage
/settings/privacy
/settings/advanced
/recovery
```

路由参数先经 schema 校验再调用 IPC。战役关闭或恢复期间守卫相关路由。

## 3. 首页与创建

战役列表虚拟化并按 lastOpened 排序，展示 health、内容、角色、场景、最后时间。创建向导五步：内容 → 能力诊断 → 角色 → 规则 → 模型检查 → 确认。每步可返回且保存 draft；必需项未通过不能完成。

删除改为 moveToTrash，默认 30 天后才允许清理；UI 明确显示磁盘占用和恢复入口。

## 4. 主持桌

```text
左栏：场景、NPC、地点、线索
中栏：虚拟化叙事时间线、规则卡片、建议行动、自由输入
右栏：角色属性、资源、状态、道具、任务
```

中央栏最小宽度 520 px；窗口低于 1000 px 时左右栏改为抽屉。输入框支持多行、历史草稿和明确提交；生成中禁止重复 submit，但允许编辑下一条草稿。

调试视图默认关闭。Demo 在主持人选项提供「调试后台任务」复选框（`KeeperConfig.debugTrace`）：打开后记录栏展示 Information / Director / Memory 冷路径、Active Context 双缓冲和 Story Monitor。只读已算过的 after-commit 结果，不写权威状态，不与叙事列混排为玩家功能。Electron 渲染进程不得为填面板再调一次模型。

消息类型有独立组件：PlayerAction、GmNarration、RuleDecision、StateChange、Clarification、SystemRecovery。Markdown 禁止原始 HTML，链接确认后外开。

## 5. 流式叙事

delta 只显示为带“生成中”的临时块。收到 completed 后以 Main 返回的 NarrationRecord 替换。序号缺失、窗口刷新或订阅丢失时丢弃临时块并重新获取 Operation。提交后叙事失败显示“事实已保存”，提供重试，不提供回滚按钮。

## 6. 时间线与分支

时间线按事件分页，默认玩家描述；高级模式显示 event/source/version。checkpoint 显示“从这里继续”，创建分支前解释旧时间线仍保留。分支删除先归档，不能删除当前分支或唯一根分支。

## 7. 内容库和设置

内容库只导入、诊断、安装、更新、卸载和打开位置，不显示编辑器。设置中的 Provider 实例支持测试、模型列表、能力、任务映射和遮罩凭据；保存 key 后不回显原文。

## 8. 可访问性

键盘可完成全部核心流程；焦点可见；颜色不作为唯一状态；动态叙事使用 `aria-live="polite"` 且批量播报；骰子和状态变化有文本；支持 100%–200% 缩放；尊重 reduced motion。

## 9. 错误体验

统一错误卡回答：发生什么、数据是否安全、可否重试、是否可能计费、下一步和诊断入口。输入验证靠近字段；系统错误保留 operationId。禁止直接展示 stack、SQL、Provider body 或路径。

## 10. 性能与测试

- 输入响应不受后台任务影响；调试面板开关不改变提交哈希；
- 10,000 时间线项只渲染可见窗口；
- campaign state change 后 500 ms 内刷新可见视图（不含数据库故障）；
- 组件测试覆盖 loading/empty/error/success；
- E2E 覆盖首次创建、完整回合、澄清、叙事重试、分支和恢复；
- axe 或等价检查无严重可访问性问题；
- 安全测试确保 Renderer 无 Node 和通用 IPC。
