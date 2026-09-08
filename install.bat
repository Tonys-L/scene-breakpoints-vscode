@echo off
chcp 65001 >nul
echo 正在安装 Scene Breakpoints 扩展到 VS Code...

set "EXT_DIR=%USERPROFILE%\.vscode\extensions\scene-breakpoints-vscode"

if exist "%EXT_DIR%" (
    rd /s /q "%EXT_DIR%"
)

xcopy "%~dp0*" "%EXT_DIR%\" /E /I /Y >nul

echo ✅ 扩展安装成功！
echo 👉 请在 VS Code 中按 Ctrl+Shift+P，输入 "Reload Window"（重新加载窗口）后即可使用！
pause
