// 全螢幕專屬介面（疊在 3D 上方）：布告欄（首頁／KPI／待辦／歷史歸檔）與書架的專案資料庫。
// 除了勾選待辦，其他全部唯讀。所有資料文字都用 textContent，不拼 HTML。
import { renderMarkdown } from './markdown.js';

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('zh-TW'));
let CUR = '$'; // 貨幣符號（office.config.json 的 company.currency）
const money = (n) => (n == null ? '待補' : `${CUR} ${fmt(n)}`);
export const STATUS_CLASS = { 進行中: 'active', 暫停: 'paused', 已結案: 'closed' };
const statusOf = (s = '') => (s.includes('結案') ? '已結案' : s.includes('暫停') ? '暫停' : '進行中');

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null && kid !== false) e.append(kid);
  return e;
}

function bar(ratio, hit) {
  const b = el('div', { class: 'v-bar' });
  const f = el('i', { class: hit ? 'hit' : '' });
  f.style.width = `${Math.max(0, Math.min(1, ratio || 0)) * 100}%`;
  b.append(f);
  return b;
}

function pill(status) {
  const s = statusOf(status);
  return el('span', { class: `v-pill ${STATUS_CLASS[s]}`, text: status || s });
}

// 小趨勢線（SVG）
function sparkline(points) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 36');
  svg.setAttribute('class', 'v-spark');
  const vals = points.filter((v) => v != null);
  if (vals.length < 2) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', '0');
    t.setAttribute('y', '24');
    t.textContent = '歷史累積中';
    svg.append(t);
    return svg;
  }
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const d = points
    .map((v, i) => (v == null ? null : `${(i / (points.length - 1)) * 116 + 2},${34 - ((v - min) / span) * 30}`))
    .filter(Boolean)
    .map((p, i) => `${i ? 'L' : 'M'}${p}`)
    .join(' ');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function table(headers, rows, cls = 'v-table') {
  const t = el('table', { class: cls });
  t.append(el('tr', {}, ...headers.map((h) => el('th', { text: h }))));
  for (const r of rows) t.append(el('tr', {}, ...r.map((c) => (c instanceof Node ? el('td', {}, c) : el('td', { text: c ?? '' })))));
  return el('div', { class: 'v-table-wrap' }, t);
}

export function createViewer(root, { openTask, toggleTodo, onClose }) {
  const title = root.querySelector('.v-title h2');
  const sub = root.querySelector('.v-sub');
  const tabs = root.querySelector('.v-tabs');
  const body = root.querySelector('.v-body');
  root.querySelector('.v-back').addEventListener('click', () => close());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden && !document.querySelector('dialog[open]')) close();
  });

  let mode = null; // 'board' | 'project'
  let boardData = null;
  let tab = 'home';

  function close() {
    root.hidden = true;
    mode = null;
    onClose?.();
  }

  function setTabs(list) {
    tabs.replaceChildren(
      ...list.map(([id, label]) =>
        el('button', {
          type: 'button',
          class: id === tab ? 'on' : '',
          text: label,
          onclick: () => {
            tab = id;
            renderBoard();
          },
        }),
      ),
    );
  }

  // ---- 布告欄 ----

  function renderBoard() {
    const d = boardData;
    title.textContent = '布告欄';
    sub.textContent = `${d.month}${d.error ? `・${d.error}` : ''}・內容來自 data/board.json，只有待辦可以勾選`;
    setTabs([
      ['home', '首頁：現金流與年度目標'],
      ['kpi', 'KPI'],
      ['todos', `待辦（${d.todos.filter((t) => !t.done).length}）`],
      ['archive', '歷史歸檔'],
    ]);
    body.replaceChildren(({ home, kpi, todos: todoView, archive } [tab] || home)(d));
  }

  function home(d) {
    const cf = d.cashflow;
    const goal = el('section', { class: 'v-card v-goal' }, el('h3', { text: '年度目標' }), el('p', { class: 'v-goal-text', text: d.goal.text || '（年度目標待定）' }));
    if (cf.goal) {
      goal.append(
        el('p', { class: 'v-big' }, `${money(cf.received)} `, el('small', { text: `／ 年度營收目標 ${money(cf.goal)}（${Math.round(cf.progress * 100)}%）` })),
        bar(cf.progress, cf.progress >= 1),
      );
    } else {
      goal.append(el('p', { class: 'v-big' }, `${money(cf.received)} `, el('small', { text: '已收／年度營收目標待定' })));
    }
    const cards = el(
      'div',
      { class: 'v-cards' },
      el('section', { class: 'v-card' }, el('h3', { text: '已收總額' }), el('p', { class: 'v-big', text: money(cf.received) }), el('p', { class: 'v-note', text: '所有案子已收款合計' })),
      el(
        'section',
        { class: 'v-card' },
        el('h3', { text: '待收尾款' }),
        el('p', { class: 'v-big', text: money(cf.pending) }),
        el('p', { class: 'v-note', text: cf.contractMissing.length ? `另有 ${cf.contractMissing.length} 案合約待補：${cf.contractMissing.join('、')}` : '各案合約減已收' }),
      ),
      el('section', { class: 'v-card' }, el('h3', { text: '本月實收' }), el('p', { class: 'v-big', text: cf.month == null ? '未填' : money(cf.month) }), el('p', { class: 'v-note', text: 'board.json 裡 id 為 revenue 的 KPI' })),
    );
    const rows = d.archive.projects.map((p) => [p.name, money(p.contract), money(p.received), p.pending == null ? '待補' : money(p.pending), pill(p.status)]);
    const weekly = d.weekly.length ? el('ul', { class: 'v-chips' }, ...d.weekly.map((w) => el('li', { text: w.text }))) : el('p', { class: 'v-note', text: '（本週重點待定）' });
    return el(
      'div',
      { class: 'v-home' },
      goal,
      cards,
      el('section', { class: 'v-card' }, el('h3', { text: '各案收款' }), rows.length ? table(['案名', '合約金額', '已收', '待收', '狀態'], rows) : el('p', { class: 'v-note', text: '（還沒有案子資料）' })),
      el('section', { class: 'v-card' }, el('h3', { text: '本週重點' }), weekly),
    );
  }

  function kpi(d) {
    const trend = (k) => {
      const pts = d.history.map((h) => h.kpis.find((x) => x.id === k.id)?.value ?? null).slice(-5);
      pts.push(k.value);
      return pts;
    };
    const cards = d.kpis.map((k) => {
      const hit = k.target != null && k.target > 0 && k.value != null && k.value >= k.target;
      return el(
        'section',
        { class: `v-card v-kpi${hit ? ' hit' : ''}` },
        el('h3', {}, k.name, k.type === 'auto' ? el('span', { class: 'v-auto', text: '自動' }) : null),
        el('p', { class: 'v-big' }, fmt(k.value), el('small', { text: ` ${k.unit || ''}` })),
        el('p', { class: 'v-note', text: k.target != null ? `目標 ${fmt(k.target)}` : '目標待定' }),
        bar(k.target ? (k.value ?? 0) / k.target : 0, hit),
        sparkline(trend(k)),
        k.note ? el('p', { class: 'v-note', text: k.note }) : null,
      );
    });
    const months = [...d.history.map((h) => ({ label: h.month, kpis: h.kpis })), { label: `${d.month}（本月）`, kpis: d.kpis }].reverse();
    const rows = months.map((m) => [m.label, ...d.kpis.map((k) => {
      const x = m.kpis.find((y) => y.id === k.id);
      return x ? `${fmt(x.value)}${x.target != null ? ` / ${fmt(x.target)}` : ''}` : '';
    })]);
    return el(
      'div',
      {},
      el('div', { class: 'v-kpis' }, ...cards),
      el('section', { class: 'v-card' }, el('h3', { text: '每月歷史（目前值／目標）' }), table(['月份', ...d.kpis.map((k) => k.name)], rows)),
      d.tasksDoneFiles?.length ? el('p', { class: 'v-note', text: `本月算進「完成」的任務卡：${d.tasksDoneFiles.join('、')}` }) : null,
    );
  }

  function todoView(d) {
    if (!d.todos.length) return el('p', { class: 'v-note', text: '（目前沒有待辦）' });
    return el(
      'section',
      { class: 'v-card' },
      el('h3', { text: '待辦清單' }),
      el('p', { class: 'v-note', text: '勾掉已完成的事；已完成的變灰排在後面，只保留最近 5 筆。' }),
      el(
        'ul',
        { class: 'v-todos' },
        ...d.todos.map((t) => {
          const box = el('input', { type: 'checkbox', 'aria-label': t.text });
          box.checked = t.done;
          box.addEventListener('change', () => toggleTodo(t.id, box.checked));
          return el(
            'li',
            { class: t.done ? 'done' : '' },
            el('label', {}, box, el('span', { text: t.text })),
            t.file ? el('button', { type: 'button', class: 'v-file', text: `📄 ${t.file.replace(/\.md$/, '')}`, onclick: () => openTask(t.file) }) : null,
          );
        }),
      ),
    );
  }

  function archive(d) {
    const a = d.archive;
    const rows = a.projects.map((p) => [p.name, p.period, pill(p.status), money(p.contract), money(p.received), p.pending == null ? '待補' : money(p.pending), p.note]);
    return el(
      'section',
      { class: 'v-card' },
      el('h3', { text: '歷史歸檔' }),
      el('p', { class: 'v-big' }, money(a.closedRevenue), el('small', { text: `　已結案收入合計（${a.closedCount} 案）` })),
      rows.length ? table(['案名', '期間', '狀態', '合約', '已收', '待收', '說明'], rows) : el('p', { class: 'v-note', text: '（歷史專案待歸檔）' }),
    );
  }

  // ---- 專案資料庫 ----

  async function showProject(project) {
    mode = 'project';
    root.hidden = false;
    title.textContent = project.name;
    sub.textContent = '專案資料庫（唯讀）';
    tabs.replaceChildren(pill(project.status));
    body.replaceChildren(el('p', { class: 'v-note', text: '讀取中…' }));
    let list;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(project.id)}/files`, { cache: 'no-store' });
      list = await r.json();
      if (!r.ok) throw new Error(list.error);
    } catch {
      body.replaceChildren(el('p', { class: 'v-note', text: '讀取失敗' }));
      return;
    }
    sub.textContent = `專案資料庫（唯讀）・${list.files.length} 個檔案${list.hidden ? `・${list.hidden} 個疑似含密鑰或不在範圍內的檔案未列出` : ''}`;
    const side = el('nav', { class: 'v-files' });
    const view = el('article', { class: 'v-doc' }, el('p', { class: 'v-note', text: '點左側檔案查看內容。' }));
    const groups = new Map();
    for (const f of list.files) {
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(f);
    }
    let first = null;
    for (const [g, files] of groups) {
      side.append(el('h4', { text: g }));
      const ul = el('ul');
      for (const f of files) {
        const btn = el('button', { type: 'button', class: f.kind === 'name-only' ? 'name-only' : '', text: f.name.replace(/\.md$/, ''), title: f.name });
        btn.addEventListener('click', () => {
          side.querySelectorAll('button.on').forEach((b) => b.classList.remove('on'));
          btn.classList.add('on');
          openFile(project, f, view);
        });
        ul.append(el('li', {}, btn));
        if (!first && f.kind === 'md') first = btn;
      }
      side.append(ul);
    }
    body.replaceChildren(el('div', { class: 'v-project' }, side, view));
    first?.click();
  }

  async function openFile(project, f, view) {
    const url = `/api/projects/${encodeURIComponent(project.id)}/file?key=${f.key}`;
    if (f.kind === 'name-only') {
      view.replaceChildren(el('h3', { text: f.name }), el('p', { class: 'v-note', text: '這類檔案（程式碼、資料檔）只顯示檔名，不顯示內容。' }));
      return;
    }
    if (f.kind === 'image') {
      view.replaceChildren(el('h3', { text: f.name }), el('img', { class: 'v-img', src: url, alt: f.name }));
      return;
    }
    view.replaceChildren(el('p', { class: 'v-note', text: '讀取中…' }));
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      view.replaceChildren(el('p', { class: 'v-note', text: `${d.group}・最後修改 ${new Date(d.mtime).toLocaleString('zh-TW', { hour12: false })}` }), renderMarkdown(d.content));
      view.scrollTop = 0;
    } catch (e) {
      view.replaceChildren(el('p', { class: 'v-note', text: e.message || '讀取失敗' }));
    }
  }

  return {
    get open() {
      return !root.hidden;
    },
    showBoard(d, which = 'home') {
      boardData = d;
      CUR = d.currency || '$';
      tab = which;
      mode = 'board';
      root.hidden = false;
      renderBoard();
    },
    // board.json 被改了：介面開著也即時更新
    updateBoard(d) {
      boardData = d;
      CUR = d.currency || '$';
      if (mode === 'board' && !root.hidden) renderBoard();
    },
    showProject,
    close,
  };
}
