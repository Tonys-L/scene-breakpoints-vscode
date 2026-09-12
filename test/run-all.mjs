import { runAdapterAndCodeLensTests } from "./adapter_and_codelens.test.mjs";
import { runConfigTests } from "./config.test.mjs";
import { runHealingTests } from "./healing.test.mjs";
import { runI18nTests } from "./i18n.test.mjs";
import { runRoundtripAndEdgeTests } from "./roundtrip_and_edge.test.mjs";
import { runStateTests } from "./state.test.mjs";
import { runTreeViewTests } from "./treeview.test.mjs";
import { runAiActivationTests } from "./ai_scene_activation.test.mjs";
import { runCommandsRegistryTests } from "./commands_registry.test.mjs";
import { runCoordinatorAndSyncTests } from "./coordinator_and_sync.test.mjs";
import { runStorageUiAndCommandsTests } from "./storage_ui_and_commands.test.mjs";

console.log("\n=======================================================");
console.log("🚀 开始执行 Scene Breakpoints 全量 11 大自动化测试套件");
console.log("=======================================================\n");

const startTime = performance.now();

try {
	runHealingTests();
	console.log("");
	runConfigTests();
	console.log("");
	runAiActivationTests();
	console.log("");
	runStateTests();
	console.log("");
	runCommandsRegistryTests();
	console.log("");
	await runCoordinatorAndSyncTests();
	console.log("");
	await runStorageUiAndCommandsTests();
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
	console.log(`🎉 全部 11 大全维单元测试套件 100% 通过！总耗时: ${totalDuration}ms`);
	console.log("=======================================================\n");
} catch (err) {
	console.error("\n❌ 单元测试执行失败:\n", err);
	process.exit(1);
}

