// Saving and restoring tabs. Used by the background script and the lists page.
import { api, isFirefox, hasFaviconApi, appUrl } from './api.js';
import * as S from './store.js';

const listsUrl = () => appUrl('lists.html');

async function resolveWindow(windowId) {
  if (windowId != null) return windowId;
  const w = await api.windows.getLastFocused({ windowTypes: ['normal'] });
  return w.id;
}

// Focus the lists page in this window, or open it. One per window.
export async function openLists(windowId, hash = '') {
  windowId = await resolveWindow(windowId);
  const base = listsUrl();
  const tabs = await api.tabs.query({ windowId });
  const existing = tabs.find((t) => t.url && t.url.startsWith(base));
  let tab;
  if (existing) tab = await api.tabs.update(existing.id, { active: true, ...(hash ? { url: base + hash } : {}) });
  else tab = await api.tabs.create({ windowId, url: base + hash, active: true });
  api.windows.update(windowId, { focused: true }).catch(() => {});
  return tab;
}

const BLANK = /^(about:(blank|newtab|home|privatebrowsing)|chrome:\/\/newtab\/?|edge:\/\/newtab\/?)$/i;

function skip(t, opts, base) {
  return t.incognito || !t.url || t.url.startsWith(base) || (opts.skipPinned && t.pinned) || !S.isSaveable(t.url);
}

// Save tabs into a new list (or into `intoId`), then close them.
// Data is written before any tab is closed, so a crash can never lose tabs.
export async function saveTabs(tabs, { intoId = null, windowId = null, showAfter = false } = {}) {
  const opts = await S.getOpts();
  const base = appUrl('');
  const picked = [];
  for (const t of tabs) {
    if (skip(t, opts, base)) continue;
    const c = S.cleanTab(t);
    if (!c) continue;
    if (hasFaviconApi) delete c.favIconUrl; // Chrome reads icons from its own cache
    picked.push([t, c]);
  }
  if (!picked.length) return { saved: 0 };
  let newTabs = picked.map(([, c]) => c);

  let done = false;
  if (intoId) {
    done = !!(await S.updateList(intoId, (l) => {
      l.tabs.push(...newTabs);
      if (opts.dedupe) l.tabs = S.dedupe(l.tabs);
    }));
  }
  if (!done) {
    if (opts.dedupe) newTabs = S.dedupe(newTabs);
    await S.putList(S.makeList(newTabs, { pinned: opts.lockNew }));
  }

  // Empty new-tab pages in the same batch are closed too (not saved).
  const blanks = tabs.filter((t) => !t.pinned && BLANK.test(t.url || ''));
  // Closing every tab in the window would close the window: keep the lists page open in it.
  const ids = [...picked.map(([t]) => t.id), ...blanks.map((t) => t.id)];
  const closing = [...picked.map(([t]) => t), ...blanks].filter((t) => t.windowId === windowId).length;
  if (windowId != null && (showAfter || closing > 0)) {
    const all = await api.tabs.query({ windowId });
    if (showAfter || all.length - closing <= 0) await openLists(windowId);
  }
  await api.tabs.remove(ids);
  return { saved: picked.length };
}

const winTabs = (windowId) => api.tabs.query({ windowId });

function selection(all, clicked) {
  const sel = all.filter((t) => t.highlighted);
  if (clicked && !sel.some((t) => t.id === clicked.id)) return [all.find((t) => t.id === clicked.id) || clicked];
  return sel;
}

export async function saveSelected(windowId, clicked, intoId = null) {
  windowId = await resolveWindow(clicked?.windowId ?? windowId);
  const all = await winTabs(windowId);
  return saveTabs(selection(all, clicked), { windowId, intoId });
}

export async function saveWindow(windowId) {
  windowId = await resolveWindow(windowId);
  const opts = await S.getOpts();
  return saveTabs(await winTabs(windowId), { windowId, showAfter: opts.showAfterSave });
}

export async function saveAllWindows(windowId) {
  windowId = await resolveWindow(windowId);
  const opts = await S.getOpts();
  const wins = await api.windows.getAll({ populate: true, windowTypes: ['normal'] });
  // Current window last, so its list ends up on top.
  wins.sort((a, b) => (a.id === windowId) - (b.id === windowId));
  let saved = 0;
  for (const w of wins) {
    const r = await saveTabs(w.tabs || [], { windowId, showAfter: opts.showAfterSave && w.id === windowId });
    saved += r.saved;
  }
  return { saved };
}

// side: 'left' | 'right' | 'others' — relative to the selected tabs.
export async function saveSide(side, windowId, clicked) {
  windowId = await resolveWindow(clicked?.windowId ?? windowId);
  const all = await winTabs(windowId);
  const sel = new Set(selection(all, clicked).map((t) => t.id));
  const idx = all.map((t, i) => (sel.has(t.id) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return { saved: 0 };
  const first = idx[0], last = idx[idx.length - 1];
  const pick = side === 'left' ? all.slice(0, first) : side === 'right' ? all.slice(last + 1) : all.filter((t) => !sel.has(t.id));
  return saveTabs(pick, { windowId });
}

// Open tabs again. Returns { opened, failed: [tabs that could not be opened] }.
export async function restoreTabs(tabs, { newWindow = false, windowId = null } = {}) {
  const opts = await S.getOpts();
  const failed = tabs.filter((t) => !S.isOpenable(t.url));
  const list = tabs.filter((t) => S.isOpenable(t.url));
  if (!list.length) return { opened: 0, failed };
  let index, start = 0, opened = 0;

  if (newWindow) {
    const w = await api.windows.create({ url: list[0].url, focused: true });
    windowId = w.id;
    const first = w.tabs?.[0];
    if (first && (list[0].pinned || list[0].muted)) api.tabs.update(first.id, { pinned: !!list[0].pinned, muted: !!list[0].muted }).catch(() => {});
    start = 1; opened = 1;
  } else {
    windowId = await resolveWindow(windowId);
    if (opts.restorePos === 'after') {
      const [act] = await api.tabs.query({ windowId, active: true });
      if (act) index = act.index + 1;
    }
  }

  const lazy = opts.lazyRestore && isFirefox;
  for (let i = start; i < list.length; i++) {
    const t = list[i];
    const activate = !newWindow && i === 0;
    const props = { windowId, url: t.url, active: activate };
    if (index !== undefined) props.index = index + i;
    if (t.pinned) props.pinned = true;
    let created = null;
    if (lazy && !activate && !t.pinned) {
      try { created = await api.tabs.create({ ...props, discarded: true, title: t.title }); } catch { created = null; }
    }
    if (!created) {
      try { created = await api.tabs.create(props); } catch { failed.push(t); continue; }
    }
    opened++;
    if (t.muted) api.tabs.update(created.id, { muted: true }).catch(() => {});
  }
  return { opened, failed };
}

// Restore a list; unlocked lists are removed afterwards. Tabs that failed to open stay saved.
export async function restoreList(id, { newWindow = false, windowId = null } = {}) {
  const l = await S.getList(id);
  if (!l) return { opened: 0, failed: [] };
  const r = await restoreTabs(l.tabs, { newWindow, windowId });
  if (!l.pinned) {
    if (!r.failed.length) await S.removeLists([id]);
    else { l.tabs = r.failed; await S.commit([l]); }
  }
  return r;
}

export async function restoreLatest(windowId) {
  const [first] = await S.getLists();
  if (first) return restoreList(first.id, { windowId });
  return { opened: 0, failed: [] };
}
