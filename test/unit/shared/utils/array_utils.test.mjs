import assert from "node:assert/strict";
import { uniqueStrings, arrayEqualsIgnoreOrder } from "#src/shared/utils/arrayUtils.ts";

export function runArrayUtilsTests() {
	console.log("  ▶ [Shared Utils] 运行 arrayUtils 纯工具单测套件...");

	// 1. uniqueStrings 空值防御
	assert.deepStrictEqual(uniqueStrings(null), []);
	assert.deepStrictEqual(uniqueStrings(undefined), []);
	assert.deepStrictEqual(uniqueStrings(""), []);
	assert.deepStrictEqual(uniqueStrings(123), []);

	// 2. uniqueStrings 逗号分隔字符串清洗与去重
	assert.deepStrictEqual(uniqueStrings("a, b, a, c, "), ["a", "b", "c"]);

	// 3. uniqueStrings 数组输入与混合嵌套
	assert.deepStrictEqual(uniqueStrings(["scene1, scene2", "scene2", "  scene3  ", 123]), [
		"scene1",
		"scene2",
		"scene3",
	]);

	// 4. arrayEqualsIgnoreOrder 数组相等比对
	assert.strictEqual(arrayEqualsIgnoreOrder(["a", "b"], ["b", "a"]), true);
	assert.strictEqual(arrayEqualsIgnoreOrder(["b", "a"], ["a", "b"]), true, "击杀 sortedA 未执行 sort 的变异体");
	assert.strictEqual(arrayEqualsIgnoreOrder(["a", "b"], ["a", "b", "c"]), false);
	assert.strictEqual(arrayEqualsIgnoreOrder(["a", "b"], ["a", "c"]), false);
	assert.strictEqual(arrayEqualsIgnoreOrder(null, ["a"]), false);
	assert.strictEqual(arrayEqualsIgnoreOrder(["a"], undefined), false);

	console.log("  ✅ [Shared Utils] arrayUtils 单测全部通过！");
}

if (process.argv[1]?.endsWith("array_utils.test.mjs")) {
	runArrayUtilsTests();
}
