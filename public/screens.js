// 電腦螢幕：用 Canvas 畫終端輸出、小遊戲、螢幕保護與 blocked 提示，再當成 3D 貼圖。
import * as THREE from '/vendor/three/three.module.js';

const W = 512;
const H = 310;
// 字放大：正後方視角下預設縮放也能讀出幾行
const BAR = 32;
const PAD = 16;
const LINE_H = 38;
const FONT = '30px "SF Mono", Menlo, "PingFang TC", "Heiti TC", monospace';
const FPS = 12;

const RULE_ONLY = /^[\s─━│┃┌┐└┘├┤┬┴┼╭╮╯╰═·•]+$/;

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function tri(x) {
  // 0..1..0 三角波
  const f = x - Math.floor(x);
  return f < 0.5 ? f * 2 : 2 - f * 2;
}

export class Screen {
  constructor(title) {
    this.title = title;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.key = null;
    this.fitted = [];
    this.scroll = 0;
    this.nextDraw = 0;
    this.game = 'runner';
    this.lastMode = '';
  }

  setLines(lines) {
    const src = (lines || []).filter((l) => l.trim() && !RULE_ONLY.test(l));
    const key = src.join('\n');
    if (key === this.key) return;
    const hadContent = this.key !== null && this.key !== '';
    this.key = key;
    this.ctx.font = FONT;
    this.fitted = src.slice(-30).map((l) => fit(this.ctx, l, W - PAD * 2));
    if (hadContent) this.scroll = 1;
  }

  pickGame() {
    const games = ['runner', 'snake', 'pong'];
    this.game = games[Math.floor(Math.random() * games.length)];
  }

  draw(mode, t, dt) {
    this.scroll = Math.max(0, this.scroll - dt * 2.5);
    if (t < this.nextDraw && mode === this.lastMode) return;
    this.nextDraw = t + 1 / FPS;
    this.lastMode = mode;
    const c = this.ctx;
    c.save();
    switch (mode) {
      case 'terminal':
        this.drawTerminal(t, 1);
        break;
      case 'dim':
        this.drawTerminal(t, 0.6, '待命中');
        break;
      case 'away':
        this.drawTerminal(t, 0.45, '離座中');
        break;
      case 'game':
        this.drawGame(t);
        break;
      case 'sleep':
        this.drawSaver(t);
        break;
      case 'blocked':
        this.drawBlocked(t);
        break;
      case 'mcloading':
        this.drawPlain('#7fb2e5', '進入 Minecraft…', '#ffffff');
        break;
      case 'unknown':
        this.drawPlain('#3a3f47', '狀態不明', '#c4c9d1');
        break;
      default:
        this.drawOff();
    }
    c.restore();
    this.texture.needsUpdate = true;
  }

  bar(bg, fg, label, dots = true) {
    const c = this.ctx;
    c.fillStyle = bg;
    c.fillRect(0, 0, W, BAR);
    if (dots) {
      ['#ff6b5f', '#ffc24a', '#33c75a'].forEach((col, i) => {
        c.fillStyle = col;
        c.beginPath();
        c.arc(16 + i * 16, BAR / 2, 5, 0, Math.PI * 2);
        c.fill();
      });
    }
    c.fillStyle = fg;
    c.font = '600 19px -apple-system, "PingFang TC", sans-serif';
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    c.fillText(label, W / 2, BAR / 2 + 1);
    c.textAlign = 'left';
  }

  drawTerminal(t, alpha, tag) {
    const c = this.ctx;
    c.fillStyle = '#17202b';
    c.fillRect(0, 0, W, H);
    this.bar('#e9ecf0', '#4a5260', this.title);
    c.font = FONT;
    c.textBaseline = 'alphabetic';
    const rows = Math.floor((H - BAR - PAD) / LINE_H);
    const lines = this.fitted.slice(-rows);
    const offset = this.scroll * LINE_H;
    c.globalAlpha = alpha;
    lines.forEach((line, i) => {
      const y = H - PAD - (lines.length - 1 - i) * LINE_H + offset;
      if (y < BAR + LINE_H - 4) return;
      c.fillStyle = /^[❯›>$]/.test(line.trim()) ? '#8fd3ff' : /error|錯誤|失敗/i.test(line) ? '#ff9b9b' : '#d6e2ef';
      c.fillText(line, PAD, y);
    });
    if (!lines.length) {
      c.fillStyle = '#7d8a99';
      c.fillText('（尚無輸出）', PAD, BAR + 30);
    }
    c.globalAlpha = 1;
    if (alpha === 1 && Math.floor(t * 2) % 2 === 0) {
      c.fillStyle = '#d6e2ef';
      c.fillRect(PAD, H - PAD + 2, 14, 4);
    }
    if (tag) {
      c.font = '600 22px -apple-system, "PingFang TC", sans-serif';
      const w = c.measureText(tag).width + 20;
      c.fillStyle = 'rgba(255,255,255,0.88)';
      c.fillRect(W - w - 10, BAR + 10, w, 32);
      c.fillStyle = '#2b2f36';
      c.textBaseline = 'middle';
      c.fillText(tag, W - w, BAR + 27);
    }
  }

  drawGame(t) {
    const c = this.ctx;
    c.fillStyle = '#121a26';
    c.fillRect(0, 0, W, H);
    this.bar('#f2d35b', '#3b3220', '小遊戲（偷玩中）');
    if (this.game === 'snake') this.gameSnake(t);
    else if (this.game === 'pong') this.gamePong(t);
    else this.gameRunner(t);
  }

  gameRunner(t) {
    const c = this.ctx;
    const ground = H - 58;
    const speed = 150;
    const gap = 190;
    c.strokeStyle = '#5c6b80';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, ground);
    c.lineTo(W, ground);
    c.stroke();
    // 地面小點往後跑
    c.fillStyle = '#3c4859';
    for (let i = 0; i < 14; i++) {
      const x = (((i * 47 - t * speed) % W) + W) % W;
      c.fillRect(x, ground + 10 + (i % 3) * 8, 6, 2);
    }
    const playerX = 92;
    let nearest = Infinity;
    c.fillStyle = '#7fe0a8';
    for (let i = 0; i < 4; i++) {
      const x = ((((i * gap - t * speed) % (gap * 4)) + gap * 4) % (gap * 4)) + 40;
      const h = 22 + ((i * 13) % 18);
      c.fillRect(x, ground - h, 16, h);
      const d = x - playerX;
      if (d > -24 && d < nearest) nearest = d;
    }
    let jump = 0;
    if (nearest < 80) jump = Math.sin((Math.PI * (80 - nearest)) / 104) * 70;
    c.fillStyle = '#ffffff';
    c.fillRect(playerX - 13, ground - 26 - Math.max(0, jump), 26, 26);
    c.fillStyle = '#121a26';
    c.fillRect(playerX + 3, ground - 20 - Math.max(0, jump), 5, 5);
    c.fillStyle = '#f2d35b';
    c.font = 'bold 16px Menlo, monospace';
    c.textBaseline = 'top';
    c.fillText(`SCORE ${String(Math.floor(t * 12) % 100000).padStart(5, '0')}`, W - 150, BAR + 12);
  }

  gameSnake(t) {
    const c = this.ctx;
    const cell = 20;
    const cols = Math.floor((W - 20) / cell);
    const rows = Math.floor((H - BAR - 20) / cell);
    const ox = (W - cols * cell) / 2;
    const oy = BAR + 10;
    c.strokeStyle = '#1f2a3a';
    c.strokeRect(ox, oy, cols * cell, rows * cell);
    const step = Math.floor(t * 8);
    const at = (k) => [
      Math.round(tri(k / 46) * (cols - 1)),
      Math.round(tri(k / 30 + 0.25) * (rows - 1)),
    ];
    const food = at(step + 9);
    c.fillStyle = '#ff7a7a';
    c.fillRect(ox + food[0] * cell + 4, oy + food[1] * cell + 4, cell - 8, cell - 8);
    for (let i = 9; i >= 0; i--) {
      const [x, y] = at(step - i);
      c.fillStyle = i === 0 ? '#ffffff' : `rgba(127,224,168,${1 - i * 0.07})`;
      c.fillRect(ox + x * cell + 2, oy + y * cell + 2, cell - 4, cell - 4);
    }
  }

  gamePong(t) {
    const c = this.ctx;
    const top = BAR + 10;
    const bottom = H - 12;
    const bx = 30 + tri(t / 2.6) * (W - 60);
    const by = top + 8 + tri(t / 1.7) * (bottom - top - 16);
    c.setLineDash([6, 8]);
    c.strokeStyle = '#2f3b4d';
    c.beginPath();
    c.moveTo(W / 2, top);
    c.lineTo(W / 2, bottom);
    c.stroke();
    c.setLineDash([]);
    const lag = (k) => top + 8 + tri((t - k) / 1.7) * (bottom - top - 16);
    c.fillStyle = '#ffffff';
    c.fillRect(14, lag(0.18) - 26, 8, 52);
    c.fillRect(W - 22, lag(0.12) - 26, 8, 52);
    c.fillStyle = '#7fe0a8';
    c.fillRect(bx - 6, by - 6, 12, 12);
    c.fillStyle = '#8899b0';
    c.font = 'bold 26px Menlo, monospace';
    c.textBaseline = 'top';
    c.fillText(String(Math.floor(t / 5.2) % 10), W / 2 - 40, top + 6);
    c.fillText(String(Math.floor(t / 7.3) % 10), W / 2 + 24, top + 6);
  }

  drawSaver(t) {
    const c = this.ctx;
    c.fillStyle = '#0d1219';
    c.fillRect(0, 0, W, H);
    const text = 'z Z z';
    c.font = 'bold 34px -apple-system, sans-serif';
    const w = c.measureText(text).width;
    const x = tri(t / 9) * (W - w - 20) + 10;
    const y = tri(t / 6.5) * (H - 60) + 44;
    c.fillStyle = `hsl(${(t * 20) % 360}, 45%, 72%)`;
    c.textBaseline = 'alphabetic';
    c.fillText(text, x, y);
  }

  drawBlocked(t) {
    const c = this.ctx;
    const on = Math.floor(t * 2.5) % 2 === 0;
    c.fillStyle = '#2a1114';
    c.fillRect(0, 0, W, H);
    c.fillStyle = on ? '#e5484d' : '#b8363a';
    c.fillRect(0, 0, W, 54);
    c.fillStyle = '#ffffff';
    c.font = 'bold 28px -apple-system, "PingFang TC", sans-serif';
    c.textBaseline = 'middle';
    c.fillText('⚠ 需要確認', PAD, 28);
    c.font = FONT;
    c.textBaseline = 'alphabetic';
    const rows = Math.floor((H - 70) / LINE_H);
    const lines = this.fitted.slice(-rows);
    lines.forEach((line, i) => {
      c.fillStyle = '#ffd6d6';
      c.fillText(line, PAD, 54 + 34 + i * LINE_H);
    });
    c.strokeStyle = on ? '#ff6369' : '#7a2a2e';
    c.lineWidth = 8;
    c.strokeRect(4, 4, W - 8, H - 8);
  }

  drawPlain(bg, label, fg) {
    const c = this.ctx;
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    c.fillStyle = fg;
    c.font = '20px -apple-system, "PingFang TC", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, W / 2, H / 2);
    c.textAlign = 'left';
  }

  drawOff() {
    const c = this.ctx;
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#2b3038');
    g.addColorStop(0.55, '#20242b');
    g.addColorStop(1, '#2a2e35');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.beginPath();
    c.moveTo(W * 0.15, 0);
    c.lineTo(W * 0.35, 0);
    c.lineTo(W * 0.15, H);
    c.lineTo(0, H);
    c.closePath();
    c.fill();
  }
}

export const SCREEN_ASPECT = W / H;
