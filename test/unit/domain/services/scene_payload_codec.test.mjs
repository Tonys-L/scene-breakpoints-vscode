import assert from "node:assert";
import {
	ScenePayloadCodec,
	defaultScenePayloadCodec,
	encodeScenePayload,
	decodeScenePayload,
	getSupportedFormatsTemplate,
	sanitizeScenesConfig,
} from "#src/domain/services/scenePayloadCodec";
import { Scene } from "#src/domain/models/scene";

export function runScenePayloadCodecTests() {
	console.log("  ▶ [Scene Payload Codec] 运行 ScenePayloadCodec 编解码与清洗全维单元测试套件（直连领域服务）...");

	// 1. encode / encodeScenePayload 序列化规范
	{
		const bps = [
			{ type: "line", file: "src\\components\\Button.tsx", line: 42, enabled: true },
			{ type: "function", functionName: "handleSubmit", enabled: false },
		];
		const jsonText = encodeScenePayload("login-flow", bps);
		const parsed = JSON.parse(jsonText);

		assert.strictEqual(parsed.sceneName, "login-flow");
		assert.strictEqual(parsed.version, "1.0");
		assert.ok(parsed.$schema);
		assert.ok(parsed.exportedAt);
		assert.strictEqual(parsed.breakpoints.length, 2);

		// 路径归一化验证：Windows 反斜杠必须被转换为 /
		assert.strictEqual(parsed.breakpoints[0].file, "src/components/Button.tsx");
		assert.strictEqual(parsed.breakpoints[1].functionName, "handleSubmit");

		// 单例与静态方法一致性
		const serializedAgain = JSON.parse(ScenePayloadCodec.encode("login-flow", bps));
		assert.strictEqual(serializedAgain.sceneName, parsed.sceneName);
		assert.deepStrictEqual(serializedAgain.breakpoints, parsed.breakpoints);
	}

	// 2. stripMarkdown 提取
	{
		assert.strictEqual(ScenePayloadCodec.stripMarkdown("  ```json\n{\"test\": 1}\n```  "), '{"test": 1}');
		assert.strictEqual(ScenePayloadCodec.stripMarkdown("```jsonc\r\n{\"test\": 2}\r\n```"), '{"test": 2}');
		assert.strictEqual(ScenePayloadCodec.stripMarkdown('{"plain": 3}'), '{"plain": 3}');
	}

	// 3. getSupportedFormatsTemplate 模板生成
	{
		const template = getSupportedFormatsTemplate({ title: "Custom Title" });
		assert.ok(template.includes("Custom Title"));
		assert.ok(template.includes("Format 1: Standard Scene Payload"));
		assert.ok(template.includes("Format 2: scenes dictionary"));
		assert.ok(template.includes("Format 3: Raw breakpoint array"));
	}

	// 4. decodeScenePayload 错误防御与边界拦截
	{
		// 空内容拦截
		const emptyRes = decodeScenePayload("");
		assert.strictEqual(emptyRes.success, false);
		assert.strictEqual(emptyRes.error, "Empty content");

		const spaceRes = decodeScenePayload("   \n\t  ");
		assert.strictEqual(spaceRes.success, false);
		assert.strictEqual(spaceRes.error, "Empty content");

		// 超过 1MB 尺寸防爆拦截 (使用非空字符以穿透 trim() 检查)
		const hugeStr = "a".repeat(1024 * 1024 + 10);
		const hugeRes = decodeScenePayload(hugeStr);
		assert.strictEqual(hugeRes.success, false);
		assert.ok(hugeRes.error.includes("exceeds maximum size limit"));

		// 语法损坏 JSON
		const brokenRes = decodeScenePayload("{ invalid json");
		assert.strictEqual(brokenRes.success, false);
		assert.ok(brokenRes.error.includes("Invalid JSON format"));

		// 根结构为基本类型而非对象/数组
		const scalarRes = decodeScenePayload("12345");
		assert.strictEqual(scalarRes.success, false);

		// 无有效断点拦截
		const noBpRes = decodeScenePayload('{"scenes": {"empty": []}}');
		assert.strictEqual(noBpRes.success, false);
		assert.strictEqual(noBpRes.error, "No valid breakpoints found in the payload");
	}

	// 5. decodeScenePayload 4 大合法格式清洗解析
	{
		// 格式 1: 标准 Payload (含 Markdown 代码块包裹)
		const fmt1 = "```json\n" + JSON.stringify({
			sceneName: "auth-flow",
			breakpoints: [
				{ type: "line", file: "src\\auth.ts", line: 10.8, condition: "isValid == true" },
				{ type: "function", functionName: "login" },
			],
		}, null, 2) + "\n```";
		const res1 = decodeScenePayload(fmt1);
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
		const res2 = decodeScenePayload(fmt2);
		assert.strictEqual(res2.success, true);
		assert.strictEqual(res2.sceneName, "payment-module");
		assert.strictEqual(res2.breakpoints.length, 1);
		assert.strictEqual(res2.breakpoints[0].file, "src/pay.ts");
		assert.strictEqual(res2.breakpoints[0].type, "line");

		// 格式 3: 裸数组
		const fmt3 = `[
			{ "file": "src/index.ts", "line": 1 }
		]`;
		const res3 = decodeScenePayload(fmt3, "default-target");
		assert.strictEqual(res3.success, true);
		assert.strictEqual(res3.sceneName, "default-target", "裸数组应回退为指定的默认场景名");
		assert.strictEqual(res3.breakpoints.length, 1);

		// 格式 4: 扁平单场景键
		const fmt4 = `{
			"custom-suite": [
				{ "file": "src/suite.ts", "line": 99 }
			]
		}`;
		const res4 = decodeScenePayload(fmt4);
		assert.strictEqual(res4.success, true);
		assert.strictEqual(res4.sceneName, "custom-suite");
		assert.strictEqual(res4.breakpoints.length, 1);
	}

	// 6. ScenePayloadCodec 类实例与静态门面一致性验证
	{
		const codec = new ScenePayloadCodec();
		const encoded = codec.encode("test-scene", [{ type: "line", file: "src/main.ts", line: 10, enabled: true }]);
		assert.ok(encoded.includes("\"sceneName\": \"test-scene\""));
		const decoded = codec.decode(encoded);
		assert.strictEqual(decoded.success, true);
		if (decoded.success) {
			assert.strictEqual(decoded.sceneName, "test-scene");
			assert.strictEqual(decoded.breakpoints.length, 1);
		}

		// 静态门面调用断言 (斩杀静态代理变异体)
		const validBpsJson = JSON.stringify([{ file: "src/main.ts", line: 1 }]);
		assert.ok(ScenePayloadCodec.encode("s2", []).includes("s2"));
		assert.strictEqual(ScenePayloadCodec.decode(validBpsJson).success, true);
		assert.strictEqual(codec.decode(validBpsJson).success, true);
		assert.strictEqual(codec.decode("[]").success, false);
		assert.strictEqual(codec.encode("s3", []).includes("s3"), true);

		// 独立函数导出与默认模板参数覆盖
		assert.ok(encodeScenePayload("s4", []).includes("s4"));
		assert.strictEqual(decodeScenePayload(validBpsJson).success, true);
		assert.strictEqual(decodeScenePayload("[]").success, false);
		const defaultTmpl = getSupportedFormatsTemplate();
		assert.ok(defaultTmpl.includes("Scene Breakpoints: Supported Payload Formats"));

		// 剥离 Markdown 与注释方法断言
		assert.strictEqual(codec.stripMarkdown("```json\n{\"test\":1}\n```").trim(), "{\"test\":1}");
		assert.strictEqual(codec.stripComments("// comment\n{\"a\":1}").replace(/\s/g, ""), "{\"a\":1}");

		// 字符串场景名 trim 序列化验证 (斩杀 name.trim() 变异体)
		const trimmedPayload = JSON.parse(encodeScenePayload("   padded-scene   ", []));
		assert.strictEqual(trimmedPayload.sceneName, "padded-scene");

		// 非对象或数组原始类型（数字、字符串）错误处理断言 (斩杀 typeof parsed !== 'object' 变异体)
		const numberRes = decodeScenePayload("12345");
		assert.strictEqual(numberRes.success, false);
		assert.strictEqual(numberRes.error, "Payload must be a JSON object or array");
		const strRes = decodeScenePayload("\"just string\"");
		assert.strictEqual(strRes.success, false);
		assert.strictEqual(strRes.error, "Payload must be a JSON object or array");
	}

	// 7. 【变异斩杀】断点全属性精细清洗 (trim、空串转 undefined、类型枚举与 enabled 默认值)
	{
		const rawPayload = JSON.stringify({
			sceneName: "cleanse-suite",
			breakpoints: [
				// (1) 文件行首尾空格与反斜杠，类型为 condition，各字段含首尾空格
				{
					type: "condition",
					file: "  src\\utils\\calc.ts  ",
					line: 12.9,
					condition: "  x > 10  ",
					hitCondition: "  >= 3  ",
					logMessage: "  user count: {c}  ",
					desc: "  check active user  ",
					enabled: false,
					contextSnippet: { current: "const x = 1;" },
				},
				// (2) hitCount 类型，纯空白字段必须安全降为 undefined，enabled 非布尔值回退为 true
				{
					type: "hitCount",
					file: "src/api.ts",
					line: 20,
					condition: "   ",
					hitCondition: "   ",
					logMessage: "   ",
					desc: "   ",
					enabled: "invalid-boolean", // 必须回退为 true
					contextSnippet: "non-object-snippet", // 非对象必须回退为 undefined
				},
				// (3) logpoint 类型
				{
					type: "logpoint",
					file: "src/logger.ts",
					line: 30,
					logMessage: "just log",
				},
				// (4) 未知非法类型，必须降级为 "line"
				{
					type: "totallyUnknownType",
					file: "src/fallback.ts",
					line: 40,
				},
				// (5) 显式 line 类型必须保留为 "line"
				{
					type: "line",
					file: "src/explicit-line.ts",
					line: 50,
				},
				// (6) 无效断点过滤：file 为空、line 非数字、line <= 0
				null,
				12345,
				{ file: "  ", line: 1 },
				{ file: "valid.ts", line: 0 },
				{ file: "valid.ts", line: -5 },
				{ file: "valid.ts", line: NaN },
			],
		});

		const res = decodeScenePayload(rawPayload);
		assert.strictEqual(res.success, true);
		assert.strictEqual(res.breakpoints.length, 5);

		// 断言断点 1：trim 清洗、取整与 enabled=false 严格保留
		const bp1 = res.breakpoints[0];
		assert.strictEqual(bp1.type, "condition");
		assert.strictEqual(bp1.file, "src/utils/calc.ts", "文件路径必须严格 trim 且转正斜杠");
		assert.strictEqual(bp1.line, 12, "浮点行号必须取整");
		assert.strictEqual(bp1.condition, "x > 10");
		assert.strictEqual(bp1.hitCondition, ">= 3");
		assert.strictEqual(bp1.logMessage, "user count: {c}");
		assert.strictEqual(bp1.desc, "check active user");
		assert.strictEqual(bp1.enabled, false, "enabled: false 必须严格保持");
		assert.deepStrictEqual(bp1.contextSnippet, { current: "const x = 1;" });

		// 断言断点 2：空白串安全转为 undefined，enabled 与 snippet 安全降级
		const bp2 = res.breakpoints[1];
		assert.strictEqual(bp2.type, "hitCount");
		assert.strictEqual(bp2.condition, undefined);
		assert.strictEqual(bp2.hitCondition, undefined);
		assert.strictEqual(bp2.logMessage, undefined);
		assert.strictEqual(bp2.desc, undefined);
		assert.strictEqual(bp2.enabled, true, "非布尔 enabled 必须降级为 true");
		assert.strictEqual(bp2.contextSnippet, undefined, "非对象 contextSnippet 必须降级为 undefined");

		// 断言断点 3：logpoint
		const bp3 = res.breakpoints[2];
		assert.strictEqual(bp3.type, "logpoint");
		assert.strictEqual(bp3.logMessage, "just log");

		// 断言断点 4：未知类型回退为 "line"
		const bp4 = res.breakpoints[3];
		assert.strictEqual(bp4.type, "line");

		// 断言断点 5：显式 line 类型保留为 "line"
		const bp5 = res.breakpoints[4];
		assert.strictEqual(bp5.type, "line");
		assert.strictEqual(bp5.file, "src/explicit-line.ts");
	}

	// 8. 【变异斩杀】function 类型断点字段校验与清洗
	{
		const funcPayload = JSON.stringify([
			{
				type: "function",
				functionName: "   processPayment   ",
				condition: "  isRetry  ",
				hitCondition: "  10  ",
				desc: "  pay func  ",
				enabled: false,
			},
			{
				type: "function",
				functionName: "defaultEnabledFunc",
				// enabled 缺省，必须默认为 true
			},
			{
				type: "function",
				functionName: "   ", // 全空白，必须被排除
			},
			{
				type: "function",
				functionName: 12345, // 非字符串，必须被排除
			},
		]);

		const res = decodeScenePayload(funcPayload);
		assert.strictEqual(res.success, true);
		assert.strictEqual(res.breakpoints.length, 2);
		const fbp = res.breakpoints[0];
		assert.strictEqual(fbp.type, "function");
		assert.strictEqual(fbp.functionName, "processPayment");
		assert.strictEqual(fbp.condition, "isRetry");
		assert.strictEqual(fbp.hitCondition, "10");
		assert.strictEqual(fbp.desc, "pay func");
		assert.strictEqual(fbp.enabled, false);

		const fbp2 = res.breakpoints[1];
		assert.strictEqual(fbp2.functionName, "defaultEnabledFunc");
		assert.strictEqual(fbp2.enabled, true, "function 断点未显式传 enabled 必须默认为 true");
	}

	// 9. 【变异斩杀】场景名称提取与默认回退优先级
	{
		// (1) 裸数组未指定 defaultSceneName 时，默认场景名为 "imported-scene"
		const resDefault = decodeScenePayload("[]");
		assert.strictEqual(resDefault.success, false); // 空数组会被拦截

		const resArrayDefault = decodeScenePayload("[{ \"file\": \"a.ts\", \"line\": 1 }]");
		assert.strictEqual(resArrayDefault.sceneName, "imported-scene");

		// (2) 裸数组传入带空格的 defaultSceneName，必须被 trim
		const resArrayCustom = decodeScenePayload("[{ \"file\": \"a.ts\", \"line\": 1 }]", "  my-target  ");
		assert.strictEqual(resArrayCustom.sceneName, "my-target");

		// (3) parsed.sceneName 为非字符串或空白时，回退到 defaultSceneName
		const resBlankName = decodeScenePayload(JSON.stringify({
			sceneName: "   ",
			breakpoints: [{ file: "a.ts", line: 1 }],
		}), "fallback-scene");
		assert.strictEqual(resBlankName.sceneName, "fallback-scene");

		// (4) 格式 2：scenes 字典包含空数组与有效场景
		const resScenes = decodeScenePayload(JSON.stringify({
			scenes: {
				"scene-one": [{ file: "a.ts", line: 1 }],
			},
		}));
		assert.strictEqual(resScenes.sceneName, "scene-one");

		// (5) 格式 4：过滤保留字段 ($schema, version, exportedAt)
		const resMetaFiltered = decodeScenePayload(JSON.stringify({
			$schema: "https://schema.org",
			version: "1.0",
			exportedAt: "2026-10-01",
			"discovered-scene": [{ file: "b.ts", line: 2 }],
		}));
		assert.strictEqual(resMetaFiltered.sceneName, "discovered-scene");
	}

	// 10. 【变异斩杀】1MB 防爆截断临界点测试 (1024*1024 恰好达标 vs 超界 1 字节)
	{
		// 刚好 1MB: 1048576 字节
		const exactOneMbHeader = '{"sceneName":"1mb","breakpoints":[{"file":"a.ts","line":1}],"filler":"';
		const exactOneMbFooter = '"}';
		const fillerLength = 1024 * 1024 - exactOneMbHeader.length - exactOneMbFooter.length;
		const exactOneMbPayload = exactOneMbHeader + "x".repeat(fillerLength) + exactOneMbFooter;
		assert.strictEqual(exactOneMbPayload.length, 1024 * 1024);
		const exactRes = decodeScenePayload(exactOneMbPayload);
		assert.strictEqual(exactRes.success, true, "恰好 1MB 的数据必须允许解析");

		// 超过 1MB 仅 1 字节: 1048577 字节，必须拦截
		const overflowOneBytePayload = exactOneMbPayload + " ";
		assert.strictEqual(overflowOneBytePayload.length, 1024 * 1024 + 1);
		const overflowRes = decodeScenePayload(overflowOneBytePayload);
		assert.strictEqual(overflowRes.success, false);
		assert.ok(overflowRes.error.includes("exceeds maximum size limit"));
	}

	// 11. 【变异斩杀】encode 序列化对 Scene 实例与 function 断点反斜杠保持
	{
		const sceneInstance = new Scene("  instance-scene  ", [
			{
				type: "function",
				functionName: "myFunc",
				enabled: true,
			},
			{
				type: "line",
				file: "src\\windows\\path.ts",
				line: 10,
				enabled: true,
			},
		]);
		// 验证 Scene 实例能正确提取 name.trim() 与断点
		const encoded = ScenePayloadCodec.encode(sceneInstance);
		const parsed = JSON.parse(encoded);
		assert.strictEqual(parsed.sceneName, "instance-scene");
		assert.strictEqual(parsed.version, "1.0");
		// function 断点不替换反斜杠
		assert.strictEqual(parsed.breakpoints[0].type, "function");
		// line 断点反斜杠转为 /
		assert.strictEqual(parsed.breakpoints[1].file, "src/windows/path.ts");

		// 不传 breakpoints 默认为空数组
		const emptyEncoded = JSON.parse(ScenePayloadCodec.encode("empty-scene"));
		assert.deepStrictEqual(emptyEncoded.breakpoints, []);
	}

	// 12. 【变异斩杀】候选负载提取分支隔离、元数据过滤与断点属性类型守卫
	{
		// (1) 仅有 sceneName 没有 breakpoints 数组 (拦截 || 变异体)
		const onlyNameRes = decodeScenePayload(JSON.stringify({ sceneName: "only-name" }));
		assert.strictEqual(onlyNameRes.success, false);
		assert.strictEqual(onlyNameRes.error, "No valid breakpoints found in the payload");

		// (2) 仅有 breakpoints 数组而无 sceneName，应按键名提取解析 (拦截 || 变异体)
		const onlyBpsRes = decodeScenePayload(JSON.stringify({ breakpoints: [{ file: "a.ts", line: 1 }] }));
		assert.strictEqual(onlyBpsRes.success, true);
		assert.strictEqual(onlyBpsRes.sceneName, "breakpoints");
		assert.strictEqual(onlyBpsRes.breakpoints.length, 1);

		// (3) scenes 为非对象类型（字符串、数字、null、数组），拦截 typeof !== 'object' 变异体
		const strScenesRes = decodeScenePayload(JSON.stringify({ scenes: "invalid-string" }));
		assert.strictEqual(strScenesRes.success, false);
		const numScenesRes = decodeScenePayload(JSON.stringify({ scenes: 12345 }));
		assert.strictEqual(numScenesRes.success, false);
		const nullScenesRes = decodeScenePayload(JSON.stringify({ scenes: null }));
		assert.strictEqual(nullScenesRes.success, false);
		const arrScenesRes = decodeScenePayload(JSON.stringify({ scenes: [{ file: "a.ts", line: 1 }] }));
		// scenes 是数组，不满足 typeof === 'object' && !Array.isArray，降级按顶层 keys[0] 解析
		assert.strictEqual(arrScenesRes.success, true);
		assert.strictEqual(arrScenesRes.sceneName, "scenes");

		// 非对象 scenes 无法解析为有效断点
		const nonObjScenesRes = decodeScenePayload(JSON.stringify({ scenes: 12345 }));
		assert.strictEqual(nonObjScenesRes.success, false);
		assert.strictEqual(nonObjScenesRes.error, "No valid breakpoints found in the payload");

		// (4) scenes 为空字典 {} 或场景值为非数组 (拦截 keys[0] 与非数组变异体)
		const emptyDictRes = decodeScenePayload(JSON.stringify({ scenes: {} }));
		assert.strictEqual(emptyDictRes.success, false);
		assert.strictEqual(emptyDictRes.error, "No valid breakpoints found in the payload");

		const nonArrDictRes = decodeScenePayload(JSON.stringify({ scenes: { "empty-target": "not-an-array" } }));
		assert.strictEqual(nonArrDictRes.success, false);

		// (5) 仅含 $schema, version, exportedAt 保留元数据字段的空对象 (拦截 keys.length > 0 变异体)
		const metaOnlyRes = decodeScenePayload(JSON.stringify({
			$schema: "https://schema.org",
			version: "1.0",
			exportedAt: "2026-10-02T00:00:00.000Z",
		}));
		assert.strictEqual(metaOnlyRes.success, false);

		// (6) 自定义顶层 key 的值不是数组 (拦截 Array.isArray 变异体)
		const nonArrCustomRes = decodeScenePayload(JSON.stringify({ customKey: "not-an-array" }));
		assert.strictEqual(nonArrCustomRes.success, false);

		// (7) 严格断点属性类型守卫：缺失 file、file 为数字、file 为 null (拦截 typeof item.file === 'string' 变异体)
		const invalidFilePayload = JSON.stringify([
			{ line: 10 },                       // 缺失 file
			{ file: 12345, line: 20 },          // file 为数字
			{ file: null, line: 30 },           // file 为 null
			{ file: true, line: 40 },           // file 为布尔
			{ file: "valid.ts", line: "100" },  // line 为字符串数字，必须被 typeof item.line === 'number' 拦截
			{ file: "valid.ts", line: null },   // line 为 null
			{ file: "valid.ts", line: true },   // line 为布尔
			"Stryker was here",                 // 基本类型字符串
			99999,                              // 基本类型数字
		]);
		const invalidFileRes = decodeScenePayload(invalidFilePayload);
		assert.strictEqual(invalidFileRes.success, false, "所有无效断点必须被守卫完全拦截");
		assert.strictEqual(invalidFileRes.error, "No valid breakpoints found in the payload");

		// (8) 显式验证 line 类型为 "line" 且正常保留 (击杀 types.includes 变异体)
		const lineTypePayload = JSON.stringify([{ file: "src/foo.ts", line: 5, type: "line" }]);
		const lineTypeRes = decodeScenePayload(lineTypePayload);
		assert.strictEqual(lineTypeRes.success, true);
		assert.strictEqual(lineTypeRes.breakpoints[0].type, "line");
	}

	// 13. sanitizeScenesConfig 与 ScenePayloadCodec.sanitizeConfig 全局配置清洗
	{
		// 空值与非对象兜底
		assert.deepStrictEqual(sanitizeScenesConfig(null), { scenes: {} });
		assert.deepStrictEqual(sanitizeScenesConfig("invalid"), { scenes: {} });
		assert.deepStrictEqual(sanitizeScenesConfig([1, 2, 3]), { scenes: {} });

		// 正常配置提取与脏数据过滤
		const rawConfig = {
			$schema: "http://example.com/schema.json",
			activeScenes: [" scene-a ", "scene-b", ""],
			bindings: {
				"launch-task": " scene-a ",
				"multi-task": ["scene-a", " scene-b ", ""],
				invalidBinding: 12345,
			},
			scenes: {
				"scene-a": [
					{ file: "src/a.ts", line: 10 },
					null,
					"invalid-bp",
				],
			},
		};

		const sanitized = sanitizeScenesConfig(rawConfig);
		assert.deepStrictEqual(sanitized.activeScenes, ["scene-a", "scene-b"]);
		assert.strictEqual(sanitized.bindings["launch-task"], "scene-a");
		assert.deepStrictEqual(sanitized.bindings["multi-task"], ["scene-a", "scene-b"]);
		assert.strictEqual(sanitized.bindings.invalidBinding, undefined);
		assert.strictEqual(sanitized.scenes["scene-a"].length, 1);
		assert.strictEqual(sanitized.scenes["scene-a"][0].file, "src/a.ts");

		// 验证类静态门面与单例门面一致性
		const sanitizedViaClass = ScenePayloadCodec.sanitizeConfig(rawConfig);
		assert.deepStrictEqual(sanitizedViaClass, sanitized);
		const sanitizedViaInstance = defaultScenePayloadCodec.sanitizeConfig(rawConfig);
		assert.deepStrictEqual(sanitizedViaInstance, sanitized);
	}

	console.log("  ✅ [Scene Payload Codec] ScenePayloadCodec 领域编解码单元测试全部通过！");
}

if (process.argv[1]?.endsWith("scene_payload_codec.test.mjs")) {
	runScenePayloadCodecTests();
}
