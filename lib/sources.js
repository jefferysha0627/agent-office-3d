// 員工狀態來源（adapter）：每種來源都提供 collect({ full, focus }) → { agents: [...] | null, error, lite }
// - demo：假狀態輪播，不需要任何 Agent，剛下載就看得到效果（終端內容是假的，一律附上）。
// - herdr：呼叫 Herdr 的唯讀指令（agent list／agent read），不送鍵、不下指令。
//   full=false 只跑 agent list；full=true 才讀終端內容（agent read），而且有快取。
//   agent read 太頻繁會讓某些終端機（例如 Ghostty）畫面規律跳動，所以讀得越少越好。
import { execFile } from 'node:child_process';

export function createSource(config) {
  return config.source.type === 'herdr' ? herdrSource(config) : demoSource(config);
}

// ---- demo ----

const DEMO_SLOT_MS = 40 * 1000; // 每 40 秒換一次狀態：閒置夠久才看得到員工玩一陣子 Minecraft
const DEMO_WORK = [
  '● Read(src/components/Header.tsx)',
  '  ⎿  Read 84 lines',
  '● Update(src/components/Header.tsx)',
  '  ⎿  Updated with 6 additions and 2 removals',
  '● Bash(npm run lint)',
  '  ⎿  ✔ No lint errors',
  '● Write(docs/notes.md)',
  '✻ Thinking…',
  '● Bash(npm test -- header)',
  '  ⎿  Tests: 12 passed, 12 total',
  '● Grep("TODO", path: "src")',
  '  ⎿  Found 3 matches',
];

function demoLines(id, status, t) {
  const tag = `[demo] ${id}`;
  if (status === 'idle') return [tag, '', '❯ '];
  if (status === 'done') return [tag, '✔ 完成：示範任務已寫入 docs/notes.md', '', '❯ '];
  if (status === 'blocked') return [tag, 'Allow command?', '  npm install three', '› 1. Yes   2. No（示範用的權限確認畫面）'];
  const n = 4 + (Math.floor(t / 3000) % 8);
  const start = (id.length * 3) % DEMO_WORK.length;
  return [tag, ...Array.from({ length: n }, (_, i) => DEMO_WORK[(start + i) % DEMO_WORK.length])];
}

function demoSource(config) {
  const names = [...config.staff.map((s) => s.id), 'tmp-helper'];
  return {
    type: 'demo',
    async collect() {
      const t = Date.now();
      const slot = Math.floor(t / DEMO_SLOT_MS);
      const n = names.length;
      const agents = names.map((name, i) => {
        // 輪流休息：任何時候都剛好有兩位閒置（閒置 → 完成待命，各一段，共 80 秒），打開頁面很快就有人去玩；
        // 其他人工作中，每三段有一位舉旗「需要確認」，示範紅色名牌
        const k = (((slot - i) % n) + n) % n;
        let status = k === 0 ? 'idle' : k === 1 ? 'done' : 'working';
        if (n > 3 && k === n - 1 && slot % 3 === 0) status = 'blocked';
        if (process.env.DEMO_ALL_IDLE === '1') status = 'idle'; // 拍片用：全員閒置，持續玩 Minecraft
        return { name, agent: i % 2 ? 'codex' : 'claude', status, title: name, paneId: `demo-${i + 1}`, focused: false, lines: demoLines(name, status, t) };
      });
      return { agents, error: null, lite: false };
    },
  };
}

// ---- herdr（唯讀白名單） ----

const READ_ONLY = new Set(['list', 'get', 'read']);
const LIST_CACHE_MS = 2000; // agent list：所有請求共用
const READ_CACHE_MS = 5000; // agent read：每位員工的結果至少快取這麼久，多個瀏覽器共用
const FOCUS_READ_MS = 2000; // 員工面板正打開的那一位可以讀快一點，其他人不跟著讀

function stripAnsi(text) {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

function tidyLines(text) {
  const lines = stripAnsi(text).split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

function herdrSource(config) {
  const { bin, args: baseArgs, readLines } = config.source.herdr;
  function herdr(args, timeout = 5000) {
    if (args[0] !== 'agent' || !READ_ONLY.has(args[1])) return Promise.reject(new Error('blocked non read-only herdr command'));
    return new Promise((resolve, reject) => {
      execFile(bin, [...baseArgs, ...args], { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
  }
  // agent list：同一時間只跑一次，結果在 LIST_CACHE_MS 內共用
  let list = { at: 0, data: null, pending: null };
  function listAgents() {
    if (list.data && Date.now() - list.at < LIST_CACHE_MS) return Promise.resolve(list.data);
    if (!list.pending) {
      list.pending = herdr(['agent', 'list']).then(
        (raw) => {
          const data = JSON.parse(raw)?.result?.agents ?? [];
          list = { at: Date.now(), data, pending: null };
          return data;
        },
        (e) => {
          list.pending = null;
          throw e;
        },
      );
    }
    return list.pending;
  }
  // 每位員工的 agent read 結果：{ at, status, lines, pending }。狀態一變就重讀（blocked 要馬上看到確認畫面）
  const reads = new Map();
  function readAgent(name, status, ttl) {
    const hit = reads.get(name);
    if (hit && hit.status === status) {
      if (hit.pending) return hit.pending;
      if (Date.now() - hit.at < ttl) return Promise.resolve(hit.lines);
    }
    // blocked 時預設來源可能讀不到確認畫面，改讀 visible
    const source = status === 'blocked' ? 'visible' : 'recent';
    const entry = { at: 0, status, lines: null, pending: null };
    entry.pending = herdr(['agent', 'read', name, '--source', source, '--lines', String(readLines)])
      .then(tidyLines, () => null)
      .then((lines) => {
        Object.assign(entry, { at: Date.now(), lines, pending: null });
        return lines;
      });
    reads.set(name, entry);
    return entry.pending;
  }
  return {
    type: 'herdr',
    async collect({ full = false, focus = null } = {}) {
      let agents;
      try {
        agents = await listAgents();
      } catch {
        // 讀不到就不要回空清單，前端會保留上一次的狀態
        return { agents: null, error: 'herdr agent list 讀取失敗', lite: !full };
      }
      for (const name of reads.keys()) if (!agents.some((a) => a.name === name)) reads.delete(name);
      const out = await Promise.all(
        agents.map(async (a) => {
          const status = a.agent_status || 'unknown';
          const row = { name: a.name, agent: a.agent, status, title: a.terminal_title_stripped || '', paneId: a.pane_id, focused: !!a.focused };
          if (full) row.lines = await readAgent(a.name, status, a.name === focus ? FOCUS_READ_MS : READ_CACHE_MS);
          return row;
        }),
      );
      return { agents: out, error: null, lite: !full };
    },
  };
}
