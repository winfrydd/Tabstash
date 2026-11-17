// Toolbar popup. Every action is handed to the background, because the popup closes the
// moment tabs change and would otherwise be killed halfway through.
import { api } from './lib/api.js';
import * as S from './lib/store.js';
import { h, icon, favicon, fmtDate, plural, applyTheme } from './lib/ui.js';

const $ = (id) => document.getElementById(id);

const win = await api.windows.getCurrent();
const [opts, lists, winTabs, allWins] = await Promise.all([
  S.getOpts(), S.getLists(), api.tabs.query({ windowId: win.id }), api.windows.getAll({ populate: true, windowTypes: ['normal'] }),
]);
applyTheme(opts);

const base = api.runtime.getURL('');
const saveable = (t) => !t.url?.startsWith(base) && S.isSaveable(t.url) && !(opts.skipPinned && t.pinned);
const nWin = winTabs.filter(saveable).length;
const nSel = winTabs.filter((t) => t.highlighted && saveable(t)).length;
const nAll = allWins.reduce((s, w) => s + (w.tabs || []).filter(saveable).length, 0);
$('n-window').textContent = plural(nWin, 'tab');
$('n-selected').textContent = String(nSel);
$('n-all').textContent = String(nAll);
$('save-window').disabled = !nWin;
$('save-selected').disabled = !nSel;
$('save-all').disabled = !nAll || allWins.length < 2;

async function send(msg) {
  try { await api.runtime.sendMessage({ ...msg, windowId: win.id }); } finally { window.close(); }
}
$('save-window').addEventListener('click', () => send({ cmd: 'save-window' }));
$('save-selected').addEventListener('click', () => send({ cmd: 'save-selected' }));
$('save-all').addEventListener('click', () => send({ cmd: 'save-all' }));
$('open-lists').addEventListener('click', () => send({ cmd: 'open-lists' }));

const $ul = $('lists');
$('none').hidden = lists.length > 0;
$('open-lists').textContent = lists.length ? `Open all ${lists.length} lists →` : 'Open lists page →';

function row(l) {
  const n = l.tabs.length;
  const icons = h('span', { class: 'icons' }, l.tabs.slice(0, 4).map((t) => favicon(t, opts.remoteIcons)));
  const li = h('li', { dataset: { color: l.color || '' } },
    h('button', { class: 'pl', title: (opts.popupClick === 'restore-window' ? 'Restore in a new window' : 'Restore in this window') + (l.pinned ? ' (locked: stays saved)' : '') },
      h('span', { class: 'bar' }),
      h('span', { class: 'txt' },
        h('span', { class: 'nm' }, l.title || plural(n, 'tab')),
        h('span', { class: 'sub' }, (l.title ? plural(n, 'tab') + ' · ' : '') + fmtDate(l.time))),
      l.pinned ? h('span', { class: 'lk', title: 'Locked' }, icon('lock')) : null,
      icons),
    h('button', { class: 'ib nw', title: opts.popupClick === 'restore-window' ? 'Restore in this window' : 'Restore in a new window' }, icon(opts.popupClick === 'restore-window' ? 'restore' : 'window')));
  const inNew = opts.popupClick === 'restore-window';
  li.firstChild.addEventListener('click', () => send({ cmd: 'restore', listId: l.id, newWindow: inNew }));
  li.lastChild.addEventListener('click', () => send({ cmd: 'restore', listId: l.id, newWindow: !inNew }));
  li.dataset.hay = (l.title + ' ' + l.tabs.map((t) => t.title + ' ' + t.url).join(' ')).toLowerCase();
  return li;
}

const SHOW = 150;
$ul.append(...lists.slice(0, SHOW).map(row));
if (lists.length > 6) {
  const f = $('filter');
  f.hidden = false;
  let built = lists.length <= SHOW;
  f.addEventListener('input', () => {
    if (!built) { $ul.append(...lists.slice(SHOW).map(row)); built = true; }
    const terms = f.value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const li of $ul.children) li.hidden = terms.length > 0 && !terms.every((t) => li.dataset.hay.includes(t));
  });
}
