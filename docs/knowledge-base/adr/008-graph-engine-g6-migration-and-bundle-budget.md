# ADR-008: 场景图迁移至 AntV G6 v5 企业级图引擎与分发包体积门禁调整至 1.5MB

## 状态

Accepted（2026-10-11，v1.3.0 业务导读图重大演进）

## 背景

v1.3.0 引入了场景断点图形化画布，初步采用了 cytoscape + cytoscape-dagre 方案。然而在实际深入使用中暴露出三个根本性瓶颈：

1. **文字与几何形状错位**：Cytoscape 的 Canvas 字体度量在 CJK 长业务描述下测量失灵，出现“空框 + 悬浮文字”的观感缺陷，无法自适应不同系统字号；
2. **缺乏原生 Combo 嵌套折叠支持**：代码业务流程导读（Code Tour & Business Flow Map）的核心心智是**分层渐进式（宏观阶段 Pipeline → 微观断点步骤下钻）**，而 Cytoscape 缺少开箱即用的容器原地折叠展开能力；
3. **样式与主题胶水代码繁重**：Canvas 渲染无法直接使用 VS Code CSS 变量，深浅色主题适配成本高。

基于“**业务优先 > 职责优先 > 变更成本 > 简单优先**”的核心原则，以及“优先使用成熟现成工具，杜绝自研轮子风险”的明确裁决，决定将画布渲染引擎升级为 **AntV G6 v5**。

同时面临工程约束冲突：
- 原 `GR-001` 硬门禁要求 VSIX 安装包 $\le 500\text{ KB}$；
- G6 v5 经 esbuild 编译与 tree-shaking 后预估约 450~650 KB，总 VSIX 体积预计在 750 KB ~ 950 KB 之间，会触碰原 500 KB 门禁。

## 方案选项

### 选项 A：继续死守 500 KB 门禁，手写 DOM + SVG 连线
- 优点：包体积可控制在 400 KB 以内。
- 缺点：需自行编写节点拓扑布局算法、连线避让、缩放视口变换与拖拽视口，违背“成熟算法优先第三方”原则，极易出现边界 Bug，维护成本极高。

### 选项 B（选定）：引入 AntV G6 v5，发起 ADR 将 GR-001 上限放宽至 1.5 MB
- 优点：
  1. 开箱即用成熟的 Combo 分组折叠展开能力，完美支撑“阶段原地展开/收起”业务流程导读心智；
  2. 原生支持自适应 Dagre 布局、节点状态动画、富文本 Tooltip 与视口交互；
  3. 纯 JS API，完美适配现有 Preact Webview 架构；
  4. 保持**生产依赖为零（Zero Dependencies）**，G6 仅作 `devDependency` 在构建期被 esbuild 打包为本地 `media/graph/g6-bundle.js`，绝不引入外部 CDN（GR-012）。
- 缺点：VSIX 包体积增加约 400~600 KB，需将门禁放宽至 1.5 MB（在现代 VS Code 插件生态中，1.5 MB 依旧属于极致轻量级梯队）。

## 决策

选选项 B。执行要点：

1. **包体积门禁放宽**：修改 `scripts/verify-guardrails.mjs` 与 `docs/knowledge-base/constraints.md`，将 `GR-001 (INV-014)` 的 VSIX 上限由 500 KB 调整为 **1536 KB（1.5 MB）**；
2. **生产零依赖纪律不变**：`@antv/g6` 严格作为 `devDependency` 安装，禁止写入生产 `dependencies`；
3. **构建期独立打包**：在 `build.mjs` 中配置 G6 v5 的独立 esbuild 打包任务，生成本地静态资源 `media/graph/g6-bundle.js`，取代原有的 `cytoscape-bundle.js`；
4. **渐进披露与双屏伴随**：利用 G6 的 Combo 原地折叠展开支持大阶段 Pipeline；利用单击节点与 VS Code 编辑器伴随滚动联动（`preserveFocus: true`），实现“看图即看代码”的极致协同体验。

## 影响

- **工程构建**：`scripts/verify-guardrails.mjs` 中的 `MAX_ALLOWED_KB` 改为 1536；
- **安装包体积**：VSIX 预计增至 750 KB ~ 950 KB，完全在 1.5 MB 安全阈值内；
- **文档联动**：同步更新 `constraints.md`、`adr/README.md` 与相关流程文档；
- **平滑兼容**：TraceView 视图不受任何影响，继续使用轻量 DOM 垂直时间轴渲染；原 Cytoscape 资源在迁移完成后彻底移除，无历史技术债务遗留。
