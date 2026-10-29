// 書架上的專案資料庫（只讀）：設定的資料夾底下，每個子資料夾是一本書（一個專案）。
// - 專案資料夾可以放 project.json：{ "name": "顯示名稱", "spine": "書背文字", "status": "進行中｜暫停｜已結案" }
// - 列出專案資料夾第一層的檔案，以及再下一層子資料夾裡的檔案（不再往下）。
// - 每個路徑都先解析成真實路徑再確認在書架資料夾內（擋路徑穿越與跳出去的符號連結）。
// - 只提供出現在清單裡的檔案（用路徑雜湊當代號）；疑似含密鑰的檔案不列出；程式與資料檔只顯示檔名；
//   名稱含 evidence／screenshots／證據／截圖 的子資料夾只列圖片。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TEXT_MAX = 512 * 1024;
const IMAGE_MAX = 8 * 1024 * 1024;
const META_MAX = 16 * 1024;
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
// 疑似密鑰：常見金鑰格式，或「key／secret／token／password = 一長串值」
const SECRET_RE =
  /(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]?[A-Za-z0-9_\-/+=]{16,})/i;
// 檔名看起來跟密鑰有關的檔案（截圖可能拍到密鑰欄位）一律不列
const SECRET_NAME_RE = /(密鑰|金鑰|secret|token|password|api[_-]?key|\.env|credential)/i;
const EVIDENCE_RE = /(evidence|screenshot|證據|截圖)/i;
const META = 'project.json';

const shelfStatus = (s = '') => (s.includes('結案') || /closed|done/i.test(s) ? '已結案' : s.includes('暫停') || /pause/i.test(s) ? '暫停' : '進行中');
const hash = (s, n = 16) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

export class ProjectsStore {
  constructor({ dir }) {
    this.dir = dir;
  }

  async root() {
    try {
      return await fs.realpath(this.dir);
    } catch {
      return null;
    }
  }

  // 解析成真實路徑後，必須在書架資料夾底下
  async safe(root, ...parts) {
    if (!root) return null;
    for (const part of parts) if (!part || part.includes('/') || part.includes('\\') || part === '..' || part.startsWith('.')) return null;
    try {
      const abs = await fs.realpath(path.join(root, ...parts));
      return abs.startsWith(root + path.sep) ? abs : null;
    } catch {
      return null;
    }
  }

  // 每個子資料夾一個專案；代號是資料夾名稱的雜湊（資料夾可以用中文命名）
  async projects() {
    const root = await this.root();
    if (!root) return [];
    const out = [];
    const entries = (await fs.readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const dir = await this.safe(root, e.name);
      if (!dir || !(await fs.stat(dir)).isDirectory()) continue;
      let meta = {};
      try {
        const metaFile = await this.safe(root, e.name, META);
        if (metaFile && (await fs.stat(metaFile)).size <= META_MAX) meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
      } catch {
        meta = {};
      }
      const name = str(meta.name, 60) || e.name;
      out.push({ id: hash(e.name, 12), folder: e.name, name, spine: str(meta.spine, 12) || name, status: str(meta.status, 20), root });
    }
    return out;
  }

  async entry(abs, group, name, kind) {
    const st = await fs.stat(abs);
    if (!st.isFile()) return null;
    if (SECRET_NAME_RE.test(name)) return { hidden: true };
    if (kind === 'md' || kind === 'text') {
      if (st.size > TEXT_MAX) kind = 'name-only';
      else if (SECRET_RE.test(await fs.readFile(abs, 'utf8'))) return { hidden: true };
    }
    if (kind === 'image' && st.size > IMAGE_MAX) return { hidden: true };
    return { key: hash(abs), abs, group, name, kind, size: st.size, mtime: st.mtimeMs };
  }

  kindOf(name) {
    const ext = path.extname(name).toLowerCase();
    if (ext === '.md') return 'md';
    if (ext === '.txt') return 'text';
    if (IMAGE_MIME[ext]) return 'image';
    return 'name-only'; // 程式、試算表、JSON 等只顯示檔名
  }

  // 一個專案能看的所有檔案
  async files(project) {
    const { root, folder } = project;
    const out = [];
    let hidden = 0;
    const add = (e) => {
      if (!e) return;
      if (e.hidden) hidden++;
      else out.push(e);
    };
    const dir = await this.safe(root, folder);
    if (!dir) return { files: out, hidden };
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    // 第一層檔案
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === META) continue;
      const abs = await this.safe(root, folder, e.name);
      if (abs && (await fs.stat(abs)).isFile()) add(await this.entry(abs, '專案文件', e.name, this.kindOf(e.name)));
    }
    // 第二層：子資料夾
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const sub = await this.safe(root, folder, e.name);
      if (!sub || !(await fs.stat(sub)).isDirectory()) continue;
      const evidence = EVIDENCE_RE.test(e.name);
      for (const n of (await fs.readdir(sub)).sort()) {
        if (n.startsWith('.')) continue;
        const kind = this.kindOf(n);
        if (evidence && kind !== 'image') continue; // 證據資料夾只列圖片
        const abs = await this.safe(root, folder, e.name, n);
        if (abs) add(await this.entry(abs, evidence ? `證據：${e.name}` : `資料夾：${e.name}`, n, kind));
      }
    }
    return { files: out, hidden };
  }

  // 書架用的專案清單；狀態以 project.json 為準，沒寫就找布告欄歸檔裡同名的案子
  async list(boardProjects = []) {
    const projects = await this.projects();
    return Promise.all(
      projects.map(async (p) => {
        const match = boardProjects.find((b) => b.name === p.name || b.name.includes(p.spine));
        const { files } = await this.files(p);
        return { id: p.id, name: p.name, spine: p.spine, status: shelfStatus(p.status || match?.status), count: files.length };
      }),
    );
  }

  async find(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{12}$/.test(id)) return null;
    return (await this.projects()).find((p) => p.id === id) || null;
  }

  async listFiles(id) {
    const project = await this.find(id);
    if (!project) return null;
    const { files, hidden } = await this.files(project);
    return { id, name: project.name, hidden, files: files.map(({ abs, ...rest }) => rest) };
  }

  // 取得檔案：必須是清單裡的；文字回內容、圖片回位元組、其他只給檔名
  async file(id, key) {
    const project = await this.find(id);
    if (!project || typeof key !== 'string' || !/^[0-9a-f]{16}$/.test(key)) return null;
    const { files } = await this.files(project);
    const f = files.find((x) => x.key === key);
    if (!f) return null;
    if (f.kind === 'name-only') return { nameOnly: true, name: f.name };
    if (f.kind === 'image') return { image: await fs.readFile(f.abs), mime: IMAGE_MIME[path.extname(f.name).toLowerCase()], name: f.name };
    return { name: f.name, group: f.group, mtime: f.mtime, content: await fs.readFile(f.abs, 'utf8') };
  }
}
