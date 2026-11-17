// Import / export. Reads and writes OneTab text and Better OneTab JSON backups.
import * as S from './store.js';

const MAX_TABS = 200000;

// JSON in the original Better OneTab format, so backups also load in the old extension.
export function toJSON(lists) {
  return JSON.stringify(lists.map((l) => ({
    title: l.title,
    tabs: l.tabs.map((t) => {
      const o = { url: t.url, title: t.title };
      if (t.pinned) o.pinned = true;
      if (t.muted) o.muted = true;
      return o;
    }),
    time: l.time,
    tags: l.tags || [],
    pinned: !!l.pinned,
    color: l.color || '',
    expand: l.expand !== false,
  })), null, 2);
}

// OneTab text: "url | title" per line, a blank line between lists.
export function toOneTab(lists) {
  return lists.map((l) => l.tabs.map((t) => `${t.url} | ${t.title.replace(/[\r\n]+/g, ' ')}`).join('\n')).join('\n\n');
}

export function toMarkdown(l) {
  const esc = (s) => s.replace(/([[\]\\])/g, '\\$1');
  return (l.title ? `## ${l.title}\n\n` : '') + l.tabs.map((t) => `- [${esc(t.title)}](${t.url.replace(/\)/g, '%29')})`).join('\n');
}

function parseOneTab(text) {
  const lists = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const tabs = [];
    for (const line of block.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      const bar = s.indexOf(' | ');
      const url = (bar >= 0 ? s.slice(0, bar) : s.split('|')[0]).trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) continue;
      tabs.push({ url, title: bar >= 0 ? s.slice(bar + 3).trim() : '' });
    }
    if (tabs.length) lists.push({ tabs });
  }
  return lists;
}

// Returns cleaned lists ready to store (new ids, positions on top in file order).
export function parseImport(text) {
  if (typeof text !== 'string') throw new Error('Nothing to import');
  const t = text.replace(/^\uFEFF/, '').trim();
  if (!t) throw new Error('Nothing to import');
  let raw;
  if (t[0] === '[' || t[0] === '{') {
    let data;
    try { data = JSON.parse(t); } catch { throw new Error('This JSON file is damaged and could not be read'); }
    raw = Array.isArray(data) ? data : Array.isArray(data?.lists) ? data.lists : null;
    if (!raw) throw new Error('No lists found in this file');
    // A flat array of tabs becomes one list.
    if (raw.length && raw.every((x) => x && typeof x.url === 'string')) raw = [{ tabs: raw }];
  } else {
    raw = parseOneTab(t);
  }
  let total = 0;
  const out = [];
  const base = S.topPos() - raw.length;
  raw.forEach((r, i) => {
    const l = S.cleanList(r, { keepId: false });
    if (!l || !l.tabs.length) return;
    total += l.tabs.length;
    if (total > MAX_TABS) throw new Error(`Too many tabs (limit ${MAX_TABS.toLocaleString()})`);
    l.pos = base + i;
    out.push(l);
  });
  if (!out.length) throw new Error('No tabs found. Paste OneTab text or choose a Better OneTab JSON backup.');
  return out;
}
