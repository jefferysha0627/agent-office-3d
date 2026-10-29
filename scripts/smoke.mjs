// npm run smoke：demo 模式冒煙測試。用暫存資料夾當布告欄資料，啟動伺服器、打幾個 API，再關掉。
// CI（ubuntu／macos／windows）都跑這支；不需要 Minecraft、不需要任何 Agent。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 4899);
const tmp = mkdtempSync(path.join(os.tmpdir(), 'agent-office-smoke-'));

const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), OFFICE_SOURCE: 'demo', OFFICE_MC: '0', OFFICE_NO_BROWSER: '1', OFFICE_BOARD: path.join(tmp, 'board.json') },
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

function request(p, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { Host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `（${detail}）` : ''}`);
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await request('/')).status === 200) return true;
    } catch {
      // 還沒起來
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

try {
  check('伺服器啟動、首頁 200', await waitUp());
  const cfg = JSON.parse((await request('/api/config')).body);
  check('/api/config', cfg.source === 'demo' && cfg.staff.length > 0, `${cfg.staff.length} 位員工`);
  const st = JSON.parse((await request('/api/state')).body);
  check('/api/state（demo 狀態）', Array.isArray(st.agents) && st.agents.length > 0 && st.agents.every((a) => a.status && Array.isArray(a.lines)), `${st.agents?.length} 位`);
  check('任務清單', st.tasks.length > 0, `${st.tasks.length} 個`);
  const task = await request(`/api/task?name=${encodeURIComponent(st.tasks[0].name)}`);
  check('/api/task', task.status === 200 && JSON.parse(task.body).content.length > 0);
  check('/api/task 擋路徑穿越', (await request('/api/task?name=..%2Fpackage.json')).status === 404);
  const board = JSON.parse((await request('/api/board')).body);
  check('/api/board（從範例建立）', !board.error && board.kpis.length > 0 && board.todos.length > 0, `${board.todos.length} 筆待辦`);
  const proj = JSON.parse((await request('/api/projects')).body).projects;
  check('/api/projects（書架）', proj.length > 0, `${proj.length} 本書`);
  const files = JSON.parse((await request(`/api/projects/${proj[0].id}/files`)).body);
  check('/api/projects/<id>/files', files.files.length > 0, `${files.files.length} 個檔案`);
  const md = files.files.find((f) => f.kind === 'md');
  const doc = await request(`/api/projects/${proj[0].id}/file?key=${md.key}`);
  check('專案 Markdown 內容', doc.status === 200 && JSON.parse(doc.body).content.length > 0);
  check('Logo', (await request('/api/brand/logo')).type.startsWith('image/'));
  check('three.js', (await request('/vendor/three/three.module.js')).status === 200);
  check('錯誤的 Host 被拒絕', (await request('/api/state', { headers: { Host: 'evil.example:80' } })).status === 403);
  const todo = board.todos.find((t) => !t.done);
  const noHeader = await request('/api/board/todo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: todo.id, done: true }) });
  check('沒有自訂標頭的寫入被拒絕', noHeader.status === 403);
  const ok = await request('/api/board/todo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Office': 'board', Origin: `http://127.0.0.1:${PORT}` },
    body: JSON.stringify({ id: todo.id, done: true }),
  });
  check('勾選待辦（寫入暫存資料夾）', ok.status === 200 && JSON.parse(ok.body).todos.find((t) => t.id === todo.id)?.done === true);
  check('其他寫入方法被拒絕', (await request('/api/board', { method: 'PUT' })).status === 405);
} catch (e) {
  check('執行測試', false, e.message);
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(tmp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r).length;
if (failed) console.log(`\n伺服器輸出：\n${log}`);
console.log(failed ? `\n冒煙測試失敗：${failed} 項` : `\n冒煙測試通過：${results.length} 項`);
process.exit(failed ? 1 : 0);
