#Requires -Version 7.0
<#
.SYNOPSIS
  把 promo/build/frames 里的 PNG 序列编码成 MP4。
.DESCRIPTION
  60fps / 1920×1080 / H.264 High / yuv420p（手机、微信、Safari 都能直接播）。
  CRF 16 属于视觉无损档，配合 -tune animation 保留大面积纯色渐变，避免色带。
.EXAMPLE
  pwsh -File encode.ps1
#>
[CmdletBinding()]
param(
    [string]$Fps = '60',
    [string]$Crf = '16',
    [string]$Out = 'out\deepseek-search-promo.mp4'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$frames = Join-Path $root 'build\frames'
$outPath = Join-Path $root $Out

# 优先用 PATH 里的 ffmpeg，否则用这台机器上找到的那个
$cmd = Get-Command ffmpeg -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$ffmpeg = if ($cmd) { $cmd.Source } else { $null }
if (-not $ffmpeg) {
    $candidates = @(
        'C:\Users\YosephYu\AppData\Roaming\Seewo\EasiNote5\Dependencies\FFmpeg\FFmpeg_2\ffmpeg.exe',
        'C:\Program Files (x86)\ETS\ffmpeg\ffmpeg.exe'
    )
    $ffmpeg = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ffmpeg) { throw '找不到 ffmpeg.exe，请先安装或把路径写进 $candidates' }

$count = (Get-ChildItem -Path $frames -Filter '*.png' -File | Measure-Object).Count
if ($count -eq 0) { throw "没有帧可编码：$frames" }

New-Item -ItemType Directory -Force (Split-Path $outPath) | Out-Null

Write-Host "ffmpeg : $ffmpeg" -ForegroundColor DarkGray
Write-Host "frames : $count" -ForegroundColor DarkGray

& $ffmpeg -y -hide_banner -loglevel warning `
    -framerate $Fps `
    -i (Join-Path $frames '%05d.png') `
    -c:v libx264 -preset slow -crf $Crf -tune animation `
    -pix_fmt yuv420p -profile:v high -level 4.2 `
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 `
    -movflags +faststart `
    $outPath

if ($LASTEXITCODE -ne 0) { throw "ffmpeg 编码失败（退出码 $LASTEXITCODE）" }

$file = Get-Item $outPath
$mb = [math]::Round($file.Length / 1MB, 2)
Write-Host "`n完成：$($file.FullName)  ($mb MB)" -ForegroundColor Green
