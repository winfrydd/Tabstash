// Small DOM helpers shared by the lists page and the popup. All page text from websites is
// inserted as text nodes, never as HTML, so a hostile tab title cannot inject markup.
import { api, hasFaviconApi } from './api.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'attrs') { for (const [a, b] of Object.entries(v)) if (b != null && b !== false) el.setAttribute(a, b === true ? '' : b); }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el[k] = v;
    }
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const PATHS = {
  x: 'M6 6l12 12M18 6L6 18',
  chevron: 'M6 9l6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2',
  restore: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  window: 'M4 5h16v14H4zM4 9h16',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
  save: 'M12 4v10M8 10l4 4 4-4M4 15v4h16v-4',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  merge: 'M7 4v6a4 4 0 0 0 4 4h6M14 11l3 3-3 3M7 20v-2',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  dedupe: 'M8 8h11v11H8zM5 16V5h11M11 13.5h5',
  palette: 'M12 4a8 8 0 1 0 0 16c1 0 1.5-.7 1.5-1.5 0-1.2-1-1.3-1-2.5 0-.8.7-1.5 1.5-1.5H16a4 4 0 0 0 4-4c0-3.6-3.6-6.5-8-6.5zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z M9 12l2 2 4-4',
  open: 'M14 4h6v6M20 4l-8 8',
  plus: 'M12 5v14M5 12h14',
};
const NS = 'http://www.w3.org/2000/svg';
const iconCache = new Map();
export function icon(name) {
  let tpl = iconCache.get(name);
  if (!tpl) {
    tpl = document.createElementNS(NS, 'svg');
    tpl.setAttribute('viewBox', '0 0 24 24');
    tpl.setAttribute('class', 'i');
    tpl.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', PATHS[name] || '');
    tpl.append(p);
    iconCache.set(name, tpl);
  }
  return tpl.cloneNode(true);
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url; }
}
export const shortUrl = (url) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');

function hue(s) {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(x) % 360;
}
export function tile(url) {
  const host = hostOf(url);
  const ch = (host.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  const el = h('span', { class: 'fav tile', attrs: { 'aria-hidden': 'true' } }, ch);
  el.style.setProperty('--h', hue(host));
  return el;
}
function img(src, url) {
  const i = h('img', { class: 'fav', src, alt: '', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
  i.addEventListener('error', () => i.replaceWith(tile(url)), { once: true });
  return i;
}
// Icon for a saved tab. Never touches the network unless the user turned on remote icons.
export function favicon(t, remote) {
  if (hasFaviconApi && /^https?:/i.test(t.url)) {
    return img(api.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(t.url) + '&size=32', t.url);
  }
  const ic = t.favIconUrl;
  if (ic && (ic.startsWith('data:image/') || (remote && /^https:/i.test(ic)))) return img(ic, t.url);
  return tile(t.url);
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export function fmtDate(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 45) return 'just now';
  if (d < 3600) return rtf.format(-Math.max(1, Math.round(d / 60)), 'minute');
  if (d < 86400) return rtf.format(-Math.round(d / 3600), 'hour');
  if (d < 7 * 86400) return rtf.format(-Math.round(d / 86400), 'day');
  return dtf.format(ts);
}
export const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

export function applyTheme(opts) {
  const r = document.documentElement;
  if (opts.theme === 'system') delete r.dataset.theme; else r.dataset.theme = opts.theme;
  r.dataset.density = opts.density;
}

// ---- Toast with optional Undo ----
let toastEl, toastTimer;
export function toast(msg, { undo, ms = 6000 } = {}) {
  if (!toastEl) { toastEl = h('div', { class: 'toast', attrs: { role: 'status', 'aria-live': 'polite' } }); document.body.append(toastEl); }
  clearTimeout(toastTimer);
  toastEl.replaceChildren(h('span', null, msg));
  if (undo) {
    toastEl.append(h('button', { class: 'btn ghost sm', onclick: () => { hide(); undo(); } }, icon('undo'), 'Undo'));
  }
  toastEl.classList.add('show');
  const hide = () => toastEl.classList.remove('show');
  toastTimer = setTimeout(hide, ms);
}

// ---- Popover menu ----
let menuEl = null, menuCleanup = null;
export function closeMenu() {
  if (menuCleanup) menuCleanup();
  menuEl?.remove();
  menuEl = null; menuCleanup = null;
}
// items: { label, icon, run, danger, disabled } | { sep: true } | { node: Element }
// at: an element to anchor to, or {x, y}
export function openMenu(at, items, { returnFocus } = {}) {
  closeMenu();
  const m = h('div', { class: 'menu', attrs: { role: 'menu' } });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { m.append(h('div', { class: 'sep', attrs: { role: 'separator' } })); continue; }
    if (it.node) { m.append(it.node); continue; }
    m.append(h('button', {
      class: 'mi' + (it.danger ? ' danger' : ''), disabled: !!it.disabled, attrs: { role: 'menuitem' },
      onclick: (e) => { e.stopPropagation(); const keep = it.keepOpen; if (!keep) closeMenu(); it.run?.(); },
    }, it.icon ? icon(it.icon) : h('span', { class: 'i' }), h('span', null, it.label)));
  }
  document.body.append(m);
  const r = at instanceof Element ? at.getBoundingClientRect() : { left: at.x, right: at.x, top: at.y, bottom: at.y };
  const mw = m.offsetWidth, mh = m.offsetHeight, vw = innerWidth, vh = innerHeight;
  let x = at instanceof Element ? r.right - mw : r.left;
  let y = r.bottom + 4;
  if (x + mw > vw - 8) x = vw - mw - 8;
  if (x < 8) x = 8;
  if (y + mh > vh - 8) y = Math.max(8, r.top - mh - 4);
  m.style.left = x + 'px';
  m.style.top = y + 'px';
  const onDown = (e) => { if (!m.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); (returnFocus || (at instanceof Element ? at : null))?.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const btns = [...m.querySelectorAll('button:not(:disabled)')];
      if (!btns.length) return;
      e.preventDefault();
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus();
    }
  };
  const onScroll = (e) => { if (!m.contains(e.target)) closeMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', onDown, true));
  document.addEventListener('keydown', onKey, true);
  addEventListener('scroll', onScroll, true);
  addEventListener('resize', closeMenu);
  addEventListener('blur', closeMenu);
  menuCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', closeMenu);
    removeEventListener('blur', closeMenu);
  };
  menuEl = m;
  (m.querySelector('input') || m.querySelector('button:not(:disabled)'))?.focus();
  return m;
}

// ---- Confirm dialog ----
export function confirmBox(text, ok = 'Delete') {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'dlg small' },
      h('p', null, text),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', value: 'no', onclick: () => d.close('no') }, 'Cancel'),
        h('button', { class: 'btn danger', value: 'yes', onclick: () => d.close('yes') }, ok)));
    d.addEventListener('close', () => { resolve(d.returnValue === 'yes'); d.remove(); });
    document.body.append(d);
    d.showModal();
  });
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
