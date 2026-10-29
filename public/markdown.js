// 簡單、安全的 Markdown → DOM：只建立元素並用 textContent 放文字，不使用 innerHTML。
// 支援：標題、段落、清單（含勾選）、引用、表格、程式碼區塊、分隔線、粗體、行內程式碼、連結（只顯示文字，不可點）。

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

// 行內：**粗體**、`程式碼`、[文字](網址)
function inline(parent, text) {
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    if (m[2] !== undefined) {
      const b = el('strong');
      b.textContent = m[2];
      parent.append(b);
    } else if (m[3] !== undefined) {
      const c = el('code');
      c.textContent = m[3];
      parent.append(c);
    } else {
      const a = el('span', 'md-link');
      a.textContent = m[4];
      a.title = m[5];
      parent.append(a);
    }
    last = re.lastIndex;
  }
  if (last < text.length) parent.append(text.slice(last));
  return parent;
}

const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function renderMarkdown(src) {
  const root = el('div', 'md');
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // 程式碼區塊
    if (/^\s*```/.test(line)) {
      const pre = el('pre');
      const code = el('code');
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      code.textContent = buf.join('\n');
      pre.append(code);
      root.append(pre);
      continue;
    }
    // 標題
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      root.append(inline(el(`h${Math.min(6, h[1].length)}`), h[2]));
      i++;
      continue;
    }
    // 分隔線
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      root.append(el('hr'));
      i++;
      continue;
    }
    // 表格
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const table = el('table');
      const head = el('tr');
      for (const c of cells(line)) head.append(inline(el('th'), c));
      table.append(head);
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const tr = el('tr');
        for (const c of cells(lines[i])) tr.append(inline(el('td'), c));
        table.append(tr);
        i++;
      }
      const wrap = el('div', 'md-table');
      wrap.append(table);
      root.append(wrap);
      continue;
    }
    // 引用
    if (/^\s*>/.test(line)) {
      const q = el('blockquote');
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      q.append(renderMarkdown(buf.join('\n')));
      root.append(q);
      continue;
    }
    // 清單（含 - [ ] 勾選）
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const list = el(ordered ? 'ol' : 'ul');
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const depth = (lines[i].match(/^\s*/)[0].length / 2) | 0;
        let text = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        const li = el('li');
        if (depth) li.style.marginLeft = `${depth * 16}px`;
        const task = /^\[([ xX])\]\s+/.exec(text);
        if (task) {
          li.className = 'md-task';
          li.append(task[1] === ' ' ? '☐ ' : '☑ ');
          text = text.slice(task[0].length);
        }
        list.append(inline(li, text));
        i++;
      }
      root.append(list);
      continue;
    }
    // 段落（連續的非空行）
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*>|\s*([-*+]|\d+\.)\s+)/.test(lines[i])) buf.push(lines[i++].trim());
    if (!buf.length) {
      root.append(inline(el('p'), lines[i++]));
      continue;
    }
    root.append(inline(el('p'), buf.join(' ')));
  }
  return root;
}
