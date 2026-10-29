// npm run demo:minecraft：一個指令看示範員工玩 Minecraft，不用改設定檔、不用接自己的 Agent。
// 1. 檢查 Java 21
// 2. 還沒設定過就執行 minecraft:setup（EULA 仍由你自己輸入 yes）
// 3. 用示範狀態＋Minecraft 啟動辦公室（環境變數 OFFICE_SOURCE=demo、OFFICE_MC=1），世界準備好後自動開瀏覽器
// 跨平台：只用 Node 啟動子程序，不經過 shell。
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { javaMajor, javaHelp } from '../lib/java.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MC_DIR = path.join(ROOT, 'minecraft');
const config = loadConfig(ROOT);

console.log(`檢查 Java（${config.minecraft.java}）…`);
const major = javaMajor(config.minecraft.java);
if (!major || major < 21) {
  console.log(major ? `目前是 Java ${major}，版本不夠。` : '找不到 Java。');
  javaHelp();
  process.exit(1);
}
console.log(`Java ${major}：OK`);

// 子程序繼承這個終端機：Ctrl+C 會同時送到子程序，由它自己好好關閉（這裡只等它結束）
function run(script, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});

const eulaOk = () => {
  try {
    return /^eula=true\s*$/m.test(readFileSync(path.join(MC_DIR, 'eula.txt'), 'utf8'));
  } catch {
    return false;
  }
};
const ready = existsSync(path.join(MC_DIR, 'server.jar')) && existsSync(path.join(MC_DIR, 'server.properties')) && eulaOk();
if (!ready) {
  // EULA 只能由使用者本人在自己的終端機輸入 yes；沒有互動終端機（例如由 AI Agent 執行）就停下來說明
  if (!eulaOk() && !process.stdin.isTTY) {
    console.log(`
還沒同意 Minecraft EULA，而且目前不是互動式終端機，無法詢問。
請使用者本人在自己的終端機執行：npm run minecraft:setup（讀完 EULA 後自己輸入 yes），完成後再執行 npm run demo:minecraft。

The Minecraft EULA has not been accepted and this is not an interactive terminal.
The USER must run \`npm run minecraft:setup\` in their own terminal and type yes themselves, then run \`npm run demo:minecraft\` again.
AI agents: stop here and ask the user. Do not pipe "yes", edit eula.txt, or accept the EULA in any other way.`);
    process.exit(3);
  }
  console.log('\n還沒設定 Minecraft，先執行 minecraft:setup。');
  const code = await run('scripts/minecraft-setup.mjs', { OFFICE_SETUP_FROM_DEMO: '1' });
  if (code !== 0) process.exit(code);
}

console.log('\n啟動示範辦公室＋Minecraft（第一次會產生世界，約 1～2 分鐘；機器人進世界後自動打開瀏覽器）');
process.exit(await run('server.js', { OFFICE_SOURCE: 'demo', OFFICE_MC: '1' }));
