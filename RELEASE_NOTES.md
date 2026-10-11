## What's Changed in v1.3.0

### Added
- **Visual Graph Canvas for Scene Breakpoints (roadmap §5)**: the new `sceneBreakpoints.showGraph` command (command palette / status-bar menu / tree-view scene context menu) opens a read-only Webview canvas rendering the expanded execution-flow DAG of all active scenes — scene lanes (team/local layering), nested reference groups, and per-breakpoint nodes with type shapes, disabled translucency, and unmatched warning markers (INV-028, INV-030). Breakpoint types are encoded across three channels — shape (rectangle / tag / hexagon / cut-rectangle / octagon), label icon (● ≡ 💬 ＃ ƒ) and a desaturated semantic border color (GitHub-dark palette) on a unified dark node fill, with the live pulse and latest trace point using the VS Code breakpoint-red semantics.
- **Click-through Source Navigation**: clicking any canvas node (or trace marker) resolves through the snapshot's single-source nodeId resolver and reveals the target file with viewport centering plus a one-shot 800ms decoration highlight.
- **Live DAP Pulse & Hit Trace Timeline**: `debug:paused` events simultaneously pulse the matched execution-flow node and append a `TraceRecord` to the session-scoped trace buffer; `debug:resumed` clears the pulse but keeps the accumulated trace, and `debug:terminated` clears it entirely. The trace timeline renders as an inline-SVG scatter/line view exposing loop iterations and never-hit breakpoints. Traces are session-volatile: zero persistence, no JSON Schema changes.
- **One-click Mermaid Export**: the new `sceneBreakpoints.exportGraphMermaid` command (command palette / canvas button) copies a renderable `flowchart TD` document (nested lane subgraphs, unmatched ⚠ markers) to the clipboard with zero disk writes; a gentle info is shown when no scene is active.
- **Reactive Refresh & Safe Lifecycle**: scene changes rebuild and re-render the snapshot while preserving traces (stable `{ownerScene}#{index}` node ids keep trace remapping drift-free); panel disposal unsubscribes all event listeners in pairs, while the trace buffer lives independently until extension teardown.
- **Scene Scope Selector (canvas)**: the canvas now supports viewing **any** scene (including inactive ones) and arbitrary multi-scene combinations via a top multi-select scope bar (team/local layer-colored chips). "What is visible" (`visibleScenes`, user-selected, defaults to the active set) is decoupled from "what is active" (`activeScenes`); inactive scenes render in an inactive style (translucent + badge) with `registered` as a pure derived annotation, while live pulses and traces naturally only hit registered nodes. A scene whose expansion fails (circular reference) degrades to a dedicated warning lane listing the cycle path instead of rendering blank, and sibling scenes are isolated from the failure. Mermaid export is aligned with what the canvas shows (blocked only when no visible lanes remain); the scope is pure view state within the panel lifecycle and resets to follow the active set on reopen.
- **Native VS Code Codicon Alignment**: unified title-bar actions to standard Codicon `$(type-hierarchy)`, seamlessly matching native VS Code dark, light, and high-contrast themes.
- **AI Skill tutorial updated**: SKILL.md now covers the Visual Graph Canvas collaboration workflow (read-only canvas, Mermaid export for PRs/docs, session-volatile trace) and a new fingerprint is registered in the official history, so existing clean installs will receive the update prompt.

### Performance & Compatibility
- **AntV G6 5.x & Preact Component Architecture (ADR-008)**: the graph canvas engine migrated from Cytoscape to `@antv/g6` 5.x with a Preact-driven reactive UI architecture, bundled at build time via esbuild into `media/graph/g6-bundle.js` and `media/graph/graphWebview.js`. Production `dependencies` remain empty, with zero external CDN links (GR-012). The packaged VSIX measures **767.67 KB**, safely below the strict 1536 KB engineering budget ceiling (GR-001).

---

<details>
<summary><b>🇨🇳 简体中文更新说明 (点击展开)</b></summary>

### 新增 (Added)
- **场景断点可视化画布 (roadmap §5)**：新命令 `sceneBreakpoints.showGraph`（命令面板/状态栏菜单/树视图场景节点右键）打开只读 Webview 画布，以执行流 DAG 全景呈现全部激活场景的展开态——场景泳道（team/local 分层）、引用嵌套分组与逐断点节点（按断点类型区分形状、禁用半透明、脱靶警告标记）（INV-028、INV-030）。断点类型经"形状（矩形/tag/六边形/切角矩形/八边形）+ 标签图标（● ≡ 💬 ＃ ƒ）+ 降饱和语义描边色（GitHub Dark 色板）"三通道编码，节点底色统一暗色；Live 脉冲与轨迹 latest 点采用 VS Code 断点红语义。
- **点击直达源码**：点击画布上任意节点（或轨迹标记）经快照 nodeId 单点权威解析器命中 `{file, line}`，编辑器打开目标文件、目标行视口居中并一次性装饰高亮（800ms）。
- **Live DAP 脉冲与命中轨迹时间线**：`debug:paused` 事件同帧驱动执行流节点脉冲与命中轨迹追加（会话级 TraceRecord）；`debug:resumed` 熄灭脉冲但保留累积轨迹，`debug:terminated` 全量清空。轨迹时间线以内联 SVG 散点折线呈现循环轮次与从未命中的断点。轨迹会话级易失：零持久化、零 JSON Schema 变更。
- **一键 Mermaid 导出**：新命令 `sceneBreakpoints.exportGraphMermaid`（命令面板/画布内按钮）将可渲染的 `flowchart TD` 文档（泳道 subgraph 嵌套、unmatched ⚠ 标记）复制到剪贴板，磁盘零写盘；无激活场景时温和提示并终止。
- **响应式刷新与安全生命周期**：场景变更驱动快照重建与重渲染且轨迹保留（稳定 `{ownerScene}#{index}` 节点 id 保证轨迹重映射不漂移）；面板关闭成对退订全部事件订阅，轨迹缓冲独立存活至扩展卸载。
- **场景范围选择器（画布）**：画布支持查看**任意**场景（含未激活）与多场景组合——画布顶部新增场景多选范围条（team/local 分层着色 chips）。"看什么"（`visibleScenes`，用户选择，缺省 = 激活集）与"什么在生效"（`activeScenes`）正交解耦；未激活场景以未激活态渲染（半透明 + 角标），`registered` 为纯推导标注，Live 脉冲与命中轨迹天然只命中已登记节点。展开失败的场景（引用成环）降级为独立警告泳道并列出环路径，不再静默空白，同批其他可见场景互不拖垮；Mermaid 导出对齐画布所见即所得（仅在可见泳道为空时拦截）。Scope 为面板生命周期内的纯视图状态，面板关闭后重置为跟随激活集。
- **原生 VS Code Codicon 图标对齐**：侧边栏标题栏拓扑入口统一使用官方原生 Codicon `$(type-hierarchy)`，完美自适应深色、浅色及高对比度主题。
- **AI Skill 教程更新**：SKILL.md 新增可视化画布协同话术（只读画布、Mermaid 导出贴入 PR/文档、轨迹会话级易失）；新指纹已登记官方史表，存量纯净版安装将收到更新提示。

### 性能与兼容 (Performance & Compatibility)
- **AntV G6 5.x 与 Preact 组件架构演进 (ADR-008)**：画布渲染引擎全面升级为 `@antv/g6` 5.x 并采用 Preact 响应式组件架构，构建期经 esbuild 打包为 `media/graph/g6-bundle.js` 与 `media/graph/graphWebview.js`——生产 `dependencies` 保持为空、零 CDN 外链（GR-012），打包实测 VSIX **767.67 KB**，远低于 1536 KB 硬上限（GR-001）。

</details>