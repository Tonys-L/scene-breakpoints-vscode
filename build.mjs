import { execSync } from "node:child_process";

console.log("🚀 Building VS Code Extension using esbuild...");

execSync(
	"npx esbuild src/extension.ts --bundle --outfile=extension.js --external:vscode --format=cjs --platform=node --target=node20",
	{ stdio: "inherit" },
);

console.log("✅ VS Code Extension built successfully: extension.js");
