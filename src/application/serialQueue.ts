import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 单写者串行互斥队列 (Single-Writer Serial Queue Guard)
 * 职责：确保写盘、自愈回填等用例操作严格按序排队执行，彻底杜绝并发写冲突 (INV-010)
 * 特性：依托 AsyncLocalStorage 实现同上下文安全可重入 (Reentrant)，防止嵌套调用自死锁
 */
export class SerialQueue {
	private queue: Promise<unknown> = Promise.resolve();
	private readonly storage = new AsyncLocalStorage<boolean>();

	/**
	 * 将异步任务放入串行队列执行
	 */
	public enqueue<T>(task: () => Promise<T>): Promise<T> {
		if (this.storage.getStore()) {
			return task();
		}

		const result = this.queue.then(() => this.storage.run(true, () => task()));
		this.queue = result.catch(() => {});
		return result;
	}
}

/**
 * 应用层全局唯一单写者串行互斥队列单例 (Canonical Single-Writer Serial Queue - INV-010)
 */
export const applicationSerialQueue = new SerialQueue();
