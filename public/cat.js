// 辦公室的貓：低多邊形橘白貓，沿走道散步、坐下、舔爪、趴睡，偶爾跳上空桌、走到閒置員工腳邊、經過負責人的桌子。
// 只走在走道上（橫向三條、縱向三條），不會穿過或卡在家具裡。
import * as THREE from '/vendor/three/three.module.js';
import { ROOM } from './scene.js';

// ==== 行為設定 ====
const CAT = {
  speed: 0.42, // 每秒走幾格（慢慢走）
  plans: { wander: 30, feet: 20, desk: 15, owner: 15, nap: 20 }, // 各種行程的權重
  secs: { sit: [8, 16], lick: [6, 10], nap: [30, 60], deskStay: [25, 45], feet: [12, 22] },
};

// 走道：三條橫向（前排後方、兩排之間、主管桌前）＋三條縱向（左、中、右）
const ROWS = [ROOM.aisleFront, ROOM.aisleBack, -2.95];
const COLS = [ROOM.corridorL, 0, ROOM.corridorR];
const X_MIN = ROOM.corridorL;
const X_MAX = ROOM.corridorR;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const mat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });
const ORANGE = mat(0xf0a24e);
const STRIPE = mat(0xd9832f);
const WHITE = mat(0xffffff);
const PINK = mat(0xf2a7a7);
const DARK = mat(0x2b2f36);

function part(geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function buildCat() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.2;
  root.add(body);
  body.add(part(boxG(0.17, 0.15, 0.36), ORANGE, 0, 0, 0));
  body.add(part(boxG(0.15, 0.05, 0.3), WHITE, 0, -0.06, -0.01));
  for (const z of [-0.08, 0.01, 0.1]) body.add(part(boxG(0.176, 0.02, 0.04), STRIPE, 0, 0.068, z));

  const head = new THREE.Group();
  head.position.set(0, 0.29, -0.2);
  root.add(head);
  head.add(part(boxG(0.16, 0.14, 0.14), ORANGE, 0, 0, 0));
  head.add(part(boxG(0.09, 0.06, 0.04), WHITE, 0, -0.03, -0.072));
  head.add(part(boxG(0.025, 0.018, 0.01), PINK, 0, -0.008, -0.095));
  for (const s of [-1, 1]) {
    head.add(part(boxG(0.024, 0.03, 0.01), DARK, s * 0.04, 0.018, -0.072));
    const ear = part(new THREE.ConeGeometry(0.036, 0.065, 4), ORANGE, s * 0.048, 0.098, 0.005);
    ear.rotation.y = Math.PI / 4;
    head.add(ear);
  }

  // 尾巴：三節，往後上翹
  const tail = [];
  let parent = root;
  let at = new THREE.Vector3(0, 0.25, 0.18);
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Group();
    seg.position.copy(at);
    seg.add(part(boxG(0.04, 0.04, 0.11), i === 2 ? WHITE : ORANGE, 0, 0, 0.055));
    parent.add(seg);
    tail.push(seg);
    parent = seg;
    at = new THREE.Vector3(0, 0, 0.11);
  }

  // 四條腿：前左、前右、後左、後右
  const legs = [];
  for (const [x, z] of [[-0.055, -0.12], [0.055, -0.12], [-0.055, 0.12], [0.055, 0.12]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.13, z);
    pivot.add(part(boxG(0.045, 0.13, 0.045), ORANGE, 0, -0.065, 0));
    pivot.add(part(boxG(0.05, 0.03, 0.06), WHITE, 0, -0.12, -0.01));
    root.add(pivot);
    legs.push(pivot);
  }
  root.traverse((o) => {
    if (o.isMesh) o.userData.cat = true;
  });
  return { root, body, head, tail, legs };
}

function weightedPlan() {
  const total = Object.values(CAT.plans).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(CAT.plans)) {
    r -= w;
    if (r <= 0) return k;
  }
  return 'wander';
}

export class Cat {
  constructor(scene, { name = '麻糬' } = {}) {
    this.catName = name; // 在 office.config.json 的 cat.name 設定
    this.parts = buildCat();
    scene.add(this.parts.root);
    this.meshes = [];
    this.parts.root.traverse((o) => o.isMesh && this.meshes.push(o));
    this.pos = new THREE.Vector3(0.6, 0, ROWS[1]);
    this.face = 0;
    this.phase = 0;
    this.queue = [];
    this.step = null;
    this.home = { x: this.pos.x, z: ROWS[1] }; // 目前所在的走道點（離開走道時記著怎麼回來）
    this.pose = null;
  }

  get name() {
    return this.catName;
  }

  get sleeping() {
    return this.step?.type === 'nap' || (this.step?.type === 'stay' && this.step.lie);
  }

  // ---- 路線 ----

  route(fromRowPt, toRowPt) {
    if (fromRowPt.z === toRowPt.z) return [toRowPt];
    const col = COLS.reduce((best, c) => (Math.abs(fromRowPt.x - c) + Math.abs(c - toRowPt.x) < Math.abs(fromRowPt.x - best) + Math.abs(best - toRowPt.x) ? c : best));
    return [{ x: col, z: fromRowPt.z }, { x: col, z: toRowPt.z }, toRowPt];
  }

  // 走到某個走道點，再走到最後的落腳點（可在走道外，例如員工腳邊）
  goTo(rowPt, final) {
    const steps = [];
    if (this.pos.x !== this.home.x || this.pos.z !== this.home.z) steps.push({ x: this.home.x, z: this.home.z });
    steps.push(...this.route(this.home, rowPt));
    this.queue.push({ type: 'walk', pts: steps, endHome: rowPt });
    if (final) this.queue.push({ type: 'walk', pts: [final], endHome: rowPt });
  }

  // ---- 行程挑選 ----

  plan(world) {
    let choice = CAT.plans[world.forceCat] ? world.forceCat : weightedPlan();
    const randomRowPt = () => ({ x: +rand(X_MIN + 0.3, X_MAX - 0.3).toFixed(2), z: pick(ROWS) });

    if (choice === 'feet') {
      // 閒置、坐在位子上的員工
      const idle = world.seats.filter((s) => s.name && s.walk.mode === 'seated' && (s.status === 'idle' || s.status === 'done'));
      if (idle.length) {
        const s = pick(idle);
        const row = s.home.z > 1 ? ROWS[0] : ROWS[1];
        this.goTo({ x: s.home.x + 0.5, z: row }, { x: s.home.x + 0.5, z: s.home.z + 0.2 });
        this.queue.push({ type: 'sit', secs: rand(...CAT.secs.feet), face: Math.PI / 2 });
        if (Math.random() < 0.5) this.queue.push({ type: 'lick', secs: rand(...CAT.secs.lick) });
        return;
      }
      choice = 'wander';
    }
    if (choice === 'desk') {
      // 後排沒人坐的空桌：跳上桌子左側（不擋螢幕）
      const empty = world.seats.filter((s) => s.kind === 'extra' && !s.name);
      if (empty.length) {
        const s = pick(empty);
        const x = s.home.x - 0.55;
        const floor = { x, z: s.home.z + 0.4 };
        const top = { x, z: s.home.z - 0.5, y: 0.78 };
        this.goTo({ x, z: ROWS[1] }, floor);
        this.queue.push({ type: 'jump', from: floor, to: top });
        this.queue.push({ type: 'stay', secs: rand(...CAT.secs.deskStay), lie: Math.random() < 0.5 });
        this.queue.push({ type: 'jump', from: top, to: floor });
        return;
      }
      choice = 'wander';
    }
    if (choice === 'owner') {
      // 從主管桌前走過去，中途坐下看一下 負責人
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.goTo({ x: -2 * dir, z: ROWS[2] });
      this.queue.push({ type: 'walk', pts: [{ x: 0.3 * dir, z: ROWS[2] }], endHome: { x: 0.3 * dir, z: ROWS[2] } });
      this.queue.push({ type: 'sit', secs: rand(...CAT.secs.sit), face: 0 });
      this.queue.push({ type: 'walk', pts: [{ x: 2 * dir, z: ROWS[2] }], endHome: { x: 2 * dir, z: ROWS[2] } });
      return;
    }
    const pt = randomRowPt();
    this.goTo(pt);
    if (choice === 'nap') {
      this.queue.push({ type: 'nap', secs: rand(...CAT.secs.nap) });
    } else {
      this.queue.push({ type: 'sit', secs: rand(...CAT.secs.sit) });
      if (Math.random() < 0.6) this.queue.push({ type: 'lick', secs: rand(...CAT.secs.lick) });
    }
  }

  // ---- 每格更新 ----

  update(t, dt, world) {
    if (!this.step) {
      if (!this.queue.length) this.plan(world);
      this.step = this.queue.shift();
      this.step.t0 = t;
      if (this.step.secs) this.step.until = t + this.step.secs * world.speed;
    }
    const st = this.step;
    let done = false;
    if (st.type === 'walk') {
      let move = CAT.speed * dt;
      while (move > 0 && st.pts.length) {
        const p = st.pts[0];
        const dx = p.x - this.pos.x;
        const dz = p.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001) this.face = Math.atan2(-dx, -dz);
        if (d <= move) {
          this.pos.x = p.x;
          this.pos.z = p.z;
          move -= d;
          st.pts.shift();
        } else {
          this.pos.x += (dx / d) * move;
          this.pos.z += (dz / d) * move;
          this.phase += move * 26; // 腳步跟實際距離同步，不滑步
          move = 0;
        }
      }
      if (!st.pts.length) {
        done = true;
        if (st.endHome) this.home = { ...st.endHome };
      }
    } else if (st.type === 'jump') {
      const k = Math.min(1, (t - st.t0) / 0.7);
      this.pos.x = st.from.x + (st.to.x - st.from.x) * k;
      this.pos.z = st.from.z + (st.to.z - st.from.z) * k;
      this.pos.y = (st.from.y || 0) + ((st.to.y || 0) - (st.from.y || 0)) * k + Math.sin(k * Math.PI) * 0.35;
      this.face = Math.atan2(-(st.to.x - st.from.x), -(st.to.z - st.from.z));
      done = k >= 1;
    } else {
      if (st.face !== undefined) this.face = st.face;
      done = t >= st.until;
    }
    if (done) this.step = null;
    this.animate(t, dt);
  }

  animate(t, dt) {
    const { root, body, head, tail, legs } = this.parts;
    const type = this.step?.type || 'stand';
    const el = t - (this.step?.t0 || 0);
    // 尾巴：tailX 根部上下（負值往上翹）、tailY 根部左右、segX／segY 後兩節再彎多少
    const p = { bodyY: 0.2, bodyX: 0, headY: 0.29, headZ: -0.2, headX: 0, headRZ: 0, legs: [0, 0, 0, 0], legY: 0.13, tailX: -0.7, tailY: Math.sin(t * 1.5) * 0.3, segX: 0.25, segY: Math.sin(t * 1.5 + 1) * 0.25, breathe: 0 };
    if (type === 'walk') {
      // 對角步態：左前＋右後、右前＋左後交替
      const s = Math.sin(this.phase);
      p.legs = [s * 0.55, -s * 0.55, -s * 0.55, s * 0.55];
      p.bodyY = 0.2 + Math.abs(Math.cos(this.phase)) * 0.012;
      p.headX = Math.sin(this.phase * 0.5) * 0.05;
    } else if (type === 'jump') {
      p.legs = [-0.9, -0.9, 0.9, 0.9];
      p.tailX = -0.2;
      p.segY = 0;
    } else if (type === 'sit' || type === 'lick' || (type === 'stay' && !this.step.lie)) {
      // 坐下：後腿收起、屁股壓低，前腳撐直
      p.bodyX = 0.55;
      p.bodyY = 0.16;
      p.legs = [-0.25, -0.25, 1.35, 1.35];
      p.headY = 0.34;
      p.headZ = -0.16;
      // 坐著：尾巴放到地上，從身旁往前繞
      p.tailX = 0.55;
      p.tailY = 0.5;
      p.segX = 0;
      p.segY = 0.75 + Math.sin(t * 0.8) * 0.12;
      if (type === 'lick') {
        // 舔爪：右前腳抬到嘴邊，頭一點一點
        p.legs[1] = 1.9;
        p.headX = -0.35 + Math.max(0, Math.sin(el * 7)) * 0.15;
      } else {
        p.headX = Math.sin(t * 0.5) * 0.08;
      }
    } else if (type === 'nap' || type === 'stay') {
      // 趴睡：四腳收起、頭靠地、尾巴繞到身旁，身體跟著呼吸
      p.bodyY = 0.09;
      p.legY = 0.06;
      p.legs = [1.5, 1.5, -1.5, -1.5];
      p.headY = 0.12;
      p.headZ = -0.22;
      p.headX = -0.15;
      p.headRZ = 0.35;
      // 尾巴貼地繞到身體側邊
      p.tailX = 0.2;
      p.tailY = 0.9;
      p.segX = 0;
      p.segY = 0.8;
      p.breathe = Math.sin(t * 1.6) * 0.012;
    }
    if (!this.pose) this.pose = { ...p, legs: [...p.legs] };
    const k = 1 - Math.exp(-dt * 10);
    for (const key of Object.keys(p)) {
      if (key === 'legs') for (let i = 0; i < 4; i++) this.pose.legs[i] += (p.legs[i] - this.pose.legs[i]) * k;
      else this.pose[key] += (p[key] - this.pose[key]) * k;
    }
    const q = this.pose;
    root.position.set(this.pos.x, this.pos.y || 0, this.pos.z);
    let d = this.face - root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    root.rotation.y += d * (1 - Math.exp(-dt * 6));
    body.position.y = q.bodyY + q.breathe;
    body.rotation.x = q.bodyX;
    head.position.set(0, q.headY, q.headZ);
    head.rotation.set(q.headX, 0, q.headRZ);
    legs.forEach((leg, i) => {
      leg.rotation.x = q.legs[i];
      leg.position.y = q.legY;
    });
    // 根部跟著身體高度（趴下時不會浮在半空），旋轉順序先左右再上下，才不會在轉向側邊後失去往下的角度
    tail[0].position.y = q.bodyY + 0.05;
    tail[0].rotation.order = 'YXZ';
    tail[0].rotation.set(q.tailX, q.tailY, 0);
    for (const seg of [tail[1], tail[2]]) {
      seg.rotation.order = 'YXZ';
      seg.rotation.set(q.segX, q.segY, 0);
    }
  }

  // 名牌與 Zzz 的位置（頭頂）
  headWorld(v) {
    return this.parts.head.getWorldPosition(v);
  }
}
