// 布告欄牆面：年度目標（含營收進度）、KPI、本週重點、現金流、待辦清單（Canvas 貼圖）。
// 內容來自 data/board.json（直接編輯檔案）；點布告欄會打開全螢幕專屬介面（viewer.js），勾選待辦在那裡做。
import { BRAND } from './scene.js';

const C = {
  board: '#fbfbfc',
  ink: '#1f2328',
  muted: '#6b7280',
  faint: '#a7adb6',
  line: '#e4e6ea',
  navy: BRAND.navy,
  gold: BRAND.gold,
  yellow: '#f8eaa6',
  blue: '#d6e8f7',
  pink: '#f7d6d6',
  green: '#d8ecd9',
  red: '#e5484d',
};
const FONT = '-apple-system, "PingFang TC", "Noto Sans TC", sans-serif';
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('zh-TW'));
let CUR = '$'; // 貨幣符號（office.config.json 的 company.currency）

function wrap(ctx, text, maxW, maxLines) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(cur);
      cur = '';
      continue;
    }
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.$/, '…');
  }
  return lines;
}

function note(ctx, x, y, w, h, color, tilt = 0) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(tilt);
  ctx.shadowColor = 'rgba(20,30,50,0.16)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

function heading(ctx, text, x, y, color = C.navy) {
  ctx.fillStyle = color;
  ctx.font = `700 32px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

// 近 6 個月趨勢（歷史快照＋本月）
function trend(data, kpi) {
  const pts = data.history.map((h) => h.kpis.find((k) => k.id === kpi.id)?.value ?? null).slice(-5);
  pts.push(kpi.value);
  return pts;
}

function spark(ctx, pts, x, y, w, h, color) {
  const vals = pts.filter((v) => v != null);
  if (vals.length < 2) {
    ctx.fillStyle = C.faint;
    ctx.font = `20px ${FONT}`;
    ctx.fillText('歷史累積中', x, y + h - 4);
    return;
  }
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const px = (i) => x + (i / (pts.length - 1)) * w;
  const py = (v) => y + h - ((v - min) / span) * h;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  let started = false;
  pts.forEach((v, i) => {
    if (v == null) return;
    if (started) ctx.lineTo(px(i), py(v));
    else ctx.moveTo(px(i), py(v));
    started = true;
  });
  ctx.stroke();
  const last = pts[pts.length - 1];
  if (last != null) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px(pts.length - 1), py(last), 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function kpiCard(ctx, data, k, x, y, w, h) {
  const hit = k.target != null && k.target > 0 && k.value != null && k.value >= k.target;
  ctx.save();
  ctx.shadowColor = 'rgba(20,30,50,0.12)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = hit ? C.gold : C.line;
  ctx.lineWidth = hit ? 5 : 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = hit ? C.gold : C.navy;
  ctx.fillRect(x, y, w, 8);

  ctx.fillStyle = C.ink;
  ctx.font = `600 23px ${FONT}`;
  // 自動 KPI 右上角有「自動」標籤，名稱要讓出位置
  wrap(ctx, k.name, w - (k.type === 'auto' ? 82 : 28), 2).forEach((l, i) => ctx.fillText(l, x + 14, y + 42 + i * 28));
  if (k.type === 'auto') {
    ctx.fillStyle = C.blue;
    ctx.fillRect(x + w - 58, y + 16, 48, 26);
    ctx.fillStyle = C.navy;
    ctx.font = `600 17px ${FONT}`;
    ctx.fillText('自動', x + w - 51, y + 35);
  }
  // 大數字：預設視角也看得出來
  const val = fmt(k.value);
  let size = 64;
  ctx.font = `800 ${size}px ${FONT}`;
  while (ctx.measureText(val).width > w - 30 && size > 36) {
    size -= 4;
    ctx.font = `800 ${size}px ${FONT}`;
  }
  ctx.fillStyle = k.value == null ? C.faint : C.ink;
  ctx.fillText(val, x + 14, y + 152);
  ctx.font = `22px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(`${k.unit || ''}　${k.target != null ? `目標 ${fmt(k.target)}` : '目標待定'}`, x + 14, y + 186);
  // 進度條：達標轉金色
  ctx.fillStyle = '#eef0f3';
  ctx.fillRect(x + 14, y + 200, w - 28, 14);
  if (k.target != null && k.target > 0 && k.value != null) {
    ctx.fillStyle = hit ? C.gold : C.navy;
    ctx.fillRect(x + 14, y + 200, (w - 28) * Math.max(0, Math.min(1, k.value / k.target)), 14);
  }
  spark(ctx, trend(data, k), x + 16, y + 226, w - 38, h - 240, hit ? C.gold : C.navy);
}

// 畫整面布告欄
export function drawBoard(canvas, data) {
  CUR = data?.currency || '$';
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = C.board;
  ctx.fillRect(0, 0, W, H);
  if (!data) {
    ctx.fillStyle = C.muted;
    ctx.font = `40px ${FONT}`;
    ctx.fillText('布告欄載入中…', 40, 90);
    return;
  }
  const L = 1436; // 左側區塊寬度（右側是待辦清單）

  // 年度目標＋營收進度（已收總額／年度營收目標）
  const cf = data.cashflow || { received: 0, pending: 0, contractMissing: [], month: null, goal: null, progress: null };
  note(ctx, 24, 18, L - 24, 128, C.yellow, -0.003);
  heading(ctx, '年度目標', 48, 62);
  ctx.fillStyle = C.ink;
  ctx.font = `700 34px ${FONT}`;
  wrap(ctx, data.goal?.text || '（年度目標待定）', 860, 2).forEach((l, i) => ctx.fillText(l, 48, 106 + i * 34));
  const gx = 940;
  ctx.font = `600 24px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(cf.goal ? `已收 ${fmt(cf.received)} ／ 目標 ${fmt(cf.goal)}` : `已收 ${CUR} ${fmt(cf.received)}（年度營收目標待定）`, gx, 64);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(gx, 82, L - gx - 30, 22);
  if (cf.goal) {
    ctx.fillStyle = cf.progress >= 1 ? C.gold : C.navy;
    ctx.fillRect(gx, 82, (L - gx - 30) * Math.min(1, cf.progress), 22);
    ctx.fillStyle = C.ink;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(`${Math.round(cf.progress * 100)}%`, gx, 134);
  }

  // KPI：一排 7 張
  const kpis = data.kpis.slice(0, 7);
  const gap = 12;
  const cw = Math.floor((L - 24 - gap * (kpis.length - 1)) / Math.max(1, kpis.length));
  kpis.forEach((k, i) => kpiCard(ctx, data, k, 24 + i * (cw + gap), 166, cw, 296));

  // 本週重點
  heading(ctx, '本週重點', 24, 510);
  const colors = [C.blue, C.green, C.yellow, C.pink];
  const weekly = data.weekly.slice(0, 6);
  if (!weekly.length) {
    ctx.fillStyle = C.faint;
    ctx.font = `24px ${FONT}`;
    ctx.fillText('（本週重點待定）', 180, 508);
  }
  weekly.forEach((w, i) => {
    const x = 24 + i * 236;
    note(ctx, x, 524, 224, 118, colors[i % colors.length], (i % 2 ? 1 : -1) * 0.015);
    ctx.fillStyle = C.ink;
    ctx.font = `600 25px ${FONT}`;
    wrap(ctx, w.text, 200, 3).forEach((l, j) => ctx.fillText(l, x + 12, 562 + j * 31));
  });

  // 現金流：已收、待收、本月實收，以及各案收款
  const ay = 670;
  heading(ctx, '現金流', 24, ay + 26);
  ctx.fillStyle = C.ink;
  ctx.font = `600 26px ${FONT}`;
  const missing = cf.contractMissing?.length ? `（${cf.contractMissing.length} 案合約待補）` : '';
  ctx.fillText(`已收 ${CUR} ${fmt(cf.received)}　待收 ${CUR} ${fmt(cf.pending)}${missing}　本月實收 ${cf.month == null ? '未填' : `${CUR} ${fmt(cf.month)}`}`, 150, ay + 26);
  const cols = [
    ['案名', 24, 470],
    ['狀態', 500, 130],
    ['合約', 640, 240],
    ['已收', 890, 240],
    ['待收', 1140, 290],
  ];
  ctx.fillStyle = '#eef0f3';
  ctx.fillRect(24, ay + 40, L - 24, 34);
  ctx.font = `600 21px ${FONT}`;
  ctx.fillStyle = C.muted;
  for (const [t, x] of cols) ctx.fillText(t, x + 8, ay + 64);
  // 進行中、暫停的案子（有待收）排前面
  const projects = [...(data.archive?.projects || [])].sort((a, b) => (a.status.includes('結案') ? 1 : 0) - (b.status.includes('結案') ? 1 : 0));
  const rows = projects.slice(0, 4);
  if (!rows.length) {
    ctx.fillStyle = C.faint;
    ctx.font = `22px ${FONT}`;
    ctx.fillText('（還沒有案子資料）', 32, ay + 108);
  }
  const money = (n) => (n == null ? '待補' : `${CUR} ${fmt(n)}`);
  rows.forEach((p, i) => {
    const y = ay + 104 + i * 34;
    ctx.font = `22px ${FONT}`;
    ctx.fillStyle = C.ink;
    const cells = [p.name, p.status, money(p.contract), money(p.received), p.pending == null ? '待補' : money(p.pending)];
    cols.forEach(([, x, w], k) => ctx.fillText(wrap(ctx, cells[k] || '', w - 16, 1)[0] || '', x + 8, y));
  });
  if (projects.length > 4) {
    ctx.fillStyle = C.muted;
    ctx.font = `20px ${FONT}`;
    ctx.fillText(`…另有 ${projects.length - 4} 案，點布告欄看全部`, 32, ay + 104 + 4 * 34);
  }

  // 待辦清單（右側，只顯示；勾選在專屬介面做）：已完成變灰排在後面
  const tx = L + 24;
  const tw = W - tx - 24;
  note(ctx, tx, 18, tw, H - 40, '#ffffff');
  ctx.fillStyle = C.navy;
  ctx.fillRect(tx, 18, tw, 64);
  const open = data.todos.filter((t) => !t.done).length;
  heading(ctx, `待辦清單（${open} 項未完成）`, tx + 22, 62, '#ffffff');
  let y = 112;
  if (!data.todos.length) {
    ctx.fillStyle = C.faint;
    ctx.font = `24px ${FONT}`;
    ctx.fillText('（目前沒有待辦）', tx + 22, y + 10);
  }
  for (const t of data.todos) {
    if (y > H - 60) break;
    const box = 34;
    ctx.lineWidth = 3;
    ctx.strokeStyle = t.done ? C.faint : C.navy;
    ctx.fillStyle = t.done ? '#eef0f3' : '#ffffff';
    ctx.fillRect(tx + 22, y - 4, box, box);
    ctx.strokeRect(tx + 22, y - 4, box, box);
    if (t.done) {
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(tx + 29, y + 13);
      ctx.lineTo(tx + 37, y + 22);
      ctx.lineTo(tx + 51, y + 3);
      ctx.stroke();
    }
    ctx.fillStyle = t.done ? C.faint : C.ink;
    ctx.font = `${t.done ? 400 : 600} 25px ${FONT}`;
    const lines = wrap(ctx, t.text, tw - 100, 2);
    lines.forEach((l, i) => {
      ctx.fillText(l, tx + 72, y + 22 + i * 30);
      if (t.done) {
        ctx.fillRect(tx + 72, y + 13 + i * 30, ctx.measureText(l).width, 2);
      }
    });
    y += 22 + lines.length * 30;
    if (t.file) {
      ctx.font = `19px ${FONT}`;
      ctx.fillStyle = t.done ? C.faint : C.navy;
      const label = `📄 ${wrap(ctx, t.file.replace(/\.md$/, ''), tw - 130, 1)[0]}`;
      ctx.fillText(label, tx + 72, y + 4);
      y += 30;
    }
    y += 22;
  }

  // board.json 改壞時：顯示上一版並提示
  if (data.error) {
    ctx.fillStyle = C.red;
    ctx.fillRect(24, H - 50, L - 24, 36);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(`${data.error}（顯示上一版內容）`, 36, H - 25);
  }
}
