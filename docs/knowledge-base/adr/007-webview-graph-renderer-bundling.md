# ADR-007: 可视化画布渲染库选型 cytoscape + cytoscape-dagre，构建期打包为零运行时依赖的本地静态资源

## 状态

Accepted（2026-10-07，v1.3.0 批次 B5 归档）

## 背景

v1.3.0「场景断点可视化」需要执行流 DAG 分层布局渲染。项目存在两条刚性约束：

- **GR-001**：VSIX 体积 ≤ 500 KB，且 webview 资源按 zip 压缩体积计入；
- **零外部生产运行时依赖**：`package.json` 的生产 `dependencies` 必须保持为空（工程与构建约束）；
- **GR-012**：分发包零 CDN 外链，全部本地资源。

候选方案（mermaid / cytoscape / cytoscape+dagre）的体积数据经 esbuild 实测留档（见设计文档 §0.1，禁止心算臆断）：mermaid 全量 minify 5130.1 KB 直接击穿 GR-001；cytoscape+dagre minify 478.6 KB、zip 压缩 154.2 KB。

## 方案选项

### 选项 A：mermaid 运行时渲染
- 优点：DAG 语法声明式，社区生态大。
- 缺点：产物 5.1 MB 击穿 GR-001；渲染引擎黑盒，节点交互（点击跳转、单节点脉冲）定制困难。

### 选项 B：webview 内联手写 SVG
- 优点：零依赖零体积。
- 缺点：DAG 分层布局算法需自研（违反"算法优先成熟第三方"纪律）。

### 选项 C（选定）：cytoscape + cytoscape-dagre 以 devDependency 引入，构建期 esbuild 打包为 `media/graph/cytoscape-bundle.js` 本地静态资源
- 优点：成熟第三方布局算法；生产 `dependencies` 保持为空；webview 沙箱隔离渲染（扩展主进程零图形库依赖）；产物 154.2 KB（zip）可控。
- 缺点：VSIX 体积实测增至 327.13 KB（仍 ≤ 500 KB，GR-001 达标）；需维护构建脚本 `scripts/build-graph-bundle.mjs`。

## 决策

选选项 C。要点：

1. cytoscape 3.34.3 与 cytoscape-dagre 4.0.1 **仅作 devDependency**，由 `scripts/build-graph-bundle.mjs` 在构建期以 esbuild `--bundle --minify --format=iife` 打包为 `media/graph/cytoscape-bundle.js`（实测 478.6 KB）；
2. webview CSP `script-src {webview.cspSource}` 加载本地 bundle，**严禁 CDN**（GR-012）；命中轨迹视图（TraceView）演进为**垂直时间轴流水线（Vertical Timeline）**，基于两行结构化卡片与循环节智能折叠纯算法（`timelineCollapse`），杜绝折线排版冲突，零新增图形库；
3. Mermaid 降级为**纯导出格式**：`exportGraphToMermaid` 纯函数生成文本写剪贴板（零落盘），运行时零 mermaid 依赖；
4. 渲染行为（cytoscape/SVG）留在 webview 沙箱，不做单测；业务逻辑全量下沉至纯函数（投影/导出器）与应用层（traceBuffer），1:1 镜像单测覆盖。

## 影响

- **体积**：VSIX 实测 327.13 KB ≤ 500 KB（GR-001 达标，B4 `vsce package` 留档）；后续升级渲染库版本需复测并更新留档数值；
- **依赖纪律**：生产 `dependencies` 保持为空不破坏；渲染库升级仅影响构建期，需重跑 `build-graph-bundle.mjs`；
- **架构**：cytoscape 仅存在于 webview 沙箱，四层依赖方向零侵入；`GraphSnapshot`/`TraceRecord` 为纯数据契约，为跨 IDE 复用预留架构红利；
- **回滚**：全部为新增文件 + 构建脚本 + devDependency，删除即回滚，零侵入既有路径。
