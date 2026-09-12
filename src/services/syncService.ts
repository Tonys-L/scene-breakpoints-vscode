/**
 * 同步协调中枢 (SyncCoordinator)
 * 职责：聚合管理内部持久化写盘状态、内容指纹比对与异步事件防护窗，消除竞态与重复回环重绘
 */
export class SyncCoordinator {
	private internalSavingTimer: NodeJS.Timeout | undefined;
	private _isInternalSaving = false;
	private lastSavedContent = "";

	/**
	 * 当前是否正处于扩展内部写盘保护周期内
	 */
	public isInternalSaving(): boolean {
		return this._isInternalSaving;
	}

	/**
	 * 显式标记内部写盘行为，并启动延时安全释放窗口
	 */
	public markInternalSaving(timeoutMs = 600): void {
		this._isInternalSaving = true;
		if (this.internalSavingTimer) {
			clearTimeout(this.internalSavingTimer);
		}
		this.internalSavingTimer = setTimeout(() => {
			this._isInternalSaving = false;
			this.internalSavingTimer = undefined;
		}, timeoutMs);
	}

	/**
	 * 记录最新一次内部持久化写盘的文件内容指纹
	 */
	public setLastSavedContent(content: string): void {
		this.lastSavedContent = content;
	}

	public getLastSavedContent(): string {
		return this.lastSavedContent;
	}

	/**
	 * 比对磁盘传入内容是否与扩展最新内部写盘内容完全一致（用于拦截自身 fileWatcher 回环）
	 */
	public isContentMatchingLastSaved(content: string): boolean {
		if (!this.lastSavedContent || !content) return false;
		try {
			// 规范化去除空白字符比对 JSON 内容语义
			return JSON.stringify(JSON.parse(content)) === JSON.stringify(JSON.parse(this.lastSavedContent));
		} catch {
			return content.trim() === this.lastSavedContent.trim();
		}
	}

	/**
	 * 事务化执行内部保存操作，自动包裹指纹记录与安全窗
	 */
	public async runWithSavingGuard<T>(action: () => Promise<T> | T): Promise<T> {
		this.markInternalSaving();
		try {
			return await action();
		} finally {
			// 确保延时安全保护处于活跃状态
			this.markInternalSaving();
		}
	}
}

export const syncCoordinator = new SyncCoordinator();
export const syncService = syncCoordinator;
export { SyncCoordinator as SyncService };

