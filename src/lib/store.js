// Storage model. Each list lives under its own key ("l:<id>") so a change rewrites one list,
// not the whole database. Order is a float `pos` on each list (smaller = higher), so moving a
// list only touches that list and no shared index can get out of sync between pages.
import { api } from './api.js';

const local = api.storage.local;

export const DEFAULTS = Object.freeze({
  action: 'popup',          // popup | save-window | save-selected | open-lists
  itemClick: 'open-remove', // open-remove | open
  popupClick: 'restore',    // restore | restore-window
  restorePos: 'end',        // end | after
  lazyRestore: true,        // Firefox: restored tabs load only when clicked
  showAfterSave: true,
  skipPinned: false,
  dedupe: true,
  lockNew: false,
  confirmDelete: false,
  pageMenu: true,
  display: 'both',          // both | title | url
  theme: 'system',          // system | light | dark
  density: 'comfortable',   // comfortable | compact
  remoteIcons: false,       // Firefox: load site icons from the web (off = zero network)
});

export const COLORS = ['', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown', 'gray'];
const COLOR_ALIAS = { cyan: 'teal', grey: 'gray' };

const P = 'l:';
export const keyOf = (id) => P + id;
export const isListKey = (k) => k.startsWith(P);
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);

// Firefox reader view wraps the real address: about:reader?url=https://...
export function unwrapUrl(url) {
  if (url.startsWith('about:reader?')) {
    try { const u = new URL(url).searchParams.get('url'); if (u) return u; } catch { /* keep as is */ }
  }
  return url;
}
// Only real web addresses are saved; browser-internal pages stay open untouched.
export const isSaveable = (url) => /^(https?|ftp):/i.test(unwrapUrl(url || ''));
// Addresses that can be opened again by an extension.
export const isOpenable = (url) => /^(https?|ftp|file):/i.test(url || '');
const isDangerous = (url) => /^\s*(javascript|data|blob|vbscript):/i.test(url);

export function cleanTab(t) {
  if (!t || typeof t !== 'object') return null;
  const url = unwrapUrl(str(t.url, 8192).trim());
  if (!url || isDangerous(url)) return null;
  const out = { url, title: str(t.title, 1000).trim() || url };
  const ic = typeof t.favIconUrl === 'string' ? t.favIconUrl : '';
  if ((ic.startsWith('data:image/') && ic.length <= 12000) || (/^https?:/i.test(ic) && ic.length <= 2048)) out.favIconUrl = ic;
  if (t.pinned === true) out.pinned = true;
  if (t.muted === true || t.mutedInfo?.muted === true) out.muted = true;
  return out;
}

export function cleanList(l, { keepId = true } = {}) {
  if (!l || typeof l !== 'object') return null;
  const tabsIn = Array.isArray(l) ? l : Array.isArray(l.tabs) ? l.tabs : null;
  if (!tabsIn) return null;
  const tabs = tabsIn.map(cleanTab).filter(Boolean);
  const time = Number.isFinite(+l.time) && +l.time > 0 ? +l.time : Date.now();
  let color = COLOR_ALIAS[l.color] ?? l.color;
  if (!COLORS.includes(color)) color = '';
  return {
    id: keepId && typeof l.id === 'string' && /^[\w-]{1,40}$/.test(l.id) ? l.id : newId(),
    title: str(l.title, 300).trim(),
    tabs,
    time,
    updatedAt: Date.now(),
    pinned: l.pinned === true,
    expand: l.expand !== false,
    color,
    tags: Array.isArray(l.tags) ? l.tags.filter((x) => typeof x === 'string').slice(0, 50).map((x) => x.slice(0, 100)) : [],
    pos: Number.isFinite(l.pos) ? l.pos : -time,
  };
}

// A position above every existing list. Newer = smaller, so new lists land on top.
let lastPos = 0;
export function topPos() {
  let p = -Date.now();
  if (p >= lastPos) p = lastPos - 0.001;
  lastPos = p;
  return p;
}

export function makeList(tabs, extra = {}) {
  return cleanList({ ...extra, tabs, time: Date.now(), pos: topPos() }, { keepId: false });
}

export const byPos = (a, b) => a.pos - b.pos || b.time - a.time;

export function listsFrom(all) {
  const out = [];
  for (const [k, v] of Object.entries(all)) if (isListKey(k) && v && Array.isArray(v.tabs)) out.push(v);
  return out.sort(byPos);
}

export async function getOpts() {
  const { opts } = await local.get('opts');
  return { ...DEFAULTS, ...(opts || {}) };
}
export async function setOpts(patch) {
  const next = { ...(await getOpts()), ...patch };
  for (const k of Object.keys(next)) if (!(k in DEFAULTS)) delete next[k];
  await local.set({ opts: next });
  return next;
}

export const getLists = async () => listsFrom(await local.get(null));
export async function getList(id) {
  const k = keyOf(id);
  return (await local.get(k))[k] ?? null;
}
export function putLists(lists) {
  const o = {};
  for (const l of lists) o[keyOf(l.id)] = l;
  return local.set(o);
}
export const putList = (l) => putLists([l]);
export const removeLists = (ids) => local.remove(ids.map(keyOf));

// An empty list disappears unless it is locked.
export const isDead = (l) => !l.tabs.length && !l.pinned;

// Writes several changed lists at once; empty unlocked ones are deleted instead.
export async function commit(lists) {
  const now = Date.now();
  const keep = [], drop = [];
  for (const l of lists) { l.updatedAt = now; (isDead(l) ? drop : keep).push(l); }
  if (keep.length) await putLists(keep);
  if (drop.length) await removeLists(drop.map((l) => l.id));
}

// Read-modify-write one list. `fn` mutates the list (or returns null to delete it).
export async function updateList(id, fn) {
  const l = await getList(id);
  if (!l) return null;
  const r = fn(l);
  if (r === null) { await removeLists([id]); return null; }
  await commit([l]);
  return isDead(l) ? null : l;
}

export function dedupe(tabs) {
  const seen = new Set();
  return tabs.filter((t) => (seen.has(t.url) ? false : (seen.add(t.url), true)));
}
