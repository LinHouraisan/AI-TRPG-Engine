# Desktop Shell 与进程生命周期

Status: Draft  
Implements: V1.0 技术设计第 4、5、14 节  
Depends On: [公共约定](00-common-conventions.md)、[Platform Security](16-platform-security.md)  
Consumed By: IPC、Player UI、发布系统

## 1. 职责

Desktop Shell 只负责 Electron 生命周期、窗口、安全策略、单实例、内部资源协议、主进程组合根和退出协调。它不包含游戏规则、SQL、Prompt、内容解析或 React 业务状态。

## 2. 进程

V1.0 使用一个 Main、一个 Preload 和一个主 Renderer。设置、内容库和主持桌使用同一窗口内路由，不为页面创建额外 BrowserWindow。CPU 密集任务达到持续阻塞 50 ms 的实测阈值后，单独迁移到 Worker；迁移前不预建 RPC。

```text
Main
├─ AppLifecycle
├─ WindowManager
├─ CompositionRoot
├─ IpcRegistry
├─ InternalProtocol
└─ ShutdownCoordinator
     │
     ├─ Preload（白名单桥）
     └─ Renderer（不可信 UI）
```

## 3. BrowserWindow 配置

必须固定：

```ts
interface MainWindowSecurityOptions {
  contextIsolation: true;
  nodeIntegration: false;
  sandbox: true;
  webSecurity: true;
  allowRunningInsecureContent: false;
}
```

禁用 DevTools 只适用于正式 stable 构建；开发和 beta 允许开启。正式构建不得通过命令行开关重新启用 Node integration。

`setWindowOpenHandler` 默认 `deny`。导航仅允许打包 Renderer origin；外部链接先经过 `ExternalNavigationPolicy` 验证 `https:`，再显示目标域名确认，最后由 Main 调用系统浏览器。

## 4. 生命周期状态机

```text
cold
 → initializing_platform
 → opening_settings
 → registering_ipc
 → creating_window
 → ready
 → shutting_down
 → stopped

任意初始化失败 → startup_failed
ready 中检测恢复需求 → recovery_required
```

`ready` 前不接受业务 IPC。`startup_failed` 只展示本地静态错误窗口，不加载可能依赖数据库的完整 UI。

## 5. 单实例

Main 在数据库打开前获取单实例锁。第二实例只允许传递：

```ts
type SecondInstanceIntent =
  | { kind: "focus" }
  | { kind: "import_file"; path: string }
  | { kind: "open_campaign_export"; path: string };
```

路径在第一实例 Main 中重新解析和校验；第二实例传入的数据不可信。若第一实例正在迁移或恢复，只排队一个去重后的 intent，窗口恢复后处理。

## 6. 组合根

`CompositionRoot` 创建并持有：Logger、Clock、IdGenerator、AppPaths、CredentialStore、SettingsRepository、CampaignDatabaseManager、ProviderRegistry、Application Services 和 IPC handlers。

依赖创建顺序严格为：平台路径 → 日志 → 凭据能力检查 → settings DB → migrations → repositories → services → IPC → window。

组件关闭使用反向顺序。模块不得从全局 service locator 获取依赖。

## 7. 内部资源协议

注册 `app-resource://`，只读取内容库和战役附件中经过登记的资源 ID：

```ts
interface ResourceRequest {
  scope: "content" | "campaign";
  ownerId: string;
  resourceId: string;
}
```

协议处理器从数据库映射到已验证的绝对路径，不接受路径片段。响应设置精确 MIME、`nosniff`、禁止脚本执行和缓存策略。HTML、SVG 和可执行 MIME 拒绝返回。

## 8. 退出协调

退出流程总预算 5 秒：

1. 停止接受新命令；
2. Renderer 保存未提交输入草稿；
3. 取消可取消的模型请求；
4. 等待正在提交的短事务结束，最多 2 秒；
5. 标记可恢复后台任务；
6. checkpoint WAL；
7. 关闭数据库和日志。

已提交事实不需要额外“保存”。超过预算时记录 `APP_SHUTDOWN_TIMEOUT`，保留数据库恢复能力并退出，不无限等待网络请求。

## 9. 错误码

| 错误码 | retryable | 含义 |
|---|---:|---|
| `APP_ALREADY_SHUTTING_DOWN` | false | 退出后收到新命令 |
| `APP_STARTUP_FAILED` | false | 初始化未知失败 |
| `APP_RECOVERY_REQUIRED` | false | 必须先完成数据恢复 |
| `APP_SHUTDOWN_TIMEOUT` | false | 退出超时，需下次检查 |
| `APP_EXTERNAL_URL_BLOCKED` | false | 非 HTTPS 或策略拒绝 |
| `APP_RESOURCE_NOT_FOUND` | false | 资源 ID 不存在 |
| `APP_RESOURCE_TYPE_BLOCKED` | false | MIME 不允许 |

## 10. 测试与验收

- E2E 断言 Renderer 中 `window.require`、Node `process` 和 `ipcRenderer` 不存在；
- E2E 断言 Preload 只有文档列出的命名 API；
- 单元测试第二实例 intent 的路径重验和去重；
- 集成测试初始化任一步失败时逆序释放已创建资源；
- 故障测试在提交前、提交中、提交后强制退出并验证恢复语义；
- CSP 测试禁止 `unsafe-eval`、远程 script 和任意 connect；
- 主窗口冷启动目标普通 SSD 小于 5 秒；
- 验收时 Main 文件只做生命周期和组装，不出现 SQL、领域规则或 Prompt。

