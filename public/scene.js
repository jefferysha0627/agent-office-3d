// 辦公室場景：白色低多邊形地板、牆、各區域擺設、辦公桌與員工小人。
// 座標：+z 朝相機（辦公室後方），員工面向 -z 看螢幕；負責人的主管桌在最前方面向員工。
import * as THREE from '/vendor/three/three.module.js';
import { Screen, SCREEN_ASPECT } from './screens.js';

const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, metalness: 0, ...extra });

const M = {
  floor: mat(0xf4f5f7),
  floorSide: mat(0xe2e5ea),
  wall: mat(0xfbfbfc),
  wallTrim: mat(0xe8eaee),
  window: mat(0xe3eef7, { roughness: 0.4 }),
  desk: mat(0xffffff),
  deskLeg: mat(0xd6d9df),
  chair: mat(0xeceef2),
  chairDark: mat(0xc3c8d0),
  monitor: mat(0xf2f3f5),
  monitorBack: mat(0xdfe2e7),
  key: mat(0xe1e4e9),
  eye: mat(0x2b2f36),
  pot: mat(0xffffff),
  leaf: mat(0xc9ddcc),
  leafDark: mat(0xb3cdb8),
  book: [mat(0xe9ebef), mat(0xd9dde3), mat(0xcfd5dd), mat(0xf1e6cf)],
  rim: mat(0x4a505a, { metalness: 0.2 }),
  mug: mat(0xffffff),
  coffee: mat(0x6b4a33),
  flag: mat(0xe5484d, { emissive: 0x5a0d10 }),
  dark: mat(0x3a3e46),
  steel: mat(0xc9cdd3, { metalness: 0.3, roughness: 0.5 }),
  mat: mat(0xc9d8e8),
  snack: [mat(0xf2b8a2), mat(0xf6d98b), mat(0xb9d7f0), mat(0xf4f4f4)],
  fruit: [mat(0xf29b4b), mat(0xe8615a), mat(0xf2d35b)],
  door: mat(0xe9ebef),
  // 主題色（深藍＋金），只做少量點綴
  brandNavy: mat(0x1d3958),
  rug: mat(0xeceef2),
  rugEdge: mat(0xdfe3e8),
  ledStrip: new THREE.MeshBasicMaterial({ color: 0xfdfcf6 }),
  brandGold: mat(0xc8aa62, { metalness: 0.15, roughness: 0.6 }),
};

export const BRAND = { navy: '#1d3958', gold: '#c8aa62' };

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, seg, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function ball(r, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// 文字牌（Canvas 貼圖）
function textPlate(text, w, h, { bg = '#ffffff', fg = '#2b2f36', font = 'bold 64px -apple-system, "PingFang TC", sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round((256 * h) / w);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
}

function plant(x, z, s = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.22 * s, 0.17 * s, 0.4 * s, 7, M.pot, 0, 0.2 * s, 0));
  const a = ball(0.36 * s, M.leaf, 0, 0.68 * s, 0);
  const b = ball(0.26 * s, M.leafDark, 0.16 * s, 0.98 * s, 0.05 * s);
  b.rotation.set(0.4, 0.8, 0);
  g.add(a, b);
  g.position.set(x, 0, z);
  return g;
}

// ---- 版面（走路路徑與各區域共用） ----

export const ROOM = {
  minX: -10.2,
  maxX: 10.2,
  backZ: -5.4, // 前牆（負責人 背後）
  frontZ: 5.0, // 地台靠相機的一端
  aisleFront: 3.75, // 前排座位後方走道
  aisleBack: 0.35, // 後排座位後方走道
  corridorL: -6.55,
  corridorR: 6.35,
};

// 閒置時會走去的地點：x/z 是站的位置，face 是面向（rotation.y），via 是從側走道進去的路徑
export const SPOTS = {
  coffee: { x: -8.3, z: -4.2, face: 0, side: 'L' },
  snack: { x: -7.15, z: -4.2, face: 0, side: 'L' },
  // 跑步機和啞鈴架都貼齊後牆
  treadmill: { x: 8.3, z: -4.3, face: 0, side: 'R', lift: 0.16 },
  // 舉啞鈴側身對著鏡頭，才看得出彎舉
  dumbbell: { x: 6.95, z: -4.5, face: -Math.PI / 2, side: 'R' },
  toilet: { x: -8.4, z: 2.1, face: 0, side: 'L', via: [[-8.4, 3.75]], hide: true },
};

export const DOOR = { x: -8.4, z: 3.0 };

export function buildOffice(scene) {
  const W = ROOM.maxX - ROOM.minX;
  const D = ROOM.frontZ - ROOM.backZ;
  const floor = box(W, 0.3, D, M.floor, 0, -0.15, (ROOM.frontZ + ROOM.backZ) / 2);
  floor.material = [M.floorSide, M.floorSide, M.floor, M.floorSide, M.floorSide, M.floorSide];
  scene.add(floor);
  const grid = new THREE.GridHelper(20, 20, 0xe6e8ec, 0xe9ebef);
  grid.position.set(0, 0.002, 0);
  scene.add(grid);
  // 工作區地毯：淺灰底＋稍深的邊框，把座位區和走道分開
  scene.add(box(11.2, 0.008, 7.1, M.rugEdge, 0, 0.004, 0.45));
  scene.add(box(10.9, 0.01, 6.8, M.rug, 0, 0.006, 0.45));

  // 牆：前牆面向相機，兩側牆從正後方看只是邊框
  const bz = ROOM.backZ;
  scene.add(box(W, 2.7, 0.2, M.wall, 0, 1.35, bz - 0.1));
  scene.add(box(W, 0.1, 0.24, M.wallTrim, 0, 2.72, bz - 0.1));
  for (const x of [ROOM.minX, ROOM.maxX]) {
    scene.add(box(0.2, 2.7, D, M.wall, x, 1.35, (ROOM.frontZ + bz) / 2));
  }
  // 踢腳板（後牆與兩側牆）＋牆頂 LED 燈條
  scene.add(box(W - 0.4, 0.09, 0.03, M.wallTrim, 0, 0.045, bz + 0.015));
  for (const s of [-1, 1]) scene.add(box(0.03, 0.09, D, M.wallTrim, s * (ROOM.maxX - 0.115), 0.045, (ROOM.frontZ + bz) / 2));
  scene.add(box(W - 0.6, 0.035, 0.05, M.ledStrip, 0, 2.6, bz + 0.03));
  // 書架上方的高窗：窗框、中間窗櫺、窗台
  buildWindow(scene, SHELF_X, 2.32, bz);
  buildBulletin(scene, bz);
  buildBrandSign(scene, bz);
  buildBookshelf(scene, bz);

  buildPantry(scene);
  buildGym(scene);
  buildToilet(scene);
  scene.add(plant(-6.3, bz + 0.5, 1.0), plant(6.0, bz + 0.5, 1.0), plant(-9.6, 4.4, 0.9), plant(9.6, 4.4, 0.9));
}

function buildWindow(scene, x, y, bz) {
  const w = 2.4;
  const h = 0.4;
  scene.add(box(w, h, 0.04, M.window, x, y, bz + 0.02));
  for (const s of [-1, 1]) {
    scene.add(box(w + 0.08, 0.05, 0.08, M.wallTrim, x, y + s * (h / 2 + 0.02), bz + 0.04));
    scene.add(box(0.05, h + 0.08, 0.08, M.wallTrim, x + s * (w / 2 + 0.02), y, bz + 0.04));
  }
  for (const dx of [-w / 6, w / 6]) scene.add(box(0.035, h, 0.06, M.wallTrim, x + dx, y, bz + 0.04));
  scene.add(box(w + 0.2, 0.03, 0.14, M.desk, x, y - h / 2 - 0.05, bz + 0.07));
}

// ---- 書架＝專案資料庫：每本書是一個專案（書背寫案名、顏色代表狀態），點了開專案資料 ----
export const SHELF_STATUS = { 進行中: '#1d3958', 暫停: '#c98f2a', 已結案: '#6f8f7b' };
export const bookshelf = { group: null, books: [], setProjects: () => {} };
const SHELF = { w: 2.4, h: 2.0, d: 0.42 };
const SHELF_X = -3.6; // 招牌左邊；預設視角看得到整座書架

function spineTexture(text, color, status) {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 384;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 96, 384);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(0, 22, 96, 5);
  ctx.fillRect(0, 334, 96, 5);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 中文一字一行；連續的英數字（例如 AI）當成一組橫著寫
  const chars = (text.match(/[A-Za-z0-9]+|./gu) || []).slice(0, 6);
  const size = chars.length > 4 ? 40 : 48;
  ctx.font = `700 ${size}px -apple-system, "PingFang TC", sans-serif`;
  const top = 180 - ((chars.length - 1) * (size + 4)) / 2;
  chars.forEach((ch, i) => ctx.fillText(ch, 48, top + i * (size + 4)));
  ctx.font = `600 22px -apple-system, "PingFang TC", sans-serif`;
  ctx.fillText(status, 48, 360);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildBookshelf(scene, bz) {
  const { w, h, d } = SHELF;
  const g = new THREE.Group();
  g.add(box(w, h, 0.04, M.desk, 0, h / 2, -d / 2 + 0.02));
  for (const s of [-1, 1]) g.add(box(0.05, h, d, M.desk, s * (w / 2 - 0.025), h / 2, 0));
  for (const y of [0.06, 0.62, 1.2, 1.8, h - 0.02]) g.add(box(w, 0.04, d, M.desk, 0, y, 0));
  g.add(box(w, 0.18, 0.03, M.desk, 0, 1.9, d / 2 - 0.015)); // 頂端名牌板
  g.add(box(w - 0.1, 0.08, 0.02, M.deskLeg, 0, 0.04, d / 2 - 0.01));
  // 上緣名牌與下緣狀態圖例
  const title = textPlate('專案資料庫', 0.9, 0.12, { bg: BRAND.navy, fg: '#ffffff', font: '700 24px -apple-system, "PingFang TC", sans-serif' });
  title.position.set(0, 1.9, d / 2 + 0.006);
  g.add(title);
  const legend = document.createElement('canvas');
  legend.width = 512;
  legend.height = 48;
  const lc = legend.getContext('2d');
  lc.fillStyle = '#ffffff';
  lc.fillRect(0, 0, 512, 48);
  lc.font = '600 26px -apple-system, "PingFang TC", sans-serif';
  lc.textBaseline = 'middle';
  Object.entries(SHELF_STATUS).forEach(([label, color], i) => {
    lc.fillStyle = color;
    lc.fillRect(20 + i * 165, 12, 24, 24);
    lc.fillStyle = '#4a5260';
    lc.fillText(label, 52 + i * 165, 25);
  });
  const ltex = new THREE.CanvasTexture(legend);
  ltex.colorSpace = THREE.SRGBColorSpace;
  const lm = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.094), new THREE.MeshBasicMaterial({ map: ltex, toneMapped: false }));
  lm.position.set(0, 0.17, d / 2 + 0.006);
  g.add(lm);
  // 最下層：一般資料夾與雜誌（裝飾）
  for (let i = 0; i < 8; i++) {
    const bh = 0.3 + (i % 3) * 0.04;
    g.add(box(0.14, bh, 0.28, M.book[i % 4], -0.95 + i * 0.17, 0.08 + bh / 2, 0));
  }
  g.position.set(SHELF_X, 0, bz + d / 2 + 0.02);
  scene.add(g);
  bookshelf.group = g;

  // 進行中／暫停放上層，已結案放中層；每層最多 6 本
  bookshelf.setProjects = (projects) => {
    for (const b of bookshelf.books) g.remove(b);
    bookshelf.books = [];
    const rows = [projects.filter((p) => p.status !== '已結案'), projects.filter((p) => p.status === '已結案')];
    rows.forEach((list, r) => {
      const y = r === 0 ? 1.22 : 0.64;
      list.slice(0, 6).forEach((p, i) => {
        const color = SHELF_STATUS[p.status] || SHELF_STATUS.進行中;
        const side = mat(new THREE.Color(color).getHex());
        const spine = new THREE.MeshStandardMaterial({ map: spineTexture(p.spine, color, p.status), roughness: 0.8 });
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.32), [side, side, side, side, spine, side]);
        book.position.set(-0.95 + i * 0.3, y + 0.27, 0.02);
        book.castShadow = true;
        book.userData.project = p;
        g.add(book);
        bookshelf.books.push(book);
      });
    });
  };
}

// 布告欄（負責人背後右側）：內容畫在 Canvas 上當貼圖，預設視角就看得到標題和 KPI 大數字
export const bulletin = { mesh: null, canvas: null, texture: null, center: new THREE.Vector3() };
const BOARD_W = 3.9;
const BOARD_H = (3.9 * 900) / 2048;
function buildBulletin(scene, bz) {
  const cx = 3.55;
  const cy = 1.62;
  scene.add(box(BOARD_W + 0.1, BOARD_H + 0.1, 0.06, M.deskLeg, cx, cy, bz + 0.03));
  scene.add(box(BOARD_W + 0.2, 0.05, 0.12, M.deskLeg, cx, cy - BOARD_H / 2 - 0.07, bz + 0.06));
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = Math.round((2048 * BOARD_H) / BOARD_W);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  mesh.position.set(cx, cy, bz + 0.065);
  mesh.userData.board = true;
  scene.add(mesh);
  Object.assign(bulletin, { mesh, canvas, texture });
  bulletin.center.set(cx, cy, bz + 0.065);
}

// 公司招牌：白色底板＋Logo（office.config.json 的 company.logo），底下一條金色細線。
// 高度依 Logo 圖片比例決定，最高 0.95，太高就縮窄寬度。
function buildBrandSign(scene, bz) {
  const cx = -0.05;
  const cy = 2.06;
  new THREE.TextureLoader().load('/api/brand/logo', (tex) => {
    const aspect = tex.image.width / Math.max(1, tex.image.height) || 3;
    let w = 2.8;
    let h = w / aspect;
    if (h > 0.95) {
      h = 0.95;
      w = h * aspect;
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    scene.add(box(w + 0.16, h + 0.12, 0.05, M.desk, cx, cy, bz + 0.03));
    scene.add(box(w + 0.16, 0.025, 0.055, M.brandGold, cx, cy - h / 2 - 0.07, bz + 0.035));
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }));
    logo.position.set(cx, cy, bz + 0.058);
    scene.add(logo);
  });
}

// 茶水間：流理臺、咖啡機、零食架、小冰箱
function buildPantry(scene) {
  const g = new THREE.Group();
  const z = ROOM.backZ + 0.4;
  g.add(box(2.4, 0.9, 0.7, M.desk, -7.95, 0.45, z));
  g.add(box(2.44, 0.05, 0.74, M.wallTrim, -7.95, 0.92, z));
  // 水槽
  g.add(box(0.5, 0.03, 0.4, M.steel, -7.7, 0.95, z));
  g.add(cyl(0.02, 0.02, 0.25, 6, M.steel, -7.7, 1.07, z - 0.18));
  // 咖啡機
  g.add(box(0.42, 0.55, 0.38, M.dark, -8.3, 1.22, z - 0.02));
  g.add(box(0.3, 0.06, 0.2, M.steel, -8.3, 1.0, z + 0.12));
  g.add(cyl(0.05, 0.04, 0.09, 7, M.mug, -8.3, 1.08, z + 0.12));
  g.add(box(0.12, 0.05, 0.02, M.flag, -8.3, 1.38, z + 0.18));
  // 零食架：餅乾盒、水果、泡麵
  g.add(box(0.7, 0.04, 0.4, M.deskLeg, -7.15, 1.2, z));
  g.add(box(0.04, 0.3, 0.4, M.deskLeg, -7.48, 1.08, z));
  g.add(box(0.04, 0.3, 0.4, M.deskLeg, -6.82, 1.08, z));
  [[-7.35, 0], [-7.15, 1], [-6.95, 2]].forEach(([x, i]) => g.add(box(0.15, 0.2, 0.12, M.snack[i], x, 1.32, z)));
  [[-7.3, 0], [-7.15, 1], [-7.0, 2], [-7.22, 1]].forEach(([x, i], k) => g.add(ball(0.06, M.fruit[i], x, 1.0 + (k === 3 ? 0.08 : 0), z + 0.08)));
  [-7.4, -7.25].forEach((x) => g.add(cyl(0.06, 0.05, 0.1, 8, M.snack[3], x, 1.27, z - 0.1)));
  // 牆上層架
  g.add(box(2.0, 0.05, 0.3, M.desk, -7.8, 1.85, ROOM.backZ + 0.15));
  [[-8.6, 0], [-8.3, 1], [-7.9, 2], [-7.5, 0], [-7.1, 1]].forEach(([x, i]) => g.add(box(0.2, 0.26, 0.18, M.snack[i], x, 2.0, ROOM.backZ + 0.15)));
  // 小冰箱
  g.add(box(0.7, 1.25, 0.65, M.monitor, -9.65, 0.63, z));
  g.add(box(0.04, 0.3, 0.04, M.steel, -9.4, 0.95, z + 0.34));
  g.add(box(0.66, 0.02, 0.02, M.wallTrim, -9.65, 0.85, z + 0.33));
  scene.add(g);
  const sign = textPlate('茶水間', 1.0, 0.3, { bg: '#ffffff', fg: '#6b7280', font: '600 56px -apple-system, "PingFang TC", sans-serif' });
  sign.position.set(-7.95, 2.35, ROOM.backZ + 0.02);
  scene.add(sign);
}

// 健身區：跑步機、啞鈴架
export const treadmillBelt = { mesh: null, texture: null };
function beltTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3e46';
  ctx.fillRect(0, 0, 16, 64);
  ctx.fillStyle = '#4c515b';
  for (let y = 0; y < 64; y += 16) ctx.fillRect(0, y, 16, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function buildGym(scene) {
  const g = new THREE.Group();
  const tx = SPOTS.treadmill.x;
  const tz = SPOTS.treadmill.z;
  g.add(box(0.85, 0.14, 1.9, M.monitor, tx, 0.07, tz));
  const tex = beltTexture();
  const belt = box(0.62, 0.02, 1.7, mat(0xffffff, { map: tex }), tx, 0.15, tz);
  g.add(belt);
  treadmillBelt.mesh = belt;
  treadmillBelt.texture = tex;
  for (const s of [-1, 1]) g.add(box(0.05, 1.1, 0.05, M.steel, tx + s * 0.38, 0.6, tz - 0.85));
  g.add(box(0.85, 0.2, 0.22, M.monitor, tx, 1.15, tz - 0.88));
  g.add(box(0.36, 0.1, 0.02, M.flag, tx, 1.18, tz - 0.76));
  for (const s of [-1, 1]) g.add(box(0.04, 0.04, 0.5, M.steel, tx + s * 0.38, 1.0, tz - 0.6));
  // 啞鈴架（貼齊後牆）
  const rx = SPOTS.dumbbell.x;
  const rz = ROOM.backZ + 0.22;
  g.add(box(1.0, 0.06, 0.4, M.steel, rx, 0.55, rz));
  g.add(box(1.0, 0.06, 0.4, M.steel, rx, 0.25, rz));
  for (const s of [-1, 1]) g.add(box(0.05, 0.6, 0.4, M.steel, rx + s * 0.48, 0.3, rz));
  for (let i = 0; i < 4; i++) {
    for (const y of [0.33, 0.63]) {
      const x = rx - 0.33 + i * 0.22;
      const bar = cyl(0.015, 0.015, 0.22, 5, M.steel, x, y, rz);
      bar.rotation.x = Math.PI / 2;
      g.add(bar);
      for (const s of [-1, 1]) {
        const w = cyl(0.045, 0.045, 0.05, 7, M.dark, x, y, rz + s * 0.09);
        w.rotation.x = Math.PI / 2;
        g.add(w);
      }
    }
  }
  scene.add(g);
  const sign = textPlate('健身區', 1.0, 0.3, { bg: '#ffffff', fg: '#6b7280', font: '600 56px -apple-system, "PingFang TC", sans-serif' });
  sign.position.set(7.8, 2.35, ROOM.backZ + 0.02);
  scene.add(sign);
}

// 廁所：一間有屋頂的小房間，門面向相機
export const toiletDoor = { pivot: null };
function buildToilet(scene) {
  const g = new THREE.Group();
  const x0 = ROOM.minX + 0.1; // 貼齊左牆
  const x1 = -7.3;
  const z0 = 0.9;
  const z1 = DOOR.z;
  const h = 2.0;
  const cx = (x0 + x1) / 2;
  g.add(box(x1 - x0, h, 0.1, M.wall, cx, h / 2, z0));
  g.add(box(0.1, h, z1 - z0, M.wall, x1, h / 2, (z0 + z1) / 2));
  const doorW = 0.8;
  const leftW = DOOR.x - doorW / 2 - x0;
  const rightW = x1 - (DOOR.x + doorW / 2);
  g.add(box(leftW, h, 0.1, M.wall, x0 + leftW / 2, h / 2, z1));
  g.add(box(rightW, h, 0.1, M.wall, x1 - rightW / 2, h / 2, z1));
  g.add(box(doorW, h - 1.6, 0.1, M.wall, DOOR.x, 1.6 + (h - 1.6) / 2, z1));
  g.add(box(x1 - x0 + 0.1, 0.08, z1 - z0 + 0.1, M.wallTrim, cx, h + 0.04, (z0 + z1) / 2));
  // 門（開門時繞左側鉸鏈轉開）
  const pivot = new THREE.Group();
  pivot.position.set(DOOR.x - doorW / 2, 0, z1 + 0.02);
  const door = box(doorW - 0.04, 1.58, 0.05, M.door, doorW / 2, 0.8, 0);
  pivot.add(door);
  pivot.add(box(0.05, 0.05, 0.06, M.steel, doorW - 0.12, 0.85, 0.04));
  g.add(pivot);
  toiletDoor.pivot = pivot;
  scene.add(g);
  const sign = textPlate('WC', 0.5, 0.28, { bg: '#2b2f36', fg: '#ffffff', font: 'bold 120px -apple-system, sans-serif' });
  sign.position.set(DOOR.x, 1.8, z1 + 0.06);
  scene.add(sign);
}

// ---- 辦公桌與員工 ----

// 鍵盤按鍵紋理（所有鍵盤共用一張）
let keyTexture = null;
function keyboardTexture() {
  if (keyTexture) return keyTexture;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 88;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d4d8de';
  ctx.fillRect(0, 0, 256, 88);
  ctx.fillStyle = '#f4f5f7';
  // 三排按鍵＋最下排的空白鍵
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 14; k++) ctx.fillRect(5 + r * 4 + k * 17.5, 5 + r * 20, 14.5, 16);
  }
  ctx.fillRect(5, 65, 40, 16);
  ctx.fillRect(52, 65, 140, 16);
  ctx.fillRect(199, 65, 52, 16);
  keyTexture = new THREE.CanvasTexture(c);
  keyTexture.colorSpace = THREE.SRGBColorSpace;
  return keyTexture;
}

// 辦公桌：桌面、前緣封邊、方腳＋腳墊、背板、抽屜櫃（抽屜面＋把手）、鍵盤、滑鼠墊與滑鼠
function makeDesk(withProps, w = 1.6, d = 0.8, drawers = ['left']) {
  const g = new THREE.Group();
  g.add(box(w, 0.04, d, M.desk, 0, 0.755, 0));
  g.add(box(w, 0.025, 0.02, M.deskLeg, 0, 0.73, d / 2 - 0.01));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const lx = x * (w / 2 - 0.05);
    const lz = z * (d / 2 - 0.05);
    g.add(box(0.05, 0.71, 0.05, M.deskLeg, lx, 0.375, lz));
    g.add(box(0.075, 0.02, 0.075, M.chairDark, lx, 0.01, lz));
  }
  g.add(box(w - 0.14, 0.3, 0.02, M.deskLeg, 0, 0.56, -d / 2 + 0.06));
  for (const side of drawers) {
    const px = (side === 'left' ? -1 : 1) * (w / 2 - 0.27);
    g.add(box(0.4, 0.6, d - 0.14, M.desk, px, 0.39, -0.02));
    for (let k = 0; k < 3; k++) {
      const y = 0.2 + k * 0.19;
      g.add(box(0.37, 0.165, 0.012, M.monitor, px, y, d / 2 - 0.085));
      g.add(box(0.12, 0.016, 0.02, M.steel, px, y + 0.04, d / 2 - 0.074));
    }
  }
  let mouse = null;
  if (withProps) {
    const kb = box(0.44, 0.022, 0.15, M.key, -0.04, 0.786, 0.24);
    kb.material = [M.key, M.key, mat(0xffffff, { map: keyboardTexture() }), M.key, M.key, M.key];
    g.add(kb);
    g.add(box(0.26, 0.004, 0.22, M.chairDark, 0.4, 0.777, 0.22));
    mouse = new THREE.Group();
    mouse.add(box(0.06, 0.026, 0.1, M.key, 0, 0, 0));
    mouse.add(box(0.008, 0.008, 0.02, M.dark, 0, 0.016, -0.025));
    mouse.position.set(0.4, 0.792, 0.24);
    g.add(mouse);
  }
  g.userData.mouse = mouse;
  return g;
}

// 約 24 吋螢幕（寬 0.86）、底緣比坐姿頭頂低，從正後方看過去頭會稍微擋到螢幕下緣
const SCREEN_Y = 0.9;
const SCREEN_W = 0.86;
const SCREEN_Z = -0.15;

// 螢幕：細黑框、下巴＋電源燈、白色背蓋、立柱與橢圓底座
function makeMonitor(screen) {
  const g = new THREE.Group();
  const sh = SCREEN_W / SCREEN_ASPECT;
  const foot = cyl(0.14, 0.15, 0.018, 16, M.monitor, 0, 0.786, SCREEN_Z + 0.02);
  foot.scale.z = 0.7;
  g.add(foot);
  g.add(box(0.05, 0.2, 0.03, M.monitor, 0, 0.88, SCREEN_Z - 0.035));
  g.add(box(SCREEN_W * 0.55, sh * 0.6, 0.05, M.monitorBack, 0, SCREEN_Y + sh / 2, SCREEN_Z - 0.04));
  g.add(box(SCREEN_W + 0.03, sh + 0.035, 0.03, M.dark, 0, SCREEN_Y + sh / 2 + 0.002, SCREEN_Z));
  g.add(box(SCREEN_W + 0.03, 0.035, 0.034, M.monitor, 0, SCREEN_Y - 0.012, SCREEN_Z));
  const led = box(0.012, 0.006, 0.004, new THREE.MeshBasicMaterial({ color: 0x46b972 }), SCREEN_W / 2 - 0.04, SCREEN_Y - 0.012, SCREEN_Z + 0.018);
  led.castShadow = false;
  g.add(led);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, sh), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
  panel.position.set(0, SCREEN_Y + sh / 2 + 0.006, SCREEN_Z + 0.016);
  g.add(panel);
  return { group: g, panel };
}

function makeLamp() {
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.08, 0.03, 8, M.deskLeg, 0, 0.795, 0));
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d9, emissive: 0x000000, flatShading: true });
  g.add(ball(0.065, lampMat, 0, 0.86, 0));
  g.position.set(0.68, 0, -0.22);
  return { group: g, lampMat };
}

// 辦公椅：座墊、三片組成的弧形椅背、扶手、氣壓棒、五爪腳與輪子
function makeChair(seatMat = M.chair) {
  const g = new THREE.Group();
  g.add(box(0.5, 0.06, 0.48, M.chairDark, 0, 0.44, 0));
  g.add(box(0.48, 0.05, 0.46, seatMat, 0, 0.49, 0));
  g.add(box(0.2, 0.4, 0.05, seatMat, 0, 0.8, 0.26));
  for (const s of [-1, 1]) {
    const side = box(0.17, 0.4, 0.05, seatMat, s * 0.175, 0.8, 0.235);
    side.rotation.y = s * -0.38;
    g.add(side);
    g.add(box(0.03, 0.2, 0.03, M.chairDark, s * 0.27, 0.57, 0.02));
    g.add(box(0.06, 0.03, 0.26, M.chairDark, s * 0.27, 0.68, 0.0));
  }
  g.add(box(0.05, 0.3, 0.04, M.chairDark, 0, 0.56, 0.27));
  g.add(cyl(0.032, 0.032, 0.32, 8, M.steel, 0, 0.26, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = box(0.05, 0.035, 0.3, M.chairDark, 0, 0.07, 0);
    leg.geometry.translate(0, 0, 0.15);
    leg.rotation.y = a;
    g.add(leg);
    const wheel = cyl(0.03, 0.03, 0.03, 8, M.dark, Math.sin(a) * 0.29, 0.03, Math.cos(a) * 0.29);
    wheel.rotation.z = Math.PI / 2;
    g.add(wheel);
  }
  return g;
}

// ---- 員工：公司制服 ----
// 深藍上衣、胸前金色 Logo 徽章、背後 Logo 布章；職位用領口與袖口滾邊顏色區分
// 設定檔以外的 Agent（例如臨時幫手）用灰色滾邊；員工的顏色在 office.config.json 設定
export const EXTRA_TRIM = 0x9aa1ab;

let logoPatch = null;
function logoMaterial() {
  if (!logoPatch) {
    const tex = new THREE.TextureLoader().load('/api/brand/mark');
    tex.colorSpace = THREE.SRGBColorSpace;
    logoPatch = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  }
  return logoPatch;
}

export const CHAR_SCALE = 1.1;
export const HIP_SIT = 0.52;
export const HIP_STAND = 0.64;

// look：{ trim: 職位顏色, boss: 是否為負責人（加炭灰外套、金色滾邊） }
export function makeCharacter(look = {}) {
  const skin = mat(0xffffff);
  const shirt = mat(0x1d3958);
  const trimMat = look.boss ? M.brandGold : mat(look.trim ?? EXTRA_TRIM);
  const pants = mat(0xc9ced6);
  const shoes = mat(0x3a3e46);
  const sleeve = look.boss ? mat(0x2b3443) : shirt;
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_SIT;
  root.add(hips);

  // 腿：大腿＋膝關節＋小腿＋鞋子
  const leg = (s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.09, 0, 0);
    hip.add(box(0.13, 0.32, 0.13, pants, 0, -0.16, 0));
    const knee = new THREE.Group();
    knee.position.y = -0.32;
    knee.add(ball(0.066, pants, 0, 0, 0));
    knee.add(box(0.12, 0.28, 0.12, pants, 0, -0.14, 0));
    knee.add(box(0.13, 0.06, 0.2, shoes, 0, -0.29, -0.04));
    hip.add(knee);
    hips.add(hip);
    return { hip, knee };
  };
  const LL = leg(-1);
  const RL = leg(1);

  const torso = new THREE.Group();
  hips.add(torso);
  torso.add(cyl(0.16, 0.21, 0.48, 10, shirt, 0, 0.25, 0));
  torso.add(cyl(0.212, 0.212, 0.04, 10, shoes, 0, 0.03, 0)); // 腰帶
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.024, 6, 14), trimMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.49;
  torso.add(collar);
  // 胸前：金框 Logo 徽章＋職位色名牌；背後：Logo 布章（從正後方的相機看得到）
  torso.add(box(0.075, 0.075, 0.01, M.brandGold, -0.07, 0.36, -0.172));
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), logoMaterial());
  badge.position.set(-0.07, 0.36, -0.178);
  badge.rotation.y = Math.PI;
  torso.add(badge);
  if (!look.boss) torso.add(box(0.08, 0.026, 0.01, trimMat, 0.07, 0.37, -0.172)); // 職位色名牌（負責人用外套金邊區分）
  // 兩肩的職位色肩線：從正後方的相機也看得出職位
  for (const s of [-1, 1]) torso.add(box(0.11, 0.022, 0.13, trimMat, s * 0.13, 0.49, 0.01));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), logoMaterial());
  back.position.set(0, 0.34, 0.183);
  torso.add(back);
  if (look.boss) {
    // 負責人：前面敞開的炭灰外套＋金色衣領邊
    const jacket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.172, 0.222, 0.46, 12, 1, true, Math.PI + 0.42, Math.PI * 2 - 0.84),
      new THREE.MeshStandardMaterial({ color: 0x2b3443, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }),
    );
    jacket.position.y = 0.26;
    jacket.castShadow = true;
    torso.add(jacket);
    for (const s of [-1, 1]) {
      const lapel = box(0.018, 0.4, 0.012, M.brandGold, s * 0.075, 0.28, -0.185);
      lapel.rotation.z = s * 0.1;
      torso.add(lapel);
    }
  }

  const head = new THREE.Group();
  head.position.y = 0.5;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), skin);
  skull.position.y = 0.17;
  skull.scale.set(1, 0.94, 1);
  skull.castShadow = true;
  head.add(skull);
  for (const s of [-1, 1]) head.add(box(0.035, 0.06, 0.02, M.eye, s * 0.075, 0.18, -0.205));

  // 手臂：肩關節＋上臂＋手肘＋前臂（袖口滾邊）＋手掌、拇指、四指
  const arm = (s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.21, 0.42, 0);
    pivot.add(ball(0.062, sleeve, 0, 0, 0));
    pivot.add(box(0.09, 0.2, 0.09, sleeve, 0, -0.1, 0));
    const elbow = new THREE.Group();
    elbow.position.y = -0.2;
    elbow.add(ball(0.05, sleeve, 0, 0, 0));
    elbow.add(box(0.085, 0.17, 0.085, sleeve, 0, -0.085, 0));
    elbow.add(box(0.092, 0.03, 0.092, trimMat, 0, -0.17, 0));
    const hand = new THREE.Group();
    hand.position.y = -0.22;
    hand.add(box(0.07, 0.07, 0.035, skin, 0, 0.005, 0));
    const thumb = box(0.024, 0.05, 0.024, skin, -s * 0.042, 0.0, -0.012);
    thumb.rotation.z = s * 0.5;
    hand.add(thumb);
    for (let f = 0; f < 4; f++) hand.add(box(0.014, 0.045, 0.03, skin, -0.025 + f * 0.0167, -0.05, 0));
    elbow.add(hand);
    pivot.add(elbow);
    torso.add(pivot);
    return { pivot, elbow, hand };
  };
  const L = arm(-1);
  const R = arm(1);

  // 手上道具：平常隱藏，依動作顯示
  const props = {};
  const flag = new THREE.Group();
  flag.add(cyl(0.015, 0.015, 0.5, 5, M.rim, 0, -0.22, 0));
  flag.add(box(0.3, 0.2, 0.02, M.flag, 0.15, -0.37, 0));
  R.hand.add(flag);
  props.flag = flag;
  const phone = box(0.08, 0.14, 0.015, M.dark, 0, -0.07, -0.03);
  R.hand.add(phone);
  props.phone = phone;
  const pen = cyl(0.01, 0.01, 0.2, 5, M.brandNavy, 0, -0.05, 0);
  pen.rotation.x = Math.PI / 2;
  const penPivot = new THREE.Group();
  penPivot.add(pen);
  penPivot.position.y = -0.05;
  R.hand.add(penPivot);
  props.pen = penPivot;
  const cup = new THREE.Group();
  cup.add(cyl(0.05, 0.045, 0.11, 8, M.mat, 0, 0, 0));
  cup.add(cyl(0.044, 0.044, 0.01, 8, M.coffee, 0, 0.052, 0));
  cup.position.set(0, -0.06, -0.02);
  R.hand.add(cup);
  props.cup = cup;
  const snack = box(0.12, 0.16, 0.04, M.snack[1], 0, -0.08, -0.02);
  L.hand.add(snack);
  props.snack = snack;
  // 兩手各一個啞鈴：握把橫在拳頭裡
  const dumbbell = (hand) => {
    const d = new THREE.Group();
    const bar = cyl(0.016, 0.016, 0.22, 6, M.steel, 0, 0, 0);
    bar.rotation.z = Math.PI / 2;
    d.add(bar);
    for (const sx of [-1, 1]) {
      const w = cyl(0.055, 0.055, 0.05, 8, M.dark, sx * 0.1, 0, 0);
      w.rotation.z = Math.PI / 2;
      d.add(w);
    }
    hand.add(d);
    return d;
  };
  props.dumbbellL = dumbbell(L.hand);
  props.dumbbellR = dumbbell(R.hand);
  for (const k of Object.keys(props)) props[k].visible = false;
  root.traverse((o) => {
    if (o.isMesh && o.material !== logoPatch) o.castShadow = true;
  });
  return {
    root, hips, torso, head, props,
    armL: L.pivot, armR: R.pivot, elbowL: L.elbow, elbowR: R.elbow, handL: L.hand, handR: R.hand,
    legL: LL.hip, legR: RL.hip, kneeL: LL.knee, kneeR: RL.knee,
    skinMat: skin, shirtMat: shirt,
  };
}

// 一張員工辦公桌（＋椅子、螢幕、狀態燈、員工）
export function makeSeat({ x, z, look, title, props }) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // 椅子貼近桌子，小人以真人坐姿比例（頭頂約 1.5）坐著打字
  const DESK_Z = -0.66;
  const desk = makeDesk(true);
  desk.position.z = DESK_Z;
  if (props) desk.add(cyl(0.05, 0.045, 0.11, 8, M.mug, -0.6, 0.83, 0.05));
  group.add(desk);

  const screen = new Screen(title || '');
  const monitor = makeMonitor(screen);
  monitor.group.position.z = DESK_Z;
  group.add(monitor.group);

  const lamp = makeLamp();
  lamp.group.position.z += DESK_Z;
  group.add(lamp.group);

  group.add(makeChair());

  const ch = makeCharacter(look);
  ch.root.scale.setScalar(CHAR_SCALE);
  group.add(ch.root);

  return { group, screen, panel: monitor.panel, lampMat: lamp.lampMat, ch, mouse: desk.userData.mouse };
}

// 負責人的主管桌：辦公室最前方、面向員工（也就是面向相機）
export function makeBossDesk(scene, { name = 'Owner' } = {}) {
  const group = new THREE.Group();
  group.position.set(0, 0, ROOM.backZ + 1.0);
  group.rotation.y = Math.PI;

  const desk = makeDesk(false, 2.4, 0.95, ['left', 'right']);
  desk.position.z = -0.75;
  group.add(desk);
  // 筆電：螢幕朝負責人，相機看到的是背面，不會擋住他
  const laptop = new THREE.Group();
  laptop.add(box(0.5, 0.025, 0.34, M.monitor, 0, 0.79, 0));
  const lid = box(0.5, 0.34, 0.02, M.monitorBack, 0, 0.95, -0.18);
  lid.rotation.x = -0.25;
  laptop.add(lid);
  laptop.position.set(0, 0, -0.55);
  group.add(laptop);
  // 名牌（朝相機）
  const plate = textPlate(name, 0.62, 0.17, { bg: BRAND.navy, fg: '#ffffff', font: 'bold 60px -apple-system, sans-serif' });
  plate.position.set(0.55, 0.88, -1.2);
  plate.rotation.set(-0.35, Math.PI, 0);
  group.add(plate);
  group.add(box(0.64, 0.06, 0.12, M.dark, 0.55, 0.81, -1.17));
  // 桌上植物與馬克杯
  const p = plant(-0.85, -0.85, 0.55);
  p.position.y = 0.78;
  group.add(p);
  group.add(cyl(0.05, 0.045, 0.11, 8, M.brandGold, 0.8, 0.835, -0.6));
  // 深藍地墊＋金邊（主管桌底下）
  group.add(box(1.7, 0.012, 1.1, M.brandGold, 0, 0.006, 0.05));
  group.add(box(1.62, 0.016, 1.02, M.brandNavy, 0, 0.008, 0.05));

  const chair = makeChair(M.brandNavy);
  chair.scale.setScalar(1.1);
  group.add(chair);
  const ch = makeCharacter({ boss: true });
  ch.root.scale.setScalar(CHAR_SCALE);
  group.add(ch.root);
  scene.add(group);
  return { group, ch };
}
