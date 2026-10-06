# ADR-005: 引入场景组合引擎——声明态/展开态分离的完全多态 SceneStep 模型

## 状态

Accepted (2026-10-06)

## 背景

v1.1.0 前，场景（Scene）仅是断点的扁平集合。跨模块调试链路（认证 → 会话 → 业务）需要在每个场景中平铺重复断点：通用链路断点变更时需逐一修改所有引用它的场景，配置冗余且维护成本高。

需要"场景引用"机制：`{ "type": "scene", "name": "auth-core" }` 在声明位置将另一场景的全部断点组合进当前场景，激活时展开下发。

核心挑战：引用是"声明"而非"断点"。若让引用条目直接流入合并/自愈/DAP 管道，会破坏 INV-001/INV-011 的断点拓扑语义，且自愈回写无法确定应归属哪个场景（引用场景可能未被激活）。

## 方案选项

### 选项 A：激活时内联展开（管道外透传）

在 UI/命令层展开引用后，把纯断点数组传给既有管道。改动最小，但引用语义散落在各调用点；无法在编译期防止"未展开的声明世界直接消费"；树视图/溯源回写等需要区分引用身份的能力缺乏统一领域模型。

### 选项 B：完全多态 SceneStep（选定）

- 领域层引入 `SceneStep` 协议（`kind` / `matches` / `toJSON` / `toggle`），`Breakpoint` 与 `SceneRefItem`（`src/domain/types.ts`）双实现；`Scene` 内部持有 `SceneStep[]`，`getSteps(): SceneStep[]` 保留声明世界。
- 新增无状态领域服务 `src/domain/services/sceneResolver.ts`：深度优先展开引用为纯断点流（`ExpandResult { steps, warnings }`），成环抛 `CircularReferenceError`，悬空/禁用降级为 warning。
- 激活管道（`src/application/sceneActivationPipeline.ts`）作为唯一**收窄点**：声明世界只进不流出，展开世界（`Breakpoint`）经收窄点产生，类型隔离在编译期强制。
- 自愈回写按 `ownerScene`（断点定义场景）路由，同源多引用至多回写一次。

## 决策

采用方案 B（设计基线：`docs/design/v1.1.0-scene-composition-engine.md` v2.0）。理由：

1. 引用身份成为领域一等公民，树视图嵌套投影、`revealRefSource`、引用启停等能力获得统一模型支撑；
2. 编译期类型隔离从机制上杜绝"绕过收窄点直接消费声明世界"，优于依赖人工约定；
3. resolver 为无状态纯函数（深度优先 + seen 全程持久的先到先得去重），复杂度可单测穷举（U1–U14 全矩阵）；
4. 黄金快照对照证明无引用场景激活行为零漂移，兼容性风险可控。

## 影响

- 新增不变量 **INV-030**（7 条子项，见 `constraints.md`）；GR-006/GR-007 适配引用条目形态。
- `SceneItem` DTO 联合类型扩展；`schema.json` 的 `scenes.items` 改为 oneOf 双分支（引用分支强制 `additionalProperties: false`）。
- 展开语义裁决：深度优先声明时序 100% 保真；跨根去重先到先得；`enabled: false` 分支先于悬空判断（禁用子树内悬空不产生警告）。
- 范围排除（v1.2.0+）：`type: "section"/"exception"` 节点、跨工作区引用（`folder` 字段预留）、`*.local.json`、调用栈固化。
