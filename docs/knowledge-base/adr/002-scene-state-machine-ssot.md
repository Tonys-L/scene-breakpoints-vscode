# ADR-002: 引入独立 SceneStateManager 实现 SSOT 并消除状态栏竞态闪烁

## 状态
Accepted

## 背景
先前设计中，全局激活场景 `currentActiveScene` 保存在 UI 组件 `statusBar.ts` 内部。在切换场景时，`applySceneBreakpoints` 会先调用 `removeBreakpoints()` 清空旧断点，瞬间触发 VS Code 原生 `onDidChangeBreakpoints` 监听器，误将状态栏重置为 `(None)`，造成明显的视觉闪烁；且其他命令直接修改 UI 状态违反了单一职责原则（SRP）。

## 方案选项

### 选项 A：在 `statusBar.ts` 内部加 `setTimeout` 防抖
- **优点**：改动极小。
- **缺点**：治标不治本，仍未解决 UI 模块兼职做状态存储的架构耦合。

### 选项 B：创建独立 `SceneStateManager` + 原子锁 + 响应式发布订阅 (本方案)
- **优点**：
  1. 符合单一事实来源（SSOT）与单向数据流；
  2. 状态机提供 `isApplyingScene` 原子锁，保护下发期间不被事件打断；
  3. `statusBar.ts` 纯粹退化为无状态视图（View），仅被动监听渲染。

## 决策
采纳 **选项 B**。实现于 `src/sceneStateManager.ts`。

## 影响
彻底消除状态栏竞态闪烁，模块职责解耦，架构健壮性达到工业级水准。
