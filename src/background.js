// Background: toolbar button, keyboard shortcuts, right-click menus, popup requests.
// Makes no network requests. All listeners are registered synchronously at top level
// so they survive the background being suspended (Firefox event page / Chrome service worker).
import { api, menus, isFirefox } from './lib/api.js';
import * as S from './lib/store.js';
import * as A from './lib/actions.js';

const TITLES = {
  popup: 'Tabstash',
  'save-window': 'Save all tabs in this window',
  'save-selected': 'Save selected tabs',
  'open-lists': 'Show saved lists',
};

const log = (e) => console.error('[Tabstash]', e);

function run(cmd, { windowId = null, tab = null, listId = null, newWindow = false } = {}) {
  switch (cmd) {
    case 'save-selected': return A.saveSelected(windowId, tab);
    case 'save-window': return A.saveWindow(tab?.windowId ?? windowId);
    case 'save-all': return A.saveAllWindows(tab?.windowId ?? windowId);
    case 'save-left': return A.saveSide('left', windowId, tab);
    case 'save-right': return A.saveSide('right', windowId, tab);
    case 'save-others': return A.saveSide('others', windowId, tab);
    case 'save-into': return A.saveSelected(windowId, tab, listId);
    case 'restore': return A.restoreList(listId, { windowId, newWindow });
    case 'restore-latest': return A.restoreLatest(tab?.windowId ?? windowId);
    case 'open-lists': return A.openLists(tab?.windowId ?? windowId);
    default: return Promise.resolve();
  }
}

async function applyAction(opts) {
  await api.action.setPopup({ popup: opts.action === 'popup' ? 'popup.html' : '' });
  await api.action.setTitle({ title: TITLES[opts.action] || TITLES.popup });
}

// ---- Right-click menus ----
let menuChain = Promise.resolve();
const rebuildMenus = () => (menuChain = menuChain.then(buildMenus).catch(log));

async function buildMenus() {
  const [opts, lists] = await Promise.all([S.getOpts(), S.getLists()]);
  await menus.removeAll();
  const contexts = ['action'];
  if (isFirefox) contexts.push('tab');
  if (opts.pageMenu) contexts.push('page');
  const add = (props) => new Promise((res) => menus.create({ contexts, ...props }, () => { void api.runtime.lastError; res(); }));

  await add({ id: 'save-selected', title: 'Save selected tabs' });
  await add({ id: 'save-window', title: 'Save all tabs in this window' });
  await add({ id: 'save-all', title: 'Save tabs from all windows' });
  await add({ id: 'more', title: 'Save more' });
  await add({ id: 'save-left', parentId: 'more', title: 'Tabs to the left' });
  await add({ id: 'save-right', parentId: 'more', title: 'Tabs to the right' });
  await add({ id: 'save-others', parentId: 'more', title: 'All tabs except selected' });
  await add({ id: 'into', title: 'Save selected tabs into' });
  const named = lists.filter((l) => l.title).slice(0, 15);
  if (!named.length) await add({ id: 'into-none', parentId: 'into', title: 'Give a list a name to see it here', enabled: false });
  for (const l of named) await add({ id: 'into:' + l.id, parentId: 'into', title: l.title.slice(0, 60).replace(/&/g, '&&') });
  await add({ id: 'open-lists', title: 'Show saved lists' });
}

async function setup() {
  const opts = await S.getOpts();
  await applyAction(opts);
  await rebuildMenus();
}

api.runtime.onInstalled.addListener(() => setup().catch(log));
api.runtime.onStartup.addListener(() => setup().catch(log));

api.action.onClicked.addListener((tab) => {
  S.getOpts().then((o) => run(o.action, { windowId: tab?.windowId })).catch(log);
});

api.commands.onCommand.addListener((cmd, tab) => {
  run(cmd, { windowId: tab?.windowId ?? null }).catch(log);
});

menus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  // `tab` is the right-clicked tab (tab strip) or the active tab (page, toolbar button).
  // If it is part of the selection, the whole selection is used; otherwise just that tab.
  const ctx = { windowId: tab?.windowId ?? null, tab: tab || null };
  if (id.startsWith('into:')) run('save-into', { ...ctx, listId: id.slice(5) }).catch(log);
  else run(id, ctx).catch(log);
});

// Popup requests. Answer at once: the popup closes as soon as tabs change.
const POPUP_CMDS = new Set(['save-selected', 'save-window', 'save-all', 'restore', 'open-lists']);
api.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== api.runtime.id || !msg || !POPUP_CMDS.has(msg.cmd)) return false;
  respond({ ok: true });
  const listId = typeof msg.listId === 'string' ? msg.listId : null;
  const windowId = Number.isInteger(msg.windowId) ? msg.windowId : null;
  run(msg.cmd, { windowId, listId, newWindow: msg.newWindow === true }).catch(log);
  return false;
});

// Keep the toolbar button and the "Save into" menu in sync with settings and list names.
let menuTimer = null;
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let rebuild = false;
  if (changes.opts) {
    const o = { ...S.DEFAULTS, ...(changes.opts.newValue || {}) };
    const old = { ...S.DEFAULTS, ...(changes.opts.oldValue || {}) };
    applyAction(o).catch(log);
    if (o.pageMenu !== old.pageMenu) rebuild = true;
  }
  for (const [k, c] of Object.entries(changes)) {
    if (!S.isListKey(k)) continue;
    if ((c.oldValue?.title || '') !== (c.newValue?.title || '') || (!!c.oldValue !== !!c.newValue && (c.oldValue?.title || c.newValue?.title))) rebuild = true;
  }
  if (rebuild) { clearTimeout(menuTimer); menuTimer = setTimeout(rebuildMenus, 400); }
});
