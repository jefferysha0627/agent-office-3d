// Agent Office 3D：把 AI Agent 的即時狀態畫成一間 3D 辦公室。只看，不下指令。
import * as THREE from '/vendor/three/three.module.js';
import { buildOffice, makeSeat, makeBossDesk, DOOR, toiletDoor, treadmillBelt, HIP_SIT, bulletin, bookshelf, EXTRA_TRIM } from './scene.js';
import { drawBoard } from './bulletin.js';
import { createViewer } from './viewer.js';
import { drawHud } from './mchud.js';
import { Cat } from './cat.js';
import { IDLE_TIMING, createWalk, updateWorker, targetPose, propsFor, actionText } from './behavior.js';

// 公司名稱、負責人、員工清單等來自 office.config.json（伺服器只給不含本機路徑的公開設定）
const CONFIG = await fetch('/api/config', { cache: 'no-store' })
  .then((r) => r.json())
  .catch(() => ({ company: { name: 'Agent Office', currency: '$' }, owner: { name: 'Owner', title: '負責人' }, cat: { name: '麻糬' }, staff: [], source: 'demo' }));
document.title = `${CONFIG.company.name} 辦公室`;
document.getElementById('company-name').textContent = `${CONFIG.company.name} 辦公室`;

const params = new URLSearchParams(location.search);
const FAST = params.has('fast');
// 驗證用：?idle=coffee 讓閒置員工都挑這個動作（名稱見 behavior.js 的 IDLE_ACTIONS）
const FORCED_IDLE = params.get('idle');
// 驗證用：?cat=nap 讓貓的行程都選這個（wander／feet／desk／owner／nap）
const FORCED_CAT = params.get('cat');
// 員工狀態每 3 秒（只跑 agent list）；終端內容每 6 秒才讀一次（agent read 太頻繁會讓某些終端機畫面跳動）
const POLL_MS = 3000;
const FULL_MS = 6000;

// 座位網格：前後兩排、四欄等距對齊（中間兩欄之間留通道，看得到負責人）
const GRID_X = [-4.2, -1.4, 1.4, 4.2];
const ROW_Z = { front: 2.6, back: -1.6 };
const GRID = [...GRID_X.map((x) => ({ x, z: ROW_Z.front })), ...GRID_X.map((x) => ({ x, z: ROW_Z.back }))];

// 設定檔的員工依序坐前排再坐後排（最多 8 位）
const STAFF = CONFIG.staff.slice(0, GRID.length).map((s, i) => ({ name: s.id, role: s.title, color: s.color, ...GRID[i] }));
// 剩下的位子給設定檔以外的 Agent（例如臨時幫手 tmp-*）坐，沒人就是空位
const EXTRA = GRID.slice(STAFF.length);

const STATUS_TEXT = {
  working: '工作中',
  idle: '閒置',
  done: '完成待命',
  blocked: '需要確認',
  unknown: '狀態不明',
  absent: '不在線',
};

// ---- Three.js 基本設定 ----

const stage = document.getElementById('stage');
const labelsEl = document.getElementById('labels');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  document.getElementById('webgl-error').hidden = false;
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f4f6);

scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ea, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.9);
sun.position.set(6, 12, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
sun.shadow.bias = -0.0008;
sun.shadow.radius = 3;
scene.add(sun);

buildOffice(scene);
const boss = makeBossDesk(scene, { name: CONFIG.owner.name });
const cat = new Cat(scene, { name: CONFIG.cat.name });

// 固定視角的正交相機：不提供旋轉，只能平移與有限縮放
// 從員工正後方、略高往前看（越過肩膀看螢幕）
const VIEW_H = 7.8;
const VIEW_W = 10.8; // 預設框住四張員工桌與右側布告欄
const CAM_DIR = new THREE.Vector3(0, 0.72, 1).normalize();
const TARGET = new THREE.Vector3(0.3, 0.9, -1.35);
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.4;
const PAN_LIMIT = { x: 9, y: 4 };
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
camera.position.copy(TARGET).addScaledVector(CAM_DIR, 40);
camera.lookAt(TARGET);
camera.updateMatrixWorld();
const CAM_RIGHT = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
const CAM_UP = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
const BASE_POS = camera.position.clone();
const pan = { x: 0, y: 0 };

function applyCamera() {
  camera.position.copy(BASE_POS).addScaledVector(CAM_RIGHT, pan.x).addScaledVector(CAM_UP, pan.y);
}

function viewHeight() {
  const aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  return Math.max(VIEW_H, VIEW_W / aspect);
}

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h);
  const vh = viewHeight();
  const aspect = w / Math.max(1, h);
  camera.left = (-vh * aspect) / 2;
  camera.right = (vh * aspect) / 2;
  camera.top = vh / 2;
  camera.bottom = -vh / 2;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---- 座位 ----

const seats = [];
const clickable = [];

function registerSeat(seat) {
  seat.index = seats.length;
  seat.group.traverse((o) => {
    if (o.isMesh) {
      o.userData.seatIndex = seat.index;
      clickable.push(o);
    }
  });
  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'tag';
  label.innerHTML = '<span class="role"></span> <b></b>';
  label.addEventListener('click', () => openAgent(seat));
  labelsEl.append(label);
  seat.labelEl = label;
  seat.labelName = label.querySelector('b');
  seat.labelRole = label.querySelector('.role');
  const bubble = document.createElement('span');
  bubble.className = 'bubble';
  labelsEl.append(bubble);
  seat.bubbleEl = bubble;
  scene.add(seat.group);
  seats.push(seat);
}

for (const s of STAFF) {
  const built = makeSeat({ x: s.x, z: s.z, look: { trim: parseInt(s.color.slice(1), 16) }, title: s.name, props: true });
  registerSeat({ ...built, kind: 'staff', staff: s, name: s.name, data: null, ...initAnim() });
}
for (const e of EXTRA) {
  const built = makeSeat({ x: e.x, z: e.z, look: { trim: EXTRA_TRIM }, title: '', props: false });
  registerSeat({ ...built, kind: 'extra', name: null, data: null, ...initAnim() });
}

function initAnim() {
  return { status: null, action: 'sit', actionUntil: 0, pose: null };
}
for (const seat of seats) createWalk(seat);

// ---- 狀態與動作（規則在 behavior.js） ----

const rand = (a, b) => a + Math.random() * (b - a);
const speed = FAST ? 0.2 : 1;
// 示範模式：剛閒置時先偷玩遊戲、之後也比較常玩，打開頁面幾秒內就看得到 Minecraft；接真的 Agent 時維持原本機率
const DEMO = CONFIG.source === 'demo';
const behaviorOpts = { speed, forced: FORCED_IDLE, ...(DEMO ? { chance: { game: 140 }, firstDelay: [3, 8], firstIdle: 'game' } : {}) };

function screenMode(seat) {
  if (seat.status === 'absent') return 'off';
  if (seat.status === 'unknown') return 'unknown';
  if (seat.status === 'blocked') return 'blocked';
  if (seat.walk.mode !== 'seated') return 'away';
  if (seat.action === 'typing') return 'terminal';
  if (seat.action === 'game') return seat.game?.mc ? 'mc' : 'game';
  if (seat.action === 'sleep') return 'sleep';
  return 'dim';
}

// ---- Minecraft：偷玩遊戲時，螢幕顯示該員工機器人的第一人稱畫面 ----
// 每位員工一個 Mineflayer 機器人（mc/run.cjs）。畫面頁面 /mc/<員工>/ 與辦公室同源，
// 用隱藏的 iframe 開著（有人在看，機器人才會動），每秒約 12 格畫到員工螢幕上。
// Minecraft 沒開時用內建小遊戲；開了的話一律玩 Minecraft，機器人還沒連上時螢幕先顯示載入中。

let mcBots = new Map();
async function loadMc() {
  try {
    const r = await fetch('/api/mc', { cache: 'no-store' });
    const d = r.ok ? await r.json() : { bots: [] };
    mcBots = new Map((d.bots || []).map((b) => [b.name, b]));
  } catch {
    mcBots = new Map();
  }
}
loadMc();
setInterval(loadMc, 5000);

const mcHost = document.createElement('div');
mcHost.className = 'mc-frames';
mcHost.setAttribute('aria-hidden', 'true');
document.body.append(mcHost);

function startGame(seat) {
  if (!CONFIG.minecraft) {
    seat.game = { mc: false };
    return;
  }
  seat.game = { mc: true, iframe: null, frames: 0, next: 0 };
  attachMc(seat);
}

// 機器人連上了才開畫面頁（每格都會重試，晚連上的機器人也接得上）
function attachMc(seat) {
  if (seat.game.iframe || !mcBots.get(seat.name)?.connected) return;
  const iframe = document.createElement('iframe');
  iframe.src = `/mc/${encodeURIComponent(seat.name)}/`;
  iframe.tabIndex = -1;
  mcHost.append(iframe);
  seat.game.iframe = iframe;
}

// 關掉 iframe：畫面斷線，機器人就停下來
function stopGame(seat) {
  seat.game?.iframe?.remove();
  seat.game = null;
}

function drawMc(seat, t) {
  const g = seat.game;
  let canvas = null;
  try {
    canvas = g.iframe?.contentWindow?.__mcRenderer?.domElement || null;
  } catch {
    canvas = null;
  }
  if (!canvas || !canvas.width) return false;
  // 接上畫面頁的連線，收機器人的遊戲介面資料（快捷欄、手持、生命飢餓、揮手、挖掘）
  if (!g.hooked) {
    const sock = g.iframe.contentWindow.__mcSocket;
    if (sock) {
      sock.on('hud', (d) => (g.hud = d));
      g.hooked = true;
    }
  }
  if (t < g.next) return true;
  g.next = t + 1 / 12;
  const ctx = seat.screen.ctx;
  ctx.drawImage(canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
  if (g.hud) drawHud(ctx, g.hud, t);
  seat.screen.texture.needsUpdate = true;
  g.frames++;
  return true;
}

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function animateSeat(seat, t, dt) {
  const { ch } = seat;
  const w = seat.walk;
  ch.root.visible = seat.status !== 'absent' && !w.hidden;
  const target = targetPose(seat, t);
  if (!seat.pose) seat.pose = { ...target };
  const k = 1 - Math.exp(-dt * 9);
  for (const key in target) {
    if (key === 'penSpin') seat.pose.penSpin = target.penSpin;
    else seat.pose[key] += (target[key] - seat.pose[key]) * k;
  }
  const p = seat.pose;
  seat.lastT = t;
  seat.lift = (seat.lift || 0) + ((w.mode === 'activity' ? w.lift : 0) - (seat.lift || 0)) * k;
  ch.root.position.set(w.pos.x - seat.home.x, seat.lift, w.pos.z - seat.home.z);
  ch.root.rotation.y = lerpAngle(ch.root.rotation.y, w.face, 1 - Math.exp(-dt * 8));
  ch.hips.position.y = p.hipsY;
  ch.torso.rotation.x = p.torso;
  ch.head.rotation.set(p.headX, p.headY, p.headZ);
  ch.armL.rotation.set(p.armLX, 0, p.armLZ);
  ch.armR.rotation.set(p.armRX, 0, p.armRZ);
  ch.elbowL.rotation.x = p.elbowL;
  ch.elbowR.rotation.x = p.elbowR;
  if (seat.mouse) seat.mouse.position.set(0.4 + p.mouseX, 0.795, 0.24 + p.mouseZ);
  ch.legL.rotation.x = p.legL;
  ch.legR.rotation.x = p.legR;
  ch.kneeL.rotation.x = p.kneeL;
  ch.kneeR.rotation.x = p.kneeR;
  ch.props.pen.rotation.z = p.penSpin;
  const show = propsFor(seat);
  for (const key in show) ch.props[key].visible = show[key];
  const grey = seat.status === 'unknown';
  ch.skinMat.color.setHex(grey ? 0xbfc4cb : 0xffffff);
  ch.shirtMat.color.setHex(grey ? 0x8a9099 : 0x1d3958);

  // 狀態燈（跟著狀態，不受閒置動作影響）
  const lamp = seat.lampMat;
  const blink = Math.floor(t * 3) % 2 === 0;
  const colors = {
    working: [0x46b972, 0x1f7a44],
    blocked: [blink ? 0xff4a52 : 0x9c262b, blink ? 0xff2a33 : 0x3a0a0c],
    idle: [0xc4cad3, 0x000000],
    done: [0x8fb3f0, 0x1f3d7a],
  };
  const [c, e] = colors[seat.status] || [0xd2d5da, 0x000000];
  lamp.color.setHex(c);
  lamp.emissive.setHex(e);

  const mode = screenMode(seat);
  if (mode !== 'mc') seat.screen.draw(mode, t, dt);
  else if (!drawMc(seat, t)) seat.screen.draw('mcloading', t, dt);
}

// 負責人：固定坐在主管桌，只有一點待機動作，不接任何狀態
function animateBoss(t) {
  const ch = boss.ch;
  const typing = Math.sin(t * 0.25) > 0.2;
  ch.hips.position.y = HIP_SIT;
  for (const leg of [ch.legL, ch.legR]) leg.rotation.x = Math.PI / 2;
  for (const knee of [ch.kneeL, ch.kneeR]) knee.rotation.x = -Math.PI / 2;
  ch.torso.rotation.x = typing ? -0.08 : 0.06;
  ch.head.rotation.set(typing ? -0.2 : 0.02, typing ? 0 : Math.sin(t * 0.5) * 0.35, 0);
  ch.armL.rotation.set(typing ? 1.2 + Math.sin(t * 15) * 0.08 : 0.3, 0, 0.12);
  ch.armR.rotation.set(typing ? 1.2 + Math.sin(t * 15 + 3) * 0.08 : 0.3, 0, -0.12);
}

// 跑步機：有人在跑時履帶往後捲
function animateBelt(dt) {
  const running = seats.some((s) => s.walk.mode === 'activity' && s.walk.activity === 'treadmill');
  if (running && treadmillBelt.texture) treadmillBelt.texture.offset.y -= dt * 1.6;
}

// 廁所門：有人在門口附近就打開
function animateDoor(dt) {
  const near = seats.some((s) => s.walk.mode !== 'seated' && Math.hypot(s.walk.pos.x - DOOR.x, s.walk.pos.z - DOOR.z) < 1.1);
  const pivot = toiletDoor.pivot;
  pivot.rotation.y += ((near ? -1.5 : 0) - pivot.rotation.y) * (1 - Math.exp(-dt * 6));
}

// ---- 標籤（HTML 疊在畫面上） ----

const tmpPos = new THREE.Vector3();
function toScreen(v) {
  v.project(camera);
  return [(v.x * 0.5 + 0.5) * stage.clientWidth, (-v.y * 0.5 + 0.5) * stage.clientHeight];
}

// 名牌貼在椅子正後方地面往上長，不擋前後排螢幕；Zzz／! 氣泡跟著頭
function updateLabel(seat) {
  const el = seat.labelEl;
  if (!seat.name && seat.kind === 'extra') {
    el.hidden = true;
    seat.bubbleEl.hidden = true;
    return;
  }
  el.hidden = false;
  const w = seat.walk;
  const [x, y] = toScreen(tmpPos.set(w.pos.x, 0, w.pos.z + 0.4));
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  seat.ch.head.getWorldPosition(tmpPos).add({ x: 0, y: 0.35, z: 0 });
  const [bx, by] = toScreen(tmpPos);
  seat.bubbleEl.style.transform = `translate(${(bx + 16).toFixed(1)}px, ${by.toFixed(1)}px) translate(0, -100%)`;
  // 名牌只寫職位；需要確認時整個名牌變紅（狀態與動作詳情在面板裡）
  el.dataset.status = seat.status;
  const [role, name] = labelText(seat);
  if (seat.labelRole.textContent !== role) seat.labelRole.textContent = role;
  if (seat.labelName.textContent !== name) seat.labelName.textContent = name;
  const st = STATUS_TEXT[seat.status] || seat.status;
  // blocked 的驚嘆號跟著頭，回座途中也看得到
  const bubble = seat.status === 'blocked' ? '!' : seat.action === 'sleep' ? 'Zzz' : '';
  if (seat.bubbleEl.textContent !== bubble) seat.bubbleEl.textContent = bubble;
  seat.bubbleEl.hidden = !bubble || seat.status === 'absent' || w.hidden;
  seat.bubbleEl.dataset.kind = seat.status === 'blocked' ? 'blocked' : 'sleep';
  el.setAttribute('aria-label', `${role} ${name} ${st}`.trim());
}

function labelText(seat) {
  if (seat.staff) return [seat.staff.role, seat.name];
  if (seat.name?.startsWith('tmp-')) return ['臨時幫手', seat.name.slice(4)];
  return ['', seat.name || ''];
}

// 負責人的名牌放在主管桌前方地上（頭上是公司招牌，不要蓋住）
const bossLabel = document.createElement('span');
bossLabel.className = 'tag boss';
bossLabel.innerHTML = '<span class="role"></span> <b></b>';
bossLabel.querySelector('.role').textContent = CONFIG.owner.title;
bossLabel.querySelector('b').textContent = CONFIG.owner.name;
labelsEl.append(bossLabel);
function updateBossLabel() {
  const [x, y] = toScreen(tmpPos.set(boss.group.position.x, 0, boss.group.position.z + 1.35));
  bossLabel.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
}

// 貓：點牠顯示名字幾秒；睡覺時頭上冒 Zzz
const catLabel = document.createElement('span');
catLabel.className = 'tag cat';
catLabel.hidden = true;
labelsEl.append(catLabel);
const catBubble = document.createElement('span');
catBubble.className = 'bubble';
catBubble.dataset.kind = 'sleep';
catBubble.textContent = 'Zzz';
labelsEl.append(catBubble);
let catLabelUntil = 0;
function showCatName() {
  catLabel.textContent = cat.name;
  catLabelUntil = clock.elapsedTime + 4;
}
function updateCatLabel(t) {
  cat.headWorld(tmpPos);
  tmpPos.y += 0.22;
  const [x, y] = toScreen(tmpPos);
  catLabel.hidden = t > catLabelUntil;
  catLabel.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  catBubble.hidden = !cat.sleeping;
  catBubble.style.transform = `translate(${(x + 10).toFixed(1)}px, ${y.toFixed(1)}px) translate(0, -100%)`;
}

// ---- 布告欄 ----
// 內容來自 data/board.json（直接編輯檔案）；這裡每 2 秒問一次版本號，檔案被改過就重抓，不用重新整理頁面。
// 點布告欄：相機平滑飛過去，打開全螢幕專屬介面（首頁現金流＋年度目標、KPI、待辦、歷史歸檔）。
// 唯一的寫入是在「待辦」勾選。

let boardData = null;
let boardRev = null;
let viewer = null;

function showBoard(d) {
  boardData = d;
  boardRev = d.rev;
  drawBoard(bulletin.canvas, d);
  bulletin.texture.needsUpdate = true;
  viewer?.updateBoard(d);
}
drawBoard(bulletin.canvas, null);
bulletin.texture.needsUpdate = true;

async function loadBoard() {
  try {
    const r = await fetch('/api/board', { cache: 'no-store' });
    if (r.ok) showBoard(await r.json());
  } catch {
    // 下次再試
  }
}

async function watchBoard() {
  try {
    const r = await fetch('/api/board/rev', { cache: 'no-store' });
    const { rev } = await r.json();
    if (rev !== boardRev) await loadBoard();
  } catch {
    // 伺服器暫時連不上：下次再試
  }
  setTimeout(watchBoard, 2000);
}
loadBoard().then(watchBoard);

async function toggleTodo(id, done) {
  try {
    const r = await fetch('/api/board/todo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Office': 'board' },
      body: JSON.stringify({ id, done }),
    });
    const d = await r.json();
    if (r.ok) showBoard(d);
    else alert(d.error || '勾選失敗');
  } catch {
    alert('勾選失敗：伺服器連不上');
  }
}

// ---- 相機平滑移動（點布告欄或書本時飛過去，返回時飛回原位） ----

let camTween = null;
let savedView = null;
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

function flyTo(to, done) {
  camTween = { from: { x: pan.x, y: pan.y, zoom: camera.zoom }, to, t0: performance.now(), dur: 650, done };
}
function flyToPoint(point, zoom, done) {
  const d = point.clone().sub(TARGET);
  flyTo({ x: d.dot(CAM_RIGHT), y: d.dot(CAM_UP), zoom: Math.min(ZOOM_MAX, zoom) }, done);
}
function stepCamera(now) {
  if (!camTween) return;
  const { from, to, t0, dur, done } = camTween;
  const k = ease(Math.min(1, (now - t0) / dur));
  pan.x = from.x + (to.x - from.x) * k;
  pan.y = from.y + (to.y - from.y) * k;
  camera.zoom = from.zoom + (to.zoom - from.zoom) * k;
  camera.updateProjectionMatrix();
  applyCamera();
  if (k >= 1) {
    camTween = null;
    done?.();
  }
}

viewer = createViewer(document.getElementById('viewer'), {
  openTask: (name) => openTask(name),
  toggleTodo: (id, done) => toggleTodo(id, done),
  onClose: () => {
    if (savedView) flyTo(savedView);
    savedView = null;
  },
});

function openViewer(point, zoom, show) {
  agentPanel.hidden = true;
  openSeat = null;
  savedView ??= { x: pan.x, y: pan.y, zoom: camera.zoom };
  flyToPoint(point, zoom, show);
}

function openBoard() {
  if (!boardData) return;
  openViewer(bulletin.center, 2.4, () => viewer.showBoard(boardData));
}

// ---- 書架：每本書是一個專案資料庫 ----

async function loadProjects() {
  try {
    const r = await fetch('/api/projects', { cache: 'no-store' });
    if (r.ok) bookshelf.setProjects((await r.json()).projects);
  } catch {
    // 書架維持空的，下次重新整理再試
  }
}
loadProjects();

function openBook(mesh) {
  const project = mesh.userData.project;
  const p = new THREE.Vector3();
  mesh.getWorldPosition(p);
  openViewer(p, 2.4, () => viewer.showProject(project));
}

// ---- 資料 ----

let lastData = null;
let openSeat = null;

function applyData(data) {
  if (!data.agents) {
    // agent list 暫時讀不到：保留上一次的座位狀態，只更新提示與任務卡
    renderSummary({ ...data, agents: [] }, 0);
    renderTasks(data.tasks || []);
    return;
  }
  lastData = data;
  const agents = data.agents;
  const byName = new Map(agents.map((a) => [a.name, a]));
  const staffNames = new Set(STAFF.map((s) => s.name));
  for (const seat of seats.filter((s) => s.kind === 'staff')) seat.data = byName.get(seat.name) || null;

  // 後排：已就座的保留位子，新來的依序補空位
  const extras = agents.filter((a) => !staffNames.has(a.name));
  const extraSeats = seats.filter((s) => s.kind === 'extra');
  for (const seat of extraSeats) {
    if (seat.name && !byName.has(seat.name)) seat.name = null;
  }
  const seated = new Set(extraSeats.map((s) => s.name).filter(Boolean));
  for (const a of extras) {
    if (seated.has(a.name)) continue;
    const free = extraSeats.find((s) => !s.name);
    if (!free) break;
    free.name = a.name;
    free.screen.title = a.name;
    seated.add(a.name);
  }
  for (const seat of extraSeats) seat.data = seat.name ? byName.get(seat.name) : null;
  const overflow = extras.filter((a) => !seated.has(a.name)).length;

  const now = clock.elapsedTime;
  for (const seat of seats) {
    const status = seat.data ? normStatus(seat.data.status) : 'absent';
    if (status !== seat.status) {
      const wasIdle = seat.status === 'idle' || seat.status === 'done';
      seat.status = status;
      if ((status === 'idle' || status === 'done') && !wasIdle && seat.walk.mode === 'seated') {
        seat.action = 'sit';
        seat.actionUntil = now + rand(...(behaviorOpts.firstDelay || IDLE_TIMING.firstDelay)) * speed;
      }
    }
    seat.screen.setLines(seat.data?.lines);
  }

  renderSummary(data, overflow);
  renderTasks(data.tasks || []);
  if (openSeat) renderAgentPanel(openSeat);
}

function normStatus(s) {
  return ['working', 'idle', 'done', 'blocked'].includes(s) ? s : 'unknown';
}

const fmt = new Intl.DateTimeFormat('zh-TW', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const fmtClock = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function renderSummary(data, overflow) {
  const counts = {};
  for (const seat of seats) if (seat.data) counts[seat.status] = (counts[seat.status] || 0) + 1;
  const parts = ['working', 'idle', 'done', 'blocked', 'unknown']
    .filter((k) => counts[k])
    .map((k) => `<span class="chip" data-status="${k}">${STATUS_TEXT[k]} ${counts[k]}</span>`);
  if (overflow) parts.push(`<span class="chip">另有 ${overflow} 位沒有座位</span>`);
  document.getElementById('summary').innerHTML = parts.join('');
  const blocked = seats.filter((s) => s.status === 'blocked').map((s) => s.name);
  const alert = document.getElementById('alert');
  alert.hidden = !blocked.length;
  alert.textContent = blocked.length ? `${blocked.join('、')} 需要確認，請到 Agent 的終端機查看畫面` : '';
  const src = document.getElementById('source');
  src.textContent = data.live ? (data.error ? data.error : '即時資料') : '示範模式（假狀態）';
  src.dataset.kind = data.live ? (data.error ? 'error' : 'live') : 'mock';
  document.getElementById('updated').textContent = `更新 ${fmtClock.format(data.at)}`;
}

let tasksKey = '';
function renderTasks(tasks) {
  const key = tasks.map((t) => t.name + t.mtime).join('|');
  if (key === tasksKey) return;
  tasksKey = key;
  const list = document.getElementById('task-list');
  list.replaceChildren(
    ...tasks.map((t) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const n = document.createElement('span');
      n.className = 'tname';
      n.textContent = t.name.replace(/\.md$/, '');
      const m = document.createElement('span');
      m.className = 'tmeta';
      m.textContent = fmt.format(t.mtime);
      b.append(n, m);
      b.addEventListener('click', () => openTask(t.name));
      li.append(b);
      return li;
    }),
  );
  document.getElementById('task-count').textContent = String(tasks.length);
}

// 只讀狀態的回應沒有終端內容：沿用上一次的。有人狀態變了或新來的，下一輪就讀終端（blocked 要看到確認畫面）
let fullSoon = false;
function keepLines(data) {
  if (!data.lite || !data.agents || !lastData?.agents) return;
  const prev = new Map(lastData.agents.map((a) => [a.name, a]));
  for (const a of data.agents) {
    const p = prev.get(a.name);
    if (!p || p.status !== a.status) fullSoon = true;
    if (p && 'lines' in p) a.lines = p.lines;
  }
}

// 分頁在背景時不輪詢，回到前景馬上讀一次。員工面板開著時，那一位每輪都讀終端（伺服器只對他縮短快取）
let pollTimer = null;
let polling = false;
let lastFull = 0;
async function poll() {
  clearTimeout(pollTimer);
  pollTimer = null;
  if (document.hidden || polling) return;
  polling = true;
  const focus = !agentPanel.hidden && openSeat?.name;
  const full = fullSoon || !!focus || Date.now() - lastFull >= FULL_MS;
  try {
    const qs = new URLSearchParams();
    if (full) qs.set('full', '1');
    if (focus) qs.set('focus', focus);
    const r = await fetch(`/api/state?${qs}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    if (full) {
      lastFull = Date.now();
      fullSoon = false;
    }
    keepLines(data);
    applyData(data);
    document.body.classList.remove('offline');
  } catch {
    document.body.classList.add('offline');
    document.getElementById('source').textContent = '伺服器連線中斷';
    document.getElementById('source').dataset.kind = 'error';
  } finally {
    polling = false;
    if (!document.hidden) pollTimer = setTimeout(poll, POLL_MS);
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll();
});

// ---- 面板 ----

const agentPanel = document.getElementById('agent-panel');
const panelScreen = agentPanel.querySelector('.p-screen');

// 員工在玩 Minecraft 時，面板放大顯示他的電腦畫面（含遊戲介面）
function mirrorPanelScreen() {
  const on = !agentPanel.hidden && openSeat?.game?.mc && openSeat.game.frames > 0;
  if (panelScreen.hidden === !on) {
    if (on) panelScreen.getContext('2d').drawImage(openSeat.screen.canvas, 0, 0);
    return;
  }
  panelScreen.hidden = !on;
}

function openAgent(seat) {
  if (!seat.name) return;
  if (viewer.open) viewer.close();
  openSeat = seat;
  agentPanel.hidden = false;
  renderAgentPanel(seat);
}

function renderAgentPanel(seat) {
  const d = seat.data;
  const role = seat.staff ? seat.staff.role : '設定檔以外的 Agent（制服灰色滾邊）';
  agentPanel.querySelector('.p-name').textContent = seat.name;
  agentPanel.querySelector('.p-role').textContent = role;
  const st = agentPanel.querySelector('.p-status');
  st.textContent = STATUS_TEXT[seat.status] || seat.status;
  st.dataset.status = seat.status;
  agentPanel.querySelector('.p-action').textContent =
    seat.status === 'absent' ? '' : `目前動作：${actionText(seat)}`;
  const meta = d ? [d.agent, d.paneId, d.title].filter(Boolean).join('・') : '目前狀態來源裡沒有這位員工';
  agentPanel.querySelector('.p-meta').textContent = meta;
  const out = d?.lines;
  agentPanel.querySelector('.p-out').textContent = out == null ? '（讀不到終端輸出）' : out.join('\n') || '（尚無輸出）';
}

document.getElementById('agent-close').addEventListener('click', () => {
  agentPanel.hidden = true;
  openSeat = null;
});

const taskDialog = document.getElementById('task-dialog');
async function openTask(name) {
  taskDialog.querySelector('.d-title').textContent = name;
  taskDialog.querySelector('.d-meta').textContent = '讀取中…';
  taskDialog.querySelector('.d-body').textContent = '';
  if (!taskDialog.open) taskDialog.showModal();
  try {
    const r = await fetch(`/api/task?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const t = await r.json();
    taskDialog.querySelector('.d-meta').textContent = `最後修改 ${fmt.format(t.mtime)}`;
    taskDialog.querySelector('.d-body').textContent = t.content;
  } catch {
    taskDialog.querySelector('.d-meta').textContent = '讀取失敗（檔案太大、已移除或不是檔案）';
  }
}
document.getElementById('task-close').addEventListener('click', () => taskDialog.close());
taskDialog.addEventListener('click', (e) => {
  if (e.target === taskDialog) taskDialog.close();
});

document.getElementById('tasks-toggle').addEventListener('click', () => {
  document.body.classList.toggle('tasks-open');
});

// ---- 平移、縮放、點選 ----

const pointers = new Map();
let dragDist = 0;
let pinchStart = null;
const canvas = renderer.domElement;
canvas.style.touchAction = 'none';

function worldPerPixel() {
  return viewHeight() / camera.zoom / Math.max(1, stage.clientHeight);
}

function clampPan() {
  pan.x = Math.max(-PAN_LIMIT.x, Math.min(PAN_LIMIT.x, pan.x));
  pan.y = Math.max(-PAN_LIMIT.y, Math.min(PAN_LIMIT.y, pan.y));
  applyCamera();
}

function setZoom(z) {
  camera.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  camera.updateProjectionMatrix();
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragDist = 0;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: camera.zoom };
  }
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    setZoom((pinchStart.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, pinchStart.d));
    dragDist = 99;
    return;
  }
  const dx = cur.x - prev.x;
  const dy = cur.y - prev.y;
  dragDist += Math.abs(dx) + Math.abs(dy);
  const wpp = worldPerPixel();
  pan.x -= dx * wpp;
  pan.y += dy * wpp;
  clampPan();
  canvas.classList.toggle('dragging', dragDist > 4);
});

const raycaster = new THREE.Raycaster();
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  canvas.classList.remove('dragging');
  if (e.type === 'pointerup' && dragDist < 5 && pointers.size === 0) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects([...clickable, ...cat.meshes, bulletin.mesh, ...bookshelf.books], false)[0];
    if (hit?.object.userData.board) openBoard();
    else if (hit?.object.userData.project) openBook(hit.object);
    else if (hit?.object.userData.cat) showCatName();
    else if (hit) openAgent(seats[hit.object.userData.seatIndex]);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      setZoom(camera.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    } else {
      const wpp = worldPerPixel();
      pan.x += e.deltaX * wpp;
      clampPan();
    }
  },
  { passive: false },
);

document.getElementById('zoom-in').addEventListener('click', () => setZoom(camera.zoom * 1.2));
document.getElementById('zoom-out').addEventListener('click', () => setZoom(camera.zoom / 1.2));
document.getElementById('view-all').addEventListener('click', () => {
  pan.x = 0;
  pan.y = 0.4;
  applyCamera();
  setZoom(0.58);
});
document.getElementById('view-reset').addEventListener('click', () => {
  pan.x = 0;
  pan.y = 0;
  applyCamera();
  setZoom(1);
});

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, dialog')) return;
  const step = 0.6;
  const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (map[e.key]) {
    pan.x += map[e.key][0];
    pan.y += map[e.key][1];
    clampPan();
  }
});

// ---- 主迴圈 ----

const clock = { start: performance.now(), last: performance.now(), elapsedTime: 0 };
function frame() {
  const nowMs = performance.now();
  const dt = Math.min(0.1, (nowMs - clock.last) / 1000);
  clock.last = nowMs;
  const t = (clock.elapsedTime = (nowMs - clock.start) / 1000);
  for (const seat of seats) {
    if (seat.status === null) continue;
    updateWorker(seat, t, dt, behaviorOpts);
    const playing = seat.action === 'game' && seat.walk.mode === 'seated' && seat.status !== 'absent';
    if (playing && !seat.game) startGame(seat);
    else if (playing && seat.game.mc) attachMc(seat);
    else if (!playing && seat.game) stopGame(seat);
    animateSeat(seat, t, dt);
  }
  stepCamera(performance.now());
  animateBoss(t);
  cat.update(t, dt, { seats, speed, forceCat: FORCED_CAT });
  mirrorPanelScreen();
  animateDoor(dt);
  animateBelt(dt);
  renderer.render(scene, camera);
  for (const seat of seats) if (seat.status !== null) updateLabel(seat);
  updateBossLabel();
  updateCatLabel(t);
  requestAnimationFrame(frame);
}

resize();
applyCamera();
for (const seat of seats) {
  seat.status = 'absent';
  seat.labelEl.hidden = true;
}
frame();
poll();

// 驗證用：開發者工具可讀目前各座位的狀態與動作
window.__office = () =>
  seats.map((s) => ({
    name: s.name,
    status: s.status,
    action: s.action,
    mode: s.walk.mode,
    text: actionText(s),
    pos: [+s.walk.pos.x.toFixed(2), +s.walk.pos.z.toFixed(2)],
    flag: s.ch.props.flag.visible,
    game: s.game ? { mc: !!s.game.mc, frames: s.game.frames || 0, hud: s.game.hud || null } : null,
    screen: screenMode(s),
  }));
window.__cat = () => ({ step: cat.step?.type || null, lie: !!cat.step?.lie, pos: cat.pos.toArray().map((v) => +v.toFixed(2)), queue: cat.queue.map((q) => q.type) });
// 驗證用：布告欄中心在畫面上的位置（給自動化測試點擊）
window.__boardPoint = () => {
  const [x, y] = toScreen(bulletin.center.clone());
  const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + x, y: r.top + y };
};
// 驗證用：布告欄 Canvas 上的位置 → 畫面座標；以及可點區域清單
window.__board = () => boardData;
window.__bookPoint = (id) => {
  const m = bookshelf.books.find((b) => b.userData.project.id === id);
  if (!m) return null;
  const v = new THREE.Vector3();
  m.getWorldPosition(v);
  const [x, y] = toScreen(v);
  const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + x, y: r.top + y };
};
window.__boardCanvasToScreen = (cx, cy) => {
  const { width, height } = bulletin.canvas;
  const g = bulletin.mesh.geometry.parameters;
  const v = new THREE.Vector3((cx / width - 0.5) * g.width, (0.5 - cy / height) * g.height, 0);
  bulletin.mesh.localToWorld(v);
  const [x, y] = toScreen(v);
  const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + x, y: r.top + y };
};
// 驗證用：把鏡頭平移到某個世界座標（只平移，不旋轉）
window.__panTo = (x, y, z) => {
  const d = new THREE.Vector3(x, y, z).sub(TARGET);
  pan.x = d.dot(CAM_RIGHT);
  pan.y = d.dot(CAM_UP);
  clampPan();
};
window.__cam = () => ({
  pos: camera.position.toArray().map((v) => +v.toFixed(3)),
  quat: camera.quaternion.toArray().map((v) => +v.toFixed(4)),
  zoom: +camera.zoom.toFixed(3),
});
