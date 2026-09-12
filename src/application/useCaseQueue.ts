type AsyncUseCase<T> = () => Promise<T>;

/**
 * 业务用例执行串行互斥队列 (Use Case Execution Queue)
 * 职责：单写者串行化调度模型，彻底阻断用户多命令连击、文件 Watcher、断点反向同步与调试会话启动等多源并发导致的用例交错竞态
 * 零外部依赖，纯 TypeScript 实现
 */
export class UseCaseQueue {
	private currentQueue: Promise<any> = Promise.resolve();

	/**
	 * 将异步业务用例入队排队执行
	 * 前一个用例无论成功还是失败，后续用例均能依次执行，不会产生隐式阻塞，且结果正确返回给调用者
	 */
	public run<T>(useCase: AsyncUseCase<T>): Promise<T> {
		const result = this.currentQueue.then(useCase, useCase);
		this.currentQueue = result.catch(() => {});
		return result;
	}
}

export const useCaseQueue = new UseCaseQueue();
