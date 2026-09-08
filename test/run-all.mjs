import { runAdapterAndCodeLensTests } from "./adapter_and_codelens.test.mjs";
import { runConfigTests } from "./config.test.mjs";
import { runHealingTests } from "./healing.test.mjs";
import { runI18nTests } from "./i18n.test.mjs";
import { runRoundtripAndEdgeTests } from "./roundtrip_and_edge.test.mjs";
import { runStateTests } from "./state.test.mjs";
import { runTreeViewTests } from "./treeview.test.mjs";

console.log("\n=======================================================");
console.log("🚀 开始执行 Scene Breakpoints 全量 7 大自动化测试套件");
console.log("=======================================================\n");

const startTime = performance.now();

try {
	runHealingTests();
	console.log("");
	runConfigTests();
	console.log("");
	runStateTests();
	console.log("");
	runAdapterAndCodeLensTests();
	console.log("");
	runRoundtripAndEdgeTests();
	console.log("");
	runTreeViewTests();
	console.log("");
	runI18nTests();

	const totalDuration = (performance.now() - startTime).toFixed(2);
	console.log("\n=======================================================");
	console.log(`🎉 全部 7 大全维单元测试套件 100% 通过！总耗时: ${totalDuration}ms`);
	console.log("=======================================================\n");
} catch (err) {
	console.error("\n❌ 单元测试执行失败:\n", err);
	process.exit(1);
}
