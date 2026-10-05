/**
 * DAP 断点下发防回声与防竞态守卫 (DAP Echo Loop Guard)
 * 职责：专职负责在批量/单点装配 DAP 断点时建立短时互斥标记，防止宿主 onDidChangeBreakpoints 监听器误将自身注入识别为用户手工修改
 */
export class DapEchoGuard {
	private isApplying = false;
	private timeoutHandle?: NodeJS.Timeout;

	public isApplyingBreakpoints(): boolean {
		return this.isApplying;
	}

	public setApplying(applying: boolean): void {
		this.isApplying = applying;
		if (!applying && this.timeoutHandle) {
			clearTimeout(this.timeoutHandle);
			this.timeoutHandle = undefined;
		}
	}

	public reset(): void {
		this.setApplying(false);
	}

	public async withApplyingLock<T>(action: () => Promise<T>): Promise<T> {
		this.isApplying = true;
		if (this.timeoutHandle) {
			clearTimeout(this.timeoutHandle);
			this.timeoutHandle = undefined;
		}
		try {
			return await action();
		} finally {
			this.timeoutHandle = setTimeout(() => {
				this.isApplying = false;
				this.timeoutHandle = undefined;
			}, 150);
		}
	}
}

export const dapEchoGuard = new DapEchoGuard();
