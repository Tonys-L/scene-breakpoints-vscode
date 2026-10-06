/**
 * 调试暂停态捕获上下文 (v1.2.0 Capture Call Stack)
 * 会话在断点命中/单步暂停期间登记活动会话与暂停线程，供调用栈固化命令查询；
 * 继续执行或会话终止即刻清除，杜绝在运行态误取陈旧堆栈。
 * 归属应用层：infra 监听器写入、UI 命令读取，保持依赖方向合规（ui → application ← infra）。
 */

/** DAP 会话最小契约：仅需通过 customRequest 读取堆栈，避免应用层依赖宿主类型 */
export interface CapturablePauseContext {
	session: { customRequest: (command: string, args: unknown) => PromiseLike<unknown> };
	threadId: number;
}

let capturablePause: CapturablePauseContext | undefined;

export function setCapturablePauseContext(context: CapturablePauseContext | undefined): void {
	capturablePause = context;
}

export function getCapturablePauseContext(): CapturablePauseContext | undefined {
	return capturablePause;
}
