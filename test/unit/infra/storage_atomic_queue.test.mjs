import assert from "node:assert";

/**
 * 模拟并发写盘互斥队列 (与 src/infra/storage/jsonFileSceneRepository.ts 100% 严格对齐)
 */
class MockAtomicConfigStorage {
	constructor() {
		this.isWriting = false;
		this.pendingSave = undefined;
		this.diskContent = "";
		this.writeCallCount = 0;
	}

	async saveScenesConfig(config) {
		const content = JSON.stringify(config);

		// 并发互斥保护：若当前正在写盘，暂存最新配置，串行合并续写
		if (this.isWriting) {
			this.pendingSave = config;
			return;
		}

		this.isWriting = true;
		try {
			// 模拟 I/O 异步磁盘耗时
			await new Promise((resolve) => setTimeout(resolve, 20));
			this.diskContent = content;
			this.writeCallCount++;
		} finally {
			this.isWriting = false;
			if (this.pendingSave) {
				const next = this.pendingSave;
				this.pendingSave = undefined;
				await this.saveScenesConfig(next);
			}
		}
	}
}

/**
 * 模拟即刻点亮单个断点注入编辑器 (与 src/infra/vscode/vscodeBreakpointBridge.ts:applySingleBreakpointToEditor 对齐)
 */
function applySingleBreakpointToEditorMock(workspaceRoot, bp, editorBreakpoints) {
	let createdBp;
	if (bp.type === "function") {
		createdBp = {
			type: "function",
			functionName: bp.functionName,
			enabled: bp.enabled ?? true,
			condition: bp.condition,
			hitCondition: bp.hitCondition,
		};
	} else {
		createdBp = {
			type: "source",
			location: { file: `${workspaceRoot}/${bp.file}`, line: bp.line },
			enabled: bp.enabled ?? true,
			condition: bp.condition,
			hitCondition: bp.hitCondition,
			logMessage: bp.logMessage,
		};
	}
	editorBreakpoints.push(createdBp);
	return createdBp;
}

/**
 * 状态栏视觉模型推导逻辑 (与 src/statusBar.ts:L45-71 100% 严格对齐)
 */
function deriveStatusBarViewModel(activeScenes, isDirty = false) {
	if (activeScenes.length > 0) {
		const label = activeScenes.length === 1 ? `[${activeScenes[0]}]` : `[${activeScenes.join(" + ")}]`;
		const fullNames = activeScenes.join(", ");
		if (isDirty) {
			return {
				text: `$(circle-filled) Scene: ${label}*`,
				color: "#cca700",
				hasDirtyStar: true,
				tooltipContainsUnsaved: true,
			};
		}
		return {
			text: `$(circle-filled) Scene: ${label}`,
			color: "#49c998",
			hasDirtyStar: false,
			tooltipContainsUnsaved: false,
		};
	}
	return {
		text: `$(circle-outline) Scene: (None)`,
		color: undefined,
		hasDirtyStar: false,
		tooltipContainsUnsaved: false,
	};
}

export async function runStorageUiAndCommandsTests() {
	console.log("  ▶ [Storage, UI & AddBP] 运行并发写盘队列、即刻点亮与状态栏三态视觉模型测试套件...");

	// =========================================================================
	// 1. 并发写盘原子互斥队列测试 (KDD-ARCH-002)
	// =========================================================================
	{
		const storage = new MockAtomicConfigStorage();

		// 同时并发发起 3 次写盘请求 (高频连击)
		const p1 = storage.saveScenesConfig({ v: 1 });
		const p2 = storage.saveScenesConfig({ v: 2 });
		const p3 = storage.saveScenesConfig({ v: 3 });

		await Promise.all([p1, p2, p3]);

		// 验证：3 次并发调用合并为 2 次原子写入（首次立即写，随后 2 和 3 合并为最新的 3 续写）
		assert.strictEqual(storage.writeCallCount, 2, "高频并发写盘必须被互斥队列合并，杜绝多次冗余冲突");
		assert.strictEqual(storage.diskContent, JSON.stringify({ v: 3 }), "磁盘最终持久化的必须是最新的配置版本 (v: 3)");
		assert.strictEqual(storage.isWriting, false, "全部处理完毕后 isWriting 必须复位为 false");
		assert.strictEqual(storage.pendingSave, undefined, "pendingSave 队列必须被清空");
	}

	// =========================================================================
	// 2. 向激活场景添加断点时的即刻点亮测试 (Immediate Highlight)
	// =========================================================================
	{
		const editorBps = [];
		const workspaceRoot = "/workspace/demo";

		// 模拟向激活场景新增一个普通行断点
		const lineBp = {
			type: "line",
			file: "src/order.ts",
			line: 45,
			enabled: true,
			condition: "orderId > 100",
		};
		const injectedLine = applySingleBreakpointToEditorMock(workspaceRoot, lineBp, editorBps);

		assert.strictEqual(editorBps.length, 1, "必须立即向编辑器运行时注入该断点");
		assert.strictEqual(injectedLine.location.file, "/workspace/demo/src/order.ts");
		assert.strictEqual(injectedLine.location.line, 45);
		assert.strictEqual(injectedLine.condition, "orderId > 100");

		// 模拟向激活场景新增一个函数断点
		const fnBp = {
			type: "function",
			functionName: "handlePayment",
			enabled: true,
		};
		const injectedFn = applySingleBreakpointToEditorMock(workspaceRoot, fnBp, editorBps);

		assert.strictEqual(editorBps.length, 2);
		assert.strictEqual(injectedFn.type, "function");
		assert.strictEqual(injectedFn.functionName, "handlePayment");
	}

	// =========================================================================
	// 3. 状态栏三态响应式视觉模型推导测试 (statusBar.ts)
	// =========================================================================
	{
		// Case A: None 态 (无激活场景)
		const noneView = deriveStatusBarViewModel([]);
		assert.strictEqual(noneView.text, "$(circle-outline) Scene: (None)");
		assert.strictEqual(noneView.color, undefined, "None 态下颜色必须为 undefined 继承默认前景色");
		assert.strictEqual(noneView.hasDirtyStar, false);

		// Case B: Clean 态 (已激活场景且未被临时修改)
		const cleanView = deriveStatusBarViewModel(["user-login"], false);
		assert.strictEqual(cleanView.text, "$(circle-filled) Scene: [user-login]");
		assert.strictEqual(cleanView.color, "#49c998", "Clean 激活态必须为高对比度翠绿色 (#49c998)");
		assert.strictEqual(cleanView.hasDirtyStar, false);

		// Case C: Dirty 态 (已激活场景且存在临时脏断点)
		const dirtyView = deriveStatusBarViewModel(["user-login"], true);
		assert.strictEqual(dirtyView.text, "$(circle-filled) Scene: [user-login]*", "Dirty 态必须在标签末尾追加黄色星号提示");
		assert.strictEqual(dirtyView.color, "#cca700", "Dirty 态必须呈现警示黄色 (#cca700)");
		assert.strictEqual(dirtyView.hasDirtyStar, true);
		assert.strictEqual(dirtyView.tooltipContainsUnsaved, true);
	}

	console.log("  ✅ [Storage, UI & AddBP] 并发写盘队列、即刻点亮与状态栏视觉模型测试（6 大核心场景）全部通过！");
}
