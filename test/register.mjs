/**
 * Node.js 模块钩子注册（单元测试真实导入 src/*.ts 的基础设施）
 *
 * 用法：node --experimental-transform-types --import ./test/register.mjs test/run-all.mjs
 *
 * 职责：
 * 1. 将裸导入 "vscode" 重定向至 test/mocks/vscode.mock.mjs，
 *    使 Node 进程可以加载 src/ 下依赖 vscode API 的真实模块；
 * 2. 补齐 TypeScript 风格的无扩展名导入解析（"./types" → "./types.ts"，
 *    "../domain/ports" → "../domain/ports/index.ts"），Node ESM 原生不支持该语义。
 *
 * 说明：TS → JS 转译由 Node 原生 --experimental-transform-types 完成，无需额外依赖。
 */

import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

const VSCODE_MOCK_URL = new URL("./mocks/vscode.mock.mjs", import.meta.url).href;
const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

registerHooks({
	resolve(specifier, context, nextResolve) {
		// 1. vscode API 重定向至测试 Mock
		if (specifier === "vscode") {
			return { url: VSCODE_MOCK_URL, shortCircuit: true };
		}

		// 2. 原生 Subpath Imports 优先与 TypeScript 自动补全
		if (specifier.startsWith("#src/") || specifier.startsWith("#test/")) {
			const subpath = specifier.startsWith("#src/") ? `src/${specifier.slice(5)}` : `test/${specifier.slice(6)}`;
			const basePath = path.resolve(PROJECT_ROOT, subpath);
			for (const candidate of [basePath, `${basePath}.ts`, `${basePath}.mjs`, `${basePath}/index.ts`, `${basePath}/index.mjs`]) {
				const stat = fs.statSync(candidate, { throwIfNoEntry: false });
				if (stat?.isFile()) {
					return { url: pathToFileURL(candidate).href, shortCircuit: true };
				}
			}
		}

		try {
			return nextResolve(specifier, context);
		} catch (err) {
			// 3. TS 无扩展名相对导入兜底：仅处理相对路径
			if (specifier.startsWith("node:") || !context.parentURL) {
				throw err;
			}

			try {
				const parentPath = fileURLToPath(context.parentURL);
				const baseDir = path.dirname(parentPath);
				for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
					const abs = path.resolve(baseDir, candidate);
					const stat = fs.statSync(abs, { throwIfNoEntry: false });
					if (stat?.isFile()) {
						return { url: pathToFileURL(abs).href, shortCircuit: true };
					}
				}
			} catch {
				// 解析失败时抛出原始错误
			}
			throw err;
		}
	},
});
