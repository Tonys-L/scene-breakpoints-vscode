## What's Changed in v1.4.0

### Added
- **Permanent Secondary Side Bar Dashboard (ViewContainer & WebviewViewProvider)**: the Scene Breakpoints graph canvas is now available directly in the Secondary Side Bar (`sceneBreakpointsGraphView`) as an always-accessible dashboard, fully preventing the canvas from crowding out the primary editor tabs.
- **Full-screen Canvas Escape Hatch**: a dedicated title-bar button (`sceneBreakpoints.openGraphInEditor`) allows expanding the canvas into an independent full-screen editor tab whenever large-scale topology analysis is required.
- **Interactive Scene Selector Popover**: replaced static scope chips with an elegant 100% opaque dark Popover dropdown menu supporting instant search, quick select all / clear, and clean active/inactive status badges.
- **Instant Single-Scene Activation**: when inspecting a single inactive scene on the canvas, an "Activate Scene" action immediately activates the scene and registers its breakpoints into VS Code DAP.

### Improved & Fixed
- **Seamless Viewport Auto-Resize & Zoom Healing**: resolved an issue where dragging and widening the Secondary Side Bar left the canvas clipped at the old width until a manual refresh was clicked. Dual-channel `window.resize` and `ResizeObserver` listeners now instantly scale the G6 canvas layer without clipping or threshold dropouts.
- **Codicon & Toolbar Alignment**: unified toolbar icons to native VS Code Codicons (`$(screen-full)`, `$(export)`, `$(type-hierarchy)`), removed duplicate export buttons, and kept card widths at a clean, compact 240px.

---

<details>
<summary><b>🇨🇳 简体中文更新说明 (点击展开)</b></summary>

### 新增 (Added)
- **常驻副侧边栏架构画布（ViewContainer & WebviewViewProvider）**：场景断点架构图谱全面入驻 VS Code 副侧边栏（`sceneBreakpointsGraphView`）常驻呈现，告别挤占主代码编辑区的痛点，形成左侧源码、右侧拓扑的双屏伴随视图。
- **全屏独立编辑器逃生门**：标题栏新增全屏切换按钮（`sceneBreakpoints.openGraphInEditor`），复杂场景一键展开为独立全屏编辑器 Tab 深入探索。
- **场景选择下拉交互 Popover**：重构场景范围选择器，由静态标签升级为 100% 暗色不透明 Popover 浮层面板，支持实时输入检索过滤、全选/清空快捷操作及激活状态指示。
- **未激活单场景一键快速激活**：当画布处于单个未激活场景分析时，顶栏直观呈现“激活场景”按钮，一键快速将其断点注册入 VS Code DAP 调试会话。

### 优化与修复 (Improved & Fixed)
- **副侧边栏自适应视口自愈与无缝缩放**：彻底根治拉宽副侧边栏时画布视口未自适应导致缩放卡片被旧视口截断遮挡的缺陷。引入原生 `window.resize` 与 `document.body`/容器双向 `ResizeObserver`，拖动瞬间实时驱动 G6 图层撑满视口，松手后对齐刷新行为无感重绘。
- **原生 Codicon 统一与卡片精致排版**：标题栏动作按钮全量对齐原生 Codicon（`$(screen-full)`、`$(export)`、`$(type-hierarchy)`），去除重复 Mermaid 导出入口，断点卡片保持 240px 紧凑精致规范。

</details>