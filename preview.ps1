#Requires -Version 7.0
<#
.SYNOPSIS
  生成一个可以脱离扩展直接双击打开的预览版起始页。
.DESCRIPTION
  把 src/ 复制到 dist/preview，注入 tools/preview-mock.js（模拟扩展 API 与假数据），
  之后用任何浏览器打开 dist/preview/preview.html 就能看到界面，不需要安装扩展、不联网、不花钱。

  加 ?q=关键词 直接看结果态，加 ?setup=1 看设置菜单展开的样子：
    preview.html?q=deepseek
    preview.html?setup=1
.EXAMPLE
  pwsh -File preview.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$src = Join-Path $root 'src'
$out = Join-Path $root 'dist\preview'

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $out | Out-Null

Copy-Item -Path (Join-Path $src '*') -Destination $out -Recurse -Force
Copy-Item -Path (Join-Path $root 'tools\preview-mock.js') -Destination (Join-Path $out 'mock.js') -Force
Get-ChildItem -Path $out -Filter 'manifest.*.json' -File | Remove-Item -Force

$htmlPath = Join-Path $out 'start.html'
$html = Get-Content -Raw -Path $htmlPath
$injected = $html -replace '<script src="start.js"></script>', '<script src="mock.js"></script><script src="start.js"></script>'
if ($injected -eq $html) { throw '没找到插入点，start.html 里的 script 标签被改过了？' }
Set-Content -Path (Join-Path $out 'preview.html') -Value $injected -Encoding utf8

$target = Join-Path $out 'preview.html'
Write-Host "预览已生成：$target" -ForegroundColor Green
Write-Host '  首页      : preview.html'
Write-Host '  结果态    : preview.html?q=deepseek'
Write-Host '  设置菜单  : preview.html?setup=1'
Write-Host ''
Write-Host '直接用浏览器打开上面这个文件即可（不需要装扩展）。'
