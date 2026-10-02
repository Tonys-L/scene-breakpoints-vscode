// Architecture & Code Health Guard
import { runArchitectureGuardTests } from "./unit/architecture/architecture_guard.test.mjs";

// Shared Layer Unit Tests (utils)
import { runArrayUtilsTests } from "./unit/shared/utils/array_utils.test.mjs";
import { runStringSimilarityTests } from "./unit/shared/utils/string_similarity.test.mjs";
import { runTextUtilsTests } from "./unit/shared/utils/text_utils.test.mjs";

// Domain Layer Unit Tests (models & services)
import { runFingerprintVoTests } from "./unit/domain/models/fingerprint.test.mjs";
import { runBreakpointEntityTests } from "./unit/domain/models/breakpoint.test.mjs";
import { runSceneAndCatalogTests } from "./unit/domain/models/scene_catalog.test.mjs";
import { runConfigTests } from "./unit/domain/models/scene.test.mjs";
import { runSkillLifecycleTests } from "./unit/domain/models/agent_rule_asset.test.mjs";
import { runHealingTests } from "./unit/domain/services/healing_engine.test.mjs";
import { runAiActivationTests } from "./unit/domain/services/active_scenes_diff_resolver.test.mjs";
import { runScenePayloadCodecTests } from "./unit/domain/services/scene_payload_codec.test.mjs";

// Application Layer Unit Tests (coordinators & services)
import { runSceneServiceTests } from "./unit/application/scene_manager.test.mjs";
import { runCoordinatorsTests } from "./unit/application/breakpoint_manager.test.mjs";
import { runStateTests } from "./unit/application/scene_state_manager.test.mjs";
import { runEventBusTests } from "./unit/application/event_bus.test.mjs";
import { runSerialQueueTests } from "./unit/application/serial_queue.test.mjs";

// Infra Layer Unit Tests (storage, bridge & listeners)
import { runEchoLoopGuardTests } from "./unit/infra/storage/echo_loop_guard.test.mjs";
import { runSceneRepositoryTests } from "./unit/infra/storage/json_file_scene_repository.test.mjs";
import { runAtomicFileJsonStoreTests } from "./unit/infra/storage/atomic_file_json_store.test.mjs";
import { runFileLineReaderTests } from "./unit/infra/storage/file_line_reader.test.mjs";
import { runBreakpointBridgeTests } from "./unit/infra/vscode/vscode_breakpoint_bridge.test.mjs";
import { runDapBridgeTests } from "./unit/infra/vscode/bridge/dap_bridge.test.mjs";
import { runListenersRegistryTests } from "./unit/infra/vscode/listeners/listeners_registry.test.mjs";

// UI Layer Unit Tests (locators, views, commands & utils)
import { runTreeviewLocatorTests } from "./unit/ui/locators/treeview_locator.test.mjs";
import { runCodeLensProviderTests } from "./unit/ui/views/scene_code_lens_provider.test.mjs";
import { runInlayHintsProviderTests } from "./unit/ui/views/scene_inlay_hints_provider.test.mjs";
import { runStatusBarViewTests } from "./unit/ui/views/status_bar_view.test.mjs";
import { runTreeViewTests } from "./unit/ui/views/scene_tree_provider.test.mjs";
import { runTemplateProviderTests } from "./unit/ui/views/template_content_provider.test.mjs";
import { runCommandsRegistryTests } from "./unit/ui/commands/commands_registry.test.mjs";
import { runCommandsExecutionTests } from "./unit/ui/commands/commands_execution.test.mjs";
import { runCommandRunnerTests } from "./unit/ui/utils/command_runner.test.mjs";

// Script & Verification Tests
import { runExtractChangelogTests } from "./unit/scripts/extract_changelog.test.mjs";
import { runGuardrailsVerificationTests } from "./unit/scripts/guardrails_verification.test.mjs";

// Integration & Fidelity Tests
import { runRoundtripAndEdgeTests } from "./integration/roundtrip_and_edge.test.mjs";
import { runI18nTests } from "./integration/i18n.test.mjs";

console.log("\n=======================================================");
console.log("🚀 开始执行 Scene Breakpoints 全量 30 大自动化测试套件 (Shared / Domain / Application / Infra / UI / Integration)");
console.log("=======================================================\n");

const startTime = performance.now();

try {
	// 0. 架构与代码质量硬门禁 (Architecture & Quality Guard)
	await runArchitectureGuardTests();
	console.log("");

	// 1. 通用纯工具层测试 (Shared Utils 1:1 镜像)
	runArrayUtilsTests();
	console.log("");
	runStringSimilarityTests();
	console.log("");
	runTextUtilsTests();
	console.log("");

	// 2. 领域层纯单元测试 (Domain Models & Services 1:1 镜像)
	await runFingerprintVoTests();
	console.log("");
	await runBreakpointEntityTests();
	console.log("");
	await runSceneAndCatalogTests();
	console.log("");

	await runHealingTests();
	console.log("");
	runConfigTests();
	console.log("");
	runAiActivationTests();
	console.log("");
	runSkillLifecycleTests();
	console.log("");
	runScenePayloadCodecTests();
	console.log("");

	// 3. 应用层服务编排测试 (Application 1:1 镜像)
	await runSceneServiceTests();
	console.log("");
	await runCoordinatorsTests();
	console.log("");
	runStateTests();
	console.log("");
	await runEventBusTests();
	console.log("");
	await runSerialQueueTests();
	console.log("");

	// 4. 基础设施存储与原生桥接测试 (Infra Storage & VSCode 1:1 镜像)
	await runEchoLoopGuardTests();
	console.log("");
	runSceneRepositoryTests();
	console.log("");
	await runAtomicFileJsonStoreTests();
	console.log("");
	await runFileLineReaderTests();
	console.log("");
	await runBreakpointBridgeTests();
	console.log("");
	await runDapBridgeTests();
	console.log("");
	await runListenersRegistryTests();
	console.log("");

	// 5. 开发者交互展示层测试 (UI Locators, Views & Commands 1:1 镜像)
	runTreeviewLocatorTests();
	console.log("");
	await runCodeLensProviderTests();
	console.log("");
	await runInlayHintsProviderTests();
	console.log("");
	runStatusBarViewTests();
	console.log("");
	await runTreeViewTests();
	console.log("");
	await runCommandRunnerTests();
	console.log("");
	runTemplateProviderTests();
	console.log("");
	await runCommandsRegistryTests();
	console.log("");
	await runCommandsExecutionTests();
	console.log("");

	// 6. 自动化脚本与门禁测试
	runExtractChangelogTests();
	console.log("");
	runGuardrailsVerificationTests();
	console.log("");

	// 7. 端到端链路与集成保真度套件
	await runRoundtripAndEdgeTests();
	console.log("");
	await runI18nTests();

	const duration = (performance.now() - startTime).toFixed(2);
	console.log("\n=======================================================");
	console.log(`🎉 全部 30 大全维测试套件 100% 通过！总耗时: ${duration}ms`);
	console.log("=======================================================\n");
} catch (error) {
	console.error("\n❌ 测试套件执行失败：\n", error);
	process.exit(1);
}
