import assert from "node:assert";
import {
	generateScenePayload,
	serializeScenePayload,
	stripMarkdownCodeBlocks,
	getSupportedFormatsTemplate,
	parseScenePayload,
} from "#src/application/payloadSerializer";

export function runPayloadSerializerTests() {
	console.log("  ▶ [Payload Serializer] 运行 payloadSerializer 序列化与清洗全维单元测试套件（真实源码）...");

	// 1. generateScenePayload / serializeScenePayload 序列化规范
	{
		const bps = [
			{ type: "line", file: "src\\components\\Button.tsx", line: 42, enabled: true },
			{ type: "function", functionName: "handleSubmit", enabled: false },
		];
		const jsonText = generateScenePayload("login-flow", bps);
		const parsed = JSON.parse(jsonText);

		assert.strictEqual(parsed.sceneName, "login-flow");
		assert.strictEqual(parsed.version, "1.0");
		assert.ok(parsed.$schema);
		assert.ok(parsed.exportedAt);
		assert.strictEqual(parsed.breakpoints.length, 2);

		// 路径归一化验证：Windows 反斜杠必须被转换为 /
		assert.strictEqual(parsed.breakpoints[0].file, "src/components/Button.tsx");
		assert.strictEqual(parsed.breakpoints[1].functionName, "handleSubmit");

		// 别名一致性
		assert.strictEqual(serializeScenePayload, generateScenePayload);
	}

	// 2. stripMarkdownCodeBlocks 提取
	{
		assert.strictEqual(stripMarkdownCodeBlocks("  ```json\n{\"test\": 1}\n```  "), '{"test": 1}');
		assert.strictEqual(stripMarkdownCodeBlocks("```jsonc\r\n{\"test\": 2}\r\n```"), '{"test": 2}');
		assert.strictEqual(stripMarkdownCodeBlocks('{"plain": 3}'), '{"plain": 3}');
	}

	// 3. getSupportedFormatsTemplate 模板生成
	{
		const template = getSupportedFormatsTemplate({ title: "Custom Title" });
		assert.ok(template.includes("Custom Title"));
		assert.ok(template.includes("Format 1: Standard Scene Payload"));
		assert.ok(template.includes("Format 2: scenes dictionary"));
		assert.ok(template.includes("Format 3: Raw breakpoint array"));
	}

	// 4. parseScenePayload 错误防御与边界拦截
	{
		// 空内容拦截
		const emptyRes = parseScenePayload("");
		assert.strictEqual(emptyRes.success, false);
		assert.strictEqual(emptyRes.error, "Empty content");

		const spaceRes = parseScenePayload("   \n\t  ");
		assert.strictEqual(spaceRes.success, false);
		assert.strictEqual(spaceRes.error, "Empty content");

		// 超过 1MB 尺寸防爆拦截 (使用非空字符以穿透 trim() 检查)
		const hugeStr = "a".repeat(1024 * 1024 + 10);
		const hugeRes = parseScenePayload(hugeStr);
		assert.strictEqual(hugeRes.success, false);
		assert.ok(hugeRes.error.includes("exceeds maximum size limit"));

		// 语法损坏 JSON
		const brokenRes = parseScenePayload("{ invalid json");
		assert.strictEqual(brokenRes.success, false);
		assert.ok(brokenRes.error.includes("Invalid JSON format"));

		// 根结构为基本类型而非对象/数组
		const scalarRes = parseScenePayload("12345");
		assert.strictEqual(scalarRes.success, false);

		// 无有效断点拦截
		const noBpRes = parseScenePayload('{"scenes": {"empty": []}}');
		assert.strictEqual(noBpRes.success, false);
		assert.strictEqual(noBpRes.error, "No valid breakpoints found in the payload");
	}

	// 5. parseScenePayload 4 大合法格式清洗解析
	{
		// 格式 1: 标准 Payload (含 Markdown 代码块包裹)
		const fmt1 = "```json\n" + JSON.stringify({
			sceneName: "auth-flow",
			breakpoints: [
				{ type: "line", file: "src\\auth.ts", line: 10.8, condition: "isValid == true" },
				{ type: "function", functionName: "login" },
			],
		}, null, 2) + "\n```";
		const res1 = parseScenePayload(fmt1);
		assert.strictEqual(res1.success, true);
		assert.strictEqual(res1.sceneName, "auth-flow");
		assert.strictEqual(res1.breakpoints.length, 2);
		assert.strictEqual(res1.breakpoints[0].file, "src/auth.ts");
		assert.strictEqual(res1.breakpoints[0].line, 10, "行号必须取整");
		assert.strictEqual(res1.breakpoints[0].condition, "isValid == true");
		assert.strictEqual(res1.breakpoints[1].type, "function");
		assert.strictEqual(res1.breakpoints[1].functionName, "login");

		// 格式 2: debug-scenes.json 片段
		const fmt2 = `{
			"scenes": {
				"payment-module": [
					{ "file": "src/pay.ts", "line": 50 }
				]
			}
		}`;
		const res2 = parseScenePayload(fmt2);
		assert.strictEqual(res2.success, true);
		assert.strictEqual(res2.sceneName, "payment-module");
		assert.strictEqual(res2.breakpoints.length, 1);
		assert.strictEqual(res2.breakpoints[0].file, "src/pay.ts");
		assert.strictEqual(res2.breakpoints[0].type, "line");

		// 格式 3: 裸数组
		const fmt3 = `[
			{ "file": "src/index.ts", "line": 1 }
		]`;
		const res3 = parseScenePayload(fmt3, "default-target");
		assert.strictEqual(res3.success, true);
		assert.strictEqual(res3.sceneName, "default-target", "裸数组应回退为指定的默认场景名");
		assert.strictEqual(res3.breakpoints.length, 1);

		// 格式 4: 扁平单场景键
		const fmt4 = `{
			"custom-suite": [
				{ "file": "src/suite.ts", "line": 99 }
			]
		}`;
		const res4 = parseScenePayload(fmt4);
		assert.strictEqual(res4.success, true);
		assert.strictEqual(res4.sceneName, "custom-suite");
		assert.strictEqual(res4.breakpoints.length, 1);
	}

	console.log("  ✅ [Payload Serializer] payloadSerializer 单元测试全部通过！");
}
