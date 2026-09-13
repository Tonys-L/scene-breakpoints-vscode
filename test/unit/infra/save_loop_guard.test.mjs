import assert from "node:assert";
import { SaveLoopGuard } from "#src/infra/storage/saveLoopGuard";

export async function runSaveLoopGuardTests() {
	console.log("  ▶ [Save Loop Guard] 运行 SaveLoopGuard 防回环守卫单元测试套件（真实源码）...");

	const guard = new SaveLoopGuard();

	// 1. 初始状态
	assert.strictEqual(guard.isInternalSaving(), false, "初始状态下 isInternalSaving 必须为 false");

	// 2. 标记内部写盘与自动超时释放
	guard.markInternalSaving(30);
	assert.strictEqual(guard.isInternalSaving(), true, "markInternalSaving 后必须立即置为 true");

	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.strictEqual(guard.isInternalSaving(), false, "经过 50ms 超时后必须自动复位为 false");

	// 3. 重入调用防抖与安全窗延展
	guard.markInternalSaving(40);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.strictEqual(guard.isInternalSaving(), true);
	// 重入再续 40ms
	guard.markInternalSaving(40);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.strictEqual(guard.isInternalSaving(), true, "续期后安全窗必须延展，不可过早关闭");
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.strictEqual(guard.isInternalSaving(), false, "续期超时后彻底关闭安全窗");

	// 4. JSON 内容指纹比对 (格式化空格抗干扰)
	const canonicalObj = { scenes: { auth: [{ file: "src/a.ts", line: 10 }] } };
	guard.setLastSavedContent(JSON.stringify(canonicalObj, null, 2));

	// 压缩版 JSON (无换行) 比对
	const compressed = JSON.stringify(canonicalObj);
	assert.strictEqual(
		guard.isContentMatchingLastSaved(compressed),
		true,
		"格式化差异（压缩 vs 美化）不应影响指纹一致性判定",
	);

	// 内容修改后比对
	const modified = JSON.stringify({ scenes: { auth: [{ file: "src/a.ts", line: 11 }] } });
	assert.strictEqual(
		guard.isContentMatchingLastSaved(modified),
		false,
		"行号变化后内容指纹判定必须为 false",
	);

	// 异常非法文本降级比对
	guard.setLastSavedContent("raw fallback text\n");
	assert.strictEqual(
		guard.isContentMatchingLastSaved("  raw fallback text  "),
		true,
		"非法 JSON 必须平滑降级为 trim 文本比对",
	);

	// 5. runWithSavingGuard 事务安全窗与异常捕获
	let executed = false;
	await guard.runWithSavingGuard(async () => {
		executed = true;
	});
	assert.strictEqual(executed, true);
	assert.strictEqual(guard.isInternalSaving(), true, "执行后保护窗依然保持开启");

	// 异常场景测试
	try {
		await guard.runWithSavingGuard(async () => {
			throw new Error("Simulated Disk Full Exception");
		});
	} catch {
		// 预期抛错
	}
	assert.strictEqual(guard.isInternalSaving(), true, "即便回调抛出严重异常，finally 仍必须锁定写盘防护");

	console.log("  ✅ [Save Loop Guard] SaveLoopGuard 单元测试全部通过！");
}
