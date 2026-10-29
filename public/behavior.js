// 員工行為：閒置動作機率與時間、走去其他區域、狀態改變時回座，以及每個動作的姿勢。
import { ROOM, SPOTS, HIP_SIT, HIP_STAND } from './scene.js';

// ==== 閒置動作設定（idle／done 時隨機挑一個；chance 是百分比，secs 是持續秒數範圍） ====
export const IDLE_ACTIONS = {
  // 坐在位子上的小動作 65%
  phone: { chance: 12, where: 'seat', secs: [20, 40], label: '滑手機' },
  stretch: { chance: 10, where: 'seat', secs: [20, 30], label: '伸懶腰' },
  pen: { chance: 10, where: 'seat', secs: [20, 40], label: '轉筆' },
  tidy: { chance: 10, where: 'seat', secs: [20, 35], label: '整理桌面' },
  drink: { chance: 12, where: 'seat', secs: [20, 40], label: '喝飲料' },
  window: { chance: 11, where: 'seat', secs: [20, 40], label: '看窗外發呆' },
  // 起身去其他區域，做完走回座位 18%（秒數是在該地點停留的時間，不含走路）
  coffee: { chance: 5, where: 'coffee', secs: [50, 80], label: '泡咖啡' },
  snack: { chance: 4, where: 'snack', secs: [40, 70], label: '拿零食' },
  treadmill: { chance: 4, where: 'treadmill', secs: [60, 110], label: '跑步機' },
  dumbbell: { chance: 2, where: 'dumbbell', secs: [60, 110], label: '舉啞鈴' },
  toilet: { chance: 3, where: 'toilet', secs: [60, 100], label: '上廁所' },
  // 偷玩 Minecraft 12%（螢幕顯示他的機器人第一人稱畫面；Minecraft 沒開時用內建小遊戲）、趴睡 5%
  game: { chance: 12, where: 'seat', secs: [60, 180], label: '偷玩遊戲' },
  sleep: { chance: 5, where: 'seat', secs: [60, 150], label: '趴睡' },
};

export const IDLE_TIMING = {
  firstDelay: [10, 20], // 剛轉成閒置時，先發呆幾秒才開始挑動作
  between: [5, 10], // 兩個動作之間發呆幾秒
  afterReturnSecs: [20, 40], // 端咖啡、帶零食回座位後，接著喝／吃幾秒
  afterReturn: { coffee: 'drink', snack: 'eat' },
  walkSpeed: 1.3, // 每秒走幾格
  runSpeed: 3.0, // 狀態變成 working／blocked 時跑回座位
};

// 步伐：腿長 × 擺幅決定一步多遠，相位跟著實際移動距離走，腳才不會滑
const LEG = 0.64 * 1.1;
const STEP = { walk: 0.45, run: 0.7 };
const PHASE_PER_UNIT = {
  walk: Math.PI / (2 * LEG * Math.sin(STEP.walk)),
  run: Math.PI / (2 * LEG * Math.sin(STEP.run)),
};

const EXTRA_TEXT = {
  typing: '打字中',
  sit: '發呆',
  eat: '吃零食',
  blocked: '舉旗等確認',
  run: '跑回座位',
  back: '走回座位',
};

// 面板用的動作說明（名牌不顯示動作）
export function actionText(seat) {
  const w = seat.walk;
  if (w.mode === 'seated' && seat.action === 'game') return seat.game?.mc ? '偷玩 Minecraft' : '偷玩內建小遊戲';
  if (w.mode === 'going') return `走去${IDLE_ACTIONS[w.activity].label}`;
  if (w.mode === 'returning') return w.run ? EXTRA_TEXT.run : EXTRA_TEXT.back;
  return IDLE_ACTIONS[seat.action]?.label || EXTRA_TEXT[seat.action] || seat.action;
}

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
// 0→1→0 的平滑脈衝：在 [a, b] 之間升起又落下
const pulse = (x, a, b) => {
  if (x <= a || x >= b) return 0;
  return Math.sin(((x - a) / (b - a)) * Math.PI);
};

export function createWalk(seat) {
  const { x, z } = seat.group.position;
  seat.home = { x, z };
  seat.walk = { mode: 'seated', pos: { x, z }, face: 0, path: [], next: 0, activity: null, start: 0, until: 0, carry: null, hidden: false, run: false, phase: 0, lift: 0 };
}

// ---- 動作挑選 ----

function pickIdle(seat, opts) {
  // 驗證用的強制動作；地點已經有人在用就照常隨機挑
  const forced = opts.forced && IDLE_ACTIONS[opts.forced] ? opts.forced : null;
  const fa = forced && IDLE_ACTIONS[forced];
  if (fa && (fa.where === 'seat' || SPOTS[fa.where].user == null)) return forced;
  // 有人在用的地點（咖啡機、跑步機…）先不排
  const entries = Object.entries(IDLE_ACTIONS).filter(([, a]) => a.where === 'seat' || SPOTS[a.where].user == null);
  const total = entries.reduce((s, [, a]) => s + a.chance, 0);
  let r = Math.random() * total;
  for (const [name, a] of entries) {
    r -= a.chance;
    if (r <= 0) return name;
  }
  return entries[entries.length - 1][0];
}

function buildPath(seat, spotName) {
  const spot = SPOTS[spotName];
  const h = seat.home;
  const aisle = h.z > 1 ? ROOM.aisleFront : ROOM.aisleBack;
  const cx = spot.side === 'L' ? ROOM.corridorL : ROOM.corridorR;
  const via = spot.via || [];
  const pts = [[h.x, h.z + 0.6], [h.x, aisle], [cx, aisle], [cx, via.length ? via[0][1] : spot.z], ...via, [spot.x, spot.z]];
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01);
}

function startAction(seat, name, now, speed, screen) {
  const a = IDLE_ACTIONS[name];
  if (a.where === 'seat') {
    seat.action = name;
    seat.actionStart = now;
    seat.actionUntil = now + rand(...a.secs) * speed;
    if (name === 'game') screen.pickGame();
    return;
  }
  const w = seat.walk;
  SPOTS[a.where].user = seat.index;
  w.mode = 'going';
  w.activity = name;
  w.path = buildPath(seat, a.where);
  w.next = 0;
  w.run = false;
  seat.action = 'walk';
}

function releaseSpot(seat) {
  for (const s of Object.values(SPOTS)) if (s.user === seat.index) s.user = null;
}

function startReturn(seat, run) {
  const w = seat.walk;
  if (w.mode === 'returning') {
    // 已經在走回座位的路上，只是改成用跑的
    w.run = run;
    if (run) w.carry = null;
    return;
  }
  const passed = w.mode === 'activity' ? w.path : w.path.slice(0, w.next);
  w.path = [...passed.slice().reverse(), [seat.home.x, seat.home.z]];
  w.next = 0;
  w.mode = 'returning';
  w.run = run;
  w.hidden = false;
  w.lift = 0;
  w.carry = run ? null : { coffee: 'cup', snack: 'snack' }[w.activity] || null;
  releaseSpot(seat);
}

// ---- 每格更新：決定動作、移動位置 ----

export function updateWorker(seat, now, dt, opts) {
  const w = seat.walk;
  const st = seat.status;
  const urgent = st === 'working' || st === 'blocked';

  if (w.mode !== 'seated') {
    if (urgent && !(w.mode === 'returning' && w.run)) startReturn(seat, true);
    if (w.mode === 'activity') {
      seat.action = w.activity;
      const prog = (now - w.start) / Math.max(0.001, w.until - w.start);
      // 泡咖啡：拿到杯子後轉身面向辦公室喝
      if (w.activity === 'coffee') w.face = prog > 0.68 ? 2.4 : SPOTS.coffee.face;
      if (now >= w.until) startReturn(seat, false);
    }
    if (w.mode === 'going' || w.mode === 'returning') move(seat, now, dt, opts);
    if (w.mode !== 'seated') return;
  }

  if (st === 'blocked') {
    // 最高優先：任何閒置動作都直接中止
    seat.action = 'blocked';
    return;
  }
  if (st === 'working') {
    seat.action = 'typing';
    return;
  }
  if (st === 'idle' || st === 'done') {
    if (seat.action === 'typing' || seat.action === 'blocked' || seat.action === 'walk') {
      seat.action = 'sit';
      seat.actionUntil = now + rand(...IDLE_TIMING.firstDelay) * opts.speed;
    }
    if (now >= seat.actionUntil) {
      if (seat.action !== 'sit') {
        seat.action = 'sit';
        seat.actionUntil = now + rand(...IDLE_TIMING.between) * opts.speed;
      } else {
        startAction(seat, pickIdle(seat, opts), now, opts.speed, seat.screen);
      }
    }
    return;
  }
  seat.action = 'sit';
}

function move(seat, now, dt, opts) {
  const w = seat.walk;
  let step = (w.run ? IDLE_TIMING.runSpeed : IDLE_TIMING.walkSpeed) * dt;
  w.phase += step * (w.run ? PHASE_PER_UNIT.run : PHASE_PER_UNIT.walk);
  while (step > 0 && w.next < w.path.length) {
    const [tx, tz] = w.path[w.next];
    const dx = tx - w.pos.x;
    const dz = tz - w.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.001) w.face = Math.atan2(-dx, -dz);
    if (d <= step) {
      w.pos.x = tx;
      w.pos.z = tz;
      step -= d;
      w.next++;
    } else {
      w.pos.x += (dx / d) * step;
      w.pos.z += (dz / d) * step;
      step = 0;
    }
  }
  if (w.next < w.path.length) return;

  if (w.mode === 'going') {
    const a = IDLE_ACTIONS[w.activity];
    const spot = SPOTS[a.where];
    w.mode = 'activity';
    w.face = spot.face;
    w.start = now;
    w.until = now + rand(...a.secs) * opts.speed;
    w.hidden = !!spot.hide;
    w.lift = spot.lift || 0;
    seat.action = w.activity;
    return;
  }
  // 回到座位
  const follow = !w.run && IDLE_TIMING.afterReturn[w.activity];
  w.mode = 'seated';
  w.face = 0;
  w.pos = { ...seat.home };
  w.activity = null;
  w.carry = null;
  w.run = false;
  seat.actionStart = now;
  if (follow) {
    seat.action = follow;
    seat.actionUntil = now + rand(...IDLE_TIMING.afterReturnSecs) * opts.speed;
  } else {
    seat.action = 'sit';
    seat.actionUntil = now + rand(...IDLE_TIMING.between) * opts.speed;
  }
}

// ---- 姿勢 ----
// 角度慣例：arm*X 肩膀往前抬、arm*Z 往外張（右手正值、左手負值）、elbow* 手肘彎（前臂往前上）
// leg* 大腿往前、knee* 小腿往後彎（負值）、torso 正值往後仰、負值往前傾、headX 正值抬頭

function seatedBase(p) {
  p.hipsY = HIP_SIT;
  p.legL = p.legR = Math.PI / 2;
  p.kneeL = p.kneeR = -Math.PI / 2;
}

// 坐著打字的手：上臂往前、手肘彎，前臂平放在鍵盤上
function handsOnKeyboard(p) {
  p.armLX = p.armRX = 0.62;
  p.elbowL = p.elbowR = 0.85;
  p.armLZ = 0.12;
  p.armRZ = -0.12;
}

function walkPose(p, w) {
  const amp = w.run ? STEP.run : STEP.walk;
  const s = Math.sin(w.phase);
  p.hipsY = HIP_STAND + Math.abs(Math.cos(w.phase)) * (w.run ? 0.04 : 0.02);
  p.legL = s * amp;
  p.legR = -s * amp;
  // 往後擺的那隻腳膝蓋彎
  p.kneeL = -Math.max(0, -Math.sin(w.phase - 0.6)) * amp * (w.run ? 1.8 : 1.1);
  p.kneeR = -Math.max(0, Math.sin(w.phase - 0.6)) * amp * (w.run ? 1.8 : 1.1);
  p.armLX = -s * amp * 0.9;
  p.armRX = s * amp * 0.9;
  p.elbowL = p.elbowR = w.run ? 1.5 : 0.35;
  p.armLZ = -0.06;
  p.armRZ = 0.06;
  p.torso = w.run ? -0.22 : -0.03;
  p.headX = w.run ? 0.15 : 0;
}

export function targetPose(seat, t) {
  const w = seat.walk;
  const p = {
    torso: 0.05, headX: 0, headY: 0, headZ: 0,
    armLX: 0.1, armRX: 0.1, armLZ: -0.06, armRZ: 0.06, elbowL: 0.15, elbowR: 0.15,
    legL: 0, legR: 0, kneeL: 0, kneeR: 0,
    hipsY: HIP_STAND, penSpin: 0, mouseX: 0, mouseZ: 0,
  };
  const ph = seat.index * 1.7;

  // ---- 站著：走路、各區域活動 ----
  if (w.mode !== 'seated') {
    if (w.mode === 'going' || w.mode === 'returning') {
      walkPose(p, w);
      if (w.carry === 'cup') {
        p.armRX = 0.55;
        p.elbowR = 1.25;
      } else if (w.carry === 'snack') {
        p.armLX = 0.55;
        p.elbowL = 1.25;
      }
    } else {
      const span = Math.max(0.001, w.until - w.start);
      const prog = (t - w.start) / span;
      const el = t - w.start;
      switch (w.activity) {
        case 'coffee':
          if (prog < 0.1) {
            // 按咖啡機按鈕
            p.armRX = 1.25;
            p.elbowR = 0.35 + pulse((el * 1.5) % 1, 0.2, 0.6) * 0.25;
            p.headX = -0.2;
          } else if (prog < 0.58) {
            // 雙手抱胸等咖啡，重心左右換、偶爾看看四周
            p.armLX = p.armRX = 0.35;
            p.elbowL = p.elbowR = 1.9;
            p.armLZ = 0.35;
            p.armRZ = -0.35;
            p.headY = Math.sin(el * 0.4) * 0.45;
            p.headX = -0.1;
            p.legL = Math.max(0, Math.sin(el * 0.5)) * 0.08;
            p.legR = Math.max(0, -Math.sin(el * 0.5)) * 0.08;
          } else if (prog < 0.68) {
            // 伸手拿杯子
            p.armRX = 1.15;
            p.elbowR = 0.4;
            p.headX = -0.25;
          } else {
            // 轉身拿著杯子，隔一陣子喝一口
            const sip = pulse(el % 7, 1, 3.4);
            p.armRX = 0.5 - sip * 0.1;
            p.elbowR = 1.3 + sip * 1.05;
            p.armRZ = 0.08;
            p.headX = sip * 0.25;
            p.armLX = 0.05;
          }
          break;
        case 'snack': {
          if (prog < 0.25) {
            // 在零食架前挑：左手伸出去、頭跟著看
            p.armLX = 1.0 + Math.sin(el * 1.3) * 0.15;
            p.elbowL = 0.5;
            p.armLZ = -0.15 + Math.sin(el * 0.9) * 0.15;
            p.headX = -0.25;
            p.headY = Math.sin(el * 0.9) * 0.25;
          } else {
            // 拿著零食吃，偶爾送進嘴裡
            const bite = pulse(el % 5, 0.8, 2.4);
            p.armLX = 0.5 - bite * 0.1;
            p.elbowL = 1.3 + bite * 1.0;
            p.headX = -0.05 + bite * 0.1;
          }
          break;
        }
        case 'treadmill': {
          // 站在跑帶上慢跑：手腳交替、手肘彎、身體上下起伏
          const f = t * 8.2 + ph;
          const s = Math.sin(f);
          p.hipsY = HIP_STAND + Math.abs(Math.cos(f)) * 0.035;
          p.legL = s * 0.55;
          p.legR = -s * 0.55;
          p.kneeL = -Math.max(0, -Math.sin(f - 0.6)) * 1.1 - 0.1;
          p.kneeR = -Math.max(0, Math.sin(f - 0.6)) * 1.1 - 0.1;
          p.armLX = -s * 0.6;
          p.armRX = s * 0.6;
          p.elbowL = p.elbowR = 1.45;
          p.armLZ = -0.1;
          p.armRZ = 0.1;
          p.torso = -0.12;
          p.headX = 0.12;
          break;
        }
        case 'dumbbell': {
          // 一組 8 下左右交替彎舉、組間休息：上臂貼身不動，只有前臂上下
          const set = el % 26;
          p.armLX = p.armRX = 0.06;
          p.armLZ = -0.1;
          p.armRZ = 0.1;
          p.elbowL = p.elbowR = 0.15;
          if (set < 17) {
            const rep = (set / 2.1) % 2;
            const curlL = rep < 1 ? Math.sin(rep * Math.PI) : 0;
            const curlR = rep >= 1 ? Math.sin((rep - 1) * Math.PI) : 0;
            p.elbowL = 0.15 + curlL * 2.1;
            p.elbowR = 0.15 + curlR * 2.1;
            p.headX = -0.15;
            p.torso = -0.02 + (curlL + curlR) * 0.04;
          } else {
            // 休息：甩甩手、看看四周
            p.headY = Math.sin(el * 0.8) * 0.3;
            p.armLZ = -0.12 - Math.sin(el * 2) * 0.05;
            p.armRZ = 0.12 + Math.sin(el * 2) * 0.05;
          }
          break;
        }
        default:
          break;
      }
    }
    // blocked 回座途中舉旗，仍看得出來
    if (seat.status === 'blocked') {
      p.armRX = 3.0;
      p.elbowR = 0.1;
      p.armRZ = 0.3 + Math.sin(t * 9) * 0.25;
    }
    return p;
  }

  // ---- 坐著 ----
  seatedBase(p);
  const el = t - (seat.actionStart || 0);
  // 平常：手放大腿上，身體微微呼吸
  p.armLX = p.armRX = 0.5;
  p.elbowL = p.elbowR = 0.7;
  p.armLZ = 0.06;
  p.armRZ = -0.06;
  p.torso = 0.05 + Math.sin(t * 1.6 + ph) * 0.01;

  switch (seat.action) {
    case 'typing': {
      handsOnKeyboard(p);
      p.torso = -0.12;
      // 手指敲鍵盤：左右手交替小幅點動，偶爾停下來看螢幕
      const pause = Math.sin(t * 0.45 + ph) > 0.75 ? 0 : 1;
      p.elbowL += Math.max(0, Math.sin(t * 14 + ph)) * 0.07 * pause;
      p.elbowR += Math.max(0, Math.sin(t * 14 + ph + 1.7)) * 0.07 * pause;
      p.armLZ += Math.sin(t * 2.3 + ph) * 0.04 * pause;
      p.armRZ += Math.sin(t * 2.9 + ph) * 0.04 * pause;
      p.headX = -0.1 + (1 - pause) * 0.08;
      break;
    }
    case 'game': {
      // 左手 WASD、右手滑鼠：滑鼠小幅快速移動、偶爾點擊；身體跟著戰況前傾或往後仰
      handsOnKeyboard(p);
      p.armLX = 0.6;
      p.elbowL = 0.85 + Math.max(0, Math.sin(t * 9 + ph)) * 0.06;
      p.armLZ = 0.2;
      const mx = Math.sin(t * 7.3 + ph) * 0.6 + Math.sin(t * 13.1) * 0.4;
      const mz = Math.sin(t * 5.7 + ph * 2) * 0.6 + Math.sin(t * 11.3) * 0.4;
      const click = Math.max(0, Math.sin(t * 4.7 + ph)) > 0.93 ? 1 : 0;
      // 右手外張到滑鼠墊上，從背後才看得到滑鼠手在動
      p.armRX = 0.6 + mz * 0.06;
      p.armRZ = 0.3 + mx * 0.09;
      p.elbowR = 0.85 - click * 0.1 + mz * 0.05;
      p.mouseX = mx * 0.045;
      p.mouseZ = -mz * 0.035;
      const mood = Math.sin(t * 0.21 + ph) * Math.sin(t * 0.57 + ph * 3);
      p.torso = mood > 0.45 ? 0.16 : mood < -0.45 ? -0.26 : -0.1;
      p.headX = mood > 0.45 ? 0.12 : mood < -0.45 ? -0.18 : -0.06;
      p.headZ = Math.sin(t * 1.1 + ph) * 0.05;
      break;
    }
    case 'sleep':
      // 兩手交疊在桌上，頭側趴在手臂上
      // 身體已往前傾 0.9，上臂相對身體只要再往前一點就會平放在桌上
      p.torso = -0.9 + Math.sin(t * 1.5 + ph) * 0.025;
      p.armLX = p.armRX = 0.6;
      p.elbowL = p.elbowR = 0.25;
      p.armLZ = 0.55;
      p.armRZ = -0.55;
      p.headX = 0.2;
      p.headZ = 0.4;
      break;
    case 'stretch': {
      // 前 8 秒：雙手往上伸直、身體往後仰，再慢慢放下；之後靠著椅背放鬆
      const k = pulse(el, 0, 8) ** 0.7;
      p.armLX = p.armRX = 0.5 + 2.55 * k;
      p.elbowL = p.elbowR = 0.7 * (1 - k);
      p.armLZ = 0.06 + 0.06 * k;
      p.armRZ = -0.06 - 0.06 * k;
      p.torso = 0.08 + 0.22 * k;
      p.headX = 0.32 * k;
      if (el > 8) {
        p.torso = 0.16;
        p.headX = 0.05;
      }
      break;
    }
    case 'phone':
      // 靠椅背、右手肘靠著，手機拿在胸前右側低頭滑，拇指在螢幕上點
      p.torso = 0.14;
      p.armRX = 0.3;
      p.armRZ = 0.28;
      p.elbowR = 1.65 + Math.sin(t * 6 + ph) * 0.03;
      p.armLX = 0.45;
      p.elbowL = 0.6;
      p.headX = -0.45;
      p.headY = -0.25;
      break;
    case 'pen':
      // 右手肘撐桌、前臂立起來轉筆，左手放桌上
      p.torso = -0.05;
      p.armRX = 0.95;
      p.armRZ = 0.32;
      p.elbowR = 1.6;
      p.armLX = 0.75;
      p.elbowL = 0.7;
      p.penSpin = t * 10;
      p.headX = -0.05;
      p.headZ = Math.sin(t * 0.5 + ph) * 0.08;
      break;
    case 'tidy': {
      // 往前把桌上的東西左右整理
      const sweep = Math.sin(el * 0.9);
      p.torso = -0.2;
      p.armLX = p.armRX = 1.1;
      p.elbowL = p.elbowR = 0.45;
      p.armLZ = 0.1 + sweep * 0.3;
      p.armRZ = -0.1 + sweep * 0.3;
      p.headX = -0.25;
      p.headY = -sweep * 0.25;
      break;
    }
    case 'drink':
    case 'eat': {
      // 手放在桌上拿著杯子／零食，每隔幾秒拿起來喝一口
      const sip = pulse(el % 8, 2, 4.4);
      if (seat.action === 'drink') {
        p.armRX = 0.8 - sip * 0.35;
        p.elbowR = 0.8 + sip * 1.5;
        p.armRZ = -0.05;
      } else {
        p.armLX = 0.8 - sip * 0.35;
        p.elbowL = 0.8 + sip * 1.5;
        p.armLZ = 0.05;
      }
      p.headX = sip * 0.22;
      break;
    }
    case 'window':
      // 雙手抱頭靠著椅背，望著窗外發呆
      p.torso = 0.2;
      p.armLX = p.armRX = 2.75;
      p.elbowL = p.elbowR = 2.35;
      p.armLZ = -0.55;
      p.armRZ = 0.55;
      p.headX = 0.18;
      p.headY = Math.sin(t * 0.25 + ph) * 0.4;
      break;
    case 'blocked':
      p.torso = 0.02;
      p.headY = -0.55;
      p.headX = 0.1;
      p.armRX = 3.0;
      p.elbowR = 0.1;
      p.armRZ = 0.3 + Math.sin(t * 9) * 0.25;
      p.armLX = 0.5;
      p.elbowL = 0.7;
      break;
    default:
      p.headZ = Math.sin(t * 0.7 + ph) * 0.06;
      p.headY = Math.sin(t * 0.4 + ph) * 0.2;
  }
  return p;
}

// 依動作顯示手上道具
export function propsFor(seat) {
  const w = seat.walk;
  const a = seat.action;
  const seated = w.mode === 'seated';
  const activity = w.mode === 'activity' ? w.activity : null;
  const prog = activity ? (seat.lastT - w.start) / Math.max(0.001, w.until - w.start) : 0;
  return {
    flag: seat.status === 'blocked',
    phone: seated && a === 'phone',
    pen: seated && a === 'pen',
    cup: (seated && a === 'drink') || w.carry === 'cup' || (activity === 'coffee' && prog > 0.63),
    snack: (seated && a === 'eat') || w.carry === 'snack' || (activity === 'snack' && prog > 0.2),
    dumbbellL: activity === 'dumbbell',
    dumbbellR: activity === 'dumbbell',
  };
}
