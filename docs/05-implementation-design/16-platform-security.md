# Windows Platform、凭据、备份与安全

Status: Draft  
Implements: Windows 路径、密钥、备份、恢复与安全  
Depends On: 公共约定  
Consumed By: Desktop、Persistence、Providers、Release

## 1. 路径

```text
%APPDATA%/<product>/settings.sqlite
%APPDATA%/<product>/logs/
%LOCALAPPDATA%/<product>/cache/
%USERPROFILE%/Documents/<product>/campaigns/
%USERPROFILE%/Documents/<product>/content/
%USERPROFILE%/Documents/<product>/backups/
```

实际路径由 Electron `app.getPath` 和已验证用户设置解析，不拼接用户名。所有相对路径解析后必须验证仍位于指定 root。写入采用临时文件 + flush + 同卷 rename。

## 2. 凭据

使用 Electron safeStorage/Windows DPAPI。`CredentialStore` 接口：set、has、use、delete；不提供 list plaintext 或 get 给 Renderer。加密 blob 存在 Main-only 文件，文件只保存 credentialId、ciphertext、createdAt、updatedAt。

`use(id, callback)` 在 Main 内短暂解密并把字符串传给 Provider request builder；callback 完成后释放引用。虽然 JS 无法保证擦除内存，禁止缓存明文、日志和错误拼接。

safeStorage 不可用时禁止保存云凭据，可允许当前会话内临时 key，关闭即丢失并明确提示。

## 3. SSRF 与网络

自定义 Base URL 校验 scheme、hostname 和 port。云端只允许 HTTPS；HTTP 仅允许 loopback。默认禁止 file、ftp、data、javascript、unix socket 和 URL userinfo。重定向最多 3 次，每次重新校验；云 endpoint 重定向到私网/loopback 时拒绝。

代理配置由 Main 使用；代理凭据进入 CredentialStore。证书错误默认不绕过，不提供全局“忽略 TLS”。

## 4. 备份格式

```text
manifest.json
campaign.sqlite
attachments/**
content-snapshots/**
checksums.json
```

manifest 包含 formatVersion、campaignId、appVersion、DB/domain versions、createdAt、branch heads 和文件清单。SQLite 使用在线 backup API。附件复制后逐文件 SHA-256，最终包写临时路径并原子 rename。

默认自动备份：每天首次成功提交后、应用升级前、内容 migration 前；保留最近 7 个每日、4 个每周和全部用户命名备份。清理前验证至少一个完整备份。

## 5. 恢复

恢复永远写入新 campaign directory 和新 catalog entry，成功验证后才允许用户替换旧入口。步骤：容器安全检查 → checksum → SQLite integrity → schema compatibility → snapshot/replay hash → 内容快照 → 新 ID 冲突处理 → catalog 注册。

损坏原件只读保留。自动恢复不得覆盖唯一副本。

## 6. 日志与诊断隐私

默认日志不含玩家正文、Prompt、响应、API Key、Authorization、完整路径。路径用 root 类型 + 相对路径或 hash。诊断包分 basic/with-content 两档；with-content 必须逐项勾选并预览清单。

## 7. 威胁模型

防护：恶意内容包、Prompt injection 取得系统能力、XSS 访问 Preload、路径穿越、任意 IPC、日志泄密、未签名更新、远端响应炸弹。非目标：已完全控制当前 Windows 用户会话的恶意软件、内核级攻击、用户主动把 key 复制给第三方。

## 8. 错误与测试

错误码：`PLATFORM_PATH_OUTSIDE_ROOT`、`CREDENTIAL_STORAGE_UNAVAILABLE`、`CREDENTIAL_NOT_FOUND`、`NETWORK_ENDPOINT_BLOCKED`、`NETWORK_TLS_FAILED`、`BACKUP_CREATE_FAILED`、`BACKUP_CHECKSUM_FAILED`、`RESTORE_INCOMPATIBLE`、`RESTORE_INTEGRITY_FAILED`。

测试覆盖 Windows 保留名/尾点/ADS/UNC、DPAPI fake、secret 扫描、重定向 SSRF、正在写入时备份、缺文件/篡改恢复、磁盘满和杀进程。安全发布前运行恶意包与 XSS E2E。

