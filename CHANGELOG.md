# Change Log

All notable changes to the "scene-breakpoints-vscode" extension will be documented in this file.

Check [Keep a Changelog](https://keepachangelog.com/) for recommendations on how to structure this file.

---

## [1.0.0] - 首发版本 (2026-09-08)

### Added
- **场景化断点分组管理**：按业务场景组织断点，一键切换、自动隔离清理无关断点。
- **代码漂移自愈**：代码改了行号变了？自动找回断点正确位置。
- **侧边栏树视图**：专属面板管理所有场景，支持复选框直接启用/禁用断点。
- **全类型断点支持**：行断点、条件断点、命中计数、Logpoint、函数断点全覆盖。
- **launch.json 自动联动**：启动调试时自动激活关联的场景断点。
- **断点双向实时同步**：编辑器里改了断点，场景自动更新；场景切换了，编辑器自动跟上。
- **多场景自由叠加**：同时激活多个场景，断点自动去重合并。
- **一键导出与导入**：当前断点导出为场景，或通过剪贴板分享给团队。
- **CodeLens 快捷入口**：在 `debug-scenes.json` 中直接点击 `▶ Apply Scene` 激活。
- **中英文双语自适应**：跟随 VS Code 语言设置自动切换。
- **声明式 JSON 配置**：`.vscode/debug-scenes.json` 随 Git 版本化，带 JSON Schema 校验。
