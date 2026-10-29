// Minecraft 總控：啟動本機伺服器（Java 21）、每位員工一個機器人、第一人稱畫面串流、狀態查詢。
// 全部只綁 127.0.0.1。由 server.js 啟動（設定檔 minecraft.enabled 為 true 時）。
// 伺服器 jar 與 EULA 由 npm run minecraft:setup 處理，這裡不下載、也不代為同意 EULA。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const mineflayer = require('mineflayer');
const { Brain } = require('./brain.cjs');
const { startViewer } = require('./viewer.cjs');

const ROOT = path.join(__dirname, '..');
const MC_DIR = path.join(ROOT, 'minecraft');
const JAVA = process.env.MC_JAVA || 'java';
const MEMORY = /^\d{1,2}G$/.test(process.env.MC_MEMORY || '') ? process.env.MC_MEMORY : '2G';
const MC_VERSION = '1.21.4';
const MC_PORT = 25570;
const STATUS_PORT = Number(process.env.MC_STATUS_PORT || 4879);
const VIEWER_BASE_PORT = 4881;
const OFFICE = `http://127.0.0.1:${process.env.PORT || 4870}`;
const STAFF = (process.env.OFFICE_STAFF || '').split(',').filter(Boolean);
// 示範模式（狀態來源是 demo）：機器人多做看得出動作的事，開場設成白天
const DEMO = process.env.OFFICE_DEMO === '1';
const MAX_BOTS = 8;
// 真人玩家（office.config.json 的 minecraft.guests 或 MC_GUESTS）：一起放進白名單，進來後自動改成觀察者
const GUESTS = (process.env.MC_GUESTS || '').split(',').filter((n) => /^[A-Za-z0-9_]{3,16}$/.test(n));
const STATE_FILE = path.join(MC_DIR, 'office-bots.json');
// 第一次進世界時給的起始工具與建材（透過伺服器主控台 give）
const STARTER_KIT = ['stone_pickaxe', 'stone_axe', 'stone_shovel', 'cobblestone 64', 'oak_planks 64', 'torch 16', 'bread 16'];

const log = (...a) => console.log('[mc]', ...a);

// ---- 前置檢查（EULA 只讀，不代改） ----

function eulaAccepted() {
  try {
    return /^eula=true\s*$/m.test(fs.readFileSync(path.join(MC_DIR, 'eula.txt'), 'utf8'));
  } catch {
    return false;
  }
}

if (!fs.existsSync(path.join(MC_DIR, 'server.jar'))) {
  log('找不到 minecraft/server.jar，不啟動 Minecraft');
  process.exit(0);
}
if (!eulaAccepted()) {
  log('尚未同意 Minecraft EULA：請執行 npm run minecraft:setup，自己閱讀 https://aka.ms/MinecraftEULA 後輸入 yes。這次不啟動 Minecraft');
  process.exit(0);
}

// ---- 名稱與狀態檔 ----

// Minecraft 玩家名稱只能用英數與底線，其餘字元換成底線（名牌仍顯示員工代號）
const mcName = (name) => name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 16);

function offlineUuid(name) {
  const h = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { homes: {}, kit: {} };
  }
}
const state = loadState();
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');

// 白名單只放目前的員工機器人與設定的真人玩家（離線 UUID）；每次都整份重寫，所以 guests 不會被機器人同步蓋掉；有變動回傳 true
function ensureWhitelist(names) {
  const file = path.join(MC_DIR, 'whitelist.json');
  const want = [...new Set([...names.map(mcName), ...GUESTS])].sort().map((n) => ({ uuid: offlineUuid(n), name: n }));
  let current = '';
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {}
  const next = JSON.stringify(want, null, 2) + '\n';
  if (current === next) return false;
  fs.writeFileSync(file, next);
  return true;
}

// ---- 伺服器 ----

let java = null;
let serverReady = false;
const console_ = (cmd) => java?.stdin.write(cmd + '\n');

function startServer() {
  ensureWhitelist(wantedBots());
  // macOS／Linux 用獨立程序群組：終端機按 Ctrl+C 不會直接打斷 Java，改由這裡下 stop 正常存檔。
  // Windows 加 detached 會另開視窗，所以不加（Ctrl+C 時 Java 自己的關閉流程也會存檔）
  java = spawn(JAVA, ['-Xms1G', `-Xmx${MEMORY}`, '-jar', 'server.jar', 'nogui'], {
    cwd: MC_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  java.on('error', (e) => {
    log(`無法啟動 Java（${JAVA}）：${e.message}。請安裝 Java 21，或在 office.config.json 設定 minecraft.java`);
    process.exit(1);
  });
  let buf = '';
  java.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (/Done \(/.test(line)) {
        serverReady = true;
        log('伺服器就緒：127.0.0.1:' + MC_PORT);
        onServerReady();
      } else if (/WARN|ERROR|joined the game|left the game|lost connection/.test(line)) {
        log(line.replace(/^\[[\d:]+\] /, ''));
        // 真人玩家進來：改成觀察者（可以飛、穿牆看機器人，不會碰到世界）
        const joined = /\]: ([A-Za-z0-9_]{3,16}) joined the game/.exec(line);
        const isBot = joined && [...bots.values()].some((e) => mcName(e.name) === joined[1]);
        if (joined && GUESTS.includes(joined[1]) && !isBot) setTimeout(() => console_(`gamemode spectator ${joined[1]}`), 500);
      }
    }
  });
  java.stderr.on('data', (d) => log(String(d).trim()));
  java.on('exit', (code) => {
    log('伺服器已結束', code);
    java = null;
    if (!shuttingDown) process.exit(1);
  });
}

// ---- 機器人 ----

const bots = new Map(); // 員工代號 → { bot, brain, viewer, port, connected }
let nextPort = VIEWER_BASE_PORT;
const officeStatus = new Map();

function createBot(name) {
  const entry = bots.get(name) || { name, port: nextPort++, connected: false, viewer: null };
  bots.set(name, entry);
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: MC_PORT, username: mcName(name), version: MC_VERSION, auth: 'offline' });
  entry.bot = bot;
  entry.brain = new Brain(bot, {
    home: state.homes[name] || null,
    onHome: (h) => {
      state.homes[name] = h;
      saveState();
    },
    log: (m) => log(`${name}: ${m}`),
    demo: DEMO,
  });
  bot.once('spawn', () => {
    entry.connected = true;
    entry.brain.setup();
    log(`${name} 已進入世界（玩家名稱 ${bot.username}）`);
    if (!state.kit[name]) {
      for (const item of STARTER_KIT) console_(`give ${bot.username} minecraft:${item}`);
      state.kit[name] = true;
      saveState();
    }
    if (!entry.viewer) entry.viewer = startViewer(bot, { port: entry.port, name, viewDistance: 4, hud: () => entry.brain.hud() });
  });
  bot.on('kicked', (reason) => log(`${name} 被踢出：${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
  bot.on('error', (e) => log(`${name} 錯誤：${e.message}`));
  bot.on('end', () => {
    entry.connected = false;
    entry.brain.setActive(false);
    entry.viewer?.close();
    entry.viewer = null;
    if (!shuttingDown) setTimeout(() => createBot(name), 5000);
  });
}

function wantedBots() {
  const only = (process.env.BOTS || '').split(',').filter(Boolean);
  if (only.length) return only;
  // 設定檔的員工，加上辦公室裡其他有座位的 Agent（最多 8 個）
  const others = [...officeStatus.keys()].filter((n) => !STAFF.includes(n));
  return [...STAFF, ...others].slice(0, MAX_BOTS);
}

function printGuestHelp() {
  if (!GUESTS.length) return;
  log(`真人玩家（${GUESTS.join('、')}）可以進遊戲看員工：
      1. 在同一台電腦打開 Minecraft Java 版，版本選 ${MC_VERSION}
      2. 多人遊戲 → 直接連線 → 位址輸入 localhost:${MC_PORT}
      3. 進來後會自動變成觀察者模式：可以飛、穿牆；按數字鍵 1 打開觀察者選單，選員工就能跳到他身上看
      伺服器是離線模式而且只綁 127.0.0.1，只能在這台電腦上連。`);
}

function onServerReady() {
  printGuestHelp();
  // 示範模式開場設成白天（晚上機器人會回家站著，看不出在做什麼）；不改遊戲規則，接真的 Agent 時不動
  if (DEMO) console_('time set day');
  syncBots();
}

// 每 3 秒讀一次辦公室的員工狀態（只讀）
async function pollOffice() {
  try {
    const r = await fetch(`${OFFICE}/api/state`);
    const data = await r.json();
    if (Array.isArray(data.agents)) {
      officeStatus.clear();
      for (const a of data.agents) officeStatus.set(a.name, a.status);
    }
  } catch {
    // 辦公室還沒起來：維持上一次的狀態
  }
  if (serverReady) syncBots();
}

// 依目前員工名單補連機器人
function syncBots() {
  const names = wantedBots();
  const fresh = names.filter((n) => !bots.has(n));
  if (ensureWhitelist(names)) {
    console_('whitelist reload');
    // 等伺服器重新載入白名單再連，避免新機器人第一次被踢
    for (const n of fresh) bots.set(n, { name: n, port: nextPort++, connected: false, viewer: null });
    setTimeout(() => fresh.forEach((n) => createBot(n)), 1500);
  } else {
    for (const n of fresh) createBot(n);
  }
}
setInterval(pollOffice, 3000);
pollOffice();

// 只有辦公室螢幕正在看（有人連上畫面）而且員工真的閒置時，機器人才會動
setInterval(() => {
  for (const e of bots.values()) {
    if (!e.connected) continue;
    const st = officeStatus.get(e.name);
    const playing = (e.viewer?.watchers() || 0) > 0 && (st === 'idle' || st === 'done');
    e.brain.setActive(playing);
  }
}, 1000);

// ---- 狀態查詢（給辦公室伺服器用，只綁本機） ----

const statusServer = http.createServer((req, res) => {
  if (req.headers.host !== `127.0.0.1:${STATUS_PORT}` || req.url !== '/bots') {
    res.writeHead(404);
    return res.end();
  }
  const list = [...bots.values()].map((e) => ({
    name: e.name,
    mcName: mcName(e.name),
    port: e.port,
    connected: e.connected,
    active: !!e.brain?.active,
    task: e.brain?.task || 'idle',
    placed: e.brain?.stats.placed || 0,
    dug: e.brain?.stats.dug || 0,
    watchers: e.viewer?.watchers() || 0,
    pos: e.bot?.entity ? e.bot.entity.position.floored() : null,
  }));
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ready: serverReady, time: bots.values().next().value?.bot?.time?.timeOfDay ?? null, bots: list }));
});
statusServer.listen(STATUS_PORT, '127.0.0.1');

// ---- 關閉：先讓機器人離線，再請伺服器存檔關閉 ----

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('關閉中…');
  for (const e of bots.values()) {
    e.brain?.setActive(false);
    e.viewer?.close();
    try {
      e.bot?.quit();
    } catch {}
  }
  statusServer.close();
  if (java) {
    console_('stop');
    const killer = setTimeout(() => java?.kill(), 30000);
    await new Promise((r) => java.once('exit', r));
    clearTimeout(killer);
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// 萬一這個程序自己異常結束，也不要留下沒人管的 Java
process.on('exit', () => java?.kill());

// 在 npm start 的終端機輸入文字，會轉給 Minecraft 伺服器主控台（例如 time set night、list）。
// 輸入 stop（辦公室伺服器關閉時也會送這行）：先讓機器人離線，再請伺服器存檔關閉
let stdinBuf = '';
process.stdin.on('data', (d) => {
  stdinBuf += d;
  let i;
  while ((i = stdinBuf.indexOf('\n')) >= 0) {
    const cmd = stdinBuf.slice(0, i).trim();
    stdinBuf = stdinBuf.slice(i + 1);
    if (cmd === 'stop') shutdown();
    else if (cmd && serverReady) console_(cmd);
  }
});
process.stdin.on('error', () => {});

startServer();
