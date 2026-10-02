import assert from "node:assert/strict";
import { findBreakpointLineInJson } from "#src/ui/locators/treeviewLocator.ts";

export function runTreeviewLocatorTests() {
	console.log("  ▶ [UI Locators] 运行 treeviewLocator 专职物理行号检索单测套件...");

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

	// 1. 查找 login 场景中的源码断点 (line 42)
	const line1 = findBreakpointLineInJson(sampleJson, "login", {
		type: "source",
		file: "src/auth.ts",
		line: 42,
	});
	assert.ok(line1 > 0, "应精准定位到 source 断点行号");

	// 2. 查找 login 场景中的函数断点
	const lineFunc = findBreakpointLineInJson(sampleJson, "login", {
		type: "function",
		functionName: "loginHandler",
	});
	assert.ok(lineFunc > line1, "应精准定位到函数断点行号");

	// 3. 不存在的断点安全降级到场景声明行
	const lineFallback = findBreakpointLineInJson(sampleJson, "checkout", {
		type: "source",
		file: "non_existent.ts",
		line: 999,
	});
	assert.ok(lineFallback > 0, "未匹配时应安全回退至场景行号");

	console.log("  ✅ [UI Locators] treeviewLocator 单测全部通过！");
}

if (process.argv[1]?.endsWith("treeview_locator.test.mjs")) {
	runTreeviewLocatorTests();
}
