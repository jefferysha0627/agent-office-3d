// Minecraft 遊戲介面（HUD）：疊在員工螢幕的第一人稱畫面上。
// 素材用 prismarine-viewer 自帶的 1.21.4 材質（/mc-assets/），數值來自機器人的真實狀態。
const BASE = '/mc-assets/';
const S = 2; // 介面放大倍數（像 Minecraft 的 GUI scale）

const cache = new Map();
function img(path) {
  if (!cache.has(path)) {
    const im = new Image();
    im.src = path.startsWith('/') ? path : BASE + path;
    cache.set(path, im);
  }
  const im = cache.get(path);
  return im.complete && im.naturalWidth ? im : null;
}

// 物品圖示：伺服器依序找 items/、blocks/（方塊類物品），找不到回透明圖
const icon = (name) => img(`/mc-icon/${name}.png`);

function sprite(ctx, path, x, y, w, h) {
  const im = img(path);
  if (im) ctx.drawImage(im, x, y, w ?? im.naturalWidth * S, h ?? im.naturalHeight * S);
}

function text(ctx, str, x, y, color = '#ffffff', align = 'right') {
  ctx.font = 'bold 15px Menlo, monospace';
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#3f3f3f';
  ctx.fillText(str, x + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.textAlign = 'left';
}

// 第一人稱右手＋手持物品：揮手（挖掘、放方塊）時往前揮
function drawHand(ctx, W, H, hud, t) {
  const swing = hud.swingAgo < 320 ? Math.sin((hud.swingAgo / 320) * Math.PI) : 0;
  const bob = Math.sin(t * 2.2) * 3;
  const skin = img('entity/player/wide/steve.png');
  ctx.save();
  ctx.translate(W - 70 - swing * 40, H + 18 + bob - swing * 26);
  ctx.rotate(-0.42 - swing * 0.55);
  if (skin) ctx.drawImage(skin, 44, 20, 4, 12, -24, -150, 48, 150); // 右手臂正面
  const held = hud.slots[hud.selected];
  const ic = held && icon(held.name);
  if (ic) {
    ctx.translate(-6, -150);
    ctx.rotate(-0.35);
    ctx.drawImage(ic, -50, -78, 92, 92);
  }
  ctx.restore();
}

export function drawHud(ctx, hud, t) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // 正在破壞的方塊：準星位置疊上裂痕（destroy_stage_0～9）
  if (hud.dig != null) {
    const stage = Math.min(9, Math.floor(hud.dig * 10));
    ctx.globalAlpha = 0.85;
    sprite(ctx, `blocks/destroy_stage_${stage}.png`, W / 2 - 56, H / 2 - 56, 112, 112);
    ctx.globalAlpha = 1;
  }

  drawHand(ctx, W, H, hud, t);

  // 十字準星（反色，跟遊戲一樣在任何背景都看得到）
  ctx.globalCompositeOperation = 'difference';
  sprite(ctx, 'gui/sprites/hud/crosshair.png', W / 2 - 15, H / 2 - 15, 30, 30);
  ctx.globalCompositeOperation = 'source-over';

  // 快捷欄 9 格＋目前手持那一格
  const hbW = 182 * S;
  const hbX = Math.round((W - hbW) / 2);
  const hbY = H - 22 * S - 2;
  sprite(ctx, 'gui/sprites/hud/hotbar.png', hbX, hbY, hbW, 22 * S);
  sprite(ctx, 'gui/sprites/hud/hotbar_selection.png', hbX - S + hud.selected * 20 * S, hbY - S, 24 * S, 23 * S);
  hud.slots.forEach((it, i) => {
    if (!it) return;
    const x = hbX + 3 * S + i * 20 * S;
    const y = hbY + 3 * S;
    const ic = icon(it.name);
    if (ic) ctx.drawImage(ic, x, y, 16 * S, 16 * S);
    if (it.count > 1) text(ctx, String(it.count), x + 16 * S + 1, y + 16 * S + 1);
  });

  // 經驗條與等級
  const xpY = hbY - 5 * S - 3;
  sprite(ctx, 'gui/sprites/hud/experience_bar_background.png', hbX, xpY, hbW, 5 * S);
  const prog = img('gui/sprites/hud/experience_bar_progress.png');
  if (prog && hud.progress > 0) {
    const w = Math.round(182 * hud.progress);
    ctx.drawImage(prog, 0, 0, w, 5, hbX, xpY, w * S, 5 * S);
  }
  if (hud.level > 0) text(ctx, String(hud.level), W / 2, xpY + 2, '#80ff20', 'center');

  // 生命（左）與飢餓（右）：各 10 個圖示
  const rowY = xpY - 9 * S - 2;
  for (let i = 0; i < 10; i++) {
    const hx = hbX + i * 8 * S;
    sprite(ctx, 'gui/sprites/hud/heart/container.png', hx, rowY, 9 * S, 9 * S);
    const hp = hud.health - i * 2;
    if (hp >= 2) sprite(ctx, 'gui/sprites/hud/heart/full.png', hx, rowY, 9 * S, 9 * S);
    else if (hp >= 1) sprite(ctx, 'gui/sprites/hud/heart/half.png', hx, rowY, 9 * S, 9 * S);

    const fx = hbX + hbW - 9 * S - i * 8 * S;
    sprite(ctx, 'gui/sprites/hud/food_empty.png', fx, rowY, 9 * S, 9 * S);
    const fd = hud.food - i * 2;
    if (fd >= 2) sprite(ctx, 'gui/sprites/hud/food_full.png', fx, rowY, 9 * S, 9 * S);
    else if (fd >= 1) sprite(ctx, 'gui/sprites/hud/food_half.png', fx, rowY, 9 * S, 9 * S);
  }
  ctx.restore();
}
