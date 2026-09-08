$ErrorActionPreference = "Stop"

$extDir = "$env:USERPROFILE\.vscode\extensions"
$targetDir = "$extDir\scene-breakpoints-vscode"
$sourceDir = $PSScriptRoot

Write-Host "正在安装 Scene Breakpoints 扩展..." -ForegroundColor Cyan

if (-not (Test-Path $extDir)) {
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
}

if (Test-Path $targetDir) {
    Remove-Item -Path $targetDir -Recurse -Force
}

# 复制到扩展目录
Copy-Item -Path $sourceDir -Destination $targetDir -Recurse -Force

Write-Host "✅ 扩展安装成功！路径: $targetDir" -ForegroundColor Green
Write-Host "👉 请在 VS Code 中按 Ctrl+Shift+P，输入 'Reload Window' (重载窗口) 即可立即使用！" -ForegroundColor Yellow
