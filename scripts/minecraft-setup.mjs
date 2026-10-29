// npm run minecraft:setup
// 1. 檢查 Java 21 以上（沒有就顯示 macOS／Windows／Linux 的安裝方式）
// 2. 顯示 Minecraft EULA 連結，使用者自己輸入 yes 才寫入 eula=true
// 3. 從 Mojang 官方版本清單下載 1.21.4 伺服器 jar，並驗證 sha1
// 4. 寫入只綁 127.0.0.1 的 server.properties
// 這個 repo 不附任何 Mojang 檔案；jar 與世界存檔都放在 minecraft/（不進版控）。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MC_DIR = path.join(ROOT, 'minecraft');
const VERSION = '1.21.4';
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const EULA_URL = 'https://aka.ms/MinecraftEULA';

// 只綁本機、只讓白名單裡的辦公室機器人進來（機器人用離線帳號，所以 online-mode 關掉）
const PROPERTIES = {
  'server-ip': '127.0.0.1',
  'server-port': '25570',
  'online-mode': 'false',
  'white-list': 'true',
  'enforce-whitelist': 'true',
  'enable-rcon': 'false',
  'enable-query': 'false',
  'max-players': '8',
  difficulty: 'peaceful',
  'spawn-protection': '0',
  'view-distance': '6',
  'simulation-distance': '6',
  'player-idle-timeout': '0',
  motd: 'Agent Office (local only)',
};

const config = loadConfig(ROOT);
const step = (n, text) => console.log(`\n[${n}/4] ${text}`);

// ---- 1. Java ----

function javaMajor(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) return null;
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${r.stderr}${r.stdout}`);
  if (!m) return null;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]);
}

function javaHelp() {
  console.log(`
需要 Java 21 以上。安裝方式：
  macOS（Homebrew）： brew install openjdk@21
                     然後把 office.config.json 的 minecraft.java 設成 /opt/homebrew/opt/openjdk@21/bin/java
                     （Intel Mac 是 /usr/local/opt/openjdk@21/bin/java）
  Windows：          winget install Microsoft.OpenJDK.21
                     裝好後重新開一個終端機視窗，java -version 應該顯示 21
  Linux（Debian／Ubuntu）： sudo apt install openjdk-21-jre-headless
也可以從 https://adoptium.net/ 下載 Temurin 21。
如果 java 不在 PATH 上，請在 office.config.json 設定 minecraft.java 為 java 執行檔的完整路徑。`);
}

step(1, `檢查 Java（${config.minecraft.java}）`);
const major = javaMajor(config.minecraft.java);
if (!major || major < 21) {
  console.log(major ? `目前是 Java ${major}，版本不夠。` : '找不到 Java。');
  javaHelp();
  process.exit(1);
}
console.log(`Java ${major}：OK`);

// ---- 2. EULA（只有使用者自己輸入 yes 才寫入） ----

step(2, 'Minecraft 使用者授權協議（EULA）');
const eulaFile = path.join(MC_DIR, 'eula.txt');
const accepted = existsSync(eulaFile) && /^eula=true\s*$/m.test(readFileSync(eulaFile, 'utf8'));
if (accepted) {
  console.log('minecraft/eula.txt 已經是 eula=true（之前由你同意過）。');
} else {
  console.log(`執行 Minecraft 伺服器前，你必須自己閱讀並同意 Minecraft EULA：\n  ${EULA_URL}`);
  if (!process.stdin.isTTY) {
    console.log('\n目前不是互動式終端機，無法詢問。請在終端機直接執行 npm run minecraft:setup。');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer = '';
  try {
    answer = (await rl.question('\n已閱讀並同意 EULA 請輸入 yes（其他輸入會取消）：')).trim().toLowerCase();
  } catch {
    answer = ''; // Ctrl+C／Ctrl+D 當作取消
  }
  rl.close();
  if (answer !== 'yes') {
    console.log('沒有同意 EULA，已取消。沒有下載或寫入任何 Minecraft 檔案。');
    process.exit(1);
  }
  await fs.mkdir(MC_DIR, { recursive: true });
  await fs.writeFile(eulaFile, `# 由使用者在 npm run minecraft:setup 中輸入 yes 同意（${new Date().toISOString()}）\n# ${EULA_URL}\neula=true\n`);
  console.log('已寫入 minecraft/eula.txt');
}

// ---- 3. 下載伺服器 jar（官方版本清單＋sha1 驗證） ----

step(3, `下載 Minecraft ${VERSION} 伺服器`);
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} 回應 ${r.status}`);
  return r.json();
}
const jar = path.join(MC_DIR, 'server.jar');
try {
  const manifest = await getJson(MANIFEST);
  const entry = manifest.versions.find((v) => v.id === VERSION);
  if (!entry) throw new Error(`版本清單裡找不到 ${VERSION}`);
  const info = (await getJson(entry.url)).downloads?.server;
  if (!info?.url || !info?.sha1) throw new Error('版本資料裡沒有伺服器下載位置');
  if (existsSync(jar) && sha1(await fs.readFile(jar)) === info.sha1) {
    console.log('minecraft/server.jar 已是正確版本（sha1 相符），略過下載。');
  } else {
    console.log(`下載中（約 ${Math.round(info.size / 1024 / 1024)} MB）…`);
    const r = await fetch(info.url);
    if (!r.ok) throw new Error(`下載失敗：${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const got = sha1(buf);
    if (got !== info.sha1) throw new Error(`sha1 不符（預期 ${info.sha1}，實際 ${got}），已丟棄下載的檔案`);
    await fs.writeFile(`${jar}.tmp`, buf);
    await fs.rename(`${jar}.tmp`, jar);
    console.log(`已下載並驗證 sha1：${got}`);
  }
} catch (e) {
  console.log(`下載失敗：${e.message}`);
  process.exit(1);
}

// ---- 4. server.properties（只改這裡列的欄位，其他保留） ----

step(4, '寫入 server.properties（只綁 127.0.0.1）');
const propsFile = path.join(MC_DIR, 'server.properties');
let lines = existsSync(propsFile) ? readFileSync(propsFile, 'utf8').split(/\r?\n/) : [];
const done = new Set();
lines = lines.map((line) => {
  const k = line.split('=')[0];
  if (!line.startsWith('#') && k in PROPERTIES) {
    done.add(k);
    return `${k}=${PROPERTIES[k]}`;
  }
  return line;
});
for (const [k, v] of Object.entries(PROPERTIES)) if (!done.has(k)) lines.push(`${k}=${v}`);
await fs.writeFile(propsFile, lines.filter((l, i) => l || i < lines.length - 1).join('\n') + '\n');
console.log('server.properties：server-ip=127.0.0.1、server-port=25570、白名單開啟');

console.log(`
完成。接下來：
  1. 打開 office.config.json，把 "minecraft": { "enabled": false } 改成 true
     （還沒有 office.config.json 的話，先複製 office.config.example.json）
  2. npm start
第一次啟動會產生世界，約需 1～2 分鐘；之後員工閒置時會進 Minecraft 玩。`);
