import assert from "node:assert";
import * as vscode from "vscode";
import { SceneCodeLensProvider } from "#src/infra/vscode/sceneCodeLensProvider";
import { sceneStateManager } from "#src/domain/sceneStateManager";
import { stripJsonComments } from "#src/infra/storage/jsonFileSceneRepository";

export async function runCodeLensProviderTests() {
	console.log("  ▶ [CodeLens Provider] 运行 SceneCodeLensProvider 单元测试套件（直连生产源码）...");

	// 1. 非 debug-scenes.json 文件直接返回空数组
	{
		const mockDoc = {
			fileName: "D:/project/repo/.vscode/settings.json",
			getText: () => '{"scenes": {}}',
			lineCount: 1,
			lineAt: () => ({ text: '{"scenes": {}}' }),
		};
		const provider = new SceneCodeLensProvider();
		const lenses = provider.provideCodeLenses(mockDoc);
		assert.strictEqual(lenses.length, 0, "非 debug-scenes.json 配置文件绝对不产生 CodeLens");
	}

	// 2. 临时语法损坏或不完整 JSON 静默降级，不抛出异常并返回空数组
	{
		const mockDoc = {
			fileName: "D:/project/repo/.vscode/debug-scenes.json",
			getText: () => '{"scenes": { invalid json...',
			lineCount: 1,
			lineAt: () => ({ text: '{"scenes": { invalid json...' }),
		};
		const provider = new SceneCodeLensProvider();
		let lenses;
		assert.doesNotThrow(() => {
			lenses = provider.provideCodeLenses(mockDoc);
		}, "语法损坏时必须被内部 try-catch 静默吞掉，避免打扰用户编辑");
		assert.strictEqual(lenses.length, 0, "语法不合法时返回空透镜数组");
	}

	// 3. 场景名正则特殊字符逃逸测试
	{
		const complexSceneNames = [
			"api-v1.0.debug",
			"auth[special-token]+test",
			"user_query(scope)",
			"price*$calculated^value?",
		];

		const scenesJson = {
			scenes: Object.fromEntries(complexSceneNames.map((name) => [name, []])),
		};
		const jsonText = JSON.stringify(scenesJson, null, 2);
		const lines = jsonText.split(/\r?\n/);

		const mockDoc = {
			fileName: "D:/project/repo/.vscode/debug-scenes.json",
			getText: () => jsonText,
			lineCount: lines.length,
			lineAt: (i) => ({ text: lines[i] }),
		};

		const provider = new SceneCodeLensProvider();
		const lenses = provider.provideCodeLenses(mockDoc);

		assert.strictEqual(
			lenses.length,
			complexSceneNames.length,
			"所有含正则特殊字符的场景名必须全部被 SceneCodeLensProvider 安全识别",
		);

		for (const name of complexSceneNames) {
			const matched = lenses.find((l) => l.command?.arguments?.[0] === name);
			assert.ok(matched, `场景名 "${name}" 必须在 CodeLens 中生成对应参数`);
		}
	}

	// 4. 复杂注释与尾逗号 JSONC 下 CodeLens 提取与激活状态感知测试
	{
		const rawJsonc = `
		{
			// 系统配置头注释
			/* 块注释说明 */
			"scenes": {
				"auth-login": [
					{ "file": "src/auth.ts", "line": 15 }, // 行末注释
				],
				"pay-flow": [
					{ "file": "src/pay.ts", "line": 88 },
				], // 场景尾部逗号
			},
		}
		`;

		// 验证生产 stripJsonComments 清洗逻辑
		const cleaned = stripJsonComments(rawJsonc);
		const parsed = JSON.parse(cleaned);
		assert.ok(parsed.scenes["auth-login"], "JSONC 清洗后必须成功解析出 auth-login");
		assert.ok(parsed.scenes["pay-flow"], "JSONC 清洗后必须成功解析出 pay-flow");

		// 设置内存状态机为仅激活 auth-login
		sceneStateManager.setActiveScenes(["auth-login"], 1);

		const lines = rawJsonc.split(/\r?\n/);
		const mockDoc = {
			fileName: "D:/project/repo/.vscode/debug-scenes.json",
			getText: () => rawJsonc,
			lineCount: lines.length,
			lineAt: (i) => ({ text: lines[i] }),
		};

		const provider = new SceneCodeLensProvider();
		const lenses = provider.provideCodeLenses(mockDoc);

		assert.strictEqual(lenses.length, 2, "必须生成两个场景对应的 CodeLens");

		const authLens = lenses.find((l) => l.command?.arguments?.[0] === "auth-login");
		const payLens = lenses.find((l) => l.command?.arguments?.[0] === "pay-flow");

		assert.ok(authLens);
		assert.ok(payLens);

		assert.ok(
			authLens.command.title.includes("✔ Active"),
			`已激活场景透镜标题必须带有 ✔ 徽标: actual = ${authLens.command.title}`,
		);
		assert.ok(
			payLens.command.title.includes("▶ Apply"),
			`未激活场景透镜标题必须展示 ▶ Apply: actual = ${payLens.command.title}`,
		);
	}

	console.log("  ✅ [CodeLens Provider] SceneCodeLensProvider 单元测试全部通过！");
}
