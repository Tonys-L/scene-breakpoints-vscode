/**
 * 画布图形库打包脚本 (v1.3.0 ADR-008)
 * 职责：将 @antv/g6 以 devDependency 构建期打包为 webview 静态资源
 * media/graph/g6-bundle.js（IIFE + minify），生产 dependencies 保持为零。
 * 运行：node scripts/build-graph-bundle.mjs（build.mjs 会自动联动调用）
 */
import { build } from "esbuild";
import { mkdirSync, statSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(projectRoot, "media", "graph", "g6-bundle.js");

mkdirSync(path.dirname(outfile), { recursive: true });

await build({
	stdin: {
		contents: `
			import * as G6 from "@antv/g6";
			window.G6 = G6;
		`,
		resolveDir: projectRoot,
		sourcefile: "g6-bundle-entry.mjs",
	},
	bundle: true,
	minify: true,
	format: "iife",
	target: "es2020",
	outfile,
	logLevel: "info",
});

const sizeKb = (statSync(outfile).size / 1024).toFixed(1);
console.log(`✅ g6-bundle.js 已生成 (${sizeKb} KB): media/graph/g6-bundle.js`);

const webviewEntry = path.join(projectRoot, "src", "ui", "views", "graphCanvas", "webview", "index.tsx");
const webviewOut = path.join(projectRoot, "media", "graph", "graphWebview.js");

console.log("🚀 Building Preact webview application bundle...");
await build({
	entryPoints: [webviewEntry],
	bundle: true,
	minify: true,
	format: "iife",
	target: "es2020",
	jsx: "automatic",
	jsxImportSource: "preact",
	outfile: webviewOut,
	logLevel: "info",
});

const webviewSizeKb = (statSync(webviewOut).size / 1024).toFixed(1);
console.log(`✅ graphWebview.js (Preact) 已生成 (${webviewSizeKb} KB): media/graph/graphWebview.js`);

console.log("🚀 Building Webview CSS bundle...");
const cssEntry = path.join(projectRoot, "src", "ui", "views", "graphCanvas", "webview", "styles.css");
const cssOut = path.join(projectRoot, "media", "graph", "graphWebview.css");
await build({
	entryPoints: [cssEntry],
	minify: true,
	outfile: cssOut,
	logLevel: "info",
});
const cssSizeKb = (statSync(cssOut).size / 1024).toFixed(1);
console.log(`✅ graphWebview.css 已生成 (${cssSizeKb} KB): media/graph/graphWebview.css`);

const htmlEntry = path.join(projectRoot, "src", "ui", "views", "graphCanvas", "webview", "index.html");
const htmlOut = path.join(projectRoot, "media", "graph", "index.html");
copyFileSync(htmlEntry, htmlOut);
console.log(`✅ index.html 模板已同步: media/graph/index.html`);
