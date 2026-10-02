import type { IBreakpointBridge, ApplySceneResult } from "#src/domain/ports/breakpointBridge";
import { applySceneBreakpoints } from "./bridge/dapDiffApplier";
import { collectCurrentBreakpoints } from "./bridge/dapBreakpointCollector";
import {
	applySingleBreakpointToEditor,
	clearAllBreakpoints,
	syncBreakpointEnabledToEditor,
} from "./bridge/dapStateSynchronizer";

export type { ApplySceneResult };
export {
	applySceneBreakpoints,
	collectCurrentBreakpoints,
	applySingleBreakpointToEditor,
	clearAllBreakpoints,
	syncBreakpointEnabledToEditor,
};

/**
 * VS Code DAP 调试断点适配器门面 (Facade)
 * 聚合 DiffApplier / Collector / Synchronizer 子模块，实现 IBreakpointBridge 领域端口契约
 */
export const vscodeBreakpointBridge: IBreakpointBridge = {
	applySceneBreakpoints,
	collectCurrentBreakpoints,
	clearAllBreakpoints,
	applySingleBreakpointToEditor,
	syncBreakpointEnabledToEditor,
};
