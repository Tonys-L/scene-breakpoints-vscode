import fs from 'node:fs';
import path from 'node:path';

export function extractChangelogSection(filePath, targetVersion) {
  if (!fs.existsSync(filePath)) {
    return '';
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const normalizedVersion = targetVersion.replace(/^v/, '');

  let capturing = false;
  const capturedLines = [];

  for (const line of lines) {
    // 匹配类似 ## [1.0.4] 或 ## 1.0.4
    const headerMatch = line.match(/^##\s+\[?([0-9]+\.[0-9]+\.[0-9]+[^\]\s]*)\]?/);
    if (headerMatch) {
      const versionInHeader = headerMatch[1];
      if (versionInHeader === normalizedVersion) {
        capturing = true;
        continue;
      } else if (capturing) {
        // 遇到下一个版本标题，结束提取
        break;
      }
    }

    if (capturing) {
      capturedLines.push(line);
    }
  }

  let result = capturedLines.join('\n').trim();
  // 移除末尾的分隔线
  while (result.endsWith('---')) {
    result = result.slice(0, -3).trim();
  }
  return result;
}

export function generateReleaseNotes({
  version,
  workspaceRoot = process.cwd(),
  outputFile = 'RELEASE_NOTES.md',
} = {}) {
  const pkgPath = path.join(workspaceRoot, 'package.json');
  let targetVersion = version;
  if (!targetVersion && fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    targetVersion = pkg.version;
  }

  if (!targetVersion) {
    throw new Error('Target version could not be determined.');
  }

  const enChangelogPath = path.join(workspaceRoot, 'CHANGELOG.md');
  const zhChangelogPath = path.join(workspaceRoot, 'CHANGELOG_zh.md');

  const enNotes = extractChangelogSection(enChangelogPath, targetVersion);
  const zhNotes = extractChangelogSection(zhChangelogPath, targetVersion);

  const parts = [];

  if (enNotes) {
    parts.push(`## What's Changed in v${targetVersion}\n\n${enNotes}`);
  }

  if (zhNotes) {
    parts.push(
      `<details>\n<summary><b>🇨🇳 简体中文更新说明 (点击展开)</b></summary>\n\n${zhNotes}\n\n</details>`
    );
  }

  if (parts.length === 0) {
    return '';
  }

  const finalNotes = parts.join('\n\n---\n\n');
  const outputPath = path.isAbsolute(outputFile)
    ? outputFile
    : path.join(workspaceRoot, outputFile);

  fs.writeFileSync(outputPath, finalNotes, 'utf8');
  console.log(`[extract-changelog] Release notes written to ${outputPath} (Version: ${targetVersion}, Length: ${finalNotes.length})`);
  return finalNotes;
}

// CLI 执行入口
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const argVersion = process.env.GITHUB_REF_NAME || process.argv[2];
  generateReleaseNotes({ version: argVersion });
}
