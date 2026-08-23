# 已知边界

- 正式云模型只支持 DeepSeek；Ollama 兼容代码保留但不是默认配置。
- 三小时按调查、对话和多路径探索估算，熟悉谜底的玩家会更快。
- 检查点复制恢复会自动进入新分支；来源分支保留不变。
- 当前不是完整 V1.0，没有通用作者工具、自动更新或多人模式。
- 任务所需的受限上下文会发送给 DeepSeek；API Key 由系统加密保存。
- 本机 electron-builder 在 `packaging` 阶段发生环境级卡死；最终版本已用已验证 Windows 壳覆盖安装，并另存完整 `release-manual/win-unpacked` 可运行目录。旧安装壳保存在 `release-backup-20260823-1705`，单独重装旧壳后仍需同步最终 resources。
