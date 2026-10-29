// 員工狀態來源（adapter）：每種來源都提供 collect() → { agents: [...] | null, error }
// - demo：假狀態輪播，不需要任何 Agent，剛下載就看得到效果。
// - herdr：呼叫 Herdr 的唯讀指令（agent list／agent read），不送鍵、不下指令。
import { execFile } from 'node:child_process';

export function createSource(config) {
  return config.source.type === 'herdr' ? herdrSource(config) : demoSource(config);
}

// ---- demo ----

const DEMO_CYCLE = ['working', 'working', 'idle', 'working', 'done', 'idle', 'working', 'idle', 'working', 'blocked'];
const DEMO_SLOT_MS = 25000;
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
      const agents = names.map((name, i) => {
        // 每位員工錯開輪播；只有一位會輪到「需要確認」，避免畫面一直亮紅燈
        let status = DEMO_CYCLE[(slot + i * 3) % DEMO_CYCLE.length];
        if (status === 'blocked' && i !== slot % names.length) status = 'working';
        return { name, agent: i % 2 ? 'codex' : 'claude', status, title: name, paneId: `demo-${i + 1}`, focused: false, lines: demoLines(name, status, t) };
      });
      return { agents, error: null };
    },
  };
}

// ---- herdr（唯讀白名單） ----

const READ_ONLY = new Set(['list', 'get', 'read']);

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
  async function readAgent(name, status) {
    // blocked 時預設來源可能讀不到確認畫面，改讀 visible
    const source = status === 'blocked' ? 'visible' : 'recent';
    try {
      return tidyLines(await herdr(['agent', 'read', name, '--source', source, '--lines', String(readLines)]));
    } catch {
      return null;
    }
  }
  return {
    type: 'herdr',
    async collect() {
      let agents;
      try {
        agents = JSON.parse(await herdr(['agent', 'list']))?.result?.agents ?? [];
      } catch {
        // 讀不到就不要回空清單，前端會保留上一次的狀態
        return { agents: null, error: 'herdr agent list 讀取失敗' };
      }
      const withOutput = await Promise.all(
        agents.map(async (a) => ({
          name: a.name,
          agent: a.agent,
          status: a.agent_status || 'unknown',
          title: a.terminal_title_stripped || '',
          paneId: a.pane_id,
          focused: !!a.focused,
          lines: await readAgent(a.name, a.agent_status),
        })),
      );
      return { agents: withOutput, error: null };
    },
  };
}
