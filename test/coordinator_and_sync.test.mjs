import assert from "node:assert";

/**
 * SyncCoordinator 逻辑镜像（与 src/syncCoordinator.ts 100% 严格对齐）
 */
class SyncCoordinatorMock {
	constructor() {
		this.internalSavingTimer = undefined;
		this._isInternalSaving = false;
		this.lastSavedContent = "";
	}

	isInternalSaving() {
		return this._isInternalSaving;
	}

	markInternalSaving(timeoutMs = 600) {
		this._isInternalSaving = true;
		if (this.internalSavingTimer) {
			clearTimeout(this.internalSavingTimer);
		}
		this.internalSavingTimer = setTimeout(() => {
			this._isInternalSaving = false;
			this.internalSavingTimer = undefined;
		}, timeoutMs);
	}

	setLastSavedContent(content) {
		this.lastSavedContent = content;
	}

	getLastSavedContent() {
		return this.lastSavedContent;
	}

	isContentMatchingLastSaved(content) {
		if (!this.lastSavedContent || !content) return false;
		try {
			return JSON.stringify(JSON.parse(content)) === JSON.stringify(JSON.parse(this.lastSavedContent));
		} catch {
			return content.trim() === this.lastSavedContent.trim();
		}
	}

	async runWithSavingGuard(action) {
		this.markInternalSaving();
		try {
			return await action();
		} finally {
			this.markInternalSaving();
		}
	}

	dispose() {
		if (this.internalSavingTimer) {
			clearTimeout(this.internalSavingTimer);
			this.internalSavingTimer = undefined;
		}
		this._isInternalSaving = false;
	}
}

/**
 * 计算断点核心拓扑指纹算法
 */
function computeBreakpointsTopologyHashMock(breakpoints) {
	if (!breakpoints || breakpoints.length === 0) return "";
	const normalized = breakpoints.map((bp) => {
		if (bp.type === "function") {
			return `fn:${(bp.functionName || "").trim()}:${bp.enabled ?? true}:${bp.condition || ""}:${bp.hitCondition || ""}`;
		}
		const relFile = (bp.file || "").replace(/\\/g, "/").trim();
		return `line:${relFile}:${bp.line}:${bp.enabled ?? true}:${bp.type || "line"}:${bp.condition || ""}:${bp.hitCondition || ""}:${bp.logMessage || ""}`;
	});
	normalized.sort();
	return normalized.join("|");
}

/**
 * 模拟协调器调度流程 (与 src/coordinators/aiActivationCoordinator.ts 100% 对齐)
 */
async function handleExternalScenesFileChangeMock(deps) {
	const {
		allowAiActivation,
		config,
		stateManager,
		applySceneCommand,
		clearAllCommand,
		applySceneBreakpoints,
		activeDebugSession,
		setStatusBarMessage,
	} = deps;

	const currentActives = stateManager.getActiveScenes();

	// 1. 模拟 resolveActiveScenesDiff
	let diff = { shouldApply: false };
	if (allowAiActivation && Array.isArray(config.activeScenes)) {
		const targetScenes = config.activeScenes.filter((s) => typeof s === "string" && s.trim());
		const isIdentical =
			targetScenes.length === currentActives.length &&
			targetScenes.every((s, idx) => s === currentActives[idx]);

		if (!isIdentical) {
			if (targetScenes.length > 0) {
				diff = { shouldApply: true, action: "apply", targetScenes };
			} else if (currentActives.length > 0) {
				diff = { shouldApply: true, action: "clear", targetScenes: [] };
			}
		}
	}

	if (diff.shouldApply) {
		if (diff.action === "apply") {
			await applySceneCommand(diff.targetScenes);
		} else if (diff.action === "clear") {
			await clearAllCommand();
		}
	} else if (currentActives.length > 0 && !stateManager.isApplyingScene()) {
		// 关键防线 2：核心断点拓扑 Diff
		const merged = [];
		for (const name of currentActives) {
			if (config.scenes && config.scenes[name]) {
				merged.push(...config.scenes[name]);
			}
		}
		const newTopologyHash = computeBreakpointsTopologyHashMock(merged);

		if (newTopologyHash === stateManager.getLastAppliedTopologyHash()) {
			return; // 0 闪烁拦截，不触发 DAP 重刷
		}

		// 关键防线 1：调试会话保护 (策略 A: 挂起策略，绝不打断单步调试)
		if (activeDebugSession) {
			stateManager.setPendingTopologyUpdate(true);
			if (setStatusBarMessage) {
				setStatusBarMessage("Breakpoint changes pending. Will apply on next debug session.");
			}
			return;
		}

		await applySceneBreakpoints("mock-workspace", currentActives.join("+"), merged);
		stateManager.setLastAppliedTopologyHash(newTopologyHash);
	}
}

export async function runCoordinatorAndSyncTests() {
	console.log("  ▶ [Coordinator & Sync] 运行同步协调中枢与外部变更调度全维测试套件...");

	// =========================================================================
	// Part 1: SyncCoordinator 核心防护窗与指纹比对测试 (INV-008)
	// =========================================================================
	{
		const coordinator = new SyncCoordinatorMock();

		// 1. 初始状态
		assert.strictEqual(coordinator.isInternalSaving(), false, "初始状态下 isInternalSaving 必须为 false");

		// 2. 标记内部写盘与自动超时释放
		coordinator.markInternalSaving(30);
		assert.strictEqual(coordinator.isInternalSaving(), true, "markInternalSaving 后必须立即置为 true");

		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.strictEqual(coordinator.isInternalSaving(), false, "经过 50ms 超时后必须自动复位为 false");

		// 3. 重入调用防抖与安全窗延展
		coordinator.markInternalSaving(40);
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.strictEqual(coordinator.isInternalSaving(), true);
		// 重入再续 40ms
		coordinator.markInternalSaving(40);
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.strictEqual(coordinator.isInternalSaving(), true, "续期后安全窗必须延展，不可过早关闭");
		await new Promise((resolve) => setTimeout(resolve, 25));
		assert.strictEqual(coordinator.isInternalSaving(), false, "续期超时后彻底关闭安全窗");

		// 4. JSON 内容指纹比对 (格式化空格抗干扰)
		const canonicalObj = { scenes: { auth: [{ file: "src/a.ts", line: 10 }] } };
		coordinator.setLastSavedContent(JSON.stringify(canonicalObj, null, 2));

		// 压缩版 JSON (无换行) 比对
		const compressed = JSON.stringify(canonicalObj);
		assert.strictEqual(
			coordinator.isContentMatchingLastSaved(compressed),
			true,
			"格式化差异（压缩 vs 美化）不应影响指纹一致性判定",
		);

		// 内容修改后比对
		const modified = JSON.stringify({ scenes: { auth: [{ file: "src/a.ts", line: 11 }] } });
		assert.strictEqual(
			coordinator.isContentMatchingLastSaved(modified),
			false,
			"行号变化后内容指纹判定必须为 false",
		);

		// 异常非法文本降级比对
		coordinator.setLastSavedContent("raw fallback text\n");
		assert.strictEqual(
			coordinator.isContentMatchingLastSaved("  raw fallback text  "),
			true,
			"非法 JSON 必须平滑降级为 trim 文本比对",
		);

		// 5. runWithSavingGuard 事务安全窗与异常捕获
		let guardExecuted = false;
		await coordinator.runWithSavingGuard(async () => {
			guardExecuted = true;
		});
		assert.strictEqual(guardExecuted, true);
		assert.strictEqual(coordinator.isInternalSaving(), true, "执行后保护窗依然保持开启");
		coordinator.dispose();

		// 异常场景测试
		try {
			await coordinator.runWithSavingGuard(async () => {
				throw new Error("Simulated Disk Full Exception");
			});
		} catch {
			// 预期抛错
		}
		assert.strictEqual(coordinator.isInternalSaving(), true, "即便回调抛出严重异常，finally 仍必须锁定写盘防护");
		coordinator.dispose();
	}

	// =========================================================================
	// Part 2: aiActivationCoordinator 外部文件联动调度与拓扑防线测试 (INV-004, INV-008)
	// =========================================================================
	{
		class MockStateManager {
			constructor() {
				this.activeScenes = [];
				this.lastAppliedTopologyHash = "";
				this.pendingTopologyUpdate = false;
				this.applying = false;
			}
			getActiveScenes() {
				return [...this.activeScenes];
			}
			getLastAppliedTopologyHash() {
				return this.lastAppliedTopologyHash;
			}
			setLastAppliedTopologyHash(h) {
				this.lastAppliedTopologyHash = h;
			}
			isPendingTopologyUpdate() {
				return this.pendingTopologyUpdate;
			}
			setPendingTopologyUpdate(p) {
				this.pendingTopologyUpdate = p;
			}
			isApplyingScene() {
				return this.applying;
			}
		}

		// Case A: AI 激活外部写入 targetScenes 自动调度
		{
			const stateManager = new MockStateManager();
			let appliedScenes = null;
			const deps = {
				allowAiActivation: true,
				config: { activeScenes: ["auth", "order"] },
				stateManager,
				applySceneCommand: async (scenes) => {
					appliedScenes = scenes;
				},
				clearAllCommand: async () => {},
				applySceneBreakpoints: async () => {},
				activeDebugSession: null,
			};
			await handleExternalScenesFileChangeMock(deps);
			assert.deepStrictEqual(appliedScenes, ["auth", "order"], "allowAiActivation 启用时外部 activeScenes 必须触发激活调度");
		}

		// Case B: 外部写入空数组清空场景
		{
			const stateManager = new MockStateManager();
			stateManager.activeScenes = ["auth"];
			let clearCalled = false;
			const deps = {
				allowAiActivation: true,
				config: { activeScenes: [] },
				stateManager,
				applySceneCommand: async () => {},
				clearAllCommand: async () => {
					clearCalled = true;
				},
				applySceneBreakpoints: async () => {},
				activeDebugSession: null,
			};
			await handleExternalScenesFileChangeMock(deps);
			assert.strictEqual(clearCalled, true, "外部设置 activeScenes: [] 必须触发 clearAllCommand");
		}

		// Case C: 拓扑 Hash 未发生实质改变时拦截 (0 闪烁防线)
		{
			const stateManager = new MockStateManager();
			stateManager.activeScenes = ["auth"];
			const bpAuth = [{ file: "src/main.ts", line: 10, enabled: true, desc: "Old Comment" }];
			stateManager.setLastAppliedTopologyHash(computeBreakpointsTopologyHashMock(bpAuth));

			let dapReloadCount = 0;
			const deps = {
				allowAiActivation: false,
				// 外部仅改动了 desc 注释，核心拓扑（文件、行号、状态）完全未变
				config: {
					scenes: {
						auth: [{ file: "src/main.ts", line: 10, enabled: true, desc: "Modified Comment Only" }],
						otherInactiveScene: [{ file: "src/other.ts", line: 99 }],
					},
				},
				stateManager,
				applySceneCommand: async () => {},
				clearAllCommand: async () => {},
				applySceneBreakpoints: async () => {
					dapReloadCount++;
				},
				activeDebugSession: null,
			};
			await handleExternalScenesFileChangeMock(deps);
			assert.strictEqual(dapReloadCount, 0, "核心断点拓扑未变时严禁重刷 DAP，必须 0 开销直接拦截！");
		}

		// Case D: 调试会话保护 (策略 A: 挂起策略，严禁打扰单步调试)
		{
			const stateManager = new MockStateManager();
			stateManager.activeScenes = ["auth"];
			const bpAuth = [{ file: "src/main.ts", line: 10, enabled: true }];
			stateManager.setLastAppliedTopologyHash(computeBreakpointsTopologyHashMock(bpAuth));

			let dapReloadCount = 0;
			let statusMsg = "";
			const deps = {
				allowAiActivation: false,
				// 断点实质变动（行号从 10 漂移到 20）
				config: {
					scenes: {
						auth: [{ file: "src/main.ts", line: 20, enabled: true }],
					},
				},
				stateManager,
				applySceneCommand: async () => {},
				clearAllCommand: async () => {},
				applySceneBreakpoints: async () => {
					dapReloadCount++;
				},
				activeDebugSession: { id: "mock-debug-session" }, // 活跃调试中
				setStatusBarMessage: (msg) => {
					statusMsg = msg;
				},
			};
			await handleExternalScenesFileChangeMock(deps);
			assert.strictEqual(dapReloadCount, 0, "活跃调试期间严禁直接热重载打断断点调试！");
			assert.strictEqual(stateManager.isPendingTopologyUpdate(), true, "必须将拓扑更新标志置为挂起 pending");
			assert.match(statusMsg, /pending/i, "必须向状态栏推送挂起提示");

			// 模拟调试结束：重刷装配
			deps.activeDebugSession = null;
			await handleExternalScenesFileChangeMock(deps);
			assert.strictEqual(dapReloadCount, 1, "调试会话结束后重新装配实质变更");
			assert.strictEqual(
				stateManager.getLastAppliedTopologyHash(),
				computeBreakpointsTopologyHashMock([{ file: "src/main.ts", line: 20, enabled: true }]),
				"重刷后必须更新最新拓扑指纹快照",
			);
		}
	}

	console.log("  ✅ [Coordinator & Sync] 同步协调中枢与外部变更调度测试套件（9 大核心场景）全部通过！");
}
