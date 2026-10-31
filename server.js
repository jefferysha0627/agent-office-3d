// Agent Office 3D｜本機伺服器
// - 只綁 127.0.0.1，並檢查 Host 標頭，避免 DNS rebinding 讀到終端輸出。
// - 員工狀態來自設定的來源（demo 或 herdr）；herdr 只執行唯讀指令，沒有任何送鍵或下指令的 API。
// - 終端輸出只放在記憶體短暫快取，不寫入檔案、不記錄到 log。
// - 唯一的寫入是布告欄介面的「勾選待辦」。

import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, publicConfig } from './lib/config.js';
import { createSource } from './lib/sources.js';
import { BoardStore, BadInput, LIMITS as BOARD_LIMITS } from './lib/board-store.js';
import { ProjectsStore } from './lib/projects-store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(ROOT);

const HOST = '127.0.0.1';
const PORT = config.port;
const TASK_MAX_BYTES = 512 * 1024;
const TASKS_DIR = config.data.tasks;

const PUBLIC_DIR = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three', 'build');
// Minecraft：機器人程序（mc/run.cjs）的狀態查詢與檢視器頁面（prismarine-viewer 的前端）
const MC_STATUS_PORT = Number(process.env.MC_STATUS_PORT || 4879);
const PV_PUBLIC = path.join(ROOT, 'node_modules', 'prismarine-viewer', 'public');

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

// ---- 員工狀態 ----

const source = createSource(config);

// 預設只讀狀態（Minecraft 機器人、背景分頁都用這個）；?full=1 才讀終端內容（只有前景的辦公室網頁會帶）。
// ?focus=<員工> 讓員工面板正打開的那一位讀快一點。快取在各來源 adapter 裡（lib/sources.js）。
async function getState({ full = false, focus = null } = {}) {
  const { agents, error, lite } = await source.collect({ full, focus });
  return { source: source.type, live: source.type !== 'demo', lite, error, agents, tasks: await listTasks(), at: Date.now() };
}

// ---- 任務（只讀任務資料夾第一層檔案） ----

async function listTasks() {
  try {
    const entries = await fs.readdir(TASKS_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map(async (e) => {
          const st = await fs.stat(path.join(TASKS_DIR, e.name));
          return { name: e.name, mtime: st.mtimeMs, size: st.size };
        }),
    );
    return files.sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

async function readTask(name) {
  if (!name || name !== path.basename(name) || name.startsWith('.') || name.includes('\\') || name.includes('/')) return null;
  const full = path.join(TASKS_DIR, name);
  if (path.dirname(full) !== TASKS_DIR) return null;
  try {
    const st = await fs.stat(full);
    if (!st.isFile() || st.size > TASK_MAX_BYTES) return null;
    return { name, mtime: st.mtimeMs, content: await fs.readFile(full, 'utf8') };
  } catch {
    return null;
  }
}

// ---- Minecraft（機器人與第一人稱畫面） ----

let mcCache = { at: 0, data: { ready: false, bots: [] } };

function fetchMcStatus() {
  if (!config.minecraft.enabled) return Promise.resolve({ ready: false, bots: [] });
  if (Date.now() - mcCache.at < 1500) return Promise.resolve(mcCache.data);
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: MC_STATUS_PORT, path: '/bots', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          mcCache = { at: Date.now(), data: JSON.parse(body) };
        } catch {
          mcCache = { at: Date.now(), data: { ready: false, bots: [] } };
        }
        resolve(mcCache.data);
      });
    });
    req.on('error', () => {
      mcCache = { at: Date.now(), data: { ready: false, bots: [] } };
      resolve(mcCache.data);
    });
    req.on('timeout', () => req.destroy());
  });
}

async function botPort(name) {
  const bot = (await fetchMcStatus()).bots.find((b) => b.name === name && b.connected);
  return bot ? bot.port : null;
}

// 檢視器前端：送出時改三處——renderer 保留畫面（辦公室才讀得到每一格）、socket.io 只用 websocket（不必開放 POST）、
// 把 socket 掛到 window（辦公室畫遊戲介面用）
let viewerBundle = null;
async function patchedViewerBundle() {
  if (viewerBundle) return viewerBundle;
  let js = await fs.readFile(path.join(PV_PUBLIC, 'index.js'), 'utf8');
  const fixes = [
    ['const l=new THREE.WebGLRenderer;l.setPixelRatio(window.devicePixelRatio||1)', 'const l=new THREE.WebGLRenderer({preserveDrawingBuffer:!0});window.__mcRenderer=l;l.setPixelRatio(1)'],
    ['({path:window.location.pathname+"socket.io"})', '({path:window.location.pathname+"socket.io",transports:["websocket"]})'],
    // 讓辦公室拿得到這條連線，接收遊戲介面資料
    ['transports:["websocket"]});let s=!0;', 'transports:["websocket"]});window.__mcSocket=o;let s=!0;'],
  ];
  for (const [a, b] of fixes) {
    if (!js.includes(a)) throw new Error('prismarine-viewer bundle changed');
    js = js.replace(a, b);
  }
  viewerBundle = js;
  return js;
}

const MC_NAME = /^[A-Za-z0-9_-]{1,32}$/;

// 遊戲介面的物品圖示：依序找 items/、blocks/、blocks/<名稱>_side，都沒有就回透明小圖（不讓 console 報 404）
const MC_TEX = path.join(PV_PUBLIC, 'textures', '1.21.4');
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function serveMcIcon(res, name) {
  if (!/^[a-z0-9_]{1,64}$/.test(name)) return send(res, 404, { error: 'not found' });
  for (const rel of [`items/${name}.png`, `blocks/${name}.png`, `blocks/${name}_side.png`, `blocks/${name}_top.png`]) {
    try {
      return send(res, 200, await fs.readFile(path.join(MC_TEX, ...rel.split('/'))), 'image/png');
    } catch {
      // 換下一個位置找
    }
  }
  send(res, 200, BLANK_PNG, 'image/png');
}

async function serveMc(req, res, p) {
  const [, , name, ...rest] = p.split('/'); // /mc/<name>/...
  if (!MC_NAME.test(name || '')) return send(res, 404, { error: 'not found' });
  const sub = rest.join('/');
  if (sub === '') return serveStatic(res, PV_PUBLIC, 'index.html');
  if (sub === 'index.js') return send(res, 200, await patchedViewerBundle(), MIME['.js']);
  return serveStatic(res, PV_PUBLIC, sub);
}

// websocket 轉送：/mc/<name>/socket.io → 該員工機器人的畫面串流（127.0.0.1）
async function proxyUpgrade(req, socket, head) {
  const fail = () => socket.destroy();
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return fail();
  const m = /^\/mc\/([A-Za-z0-9_-]{1,32})\/socket\.io\//.exec(req.url || '');
  if (!m) return fail();
  const port = await botPort(m[1]);
  if (!port) return fail();
  const upstream = net.connect(port, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      lines.push(`${k}: ${k.toLowerCase() === 'host' ? `127.0.0.1:${port}` : req.rawHeaders[i + 1]}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', fail);
  socket.on('error', () => upstream.destroy());
}

// ---- 書架與布告欄 ----

// 書架的專案資料庫（只讀，規則見 lib/projects-store.js）
const projects = new ProjectsStore({ dir: config.data.projects });

const board = new BoardStore({
  file: config.data.board,
  example: config.data.boardExample,
  tasksDir: TASKS_DIR,
  countCases: async () => (await projects.list()).filter((p) => p.status === '進行中').length,
});
await board.init();
// 換月自動結算：每小時檢查一次（讀取時也會檢查）
setInterval(() => board.view().catch(() => {}), 3600e3);

async function boardView() {
  return { ...(await board.view()), currency: config.company.currency };
}

async function serveProjects(res, p, url) {
  const parts = p.split('/').filter(Boolean); // api, projects, <id>, files|file
  if (parts.length === 2) {
    const { board: b } = await board.read();
    return send(res, 200, { projects: await projects.list(b.archive.projects) });
  }
  const id = parts[2];
  if (parts.length === 4 && parts[3] === 'files') {
    const list = await projects.listFiles(id);
    return list ? send(res, 200, list) : send(res, 404, { error: 'not found' });
  }
  if (parts.length === 4 && parts[3] === 'file') {
    const f = await projects.file(id, url.searchParams.get('key'));
    if (!f) return send(res, 404, { error: 'not found' });
    if (f.nameOnly) return send(res, 403, { error: `${f.name}：這類檔案只顯示檔名，不顯示內容` });
    if (f.image) return send(res, 200, f.image, f.mime);
    return send(res, 200, f);
  }
  return send(res, 404, { error: 'not found' });
}

// Logo：設定檔指定的圖片（只接受常見圖片格式）
async function serveBrand(res, which) {
  const file = which === 'logo' ? config.company.logo : config.company.mark;
  const type = { '.svg': MIME['.svg'], '.png': MIME['.png'], '.jpg': MIME['.jpg'], '.jpeg': MIME['.jpeg'], '.webp': MIME['.webp'] }[path.extname(file).toLowerCase()];
  if (!type) return send(res, 404, { error: 'not found' });
  try {
    send(res, 200, await fs.readFile(file), type);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

let boardLock = Promise.resolve();
const serialize = (fn) => (boardLock = boardLock.then(fn, fn));

// 防 CSRF：同源、JSON、自訂標頭（跨站請求帶自訂標頭會被瀏覽器的預檢擋下）
function writeAllowed(req) {
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return false;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return false;
  return req.headers['x-agent-office'] === 'board';
}

class TooLarge extends Error {}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] || 0) > BOARD_LIMITS.bytes) return reject(new TooLarge());
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= BOARD_LIMITS.bytes) chunks.push(c);
    });
    req.on('end', () => {
      if (size > BOARD_LIMITS.bytes) return reject(new TooLarge());
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new BadInput('JSON 格式錯誤'));
      }
    });
    req.on('error', reject);
  });
}

async function handleBoardWrite(req, res) {
  if (!writeAllowed(req)) return send(res, 403, { error: '拒絕寫入（需要同源、JSON 與 X-Agent-Office 標頭）' });
  try {
    const input = await readJson(req);
    await serialize(() => board.toggleTodo(input.id, input.done));
    return send(res, 200, await boardView());
  } catch (e) {
    if (e instanceof TooLarge) {
      res.setHeader('Connection', 'close');
      return send(res, 413, { error: `資料太大（上限 ${BOARD_LIMITS.bytes / 1024}KB）` });
    }
    if (e instanceof BadInput) return send(res, 400, { error: e.message });
    return send(res, 500, { error: '儲存失敗' });
  }
}

// ---- HTTP ----

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function serveStatic(res, baseDir, rel) {
  const full = path.normalize(path.join(baseDir, ...rel.split('/')));
  if (!full.startsWith(baseDir + path.sep)) return send(res, 404, { error: 'not found' });
  try {
    const buf = await fs.readFile(full);
    send(res, 200, buf, MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return send(res, 403, { error: 'host not allowed' });
  let url;
  let p;
  try {
    url = new URL(req.url, `http://${req.headers.host}`);
    p = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, { error: 'bad request' });
  }
  // 只有「勾選待辦」可以寫，其他一律只讀
  if (req.method === 'POST' && p === '/api/board/todo') return handleBoardWrite(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'read only' });

  try {
    if (p === '/api/config') return send(res, 200, publicConfig(config));
    if (p === '/api/state') return send(res, 200, await getState({ full: url.searchParams.get('full') === '1', focus: url.searchParams.get('focus') }));
    if (p === '/api/task') {
      const task = await readTask(url.searchParams.get('name'));
      return task ? send(res, 200, task) : send(res, 404, { error: 'not found' });
    }
    if (p === '/api/board') return send(res, 200, await boardView());
    if (p === '/api/board/rev') return send(res, 200, { rev: await board.rev() });
    if (p === '/api/projects' || p.startsWith('/api/projects/')) return serveProjects(res, p, url);
    if (p === '/api/brand/logo' || p === '/api/brand/mark') return serveBrand(res, p.slice('/api/brand/'.length));
    if (p === '/api/mc') {
      const st = await fetchMcStatus();
      return send(res, 200, { enabled: config.minecraft.enabled, ready: !!st.ready, bots: st.bots.map(({ name, connected, active, task }) => ({ name, connected, active, task })) });
    }
    if (p.startsWith('/mc-icon/')) return serveMcIcon(res, p.slice('/mc-icon/'.length).replace(/\.png$/, ''));
    if (p.startsWith('/mc-assets/')) return serveStatic(res, MC_TEX, p.slice('/mc-assets/'.length));
    if (p.startsWith('/mc/')) return serveMc(req, res, p);
    if (p === '/favicon.ico') return serveBrand(res, 'mark');
    if (p.startsWith('/vendor/three/')) return serveStatic(res, THREE_DIR, p.slice('/vendor/three/'.length));
    return serveStatic(res, PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
  } catch {
    send(res, 500, { error: 'server error' });
  }
});

server.on('upgrade', (req, socket, head) => {
  proxyUpgrade(req, socket, head).catch(() => socket.destroy());
});

// ---- Minecraft：設定打開而且已經跑過 npm run minecraft:setup 才啟動 ----

let mcChild = null;
if (config.minecraft.enabled) {
  if (existsSync(path.join(ROOT, 'minecraft', 'server.jar'))) {
    mcChild = spawn(process.execPath, [path.join(ROOT, 'mc', 'run.cjs')], {
      stdio: ['pipe', 'inherit', 'inherit'],
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(PORT),
        MC_STATUS_PORT: String(MC_STATUS_PORT),
        MC_JAVA: config.minecraft.java,
        MC_MEMORY: config.minecraft.memory,
        OFFICE_STAFF: config.staff.map((s) => s.id).join(','),
        OFFICE_DEMO: config.source.type === 'demo' ? '1' : '0',
        MC_GUESTS: config.minecraft.guests.join(','),
      },
    });
    mcChild.on('exit', () => (mcChild = null));
    mcChild.stdin.on('error', () => {});
    // 在這個終端機輸入的文字轉給 Minecraft 主控台（例如 time set day、list）
    process.stdin.on('data', (d) => mcChild?.stdin.write(d));
    process.stdin.on('error', () => {});
  } else {
    console.log('設定已打開 Minecraft，但還沒有 minecraft/server.jar：請先執行 npm run minecraft:setup');
  }
}

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  if (!mcChild) process.exit(0);
  console.log('等待 Minecraft 存檔關閉…');
  mcChild.once('exit', () => process.exit(0));
  // 用 stdin 送 stop（Windows 沒有 SIGTERM 可以好好關），45 秒還沒關才強制結束
  mcChild.stdin.write('stop\n');
  setTimeout(() => {
    mcChild?.kill();
    process.exit(0);
  }, 45000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---- 啟動後打開瀏覽器（各平台用各自的方式，不經過 shell） ----

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // 打不開就算了，網址已經印在終端機
  }
}

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `連接埠 ${PORT} 已被使用：請關掉另一個程式，或在 office.config.json 改 port` : e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log(`Agent Office 3D：${url}  （只綁本機，Ctrl+C 停止）`);
  console.log(`狀態來源：${source.type === 'demo' ? 'demo（示範用假狀態）' : 'herdr（唯讀）'}・設定檔：${config.file ? path.relative(ROOT, config.file) : '（預設值）'}`);
  if (!config.openBrowser) return;
  if (!mcChild) return openBrowser(url);
  // 開了 Minecraft：等第一個機器人進世界再開瀏覽器（最多等 3 分鐘），一打開就看得到員工在玩
  const t0 = Date.now();
  const timer = setInterval(async () => {
    const st = await fetchMcStatus();
    const waited = Date.now() - t0 > 180e3;
    if (st.bots.some((b) => b.connected) || waited || !mcChild) {
      clearInterval(timer);
      if (!waited) console.log('機器人已進入 Minecraft 世界，打開瀏覽器');
      openBrowser(url);
    }
  }, 2000);
});
