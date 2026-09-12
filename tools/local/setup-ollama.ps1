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
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Host "    已安装：$((Get-Command ollama).Source)"
} else {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "没有 winget。到 https://ollama.com/download 手动下载安装。"
    }
    Write-Host "    用 winget 安装（约 1.5GB，取决于网速）"
    winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
    # 刚装的 ollama 不在当前会话的 PATH 里，重载一下
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        throw "装完仍找不到 ollama，重开一个终端再跑一次。"
    }
}

Step "启动服务"
$alive = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $alive) {
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
