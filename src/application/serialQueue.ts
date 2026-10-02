/**
 * 单写者串行互斥队列 (Single-Writer Serial Queue Guard)
 * 职责：确保写盘、自愈回填等用例操作严格按序排队执行，彻底杜绝并发写冲突 (INV-010)
 */
export class SerialQueue {
	private queue: Promise<unknown> = Promise.resolve();

	/**
	 * 将异步任务放入串行队列执行
	 */
	public enqueue<T>(task: () => Promise<T>): Promise<T> {
		const result = this.queue.then(() => task());
		this.queue = result.catch(() => {});
		return result;
	}
}
