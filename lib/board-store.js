// 布告欄資料：年度目標、KPI、本週重點、待辦清單、歷史歸檔、每月歷史快照。
// - 內容直接編輯 data/board.json（格式見 docs/board-format.md）；第一次啟動時從 board.example.json 複製一份。
// - 伺服器只做兩種寫入：勾選待辦、換月自動結算。都是原子寫入並保留 .bak。
// - 自動 KPI 只讀：書架上進行中的專案數、任務資料夾裡本月完成的任務數。
import { promises as fs } from 'node:fs';
import path from 'node:path';

const LIMITS = { history: 36, todosDoneShown: 5, bytes: 4096 };

// board.json 沒有 kpis 時用的預設 KPI（目標值留空）
const DEFAULT_KPIS = [
  { id: 'revenue', name: '本月收入', unit: '$', type: 'manual' },
  { id: 'deals', name: '本月新案', unit: '件', type: 'manual' },
  { id: 'quotes', name: '本月報價', unit: '份', type: 'manual' },
  { id: 'cases', name: '進行中專案', unit: '案', type: 'auto', note: '書架上狀態為進行中的專案數' },
  { id: 'tasks-done', name: '本月完成任務', unit: '張', type: 'auto', note: '本月修改過、狀態寫「完成」的任務檔' },
];

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export class BoardStore {
  constructor({ file, example, tasksDir, countCases }) {
    this.file = file;
    this.dataDir = path.dirname(file);
    this.example = example;
    this.tasksDir = tasksDir;
    this.countCases = countCases;
    this.lastGood = null;
  }

  // 第一次啟動：還沒有 board.json 就從範例複製一份（之後只改 board.json，範例檔保持不變）
  async init() {
    try {
      await fs.access(this.file);
    } catch {
      try {
        // 記下目前月份，之後換月才會自動結算
        const raw = JSON.parse(await fs.readFile(this.example, 'utf8'));
        raw.lastMonth = BoardStore.monthOf();
        await this.write(raw);
      } catch {
        // 沒有範例檔也沒關係，布告欄顯示空白
      }
    }
  }

  static monthOf(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  emptyBoard() {
    return {
      version: 2,
      goal: { text: '' },
      kpis: DEFAULT_KPIS.map((k) => ({ ...k, value: null, target: null })),
      weekly: [],
      todos: [],
      archive: { projects: [] },
      history: [],
      lastMonth: BoardStore.monthOf(),
      updatedAt: null,
    };
  }

  // 版本號：檔案修改時間＋大小。前端每幾秒問一次，變了才重抓（直接改檔也會即時反映）
  async rev() {
    try {
      const st = await fs.stat(this.file);
      return `${st.mtimeMs}-${st.size}`;
    } catch {
      return 'none';
    }
  }

  // 讀檔：raw 是檔案原樣（寫回時只改需要的欄位），board 是整理過的版本（缺欄位只在記憶體補預設值）。
  // 手改的 JSON 若格式錯誤，沿用上一次正確的內容並回報錯誤
  async read() {
    let text;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch {
      return { raw: null, board: this.emptyBoard(), error: null, exists: false };
    }
    try {
      const raw = JSON.parse(text);
      const board = normalize(raw, this.emptyBoard());
      this.lastGood = board;
      return { raw, board, error: null, exists: true };
    } catch (e) {
      return { raw: null, board: this.lastGood || this.emptyBoard(), error: `board.json 格式錯誤：${e.message}`, exists: true };
    }
  }

  // 寫回原始 JSON（不會把記憶體裡補的預設值寫進檔案）；先寫暫存檔再改名，改名前備份成 board.json.bak
  async write(raw) {
    raw.updatedAt = new Date().toISOString();
    const json = JSON.stringify(raw, null, 2) + '\n';
    await fs.mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    await fs.writeFile(tmp, json, { mode: 0o600 });
    try {
      await fs.copyFile(this.file, `${this.file}.bak`);
    } catch {
      // 第一次寫還沒有舊檔
    }
    await fs.rename(tmp, this.file);
  }

  // ---- 自動 KPI（只讀） ----

  // 任務資料夾裡本月修改過、有一行「- 狀態：完成…」或「- Status: done…」的 md 檔
  async tasksDone(month) {
    try {
      const names = (await fs.readdir(this.tasksDir)).filter((n) => n.endsWith('.md') && !n.startsWith('.'));
      const done = [];
      for (const n of names) {
        const full = path.join(this.tasksDir, n);
        const st = await fs.stat(full);
        if (!st.isFile() || BoardStore.monthOf(st.mtime) !== month) continue;
        const m = /^- (狀態|Status)\s*[:：]\s*(.*)$/im.exec(await fs.readFile(full, 'utf8'));
        if (m && /^(完成|done)/i.test(m[2])) done.push(n);
      }
      return done;
    } catch {
      return null;
    }
  }

  async autoValues(month) {
    const done = await this.tasksDone(month);
    let cases = null;
    try {
      cases = await this.countCases();
    } catch {
      cases = null;
    }
    return { cases, 'tasks-done': done ? done.length : null, tasksDoneFiles: done || [] };
  }

  // ---- 每月快照 ----

  // 把一個月的 KPI 存成快照，寫進原始 JSON 的 history
  snapshot(raw, board, month, auto) {
    const entry = {
      month,
      closedAt: new Date().toISOString(),
      kpis: board.kpis.map((k) => ({ id: k.id, name: k.name, unit: k.unit, value: k.type === 'auto' ? auto[k.id] ?? null : k.value, target: k.target })),
    };
    const history = (Array.isArray(raw.history) ? raw.history : []).filter((h) => h?.month !== month);
    history.push(entry);
    history.sort((a, b) => String(a.month).localeCompare(String(b.month)));
    raw.history = history.slice(-LIMITS.history);
  }

  // 換月：結算上個月（手動 KPI 的「本月」數值歸零，目標保留）；只改 history、kpis[].value、lastMonth
  async rollover() {
    const { raw, board, error, exists } = await this.read();
    if (error || !exists) return false;
    const now = BoardStore.monthOf();
    if (board.lastMonth === now) return false;
    if (board.lastMonth) {
      this.snapshot(raw, board, board.lastMonth, await this.autoValues(board.lastMonth));
      for (const k of Array.isArray(raw.kpis) ? raw.kpis : []) if (k && k.type !== 'auto') k.value = null;
    }
    raw.lastMonth = now;
    await this.write(raw);
    return true;
  }

  // ---- 給前端的資料 ----

  async view() {
    await this.rollover();
    const { board, error } = await this.read();
    const auto = await this.autoValues(board.lastMonth);
    return {
      rev: await this.rev(),
      error,
      month: board.lastMonth,
      goal: board.goal,
      cashflow: cashflow(board),
      kpis: board.kpis.map((k) => (k.type === 'auto' ? { ...k, value: auto[k.id] ?? null } : k)),
      weekly: board.weekly,
      todos: visibleTodos(board.todos),
      archive: archiveView(board.archive),
      history: board.history,
      tasksDoneFiles: auto.tasksDoneFiles,
      updatedAt: board.updatedAt,
    };
  }

  // 唯一的使用者寫入：在布告欄介面勾選／取消勾選一筆待辦
  async toggleTodo(id, done) {
    if (typeof id !== 'string' || !ID.test(id) || typeof done !== 'boolean') throw new BadInput('待辦資料不正確');
    const { raw, error, exists } = await this.read();
    if (error) throw new BadInput('board.json 格式錯誤，暫時不能勾選');
    if (!exists) throw new BadInput('還沒有布告欄資料');
    // 只改原始 JSON 裡這一筆待辦的 done／doneAt
    const todo = (Array.isArray(raw.todos) ? raw.todos : []).find((t) => t?.id === id);
    if (!todo) throw new BadInput('找不到這筆待辦');
    todo.done = done;
    if (done) todo.doneAt = new Date().toISOString();
    else delete todo.doneAt;
    await this.write(raw);
    return this.view();
  }
}

export class BadInput extends Error {}
export { LIMITS };

// ---- 整理手改的資料（缺欄位補預設、型別不對就略過） ----

function normalize(raw, empty) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('最外層要是物件');
  const kpis = Array.isArray(raw.kpis)
    ? raw.kpis
        .filter((k) => k && typeof k.id === 'string' && typeof k.name === 'string')
        .map((k) => ({ ...k, id: str(k.id, 40), name: str(k.name, 40), unit: str(k.unit, 10), type: k.type === 'auto' ? 'auto' : 'manual', value: num(k.value), target: num(k.target), note: str(k.note) || undefined }))
    : empty.kpis;
  return {
    ...raw,
    version: 2,
    goal: { text: str(raw.goal?.text, 500), amount: num(raw.goal?.amount) },
    kpis,
    weekly: Array.isArray(raw.weekly) ? raw.weekly.filter((w) => w && typeof w.text === 'string' && w.text.trim()).map((w, i) => ({ id: str(w.id, 40) || `w-${i + 1}`, text: str(w.text, 60) })) : [],
    todos: Array.isArray(raw.todos)
      ? raw.todos
          .filter((t) => t && typeof t.id === 'string' && ID.test(t.id) && typeof t.text === 'string')
          .map((t) => ({ ...t, text: str(t.text, 120), done: t.done === true, file: str(t.file, 200) || undefined, doneAt: str(t.doneAt, 40) || undefined }))
      : [],
    archive: {
      projects: Array.isArray(raw.archive?.projects)
        ? raw.archive.projects
            .filter((p) => p && typeof p.name === 'string')
            .map((p) => {
              // 舊格式只有 revenue（當作已收）；已結案的案子合約等於已收。只在記憶體補，不寫回檔案
              const status = str(p.status, 20);
              const received = num(p.received) ?? num(p.revenue);
              const contract = num(p.contract) ?? (status.includes('結案') ? received : null);
              const pending = contract != null && received != null ? Math.max(0, contract - received) : null;
              return { name: str(p.name, 60), period: str(p.period, 40), status, contract, received, pending, revenue: num(p.revenue), note: str(p.note, 120) };
            })
        : [],
    },
    history: Array.isArray(raw.history) ? raw.history.filter((h) => h && typeof h.month === 'string' && Array.isArray(h.kpis)) : [],
    lastMonth: typeof raw.lastMonth === 'string' ? raw.lastMonth : BoardStore.monthOf(),
  };
}

// 待辦：未完成照原順序在前；已完成變灰排在後面，只留最近 5 筆
function visibleTodos(todos) {
  const open = todos.filter((t) => !t.done);
  const done = todos
    .filter((t) => t.done)
    .sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')))
    .slice(0, LIMITS.todosDoneShown);
  return [...open, ...done];
}

// 歷史歸檔：各案收入與已結案收入合計
function archiveView(archive) {
  const projects = archive.projects;
  const closed = projects.filter((p) => p.status.includes('結案') && p.received != null);
  return {
    projects,
    closedRevenue: closed.reduce((s, p) => s + p.received, 0),
    closedCount: closed.length,
  };
}

// 現金流：已收總額、待收尾款（各案合約減已收）、本月實收、年度目標達成進度
function cashflow(board) {
  const projects = board.archive.projects;
  const received = projects.reduce((s, p) => s + (p.received ?? 0), 0);
  const pending = projects.reduce((s, p) => s + (p.pending ?? 0), 0);
  const contractMissing = projects.filter((p) => !p.status.includes('結案') && p.contract == null).map((p) => p.name);
  const month = board.kpis.find((k) => k.id === 'revenue')?.value ?? null;
  const goal = board.goal.amount;
  return { received, pending, contractMissing, month, goal, progress: goal ? received / goal : null };
}
