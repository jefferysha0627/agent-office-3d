// 機器人的規則式行為（不接 LLM）：探索、砍樹、挖礦、在家旁邊蓋小屋、天黑回家。
// 只有「辦公室螢幕正在看他玩」而且員工真的閒置時才會動，否則原地停下。
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

// 白天各任務的權重
const TASKS = { explore: 3, chop: 3, mine: 2, build: 2 };
const TASK_TIMEOUT_MS = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

function pickTask() {
  const total = Object.values(TASKS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [name, w] of Object.entries(TASKS)) {
    r -= w;
    if (r <= 0) return name;
  }
  return 'explore';
}

class Brain {
  constructor(bot, { home, onHome, log }) {
    this.bot = bot;
    this.home = home; // { x, y, z } 或 null（第一次啟用時決定）
    this.onHome = onHome;
    this.log = log;
    this.active = false;
    this.token = 0;
    this.task = 'idle';
    this.stats = { placed: 0, dug: 0 };
    // 給螢幕上的遊戲介面用：最近一次揮手、正在挖的進度
    this.lastSwing = 0;
    this.digging = null;
    bot.loadPlugin(pathfinder);
    bot.on('diggingCompleted', () => this.stats.dug++);
  }

  setup() {
    // swingArm 要等進入世界後才有：挖掘、放方塊時記下揮手時間
    if (!this.swingWrapped) {
      const swing = this.bot.swingArm.bind(this.bot);
      this.bot.swingArm = (...a) => {
        this.lastSwing = Date.now();
        return swing(...a);
      };
      this.swingWrapped = true;
    }
    const m = new Movements(this.bot);
    m.canDig = true;
    m.allow1by1towers = false; // 不要拿方塊往上疊（留給蓋房子）
    m.allowParkour = false;
    this.bot.pathfinder.setMovements(m);
    this.bot.pathfinder.thinkTimeout = 3000;
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    this.token++;
    if (!on) this.halt();
    else this.run(this.token);
  }

  halt() {
    const bot = this.bot;
    try {
      bot.pathfinder.stop();
      bot.pathfinder.setGoal(null);
    } catch {}
    try {
      bot.stopDigging();
    } catch {}
    bot.clearControlStates();
    this.task = 'idle';
  }

  alive(token) {
    return this.active && token === this.token && this.bot.entity;
  }

  async run(token) {
    while (this.alive(token)) {
      try {
        if (!this.home) await this.chooseHome(token);
        const night = this.isNight();
        const name = night ? 'goHome' : pickTask();
        this.task = name;
        await this.withTimeout(this[name](token), TASK_TIMEOUT_MS);
      } catch (e) {
        if (this.alive(token)) this.log?.(`task ${this.task} 失敗：${e.message}`);
      }
      this.bot.pathfinder.setGoal(null);
      if (this.alive(token)) await this.lookAround(token, rand(1500, 4000));
    }
  }

  withTimeout(p, ms) {
    let t;
    return Promise.race([
      p,
      new Promise((_, rej) => {
        t = setTimeout(() => {
          this.bot.pathfinder.stop();
          rej(new Error('timeout'));
        }, ms);
      }),
    ]).finally(() => clearTimeout(t));
  }

  isNight() {
    const t = this.bot.time.timeOfDay;
    return t > 12800 && t < 23200;
  }

  async goto(goal, token) {
    if (!this.alive(token)) return;
    await this.bot.pathfinder.goto(goal);
  }

  // ---- 家 ----

  async chooseHome(token) {
    const p = this.bot.entity.position.floored();
    this.home = { x: p.x, y: p.y, z: p.z };
    this.onHome?.(this.home);
  }

  async goHome(token) {
    const h = this.home;
    await this.goto(new goals.GoalNear(h.x, h.y, h.z, 1), token);
    // 天黑了：在家門口東張西望等天亮
    await this.lookAround(token, 8000);
  }

  // ---- 白天任務 ----

  async explore(token) {
    const h = this.home;
    const a = Math.random() * Math.PI * 2;
    const d = rand(10, 26);
    await this.goto(new goals.GoalXZ(Math.round(h.x + Math.cos(a) * d), Math.round(h.z + Math.sin(a) * d)), token);
    await this.lookAround(token, 3000);
  }

  async chop(token) {
    const bot = this.bot;
    const log = bot.findBlock({ matching: (b) => b.name.endsWith('_log'), maxDistance: 32 });
    if (!log) return this.explore(token);
    await this.goto(new goals.GoalGetToBlock(log.position.x, log.position.y, log.position.z), token);
    await this.equip(['stone_axe', 'wooden_axe']);
    // 從看得到的那塊開始，往上砍整根樹幹（最多 5 塊）
    for (let dy = 0; dy < 5 && this.alive(token); dy++) {
      const b = bot.blockAt(log.position.offset(0, dy, 0));
      if (!b || !b.name.endsWith('_log')) break;
      if (bot.entity.position.distanceTo(b.position.offset(0.5, 0.5, 0.5)) > 4.5) break;
      await this.dig(b);
    }
    await this.collectDrops(token);
  }

  async mine(token) {
    const bot = this.bot;
    const ores = new Set(['coal_ore', 'iron_ore', 'copper_ore', 'deepslate_coal_ore', 'deepslate_iron_ore']);
    const exposed = (b) => {
      for (const v of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = bot.blockAt(b.position.offset(...v));
        if (n && n.name === 'air') return true;
      }
      return false;
    };
    let target = bot.findBlock({ matching: (b) => ores.has(b.name), maxDistance: 24, useExtraInfo: exposed });
    if (!target) target = bot.findBlock({ matching: (b) => b.name === 'stone' || b.name === 'andesite' || b.name === 'granite', maxDistance: 16, useExtraInfo: exposed });
    if (!target) return this.explore(token);
    await this.goto(new goals.GoalLookAtBlock(target.position, bot.world), token);
    await this.equip(['stone_pickaxe', 'wooden_pickaxe']);
    await this.dig(target);
    // 順著挖旁邊的 2～3 塊，像在挖礦道
    const dir = bot.entity.position.offset(0, 1.6, 0).minus(target.position.offset(0.5, 0.5, 0.5)).scaled(-1);
    const step = new Vec3(Math.sign(Math.round(dir.x)), 0, Math.sign(Math.round(dir.z)));
    for (let i = 1; i <= 3 && this.alive(token); i++) {
      const b = bot.blockAt(target.position.plus(step.scaled(i)));
      if (!b || b.name === 'air' || !b.diggable || b.name.includes('water') || b.name.includes('lava')) break;
      await this.goto(new goals.GoalLookAtBlock(b.position, bot.world), token);
      await this.dig(b);
    }
    await this.collectDrops(token);
  }

  // 在家旁邊蓋一間 5×5、牆高 2 的小屋（前面留門），每次蓋幾塊，慢慢蓋完
  async build(token) {
    const bot = this.bot;
    const h = this.home;
    const plan = [];
    for (let y = 0; y < 2; y++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          const door = dx === 0 && dz === 2;
          if (edge && !door) plan.push(new Vec3(h.x + dx + 4, h.y + y, h.z + dz));
        }
      }
    }
    let placed = 0;
    for (const p of plan) {
      if (!this.alive(token) || placed >= 6) break;
      const here = bot.blockAt(p);
      const below = bot.blockAt(p.offset(0, -1, 0));
      if (!here || here.name !== 'air' || !below || below.boundingBox !== 'block') continue;
      const item = bot.inventory.items().find((i) => ['cobblestone', 'oak_planks', 'dirt', 'oak_log', 'birch_log', 'spruce_log'].includes(i.name));
      if (!item) return this.chop(token);
      await this.goto(new goals.GoalNear(p.x, p.y, p.z, 3), token);
      if (bot.entity.position.floored().equals(p) || bot.entity.position.floored().equals(p.offset(0, -1, 0))) continue;
      await bot.equip(item, 'hand');
      await bot.placeBlock(below, new Vec3(0, 1, 0));
      placed++;
      this.stats.placed++;
      await sleep(300);
    }
    if (!placed) await this.explore(token);
  }

  async dig(block) {
    this.digging = { start: Date.now(), ms: Math.max(50, this.bot.digTime(block)) };
    try {
      await this.bot.dig(block, true);
    } finally {
      this.digging = null;
    }
  }

  hud() {
    const bot = this.bot;
    const inv = bot.inventory;
    const slots = [];
    for (let i = 0; i < 9; i++) {
      const it = inv.slots[inv.hotbarStart + i];
      slots.push(it ? { name: it.name, count: it.count } : null);
    }
    const d = this.digging;
    return {
      slots,
      selected: bot.quickBarSlot,
      health: bot.health ?? 20,
      food: bot.food ?? 20,
      level: bot.experience?.level ?? 0,
      progress: bot.experience?.progress ?? 0,
      swingAgo: this.lastSwing ? Date.now() - this.lastSwing : 99999,
      dig: d ? Math.min(1, (Date.now() - d.start) / d.ms) : null,
    };
  }

  async collectDrops(token) {
    const bot = this.bot;
    const drops = Object.values(bot.entities).filter((e) => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 8);
    for (const e of drops.slice(0, 4)) {
      if (!this.alive(token) || !e.isValid) continue;
      await this.goto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, 0.8), token).catch(() => {});
    }
  }

  async equip(names) {
    const item = this.bot.inventory.items().find((i) => names.includes(i.name));
    if (item) await this.bot.equip(item, 'hand');
  }

  async lookAround(token, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && this.alive(token)) {
      await this.bot.look(this.bot.entity.yaw + rand(-1.2, 1.2), rand(-0.3, 0.2), false);
      await sleep(rand(600, 1400));
    }
  }
}

module.exports = { Brain };
