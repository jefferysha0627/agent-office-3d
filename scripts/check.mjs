// npm run check：對所有 .js／.cjs／.mjs 做語法檢查，並確認範例 JSON 格式正確（跨平台，不用 shell 語法）
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'minecraft']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
let failed = 0;
for (const f of files.filter((f) => /\.(c|m)?js$/.test(f))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`✗ ${path.relative(ROOT, f)}\n${r.stderr}`);
  }
}
for (const f of files.filter((f) => f.endsWith('.json') && !f.endsWith('package-lock.json'))) {
  try {
    JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    failed++;
    console.error(`✗ ${path.relative(ROOT, f)}：${e.message}`);
  }
}
console.log(failed ? `語法檢查失敗：${failed} 個檔案` : `語法檢查通過（${files.length} 個檔案掃描）`);
process.exit(failed ? 1 : 0);
