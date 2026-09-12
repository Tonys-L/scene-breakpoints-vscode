import * as path from "node:path";
import * as fs from "node:fs";
import Mocha from "mocha";

export function run(): Promise<void> {
  // 创建 Mocha 实例
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 30000,
  });

  const testsRoot = path.resolve(__dirname, "suite");

  return new Promise<void>((resolve, reject) => {
    function findTestFiles(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findTestFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
          mocha.addFile(fullPath);
        }
      }
    }

    try {
      findTestFiles(testsRoot);

      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
