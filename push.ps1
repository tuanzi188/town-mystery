# 一键提交并推送到 GitHub
# 用法 1（带说明）：   .\push.ps1 "修复了第 4 关碎瓷没动画的 bug"
# 用法 2（无说明）：   .\push.ps1     （会交互询问）
param(
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $Message) {
  $Message = Read-Host "提交信息"
  if (-not $Message) {
    Write-Host "未输入提交信息，已取消" -ForegroundColor Yellow
    exit 1
  }
}

git add .
$status = git status --porcelain
if (-not $status) {
  Write-Host "没有需要提交的更改" -ForegroundColor Yellow
  exit 0
}

git commit -m $Message
if ($LASTEXITCODE -ne 0) {
  Write-Host "commit 失败" -ForegroundColor Red
  exit 1
}

git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host "push 失败，请检查网络或 token" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "已推送成功 → https://github.com/tuanzi188/town-mystery" -ForegroundColor Green
