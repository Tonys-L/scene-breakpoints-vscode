// Domain Layer Unit Tests
import { runHealingTests } from "./unit/domain/healing.test.mjs";
import { runConfigTests } from "./unit/domain/config_operations.test.mjs";
import { runStateTests } from "./unit/domain/state_projection.test.mjs";
import { runAiActivationTests } from "./unit/domain/activation_resolver.test.mjs";
import { runSkillLifecycleTests } from "./unit/domain/skill_lifecycle.test.mjs";

// Application Layer Unit Tests
import { runSceneServiceTests } from "./unit/application/scene_service.test.mjs";
import { runPayloadSerializerTests } from "./unit/application/payload_serializer.test.mjs";

// Infra Layer Unit Tests
import { runBreakpointBridgeTests } from "./unit/infra/breakpoint_bridge.test.mjs";
import { runCodeLensProviderTests } from "./unit/infra/codelens_provider.test.mjs";
import { runCommandsRegistryTests } from "./unit/infra/commands_registry.test.mjs";
import { runSaveLoopGuardTests } from "./unit/infra/save_loop_guard.test.mjs";
import { runSceneRepositoryTests } from "./unit/infra/scene_repository.test.mjs";
import { runStatusBarViewTests } from "./unit/infra/status_bar_view.test.mjs";
import { runTreeViewTests } from "./unit/infra/treeview_provider.test.mjs";
import { runTemplateProviderTests } from "./unit/infra/template_provider.test.mjs";
import { runListenersRegistryTests } from "./unit/infra/listeners_registry.test.mjs";
import { runExtractChangelogTests } from "./unit/infra/extract_changelog.test.mjs";

// Integration & Fidelity Tests
import { runRoundtripAndEdgeTests } from "./integration/roundtrip_and_edge.test.mjs";
import { runI18nTests } from "./integration/i18n.test.mjs";

console.log("\n=======================================================");
console.log("🚀 开始执行 Scene Breakpoints 全量 19 大自动化测试套件 (Domain / Application / Infra / Integration)");
console.log("=======================================================\n");

const startTime = performance.now();

try {
	// 1. 领域层纯单元测试 (Domain)
	runHealingTests();
	console.log("");
	runConfigTests();
	console.log("");
	runAiActivationTests();
	console.log("");
	runStateTests();
	console.log("");
	runSkillLifecycleTests();
	console.log("");

	// 2. 应用层服务编排测试 (Application)
	await runSceneServiceTests();
	console.log("");
	runPayloadSerializerTests();
	console.log("");

	// 3. 基础设施层适配与协同测试 (Infra 1:1 镜像对齐)
	await runBreakpointBridgeTests();
	console.log("");
	await runCodeLensProviderTests();
	console.log("");
	runCommandsRegistryTests();
	console.log("");
	await runSaveLoopGuardTests();
	console.log("");
	await runSceneRepositoryTests();
	console.log("");
	await runStatusBarViewTests();
	console.log("");
	runTreeViewTests();
	console.log("");
	runTemplateProviderTests();
	console.log("");
	await runListenersRegistryTests();
	console.log("");
	runExtractChangelogTests();
	console.log("");

	// 4. 集成与保真度测试 (Integration)
	runRoundtripAndEdgeTests();
	console.log("");
	runI18nTests();

	const totalDuration = (performance.now() - startTime).toFixed(2);
	console.log("\n=======================================================");
	console.log(`🎉 全部 19 大全维测试套件 100% 通过！总耗时: ${totalDuration}ms`);
	console.log("=======================================================\n");
} catch (err) {
	console.error("\n❌ 自动化测试执行失败:\n", err);
	process.exit(1);
}
