import assert from "node:assert/strict";
import {
	buildGraphSnapshot,
	findNodeByLocation,
	findNodeById,
	createNodeIdResolver,
} from "#src/application/sceneGraphProjection";
import { SceneCatalog } from "#src/domain/models/sceneCatalog";

export async function runSceneGraphProjectionTests() {
	console.log("  ▶ [SceneGraphProjection] 运行场景图形化只读投影单元测试套件...");

	const workspaceRoot = "/ws/demo-app";

	const fixtures = {
		activeScenes: ["auth-flow", "order-flow"],
		scenes: {
			"auth-flow": [
				{ type: "line", file: "src/auth/login.ts", line: 10, desc: "校验凭证" },
				{ type: "scene", name: "auth-core" },
				{ type: "scene", name: "ghost-ref" },
				{ type: "scene", name: "disabled-svc", enabled: false },
			],
			"auth-core": [
				{ type: "line", file: "src/auth/token.ts", line: 20, desc: "生成令牌" },
				{ type: "function", functionName: "handleAuthError" },
			],
			"order-flow": [
				{ type: "line", file: "src/auth/login.ts", line: 10, desc: "重复位置先到先得" },
				{ type: "line", file: "src/order/create.ts", line: 30 },
			],
			"disabled-svc": [{ type: "line", file: "src/svc/a.ts", line: 1 }],
		},
	};

	function buildFixture(overrides = {}) {
		const config = { ...fixtures, ...overrides };
		return buildGraphSnapshot({
			workspaceRoot,
			catalog: SceneCatalog.fromConfig(config),
			activeScenes: config.activeScenes,
			visibleScenes: overrides.visibleScenes,
			originByScene: overrides.originByScene,
			isUnmatched: overrides.isUnmatched,
		});
	}

	// 1. 基础泳道构建：泳道序与激活场景声明序一致，节点 id 按 ownerScene 内声明序稳定递增
	{
		const snapshot = buildFixture();
		assert.strictEqual(snapshot.workspaceRoot, workspaceRoot);
		assert.deepStrictEqual(snapshot.activeScenes, ["auth-flow", "order-flow"]);
		assert.strictEqual(snapshot.lanes.length, 2);
		assert.strictEqual(snapshot.lanes[0].id, "scene:auth-flow");
		assert.strictEqual(snapshot.lanes[0].sceneName, "auth-flow");
		assert.strictEqual(snapshot.lanes[0].layer, "team", "缺省溯源为 team 层");

		const authNodes = snapshot.lanes[0].nodes;
		// 3 个断点节点（含引用展开 2 个）+ 2 个引用占位节点
		assert.strictEqual(authNodes.length, 5);
		assert.strictEqual(authNodes[0].id, "auth-flow#0");
		assert.strictEqual(authNodes[0].kind, "breakpoint");
		assert.strictEqual(authNodes[0].file, "src/auth/login.ts");
		assert.strictEqual(authNodes[0].line, 10);
		assert.strictEqual(authNodes[0].bpType, "line");
		assert.strictEqual(authNodes[0].desc, "校验凭证");
		assert.strictEqual(authNodes[0].enabled, true);
		assert.strictEqual(authNodes[0].status, "idle");
		assert.deepStrictEqual(authNodes[0].refPath, ["auth-flow"]);

		// 引用展开节点：ownerScene 为定义场景，refPath 含完整引用链
		assert.strictEqual(authNodes[1].id, "auth-core#0");
		assert.strictEqual(authNodes[1].ownerScene, "auth-core");
		assert.deepStrictEqual(authNodes[1].refPath, ["auth-flow", "auth-core"]);
		assert.strictEqual(authNodes[1].file, "src/auth/token.ts");

		// 函数断点：functionName 存在，无 file/line
		assert.strictEqual(authNodes[2].id, "auth-core#1");
		assert.strictEqual(authNodes[2].bpType, "function");
		assert.strictEqual(authNodes[2].functionName, "handleAuthError");
		assert.strictEqual(authNodes[2].file, undefined);
		assert.strictEqual(authNodes[2].line, undefined);
	}

	// 2. 多场景独立泳道自治保真 (Lane Isolation)：各场景独立展开自身拓扑，杜绝跨场景先到先得误伤断点
	{
		const snapshot = buildFixture();
		const orderNodes = snapshot.lanes[1].nodes;
		assert.strictEqual(orderNodes.length, 2, "独立泳道必须保真展示该场景自身的完整断点，不受其他泳道干扰");
		assert.strictEqual(orderNodes[0].id, "order-flow#0");
		assert.strictEqual(orderNodes[0].file, "src/auth/login.ts");
		assert.strictEqual(orderNodes[1].id, "order-flow#1");
		assert.strictEqual(orderNodes[1].file, "src/order/create.ts");
	}

	// 3. 警告透传与引用占位节点：悬空引用与禁用引用降级为灰色占位
	{
		const snapshot = buildFixture();
		assert.strictEqual(snapshot.warnings.length, 2);
		assert.deepStrictEqual(snapshot.warnings[0], {
			code: "dangling-ref",
			refName: "ghost-ref",
			refPath: ["auth-flow"],
		});
		assert.deepStrictEqual(snapshot.warnings[1], {
			code: "disabled-ref",
			refName: "disabled-svc",
			refPath: ["auth-flow"],
		});

		const authNodes = snapshot.lanes[0].nodes;
		const ghost = authNodes.find((n) => n.kind === "scene-ref" && n.refName === "ghost-ref");
		assert.ok(ghost, "悬空引用必须有占位节点");
		assert.strictEqual(ghost.id, "auth-flow#ref-ghost-ref");
		assert.strictEqual(ghost.enabled, true, "悬空引用占位保持启用外观");
		assert.strictEqual(ghost.status, "idle");

		const disabled = authNodes.find((n) => n.kind === "scene-ref" && n.refName === "disabled-svc");
		assert.ok(disabled, "禁用引用必须有占位节点");
		assert.strictEqual(disabled.enabled, false, "禁用引用占位呈禁用态");
		// 占位节点无物理位置，永不参与位置匹配
		assert.strictEqual(disabled.file, undefined);
		assert.strictEqual(disabled.line, undefined);
	}

	// 4. unmatched 标记：注入判定函数命中节点置为 unmatched
	{
		const snapshot = buildFixture({
			isUnmatched: (file, line) => (file ?? "").endsWith("login.ts") && line === 10,
		});
		const hit = snapshot.lanes[0].nodes.find((n) => n.id === "auth-flow#0");
		assert.strictEqual(hit.status, "unmatched");
		const miss = snapshot.lanes[0].nodes.find((n) => n.id === "auth-core#0");
		assert.strictEqual(miss.status, "idle");
	}

	// 5. 分层来源标注 (INV-032)：originByScene 驱动泳道 layer
	{
		const snapshot = buildFixture({ originByScene: { "order-flow": "local" } });
		assert.strictEqual(snapshot.lanes[0].layer, "team");
		assert.strictEqual(snapshot.lanes[1].layer, "local");
	}

	// 6. 字段拷贝不改实体：变异快照节点后重建，源实体零污染
	{
		const snapshot = buildFixture();
		const node = snapshot.lanes[0].nodes[0];
		const mutated = /** @type {any} */ ({ ...node });
		mutated.line = 999;
		mutated.refPath.push("hacked");

		const rebuilt = buildFixture();
		const fresh = rebuilt.lanes[0].nodes[0];
		assert.strictEqual(fresh.line, 10, "快照节点为字段拷贝，实体不可被快照回写");
		assert.strictEqual(fresh.refPath.length, 1, "refPath 为独立副本");
	}

	// 7. 空可见场景与成环降级：空集零异常；成环场景渲染警告泳道（不再静默空白）
	{
		const empty = buildGraphSnapshot({
			workspaceRoot,
			catalog: SceneCatalog.fromConfig(fixtures),
			activeScenes: [],
		});
		assert.deepStrictEqual(empty.lanes, []);
		assert.deepStrictEqual(empty.warnings, []);
		assert.strictEqual(empty.availableScenes.length, 4, "空可见集仍须透出目录选项供 Scope 选择");
		assert.deepStrictEqual(empty.activeScenes, []);

		const cyclicConfig = {
			activeScenes: ["cycle-a"],
			scenes: {
				"cycle-a": [{ type: "scene", name: "cycle-b" }],
				"cycle-b": [{ type: "scene", name: "cycle-a" }],
			},
		};
		const cyclic = buildGraphSnapshot({
			workspaceRoot,
			catalog: SceneCatalog.fromConfig(cyclicConfig),
			activeScenes: ["cycle-a"],
		});
		assert.strictEqual(cyclic.lanes.length, 1, "成环场景必须渲染警告泳道而非空画布");
		assert.strictEqual(cyclic.lanes[0].sceneName, "cycle-a");
		assert.strictEqual(cyclic.lanes[0].expandError.code, "circular-ref");
		assert.deepStrictEqual(cyclic.lanes[0].expandError.cyclePath, ["cycle-a", "cycle-b", "cycle-a"]);
		assert.strictEqual(cyclic.lanes[0].nodes.length, 0, "警告泳道仅列原因，不产出节点");
	}

	// 8. 位置查找与 nodeId 解析器：跨平台路径容错，未命中记 null
	{
		const snapshot = buildFixture();
		const hit = findNodeByLocation(snapshot, "/ws/demo-app/src/auth/token.ts", 20);
		assert.ok(hit, "绝对路径查询必须命中相对声明节点");
		assert.strictEqual(hit.id, "auth-core#0");

		assert.ok(findNodeByLocation(snapshot, "src/auth/login.ts", 10), "相对路径查询命中");
		assert.strictEqual(
			findNodeByLocation(snapshot, "/ws/demo-app/src/auth/token.ts", 999),
			undefined,
			"行号不匹配不命中",
		);
		assert.strictEqual(
			findNodeByLocation(snapshot, "/ws/demo-app/unknown.ts", 1),
			undefined,
			"未知文件不命中",
		);

		const resolve = createNodeIdResolver(snapshot);
		assert.strictEqual(resolve("/ws/demo-app/src/auth/login.ts", 10), "auth-flow#0");
		assert.strictEqual(resolve("/ws/demo-app/none.ts", 1), null, "未命中返回 null");
		assert.strictEqual(
			resolve("/ws/demo-app/ghost-ref", 0),
			null,
			"占位节点无物理位置永不命中",
		);
	}

	// 9. Scope 选择器："看什么"与"什么在生效"正交解耦 —— visibleScenes 可含未激活场景
	{
		const snapshot = buildFixture({ visibleScenes: ["order-flow", "auth-core"] });
		assert.deepStrictEqual(snapshot.activeScenes, ["auth-flow", "order-flow"], "激活集不受可见集影响");
		assert.strictEqual(snapshot.lanes.length, 2);
		assert.strictEqual(snapshot.lanes[0].sceneName, "order-flow");
		assert.strictEqual(snapshot.lanes[0].registered, true, "激活场景泳道呈已登记态");
		assert.strictEqual(snapshot.lanes[1].sceneName, "auth-core");
		assert.strictEqual(snapshot.lanes[1].registered, false, "未激活场景泳道呈未登记态");

		// 未激活泳道节点正常展开，registered 纯推导标注
		const coreNodes = snapshot.lanes[1].nodes;
		assert.strictEqual(coreNodes.length, 2, "未激活场景仍完整展开节点流");
		assert.ok(coreNodes.every((n) => n.registered === false), "未激活场景节点必须标注未登记");
		const orderNodes = snapshot.lanes[0].nodes;
		assert.ok(orderNodes.every((n) => n.registered === true), "激活场景节点必须标注已登记");

		// 混合泳道：可见根场景激活，但其引用链下游场景未激活
		const mixed = buildFixture({ visibleScenes: ["order-flow", "auth-flow", "disabled-svc"] });
		const svcLane = mixed.lanes.find((l) => l.sceneName === "disabled-svc");
		assert.ok(svcLane, "disabled-svc 在目录中存在，必须可被选为可见场景");
		assert.strictEqual(svcLane.registered, false);
	}

	// 10. availableScenes 选项源：目录全量场景 + 分层 + registered 推导标注
	{
		const snapshot = buildFixture({ originByScene: { "disabled-svc": "local" } });
		assert.strictEqual(snapshot.availableScenes.length, 4);
		const svc = snapshot.availableScenes.find((s) => s.name === "disabled-svc");
		assert.strictEqual(svc.layer, "local", "选项须携带分层来源");
		assert.strictEqual(svc.registered, false, "未激活场景选项标注未登记");
		const auth = snapshot.availableScenes.find((s) => s.name === "auth-flow");
		assert.strictEqual(auth.layer, "team");
		assert.strictEqual(auth.registered, true);
	}

	// 11. 混合成环降级：可见集中部分成环、部分正常，二者互不拖垮
	{
		const snapshot = buildGraphSnapshot({
			workspaceRoot,
			catalog: SceneCatalog.fromConfig({
				activeScenes: ["order-flow"],
				scenes: {
					"order-flow": [{ type: "line", file: "src/order/create.ts", line: 30 }],
					"cycle-a": [{ type: "scene", name: "cycle-b" }],
					"cycle-b": [{ type: "scene", name: "cycle-a" }],
				},
			}),
			activeScenes: ["order-flow"],
			visibleScenes: ["cycle-a", "order-flow"],
		});
		assert.strictEqual(snapshot.lanes.length, 2);
		const cycleLane = snapshot.lanes.find((l) => l.sceneName === "cycle-a");
		const orderLane = snapshot.lanes.find((l) => l.sceneName === "order-flow");
		assert.strictEqual(cycleLane.expandError.code, "circular-ref", "成环场景降级为警告泳道");
		assert.strictEqual(orderLane.expandError, undefined, "正常场景不受成环场景拖垮");
		assert.strictEqual(orderLane.nodes.length, 1, "正常场景节点照常展开");
		assert.strictEqual(orderLane.nodes[0].registered, true);
	}

	// 12. contextSnippet 渲染与条件断点全字段映射加固
	{
		const snippetFixture = buildGraphSnapshot({
			workspaceRoot,
			catalog: SceneCatalog.fromConfig({
				activeScenes: ["snippet-flow"],
				scenes: {
					"snippet-flow": [
						{
							type: "line",
							file: "src/calc.ts",
							line: 42,
							contextSnippet: {
								prev: "const a = 1;",
								current: "const b = a + 2;",
								next: "return b;",
							},
							condition: "x > 0",
							hitCondition: "3",
							logMessage: "log: {x}",
						},
						{
							type: "line",
							file: "src/calc.ts",
							line: 50,
							contextSnippet: {
								current: "return false;",
							},
						},
					],
				},
			}),
			activeScenes: ["snippet-flow"],
		});

		const fullNode = snippetFixture.lanes[0].nodes[0];
		assert.strictEqual(
			fullNode.contextSnippet,
			"  const a = 1;\n> const b = a + 2;\n  return b;",
			"完整三行切片必须精确渲染缩进与箭头指示符",
		);
		assert.strictEqual(fullNode.condition, "x > 0");
		assert.strictEqual(fullNode.hitCondition, "3");
		assert.strictEqual(fullNode.logMessage, "log: {x}");

		const singleNode = snippetFixture.lanes[0].nodes[1];
		assert.strictEqual(singleNode.contextSnippet, "> return false;", "单行切片仅渲染箭头指示行");
	}

	// 13. findNodeById 节点查找与未知异常重新抛出加固
	{
		const snapshot = buildFixture();
		const found = findNodeById(snapshot, "auth-flow#0");
		assert.ok(found, "按合法 nodeId 必须精确命中对应节点");
		assert.strictEqual(found.id, "auth-flow#0");
		assert.strictEqual(findNodeById(snapshot, "non-existent-id"), undefined, "不存在的 nodeId 必须返回 undefined");

		// 模拟 expandScene 抛出非循环引用常规未知异常
		assert.throws(
			() => {
				buildGraphSnapshot({
					workspaceRoot,
					catalog: {
						getScene() {
							throw new TypeError("Simulated internal catalog error");
						},
						listScenes: () => [],
					},
					activeScenes: ["boom"],
				});
			},
			TypeError,
			"非 CircularReferenceError 必须直接向外重抛",
		);
	}

	console.log("  ✅ [SceneGraphProjection] 场景图形化只读投影测试全部通过！");
}

if (process.argv[1]?.endsWith("scene_graph_projection.test.mjs")) {
	runSceneGraphProjectionTests();
}
