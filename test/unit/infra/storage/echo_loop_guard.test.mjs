import assert from "node:assert";
import { EchoLoopGuard } from "#src/infra/storage/echoLoopGuard";

export async function runEchoLoopGuardTests() {
	console.log("  ▶ [Echo Loop Guard] 运行 EchoLoopGuard 防回声回环守卫单元测试套件（真实源码）...");

	const guard = new EchoLoopGuard();

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

	// 6. 【变异斩杀】初始 lastSavedContent 空值与 getter/setter 保真
	const freshGuard = new EchoLoopGuard();
	assert.strictEqual(freshGuard.getLastSavedContent(), "", "初始状态下 lastSavedContent 必须为空字符串");
	freshGuard.setLastSavedContent("myContent");
	assert.strictEqual(freshGuard.getLastSavedContent(), "myContent", "setLastSavedContent 必须保真更新");

	// 7. 【变异斩杀】isContentMatchingLastSaved 空值防御与非匹配分支
	// (1) lastSavedContent 为空时必须返回 false
	freshGuard.setLastSavedContent("");
	assert.strictEqual(freshGuard.isContentMatchingLastSaved("any text"), false);
	// (2) 传入 content 为空时必须返回 false
	freshGuard.setLastSavedContent("valid text");
	assert.strictEqual(freshGuard.isContentMatchingLastSaved(""), false);
	// (3) 两者均为非法非 JSON 文本但内容不一致，必须降级 trim 比对返回 false（斩杀 return true 突变）
	freshGuard.setLastSavedContent("raw text A");
	assert.strictEqual(freshGuard.isContentMatchingLastSaved("raw text B"), false);

	// 8. 【变异斩杀】runWithSavingGuard 执行中前置锁、返回值锁定与默认 600ms 超时
	let isSavingDuringAction = false;
	const guardReturn = await freshGuard.runWithSavingGuard(async () => {
		isSavingDuringAction = freshGuard.isInternalSaving();
		return "action-return-value";
	});
	assert.strictEqual(isSavingDuringAction, true, "进入 action 执行体内时必须已激活写盘保护（斩杀前置 markInternalSaving 丢失）");
	assert.strictEqual(guardReturn, "action-return-value", "runWithSavingGuard 必须完整透传 action 异步返回值");

	// 默认参数 markInternalSaving() 调用
	freshGuard.markInternalSaving();
	assert.strictEqual(freshGuard.isInternalSaving(), true);

	// 9. 【变异斩杀】finally 关键续期保护与空值/纯空白精准拦截
	const longActionGuard = new EchoLoopGuard();
	// 针对一方为空串、另一方为纯空白字符时（trim 后虽皆为空，但仍属无效内容），必须严格拦截返回 false（精准斩杀 && 与 false 突变）
	freshGuard.setLastSavedContent("   ");
	assert.strictEqual(freshGuard.isContentMatchingLastSaved(""), false, "内容为空且已保存内容为纯空白时必须返回 false");
	freshGuard.setLastSavedContent("");
	assert.strictEqual(freshGuard.isContentMatchingLastSaved("   "), false, "已保存内容为空且传入内容为纯空白时必须返回 false");

	// action 内部模拟写盘锁超时或外部清除，验证 finally 必须强制重新激活保护
	await longActionGuard.runWithSavingGuard(async () => {
		// 模拟在 action 执行中途保护窗复位
		longActionGuard._isInternalSaving = false;
	});
	assert.strictEqual(longActionGuard.isInternalSaving(), true, "action 执行完后 finally 必须无条件重新激活防护（斩杀 finally 缺失与调用丢失变异）");

	console.log("  ✅ [Echo Loop Guard] EchoLoopGuard 单元测试全部通过！");
}

if (process.argv[1]?.endsWith("echo_loop_guard.test.mjs")) {
	runEchoLoopGuardTests();
}

