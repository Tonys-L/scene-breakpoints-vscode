import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "..");
    const extensionTestsPath = path.resolve(__dirname, "../out-test/index.js");
    const testWorkspace = path.resolve(__dirname, "../test-fixtures/sample-workspace");

    console.log("🚀 Starting VS Code E2E Tests via @vscode/test-electron...");
    console.log(`📁 Extension Path: ${extensionDevelopmentPath}`);
    console.log(`🧪 Test Runner: ${extensionTestsPath}`);
    console.log(`📂 Sandbox Workspace: ${testWorkspace}`);

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspace,
        "--disable-extensions",
        "--disable-gpu",
      ],
    });

    console.log("🎉 All E2E Tests Completed Successfully!");
  } catch (err) {
    console.error("❌ Failed to run E2E tests:", err);
    process.exit(1);
  }
}

main();
