/**
 * 应用级事件总线 (Application Event Bus)
 * 职责：提供解耦的领域/应用状态变更广播通道，消除命令层与 UI 视图刷新之间的直接强耦合。
 */

export type ApplicationEventType =
	| "scenes:changed"
	| "scene:activated"
	| "breakpoints:changed"
	| "debug:paused"
	| "debug:resumed";

export interface ApplicationEventPayloads {
	"scenes:changed": { workspaceRoot: string; reason?: string };
	"scene:activated": { workspaceRoot: string; activeScenes: string[] };
	"breakpoints:changed": { workspaceRoot: string; sceneName?: string };
	"debug:paused": { file: string; line: number };
	"debug:resumed": { reason?: string } | undefined;
}

export type ApplicationEventListener<T extends ApplicationEventType> = (
	payload: ApplicationEventPayloads[T],
) => void;

export interface IDisposable {
	dispose(): void;
}

export class ApplicationEventBus {
	private readonly listeners = new Map<ApplicationEventType, Set<ApplicationEventListener<any>>>();

	/**
	 * 订阅指定类型的应用事件
	 */
	public on<T extends ApplicationEventType>(
		type: T,
		listener: ApplicationEventListener<T>,
	): IDisposable {
		let set = this.listeners.get(type);
		if (!set) {
			set = new Set();
			this.listeners.set(type, set);
		}
		set.add(listener);

		return {
			dispose: () => {
				const current = this.listeners.get(type);
				if (current) {
					current.delete(listener);
					if (current.size === 0) {
						this.listeners.delete(type);
					}
				}
			},
		};
	}

	/**
	 * 同步广播应用事件
	 */
	public emit<T extends ApplicationEventType>(
		type: T,
		payload: ApplicationEventPayloads[T],
	): void {
		const set = this.listeners.get(type);
		if (!set || set.size === 0) return;

		for (const listener of Array.from(set)) {
			try {
				listener(payload);
			} catch (err) {
				console.error(`[ApplicationEventBus] Error in listener for event "${type}":`, err);
			}
		}
	}

	/**
	 * 清空所有订阅者 (通常用于测试重置)
	 */
	public clear(): void {
		this.listeners.clear();
	}
}

export const appEventBus = new ApplicationEventBus();
