<#
.SYNOPSIS
    本地模型服务一键搭建：装 Ollama → 拉对话模型与 embedding 模型 → 生成 electron/.env。

.DESCRIPTION
    本机没有 NVIDIA 显卡，所以只做**本地推理/向量化**，微调走云端（见 tools/lora/）。
    服务起来后 http://127.0.0.1:11434/v1 同时提供 OpenAI 兼容的
    /v1/chat/completions 与 /v1/embeddings，后续 rag:build / bench 不需要任何付费 API。

.EXAMPLE
    .\tools\local\setup-ollama.ps1
    .\tools\local\setup-ollama.ps1 -WriteEnv                 # 顺手写入 electron/.env
    .\tools\local\setup-ollama.ps1 -ChatModel qwen2.5:1.5b-instruct
#>
[CmdletBinding()]
param(
    [string]$ChatModel = "qwen2.5:3b-instruct",
    [string]$EmbedModel = "bge-m3",
    [int]$Port = 11434,
    [switch]$SkipPull,
    [switch]$WriteEnv
)

$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:$Port"

function Step { param([string]$msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }

function Refresh-Path {
    # 当前会话的 PATH 是进程启动时继承的。刚装完的软件写进了注册表但没进这个会话，
    # 直接 Get-Command 会误判成"没装"，进而重复安装——所以探查前先按注册表刷一次。
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
    $knownExe = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path $knownExe) { $env:Path += ";" + (Split-Path $knownExe) }
}

function Wait-Ready {
    Write-Host "    等待服务就绪..." -NoNewline
    for ($i = 0; $i -lt 60; $i++) {
        try {
            Invoke-WebRequest "$base/api/tags" -UseBasicParsing -TimeoutSec 2 | Out-Null
            Write-Host " OK"
            return
        } catch { Start-Sleep -Seconds 1 }
    }
    throw "服务未起来：$base"
}

Step "检查 Ollama"
Refresh-Path
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Host "    已安装：$((Get-Command ollama).Source)"
} else {
    Step "安装 Ollama（约 1.5GB）"
    # 优先直连 ollama.com：winget 的安装器托管在 GitHub releases，
    # 而部分网络环境到 GitHub 的下载会停摆（进程活着但磁盘无增长）。
    # curl.exe 是 Windows 自带组件，流式落盘，不像 Invoke-WebRequest 会把 1.5GB 全读进内存。
    # 已存在且大小正常就复用——重跑一次脚本不该白等三分钟。
    $installer = Join-Path $env:TEMP "OllamaSetup.exe"

    if ((Test-Path $installer) -and (Get-Item $installer).Length -gt 50MB) {
        Write-Host "    复用已下载的安装器"
    } else {
        $ok = $false
        $proxyArgs = @()
        $settings = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction SilentlyContinue
        if ($settings -and $settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
            # 不走代理直连只有约 0.2MB/s，走系统代理约 7MB/s：两小时 vs 三分钟。
            Write-Host "    走系统代理 $($settings.ProxyServer)"
            $proxyArgs = @("--proxy", $settings.ProxyServer)
        }
        Write-Host "    下载 https://ollama.com/download/OllamaSetup.exe"
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            & curl.exe -L --retry 3 --retry-delay 3 --connect-timeout 20 @proxyArgs -o $installer https://ollama.com/download/OllamaSetup.exe
            $ok = $LASTEXITCODE -eq 0 -and (Test-Path $installer) -and (Get-Item $installer).Length -gt 50MB
        }
        if (-not $ok) {
            Write-Host "    下载失败，回退到 winget"
            winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
        }
    }

    if ((Test-Path $installer) -and (Get-Item $installer).Length -gt 50MB) {
        Start-Process -FilePath $installer -ArgumentList "/VERYSILENT","/NORESTART" -Wait
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
    }

    Refresh-Path
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        # Ollama 通常装在 %LOCALAPPDATA%\Programs\Ollama，直接指过去即可
        $fallback = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
        if (Test-Path $fallback) { $env:Path += ";" + (Split-Path $fallback) }
    }
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        throw "装完仍找不到 ollama，重开一个终端再跑一次。"
    }
}

Step "启动服务"
# 用原始 TCP 探活，不用 Test-NetConnection：后者在非交互会话里单次可能耗 20 秒以上。
$alive = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $Port)
    $tcp.Close()
    $alive = $true
} catch { }
if ($alive) {
    Write-Host "    已在运行"
} else {
    Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
}
Wait-Ready

if (-not $SkipPull) {
    Step "拉取 $ChatModel"
    & ollama pull $ChatModel
    Step "拉取 $EmbedModel"
    & ollama pull $EmbedModel
}

Step "已就绪的模型"
& ollama list

$envLines = @(
    "# 本地模型服务（由 tools/local/setup-ollama.ps1 生成）"
    "LC_PROTOCOL=ollama"
    "LC_BASE_URL=$base"
    "LC_MODEL=$ChatModel"
    "LC_API_KEY=ollama"
    "LC_EMBED_PROTOCOL=ollama"
    "LC_EMBED_BASE_URL=$base"
    "LC_EMBED_MODEL=$EmbedModel"
    "LC_EMBED_API_KEY=ollama"
) -join "`n"

if ($WriteEnv) {
    $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
    $envPath = Join-Path $repoRoot "electron\.env"
    Set-Content -LiteralPath $envPath -Value $envLines -Encoding utf8
    Write-Host "`n已写入 $envPath"
} else {
    Write-Host "`n把下面写进 electron/.env（或加 -WriteEnv 让我代劳）：`n" -ForegroundColor Yellow
    Write-Host $envLines
    Write-Host ""
}

Write-Host "验证：" -ForegroundColor Cyan
Write-Host "  cd electron && bun run rag:build"
Write-Host "  cd electron && bun run bench -- --mode rag`n"
