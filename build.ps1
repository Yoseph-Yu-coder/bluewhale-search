#Requires -Version 7.0
<#
.SYNOPSIS
  构建 DeepSeek 搜索扩展的 Chrome / Firefox 两个分发包。
.DESCRIPTION
  从 src/ 复制一份共享代码，分别套上 manifest.chrome.json / manifest.firefox.json，
  产出 dist/chrome、dist/firefox 两个可直接加载的目录，以及 .zip / .xpi 安装包。
.EXAMPLE
  pwsh -File build.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipIcons
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$src = Join-Path $root 'src'
$dist = Join-Path $root 'dist'
$python = 'C:\Users\YosephYu\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "    $Message" -ForegroundColor DarkGray
}

if (-not (Test-Path $src)) {
    throw "找不到源码目录：$src"
}

# ---------------------------------------------------------------- 图标
$iconDir = Join-Path $src 'icons'
$icon128 = Join-Path $iconDir 'icon128.png'
$portrait = Join-Path $root 'assets\portrait.jpg'

$needIcons = -not (Test-Path $icon128)
if (-not $needIcons -and (Test-Path $portrait)) {
    # 换过源图就重新生成，不用手动记得
    $needIcons = (Get-Item $portrait).LastWriteTime -gt (Get-Item $icon128).LastWriteTime
}

if (-not $SkipIcons -and $needIcons) {
    Write-Step '从 assets/portrait.jpg 生成图标'
    if (-not (Test-Path $python)) {
        throw "找不到 Python：$python（可以手动放置 src/icons 下的图标后加 -SkipIcons 重跑）"
    }
    & $python (Join-Path $root 'tools\make_icons.py')
    if ($LASTEXITCODE -ne 0) { throw '图标生成失败' }
}

# ---------------------------------------------------------------- 版本号
$chromeManifestPath = Join-Path $src 'manifest.chrome.json'
$chromeManifest = Get-Content -Raw -Path $chromeManifestPath | ConvertFrom-Json
$version = $chromeManifest.version
$version = $version -replace '[^0-9A-Za-z\.\-]', '.'
if (-not $version) { throw 'manifest.chrome.json 里没有 version' }

Write-Step "版本 $version"

# ---------------------------------------------------------------- 清理
if (Test-Path $dist) {
    Remove-Item -Path $dist -Recurse -Force
}
New-Item -Path $dist -ItemType Directory -Force | Out-Null

# ---------------------------------------------------------------- 打包
$targets = @(
    @{ Name = 'chrome';  Manifest = 'manifest.chrome.json';  Extension = 'zip'; Label = 'Chrome / Edge' }
    @{ Name = 'firefox'; Manifest = 'manifest.firefox.json'; Extension = 'xpi'; Label = 'Firefox' }
)

$artifacts = @()

foreach ($target in $targets) {
    $name = $target.Name
    $manifestFile = $target.Manifest
    $ext = $target.Extension

    $manifestPath = Join-Path $src $manifestFile
    if (-not (Test-Path $manifestPath)) { throw "找不到 $manifestFile" }
    Get-Content -Raw -Path $manifestPath | ConvertFrom-Json | Out-Null  # 校验 JSON

    $targetDir = Join-Path $dist $name
    New-Item -Path $targetDir -ItemType Directory -Force | Out-Null

    Write-Step "组装 $($target.Label)"

    Copy-Item -Path (Join-Path $src '*') -Destination $targetDir -Recurse -Force
    Get-ChildItem -Path $targetDir -Filter 'manifest.*.json' -File | Remove-Item -Force
    Copy-Item -Path $manifestPath -Destination (Join-Path $targetDir 'manifest.json') -Force

    $archive = Join-Path $dist "bluewhale-search-$name-$version.$ext"
    Compress-Archive -Path (Join-Path $targetDir '*') -DestinationPath $archive -Force

    $files = (Get-ChildItem -Path $targetDir -Recurse -File).Count
    $sizeKb = [math]::Round((Get-Item $archive).Length / 1KB, 1)
    Write-Ok "$name：$files 个文件 -> $(Split-Path -Leaf $archive) ($sizeKb KB)"

    $artifacts += [pscustomobject]@{
        Target   = $name
        Dir      = $targetDir
        Archive  = $archive
        SizeKB   = $sizeKb
    }
}

# ---------------------------------------------------------------- 摘要
Write-Host ''
Write-Host '构建完成：' -ForegroundColor Green
$artifacts | Format-Table -AutoSize -Property Target, SizeKB, Archive | Out-String | Write-Host

Write-Host '本地加载：' -ForegroundColor Yellow
Write-Host '  Chrome : chrome://extensions -> 开发者模式 -> 加载已解压的扩展程序 -> dist\chrome'
Write-Host '  Firefox: about:debugging#/runtime/this-firefox -> 临时载入附加组件 -> dist\firefox\manifest.json'
Write-Host '  Firefox 正式安装需签名，见 sign-firefox.ps1 与 README。'
