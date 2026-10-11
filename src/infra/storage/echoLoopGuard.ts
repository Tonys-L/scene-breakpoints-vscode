/**
 * 基础设施层存储与断点事件防回声回环守卫 (EchoLoopGuard)
 * 职责：聚合管理本地磁盘持久化写盘状态、内容指纹比对与异步事件防护窗，消除外部文件监听与 DAP 断点变更的回声回环竞态
 * 遵循不变量：INV-008 断点全双工同步与死循环防回环守卫 (Echo Loop Guard)
 * v1.2.0：内容指纹基线升级为按键控 (per-file) Map，支持 team 主文件与 local 私有文件双基线独立隔离 (INV-032)
 */
const DEFAULT_CONTENT_KEY = "__default__";
export class EchoLoopGuard {
	private internalSavingTimer: NodeJS.Timeout | undefined;
	private _isInternalSaving = false;
	private lastSavedContentByKey = new Map<string, string>();

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
	 * 重置内部状态（供单元测试环境复位）
	 */
	public reset(): void {
		if (this.internalSavingTimer) {
			clearTimeout(this.internalSavingTimer);
			this.internalSavingTimer = undefined;
		}
		this._isInternalSaving = false;
		this.lastSavedContentByKey.clear();
	}

	/**
	 * 记录指定键控文件最新一次内部持久化写盘的内容指纹 (v1.2.0 分层配置)
	 */
	public setLastSavedContentForKey(key: string, content: string): void {
		this.lastSavedContentByKey.set(key, content);
	}

	public getLastSavedContentForKey(key: string): string {
		return this.lastSavedContentByKey.get(key) ?? "";
	}

	/**
	 * 记录最新一次内部持久化写盘的文件内容指纹（默认键，向后兼容主文件）
	 */
	public setLastSavedContent(content: string): void {
		this.setLastSavedContentForKey(DEFAULT_CONTENT_KEY, content);
	}

	public getLastSavedContent(): string {
		return this.getLastSavedContentForKey(DEFAULT_CONTENT_KEY);
	}

	/**
	 * 冷启动基线播种 (INV-031 前置)
	 * 扩展启动时若指定键从未发生过内部写盘（基线为空），以磁盘现状播种基线，
	 * 保证 Git Pull / 环境漂移在冷启动后仍可静默自愈，不误判为外部编辑冲突
	 */
	public seedBaselineForKey(key: string, content: string): void {
		if (this.getLastSavedContentForKey(key) || !content) return;
		this.lastSavedContentByKey.set(key, content);
	}

	public seedBaseline(content: string): void {
		this.seedBaselineForKey(DEFAULT_CONTENT_KEY, content);
	}

	/**
	 * 判定磁盘内容是否相对指定键最近一次内部写盘基线发生外部修改 (INV-031 门控信号)
	 * 无基线（冷启动未播种）或空内容时一律返回 false，防止冷启动误伤
	 */
	public isDiskContentModifiedSinceLastSaveForKey(key: string, content: string): boolean {
		if (!content || !this.getLastSavedContentForKey(key)) return false;
		return !this.isContentMatchingLastSavedForKey(key, content);
	}

	public isDiskContentModifiedSinceLastSave(content: string): boolean {
		return this.isDiskContentModifiedSinceLastSaveForKey(DEFAULT_CONTENT_KEY, content);
	}

	/**
	 * 比对磁盘传入内容是否与指定键最新内部写盘内容完全一致（用于拦截自身 fileWatcher 回环）
	 */
	public isContentMatchingLastSavedForKey(key: string, content: string): boolean {
		const baseline = this.getLastSavedContentForKey(key);
		if (!baseline || !content) return false;
		try {
			// 规范化去除空白字符比对 JSON 内容语义
			return JSON.stringify(JSON.parse(content)) === JSON.stringify(JSON.parse(baseline));
		} catch {
			return content.trim() === baseline.trim();
		}
	}

	public isContentMatchingLastSaved(content: string): boolean {
		return this.isContentMatchingLastSavedForKey(DEFAULT_CONTENT_KEY, content);
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

