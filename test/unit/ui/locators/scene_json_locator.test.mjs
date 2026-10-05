import assert from "node:assert/strict";
import {
	findBreakpointLineInJson,
	findEnclosingSceneName,
	detectSceneFromActiveEditor,
} from "#src/ui/locators/sceneJsonLocator";

export function runSceneJsonLocatorTests() {
	console.log("  ▶ [UI Locators] 运行 sceneJsonLocator 统一物理行号与光标感知推导单测套件...");

	// ==========================================
	// 1. findBreakpointLineInJson 树节点检索测试
	// ==========================================
	const sampleJson = `
{
  "scenes": {
    "login": [
      {
        "type": "source",
        "file": "src/auth.ts",
        "line": 42
      },
      {
        "type": "function",
        "functionName": "loginHandler"
      }
    ],
    "checkout": [
      {
        "type": "source",
        "file": "src/pay.ts",
        "line": 108
      }
    ]
  }
}
	`.trim();

	// 1.1 查找 login 场景中的源码断点 (line 42)
	const line1 = findBreakpointLineInJson(sampleJson, "login", {
		type: "source",
		file: "src/auth.ts",
		line: 42,
	});
	assert.ok(line1 > 0, "应精准定位到 source 断点行号");

	// 1.2 查找 login 场景中的函数断点
	const lineFunc = findBreakpointLineInJson(sampleJson, "login", {
		type: "function",
		functionName: "loginHandler",
	});
	assert.ok(lineFunc > line1, "应精准定位到函数断点行号");

	// 1.3 不存在的断点安全降级到场景声明行
	const lineFallback = findBreakpointLineInJson(sampleJson, "checkout", {
		type: "source",
		file: "non_existent.ts",
		line: 999,
	});
	assert.ok(lineFallback > 0, "未匹配时应安全回退至场景行号");

	// ==========================================
	// 2. findEnclosingSceneName 光标推导测试
	// ==========================================
	const sampleLines = [
		"{",
		'  "scenes": {',
		'    "auth-flow": [',
		"      {",
		'        "file": "src/auth.ts",',
		'        "line": 42',
		"      }",
		"    ],",
		'    "payment-flow": [',
		"      {",
		'        "file": "src/pay.ts",',
		'        "line": 100',
		"      }",
		"    ]",
		"  }",
		"}",
	];
	const candidates = ["auth-flow", "payment-flow"];

	// 2.1 光标位于 auth-flow 内部断点行 (第 5 行，0-indexed 为 4)
	const detected1 = findEnclosingSceneName(sampleLines, 4, candidates);
	assert.strictEqual(detected1, "auth-flow", "光标在断点行时应正确推导出外层所属场景 auth-flow");

	// 2.2 光标位于 auth-flow 声明键名行 (第 3 行，0-indexed 为 2)
	const detected2 = findEnclosingSceneName(sampleLines, 2, candidates);
	assert.strictEqual(detected2, "auth-flow", "光标在场景键名行时应正确推导");

	// 2.3 光标位于 payment-flow 内部断点行 (第 10 行，0-indexed 为 9)
	const detected3 = findEnclosingSceneName(sampleLines, 9, candidates);
	assert.strictEqual(detected3, "payment-flow", "光标在 payment-flow 内部时应正确推导出 payment-flow");

	// 2.4 光标位于文件头部 (第 1 行，0-indexed 为 0)
	const detectedTop = findEnclosingSceneName(sampleLines, 0, candidates);
	assert.strictEqual(detectedTop, undefined, "光标在未进入任何场景的头部时应返回 undefined");

	// 2.5 候选列表为空
	const detectedEmpty = findEnclosingSceneName(sampleLines, 4, []);
	assert.strictEqual(detectedEmpty, undefined, "无候选场景时应返回 undefined");

	// 2.6 支持 VS Code Document 风格的 lineAt 对象
	const mockDocument = {
		lineAt: (idx) => ({ text: sampleLines[idx] || "" }),
	};
	const detectedDoc = findEnclosingSceneName(mockDocument, 5, candidates);
	assert.strictEqual(detectedDoc, "auth-flow", "通过 lineAt 接口也应正确推导场景");

	// 2.7 detectSceneFromActiveEditor: 无编辑器或非 debug-scenes.json 文件
	assert.strictEqual(detectSceneFromActiveEditor(candidates, undefined), undefined);
	const nonConfigEditor = {
		document: { fileName: "/path/to/other.ts", lineAt: () => ({ text: "" }) },
		selection: { active: { line: 0 } },
	};
	assert.strictEqual(detectSceneFromActiveEditor(candidates, nonConfigEditor), undefined);

	// 2.8 detectSceneFromActiveEditor: 正确匹配 debug-scenes.json
	const configEditor = {
		document: {
			fileName: "/workspace/.vscode/debug-scenes.json",
			lineAt: (idx) => ({ text: sampleLines[idx] || "" }),
		},
		selection: { active: { line: 10 } },
	};
	assert.strictEqual(detectSceneFromActiveEditor(candidates, configEditor), "payment-flow");

	console.log("  ✅ [UI Locators] sceneJsonLocator 单元测试全部通过！");
}

if (process.argv[1]?.endsWith("scene_json_locator.test.mjs")) {
	runSceneJsonLocatorTests();
}
