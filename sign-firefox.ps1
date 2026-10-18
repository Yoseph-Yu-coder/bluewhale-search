#Requires -Version 7.0
<#
.SYNOPSIS
  用 web-ext 为 Firefox 版申请 AMO 签名，产出可正式安装的 .xpi。
.DESCRIPTION
  Firefox Release 版只允许安装已签名的扩展。签名走 Mozilla 的 AMO 服务：
    1. 注册账号并生成 API 凭据：https://addons.mozilla.org/developers/addon/api/key/
    2. 把 JWT issuer 与 secret 传进来（或用环境变量 AMO_JWT_ISSUER / AMO_JWT_SECRET）
    3. 本脚本调用 web-ext sign 上传、签名并下载 .xpi

  channel = unlisted（自发布，签名后自己分发）或 listed（上架 AMO 商店，需人工审核）。
.EXAMPLE
  pwsh -File sign-firefox.ps1 -ApiKey 'user:12345:67' -ApiSecret 'abcdef...'
.EXAMPLE
  $env:AMO_JWT_ISSUER='user:12345:67'; $env:AMO_JWT_SECRET='abcdef...'; pwsh -File sign-firefox.ps1
#>
[CmdletBinding()]
param(
    [string]$ApiKey = $env:AMO_JWT_ISSUER,
    [string]$ApiSecret = $env:AMO_JWT_SECRET,
    [ValidateSet('unlisted', 'listed')]
    [string]$Channel = 'unlisted',
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$sourceDir = Join-Path $root 'dist\firefox'
$artifactsDir = Join-Path $root 'dist\signed'

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

if (-not $SkipBuild) {
    Write-Step '先构建 firefox 目录'
    & (Join-Path $root 'build.ps1') | Out-Host
}

if (-not (Test-Path (Join-Path $sourceDir 'manifest.json'))) {
    throw "找不到 $sourceDir\manifest.json，先运行 build.ps1"
}

if (-not $ApiKey -or -not $ApiSecret) {
    Write-Host ''
    Write-Host '缺少 AMO API 凭据。' -ForegroundColor Yellow
    Write-Host '  1) 打开 https://addons.mozilla.org/developers/addon/api/key/ 生成 JWT issuer / secret'
    Write-Host '  2) 重跑：pwsh -File sign-firefox.ps1 -ApiKey <issuer> -ApiSecret <secret>'
    Write-Host ''
    Write-Host '不想用命令行？也可以手动上传：' -ForegroundColor Yellow
    Write-Host '  打开 https://addons.mozilla.org/developers/addon/submit/'
    Write-Host '  选择 “On your own”（unlisted），上传 dist\deepseek-search-firefox-*.xpi'
    Write-Host '  审核通过后 Mozilla 会把签名好的 .xpi 发给你'
    exit 1
}

New-Item -Path $artifactsDir -ItemType Directory -Force | Out-Null

# 优先用本地已安装的 web-ext，否则退回 npx
$webExt = Get-Command web-ext -CommandType Application -ErrorAction SilentlyContinue
$useNpx = -not $webExt
if ($useNpx) {
    $npx = Get-Command npx -CommandType Application -ErrorAction SilentlyContinue
    if (-not $npx) {
        throw '既没有 web-ext 也没有 npx。请先安装 Node.js，然后 npm i -g web-ext（或用 npm i 安装本目录依赖）。'
    }
}

Write-Step "提交签名（channel=$Channel）"

$arguments = @(
    'sign'
    '--source-dir', $sourceDir
    '--artifacts-dir', $artifactsDir
    '--channel', $Channel
    '--api-key', $ApiKey
    '--api-secret', $ApiSecret
    '--overwrite-dest'
)

if ($useNpx) {
    & npx --yes web-ext@latest @arguments
} else {
    & $webExt.Source @arguments
}

if ($LASTEXITCODE -ne 0) {
    throw "web-ext sign 失败（退出码 $LASTEXITCODE）。常见原因：版本号未递增、manifest 字段不合规、Id 冲突。"
}

$signed = Get-ChildItem -Path $artifactsDir -Filter '*.xpi' -File | Sort-Object LastWriteTime -Descending
if (-not $signed) {
    throw '没有拿到签名后的 .xpi，请检查 web-ext 输出。'
}

Write-Host ''
Write-Host '签名完成：' -ForegroundColor Green
$signed | Select-Object Name, @{ Name = 'SizeKB'; Expression = { [math]::Round($_.Length / 1KB, 1) } } | Format-Table -AutoSize

Write-Host '安装：Firefox 打开 about:addons -> 齿轮 -> 从文件安装附加组件，选择上面的 .xpi。' -ForegroundColor Yellow
Write-Host '提示：重新签名前必须先改 manifest.firefox.json 里的 version，AMO 不接受重复版本号。'
