// 讀設定檔：office.config.json（沒有就用 office.config.example.json），補預設值並檢查格式。
// 路徑一律相對於專案根目錄解析，Windows／macOS／Linux 都用 path 組合。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ID = /^[A-Za-z0-9_-]{1,32}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_SEATS = 8; // 前排 4 個＋後排 4 個
const DEFAULT_COLORS = ['#c8aa62', '#3fa66b', '#e8833a', '#8a5cc2', '#3b82c4', '#d0556a', '#2aa198', '#9a7b4f'];

const str = (v, fallback, max = 60) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);

export function configFile(root) {
  const candidates = [process.env.OFFICE_CONFIG, path.join(root, 'office.config.json'), path.join(root, 'office.config.example.json')];
  return candidates.find((f) => f && existsSync(f)) || null;
}

// Minecraft 玩家名稱：3～16 個英數或底線，重複的只留一個
function guestList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((n) => String(n).trim()).filter((n) => /^[A-Za-z0-9_]{3,16}$/.test(n)))].slice(0, 8);
}

export function loadConfig(root) {
  const file = configFile(root);
  let raw = {};
  if (file) {
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`設定檔格式錯誤（${file}）：${e.message}`);
    }
  }
  const resolve = (p, fallback) => path.resolve(root, typeof p === 'string' && p ? p : fallback);

  const seen = new Set();
  const staff = (Array.isArray(raw.staff) ? raw.staff : [])
    .filter((s) => s && ID.test(s.id) && !seen.has(s.id) && seen.add(s.id))
    .slice(0, MAX_SEATS)
    .map((s, i) => ({ id: s.id, title: str(s.title, s.id, 20), color: COLOR.test(s.color || '') ? s.color : DEFAULT_COLORS[i % DEFAULT_COLORS.length] }));

  const sourceType = process.env.OFFICE_SOURCE || raw.source?.type;
  const port = Number(process.env.PORT || raw.port || 4870);

  return {
    file,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 4870,
    openBrowser: raw.openBrowser !== false && !process.env.CI && process.env.OFFICE_NO_BROWSER !== '1',
    company: {
      name: str(raw.company?.name, 'Agent Office', 40),
      currency: str(raw.company?.currency, '$', 8),
      logo: resolve(raw.company?.logo, 'public/brand/logo.svg'),
      mark: resolve(raw.company?.mark, 'public/brand/mark.svg'),
    },
    owner: { name: str(raw.owner?.name, 'Owner', 20), title: str(raw.owner?.title, '負責人', 20) },
    cat: { name: str(raw.cat?.name, '麻糬', 20) },
    staff,
    source: {
      type: sourceType === 'herdr' ? 'herdr' : 'demo',
      herdr: {
        bin: str(raw.source?.herdr?.bin, 'herdr', 400),
        args: Array.isArray(raw.source?.herdr?.args) ? raw.source.herdr.args.filter((a) => typeof a === 'string').slice(0, 10) : [],
        readLines: Math.min(200, Math.max(5, Number(raw.source?.herdr?.readLines) || 40)),
      },
    },
    data: {
      board: resolve(process.env.OFFICE_BOARD || raw.data?.board, 'data/board.json'),
      boardExample: resolve(raw.data?.boardExample, 'data/board.example.json'),
      projects: resolve(raw.data?.projects, 'data/projects'),
      tasks: resolve(raw.data?.tasks, 'data/tasks'),
    },
    minecraft: {
      enabled: process.env.OFFICE_MC === '0' ? false : process.env.OFFICE_MC === '1' || raw.minecraft?.enabled === true,
      java: str(process.env.MC_JAVA || raw.minecraft?.java, 'java', 400),
      memory: /^\d{1,2}G$/.test(raw.minecraft?.memory || '') ? raw.minecraft.memory : '2G',
      // 真人玩家（同一台電腦的 Java 版），進來後自動變成觀察者看機器人；環境變數 MC_GUESTS=name1,name2 優先
      guests: guestList(process.env.MC_GUESTS != null ? process.env.MC_GUESTS.split(',') : raw.minecraft?.guests),
    },
  };
}

// 給瀏覽器的公開設定（不含本機路徑）
export function publicConfig(config) {
  return {
    company: { name: config.company.name, currency: config.company.currency },
    owner: config.owner,
    cat: config.cat,
    staff: config.staff,
    source: config.source.type,
    minecraft: config.minecraft.enabled,
  };
}
