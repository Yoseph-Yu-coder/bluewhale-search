#Requires -Version 7.0
<#
.SYNOPSIS
  初始化仓库并推送到 GitHub（这一步需要你的网络和 GitHub 账号）。
.DESCRIPTION
  这个脚本要在你自己的终端里跑 —— 沙箱环境连不上 github.com。

  前置：先在 https://github.com/new 建一个空仓库（不要勾 README / .gitignore / license），
  拿到形如 https://github.com/你的用户名/bluewhale-search.git 的地址。

.EXAMPLE
  pwsh -File publish.ps1 -RepoUrl https://github.com/you/bluewhale-search.git
.EXAMPLE
  pwsh -File publish.ps1 -RepoUrl https://github.com/you/bluewhale-search.git -Name "你的名字" -Email "you@example.com"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory, HelpMessage = 'GitHub 仓库地址，形如 https://github.com/you/repo.git')]
    [string]$RepoUrl,

    [string]$Name = '蓝鲸搜索',
    [string]$Email = 'bluewhale-search@users.noreply.github.com',

    [string]$Message = 'chore: 初始提交'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

if (-not (Test-Path '.git')) {
    Write-Host '==> git init' -ForegroundColor Cyan
    git init | Out-Null
    git branch -M main
}

# 身份：只在本地仓库生效，不动全局配置
git config user.name $Name
git config user.email $Email

# 没有暂存内容就先 add
$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Host '==> 暂存文件' -ForegroundColor Cyan
    git add -A
}

$pending = git diff --cached --name-only
if ($pending) {
    Write-Host "==> 提交 $((($pending | Measure-Object).Count)) 个文件" -ForegroundColor Cyan
    git commit -m $Message | Out-Null
} else {
    Write-Host '==> 没有需要提交的改动' -ForegroundColor DarkGray
}

# 远端
$existing = git remote 2>$null
if ($existing -contains 'origin') {
    git remote set-url origin $RepoUrl
} else {
    git remote add origin $RepoUrl
}

Write-Host "==> 推送到 $RepoUrl" -ForegroundColor Cyan
Write-Host '    首次推送会弹出 GitHub 登录窗口（浏览器授权即可）' -ForegroundColor DarkGray
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n完成：$RepoUrl" -ForegroundColor Green
}
