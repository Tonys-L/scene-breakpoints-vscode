/**
 * 基础设施层存储与断点事件防回声回环守卫 (EchoLoopGuard)
 * 职责：聚合管理本地磁盘持久化写盘状态、内容指纹比对与异步事件防护窗，消除外部文件监听与 DAP 断点变更的回声回环竞态
 * 遵循不变量：INV-008 断点全双工同步与死循环防回环守卫 (Echo Loop Guard)
 */
export class EchoLoopGuard {
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
	 * 冷启动基线播种 (INV-031 前置)
	 * 扩展启动时若从未发生过内部写盘（lastSavedContent 为空），以磁盘现状播种基线，
	 * 保证 Git Pull / 环境漂移在冷启动后仍可静默自愈，不误判为外部编辑冲突
	 */
	public seedBaseline(content: string): void {
		if (this.lastSavedContent || !content) return;
		this.lastSavedContent = content;
	}

	/**
	 * 判定磁盘内容是否相对最近一次内部写盘基线发生外部修改 (INV-031 门控信号)
	 * 无基线（冷启动未播种）或空内容时一律返回 false，防止冷启动误伤
	 */
	public isDiskContentModifiedSinceLastSave(content: string): boolean {
		if (!content || !this.lastSavedContent) return false;
		return !this.isContentMatchingLastSaved(content);
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

export const echoLoopGuard = new EchoLoopGuard();

