# ADR-003: 引入全局单写者可重入串行队列消除多管理器并发写竞态与自死锁

## 状态
Accepted

## 背景
先前架构中，`SceneManager`、`BreakpointManager` 和 `AgentSyncService` 各自实例化了独立的 `new SerialQueue()`。当外部文件变更感知（`AgentSyncService`）、用户断点操作（`BreakpointManager`）或场景切换（`SceneManager`）几乎同时发生时，由于运行在不同的队列上，会并发读写磁盘 `.vscode/debug-scenes.json`，存在写脏覆盖与打破 INV-010 单向回写时序保证的隐患。然而，若直接粗暴共享单个简单 Promise 队列，跨管理器调用链路（例如 `AgentSyncService.handleExternalChange` 触发 `SceneManager.activateScene`）会因为内层任务排在外层任务之后而引发经典队列自死锁（Deadlock）。

## 方案选项

### 选项 A：各模块维持独立队列并在调用前暴露锁状态
- **优点**：改动小。
- **缺点**：治标不治本，无法根除偶发的并发竞态与读写覆盖。

### 选项 B：统一使用全局 `applicationSerialQueue` 并依托 Node.js 原生 `AsyncLocalStorage` 赋予可重入能力 (本方案)
- **优点**：
  1. **物理单写者保证**：全工程所有对持久化 SSOT 的写操作统一汇入单一串行管道，彻底根绝数据覆盖；
  2. **同调用链安全可重入**：依托 Node.js 原生内置的 `AsyncLocalStorage` 探测执行上下文，若当前异步链已持有单写者锁，直接就地放行，零死锁风险；
  3. **零外部重型依赖**：无需引入第三方并发锁库，保持极简原生代码。
- **缺点**：需确保所有应用写操作统一注入或使用默认的 `applicationSerialQueue`。

## 决策
选择 **选项 B**。实现于 `src/application/serialQueue.ts`，并在 `SceneManager`、`BreakpointManager` 与 `AgentSyncService` 中默认使用 `applicationSerialQueue`。

## 影响
1. 真正物理落地 INV-010 单写者物理互斥保证；
2. 彻底消除多管理器跨模块调用时的队列自死锁隐患；
3. 为应用层统一事务管道与深模块演进奠定坚固的并发安全基石。
