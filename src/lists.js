// The saved-lists page. Data flow is one-way: every action writes to storage, and the
// storage.onChanged listener re-renders only the lists that changed. That keeps this page,
// other open copies of it, the popup and the background in sync without message passing.
import { api, isFirefox } from './lib/api.js';
import * as S from './lib/store.js';
import * as A from './lib/actions.js';
import * as IO from './lib/io.js';
import { h, icon, favicon, fmtDate, plural, applyTheme, toast, openMenu, closeMenu, confirmBox, debounce, download, shortUrl } from './lib/ui.js';

const $ = (id) => document.getElementById(id);
const $lists = $('lists'), $q = $('q'), $stats = $('stats');

const state = { opts: { ...S.DEFAULTS }, lists: [], byId: new Map(), cards: new Map(), terms: [] };

const nameOf = (l) => l.title || plural(l.tabs.length, 'tab');

// ---------------------------------------------------------------- rendering

const ib = (name, act, title, extra = '') =>
  h('button', { class: 'ib ' + extra, title, dataset: { act }, attrs: { 'aria-label': title } }, icon(name));

const metaText = (l) => (l.title ? plural(l.tabs.length, 'tab') + ' · ' : '') + fmtDate(l.time);

function buildCard(l) {
  const card = h('section', {
    class: 'card' + (l.expand ? '' : ' collapsed') + (l.pinned ? ' locked' : ''),
    dataset: { id: l.id, color: l.color || '' },
    attrs: { 'aria-label': nameOf(l) },
  });
  const head = h('header', { class: 'card-h', attrs: { draggable: 'true' } },
    h('button', { class: 'ib chev', dataset: { act: 'toggle' }, title: l.expand ? 'Collapse' : 'Expand', attrs: { 'aria-expanded': String(l.expand) } }, icon('chevron')),
    h('div', { class: 'ttl' },
      h('h2', { class: 'title' + (l.title ? '' : ' untitled'), dataset: { act: 'rename' }, title: 'Click to rename' }, nameOf(l)),
      h('span', { class: 'meta' }, metaText(l), l.pinned ? h('span', { class: 'badge' }, icon('lock'), 'Locked') : null)),
    h('div', { class: 'acts' },
      h('button', { class: 'btn sm', dataset: { act: 'restore' }, title: l.pinned ? 'Open all tabs (locked list stays)' : 'Open all tabs and remove this list' }, icon('restore'), h('span', null, 'Restore')),
      ib('window', 'restore-window', 'Open all in a new window'),
      ib(l.pinned ? 'lock' : 'unlock', 'lock', l.pinned ? 'Unlock: remove this list after restoring' : 'Lock: keep this list after restoring', l.pinned ? 'on' : ''),
      ib('more', 'menu', 'More actions')));
  card.append(head, h('ul', { class: 'tabs' }));
  if (l.expand || state.terms.length) fillRows(card, l);
  return card;
}

function fillRows(card, l) {
  const ul = card.querySelector('.tabs');
  if (ul.dataset.filled) return;
  ul.dataset.filled = '1';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < l.tabs.length; i++) frag.append(buildRow(l.tabs[i], i));
  ul.append(frag);
}

function buildRow(t, i) {
  const o = state.opts;
  const kids = [];
  if (o.display !== 'url') kids.push(h('span', { class: 't' }, t.title));
  if (o.display !== 'title') kids.push(h('span', { class: 'u' }, shortUrl(t.url)));
  return h('li', { class: 'tab', dataset: { i }, attrs: { draggable: 'true' } },
    favicon(t, o.remoteIcons),
    h('a', { class: 'link', attrs: { href: /^https?:/i.test(t.url) ? t.url : null, rel: 'noreferrer noopener', title: t.title + '\n' + t.url, draggable: 'false' } }, ...kids),
    h('button', { class: 'ib x', dataset: { act: 'remove-tab' }, title: 'Remove from list', attrs: { 'aria-label': 'Remove ' + t.title } }, icon('x')));
}

function renderCard(l) {
  const card = buildCard(l);
  const old = state.cards.get(l.id);
  if (old) old.replaceWith(card);
  state.cards.set(l.id, card);
  return card;
}

// Keep card order in the DOM equal to state.lists, moving only what is out of place.
function placeCards() {
  let prev = null;
  for (const l of state.lists) {
    const c = state.cards.get(l.id);
    if (!c) continue;
    const want = prev ? prev.nextSibling : $lists.firstChild;
    if (c !== want) $lists.insertBefore(c, want);
    prev = c;
  }
}

// Yield to the browser without the throttling setTimeout/rAF get in background tabs.
const yieldTask = (() => {
  const ch = new MessageChannel(), q = [];
  ch.port1.onmessage = () => q.shift()?.();
  return (fn) => { q.push(fn); ch.port2.postMessage(0); };
})();

// Build any cards the chunked renderer has not reached yet (search needs all of them).
function ensureAllCards() {
  let added = false;
  for (const l of state.lists) {
    if (state.cards.has(l.id)) continue;
    state.cards.set(l.id, buildCard(l));
    added = true;
  }
  if (added) placeCards();
}

// Render in chunks so the first screen appears at once even with thousands of lists.
let renderToken = 0;
function renderAll() {
  const token = ++renderToken;
  $lists.replaceChildren();
  state.cards.clear();
  const ids = state.lists.map((l) => l.id);
  let i = 0;
  const step = () => {
    if (token !== renderToken) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(ids.length, i + (i === 0 ? 15 : 40));
    for (; i < end; i++) {
      const l = state.byId.get(ids[i]);
      if (!l || state.cards.has(l.id)) continue;
      const c = buildCard(l);
      state.cards.set(l.id, c);
      frag.append(c);
    }
    $lists.append(frag);
    if (i < ids.length) yieldTask(step);
    else { placeCards(); if (state.terms.length) applySearch(); }
  };
  step();
  updateChrome();
}

function updateChrome() {
  const nl = state.lists.length;
  $('empty').hidden = nl > 0;
  document.body.classList.toggle('no-lists', nl === 0);
  if (state.terms.length) return;
  const nt = state.lists.reduce((s, l) => s + l.tabs.length, 0);
  $stats.textContent = nl ? `${plural(nt, 'tab')} in ${plural(nl, 'list')}` : '';
}

// Relative times ("5 minutes ago") go stale; refresh just the text.
setInterval(() => {
  const week = Date.now() - 7 * 86400e3;
  for (const l of state.lists) {
    if (l.time < week) continue;
    const m = state.cards.get(l.id)?.querySelector('.meta');
    if (m?.firstChild?.nodeType === 3) m.firstChild.textContent = metaText(l);
  }
}, 60e3);

// ---------------------------------------------------------------- storage sync

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let all = false;
  for (const [k, c] of Object.entries(changes)) {
    if (k === 'opts') {
      const prev = state.opts;
      state.opts = { ...S.DEFAULTS, ...(c.newValue || {}) };
      applyTheme(state.opts);
      if (prev.display !== state.opts.display || prev.remoteIcons !== state.opts.remoteIcons) all = true;
      syncSettings();
      continue;
    }
    if (!S.isListKey(k)) continue;
    const id = k.slice(2), nv = c.newValue;
    if (nv && Array.isArray(nv.tabs)) {
      state.byId.set(id, nv);
      if (!all) renderCard(nv);
    } else if (state.byId.has(id)) {
      state.byId.delete(id);
      state.cards.get(id)?.remove();
      state.cards.delete(id);
    }
  }
  state.lists = [...state.byId.values()].sort(S.byPos);
  if (all) return renderAll();
  placeCards(); // also inserts cards for newly added lists
  updateChrome();
  if (state.terms.length) applySearch();
});

// ---------------------------------------------------------------- actions

const copy = (text, msg) => navigator.clipboard.writeText(text).then(() => toast(msg, { ms: 2000 }), () => toast('Could not copy'));

async function currentWindowId() {
  return (await api.windows.getCurrent()).id;
}

async function restore(l, newWindow) {
  const r = await A.restoreList(l.id, { newWindow, windowId: await currentWindowId() });
  if (r.failed.length) toast(`${plural(r.failed.length, 'tab')} could not be opened and stayed in the list`);
}

const indexOfTab = (list, i, url) => (list.tabs[i]?.url === url ? i : list.tabs.findIndex((x) => x.url === url));

async function openRow(l, i, background) {
  const t = l.tabs[i];
  if (!t) return;
  if (!S.isOpenable(t.url)) return toast('Browsers do not let extensions open this kind of address');
  try {
    await api.tabs.create({ url: t.url, active: !background });
  } catch {
    return toast('Could not open this address');
  }
  if (state.opts.itemClick === 'open-remove' && !l.pinned) {
    await S.updateList(l.id, (x) => { const j = indexOfTab(x, i, t.url); if (j >= 0) x.tabs.splice(j, 1); });
  }
}

async function removeTab(l, i) {
  const t = l.tabs[i];
  if (!t) return;
  const snap = structuredClone(l);
  await S.updateList(l.id, (x) => { const j = indexOfTab(x, i, t.url); if (j >= 0) x.tabs.splice(j, 1); });
  toast('Tab removed', { undo: () => S.putList(snap) });
}

async function deleteList(l) {
  if (state.opts.confirmDelete && !(await confirmBox(`Delete “${nameOf(l)}”? It has ${plural(l.tabs.length, 'tab')}.`))) return;
  const snap = structuredClone(l);
  await S.removeLists([l.id]);
  toast(`Deleted “${nameOf(snap)}”`, { undo: () => S.putList(snap) });
}

// Position for putting list `id` at `index` among the other lists. null = no room left.
function posAt(id, index) {
  const arr = state.lists.filter((x) => x.id !== id);
  index = Math.max(0, Math.min(index, arr.length));
  const prev = arr[index - 1], next = arr[index];
  const pos = prev && next ? (prev.pos + next.pos) / 2 : next ? next.pos - 1 : prev ? prev.pos + 1 : 0;
  if (prev && next && !(pos > prev.pos && pos < next.pos)) return null;
  return pos;
}

async function moveListTo(id, index) {
  const pos = posAt(id, index);
  if (pos != null) return S.updateList(id, (x) => { x.pos = pos; });
  // Positions got too close after many moves: renumber everything once.
  const arr = state.lists.filter((x) => x.id !== id);
  arr.splice(index, 0, state.byId.get(id));
  await S.putLists(arr.map((x, i) => ({ ...x, pos: i })));
}

// Move tab i of list `fromId` to position j in `toId` (null = a new list).
async function moveTab(fromId, i, toId, j) {
  const src = structuredClone(state.byId.get(fromId));
  if (!src) return;
  const [t] = src.tabs.splice(i, 1);
  if (!t) return;
  if (toId === null) {
    await S.putList(S.makeList([t]));
    return S.commit([src]);
  }
  const dst = toId === fromId ? src : structuredClone(state.byId.get(toId));
  if (!dst) return;
  if (toId === fromId && j > i) j--;
  dst.tabs.splice(Math.min(j, dst.tabs.length), 0, t);
  await S.commit(toId === fromId ? [src] : [dst, src]);
}

async function mergeInto(src, dstId) {
  const dst = state.byId.get(dstId);
  if (!dst) return;
  const snaps = [structuredClone(src), structuredClone(dst)];
  const next = structuredClone(dst);
  next.tabs.push(...src.tabs);
  if (state.opts.dedupe) next.tabs = S.dedupe(next.tabs);
  await S.commit([next]);
  await S.removeLists([src.id]);
  toast(`Merged into “${nameOf(dst)}”`, { undo: () => S.putLists(snaps) });
}

function startRename(l) {
  const card = state.cards.get(l.id);
  const title = card?.querySelector('.title');
  if (!title) return;
  const input = h('input', { class: 'title-in', value: l.title, placeholder: 'Name this list', maxLength: 300, attrs: { 'aria-label': 'List name' } });
  title.replaceWith(input);
  card.querySelector('.card-h').draggable = false;
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (save && v !== l.title) await S.updateList(l.id, (x) => { x.title = v; });
    else { const cur = state.byId.get(l.id); if (cur) renderCard(cur); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

// A menu that lets the user pick a list (with a filter box when there are many).
function pickList(at, excludeId, heading, onPick, { allowNew = false } = {}) {
  const lists = state.lists.filter((x) => x.id !== excludeId);
  const box = h('div', { class: 'pick' });
  const btns = [];
  if (allowNew) btns.push(h('button', { class: 'mi', onclick: () => { closeMenu(); onPick(null); } }, icon('plus'), h('span', null, 'New list')));
  for (const l of lists) {
    const b = h('button', { class: 'mi', onclick: () => { closeMenu(); onPick(l.id); } },
      h('span', { class: 'dot', dataset: { color: l.color || '' } }),
      h('span', { class: 'pick-name' }, nameOf(l), h('small', null, l.title ? plural(l.tabs.length, 'tab') : fmtDate(l.time))));
    b.dataset.hay = (l.title + ' ' + l.tabs.slice(0, 50).map((t) => t.title).join(' ')).toLowerCase();
    btns.push(b);
  }
  box.append(...btns);
  const items = [{ node: h('div', { class: 'menu-h' }, heading) }];
  if (lists.length > 8) {
    const f = h('input', { class: 'menu-filter', type: 'search', placeholder: 'Filter lists', attrs: { 'aria-label': 'Filter lists' } });
    f.addEventListener('input', () => {
      const q = f.value.toLowerCase().trim();
      for (const b of btns) if (b.dataset.hay) b.hidden = q && !b.dataset.hay.includes(q);
    });
    items.push({ node: f });
  }
  items.push({ node: box });
  openMenu(at, items);
}

function colorMenu(l, at) {
  const grid = h('div', { class: 'swatches' }, S.COLORS.map((c) =>
    h('button', {
      class: 'sw' + (c === (l.color || '') ? ' on' : ''), dataset: { color: c }, title: c || 'No color', attrs: { 'aria-label': c || 'No color' },
      onclick: () => { closeMenu(); S.updateList(l.id, (x) => { x.color = c; }); },
    })));
  openMenu(at, [{ node: h('div', { class: 'menu-h' }, 'Color') }, { node: grid }]);
}

function listMenu(l, el) {
  const idx = state.lists.findIndex((x) => x.id === l.id);
  const dupes = l.tabs.length - S.dedupe(l.tabs).length;
  openMenu(el, [
    { label: 'Rename', icon: 'pencil', run: () => startRename(l) },
    { label: 'Color…', icon: 'palette', run: () => colorMenu(l, el) },
    { sep: true },
    { label: 'Move to top', icon: 'up', disabled: idx === 0, run: () => moveListTo(l.id, 0) },
    { label: 'Move to bottom', icon: 'down', disabled: idx === state.lists.length - 1, run: () => moveListTo(l.id, state.lists.length - 1) },
    { label: 'Merge into…', icon: 'merge', disabled: state.lists.length < 2, run: () => pickList(el, l.id, 'Merge into', (to) => mergeInto(l, to)) },
    {
      label: dupes ? `Remove ${dupes === 1 ? '1 duplicate' : dupes + ' duplicates'}` : 'No duplicates', icon: 'dedupe', disabled: !dupes,
      run: async () => { const snap = structuredClone(l); await S.updateList(l.id, (x) => { x.tabs = S.dedupe(x.tabs); }); toast('Duplicates removed', { undo: () => S.putList(snap) }); },
    },
    { sep: true },
    { label: 'Copy links', icon: 'copy', run: () => copy(l.tabs.map((t) => t.url).join('\n'), 'Links copied') },
    { label: 'Copy as Markdown', icon: 'copy', run: () => copy(IO.toMarkdown(l), 'Markdown copied') },
    { sep: true },
    { label: 'Delete list', icon: 'trash', danger: true, run: () => deleteList(l) },
  ]);
}

function doAct(act, l, el) {
  switch (act) {
    case 'toggle': return S.updateList(l.id, (x) => { x.expand = !x.expand; });
    case 'rename': return startRename(l);
    case 'restore': return restore(l, false);
    case 'restore-window': return restore(l, true);
    case 'lock': return S.updateList(l.id, (x) => { x.pinned = !x.pinned; });
    case 'menu': return listMenu(l, el);
    case 'remove-tab': return removeTab(l, +el.closest('.tab').dataset.i);
  }
}

const ctxOf = (target) => {
  const card = target.closest?.('.card');
  const l = card && state.byId.get(card.dataset.id);
  return l ? { card, l } : null;
};

$lists.addEventListener('click', (e) => {
  const c = ctxOf(e.target);
  if (!c) return;
  const act = e.target.closest('[data-act]');
  if (act) { e.preventDefault(); doAct(act.dataset.act, c.l, act); return; }
  const link = e.target.closest('.link');
  if (link) {
    e.preventDefault();
    openRow(c.l, +link.closest('.tab').dataset.i, e.ctrlKey || e.metaKey || e.shiftKey);
    return;
  }
  if (e.target.closest('.card-h') && !e.target.closest('button, input')) doAct('toggle', c.l);
});

// Middle click: open in the background.
$lists.addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;
  const link = e.target.closest('.link');
  const c = link && ctxOf(link);
  if (!c) return;
  e.preventDefault();
  openRow(c.l, +link.closest('.tab').dataset.i, true);
});

// Right-click a tab for more options (hold Shift for the browser's own menu).
$lists.addEventListener('contextmenu', (e) => {
  if (e.shiftKey) return;
  const row = e.target.closest('.tab');
  const c = row && ctxOf(row);
  if (!c) return;
  e.preventDefault();
  const i = +row.dataset.i, t = c.l.tabs[i], at = { x: e.clientX, y: e.clientY };
  openMenu(at, [
    { label: 'Open', icon: 'open', run: () => openRow(c.l, i, false) },
    { label: 'Open in background', icon: 'restore', run: () => openRow(c.l, i, true) },
    { sep: true },
    { label: 'Copy link', icon: 'copy', run: () => copy(t.url, 'Link copied') },
    { label: 'Copy title', icon: 'copy', run: () => copy(t.title, 'Title copied') },
    { label: 'Move to…', icon: 'merge', run: () => pickList(at, c.l.id, 'Move tab to', (to) => moveTab(c.l.id, i, to, Infinity), { allowNew: true }) },
    { sep: true },
    { label: 'Remove', icon: 'trash', danger: true, run: () => removeTab(c.l, i) },
  ]);
});

// ---------------------------------------------------------------- drag and drop

let drag = null, mark = null, markCls = '';
function setMark(el, cls) {
  if (mark === el && markCls === cls) return;
  clearMark();
  mark = el; markCls = cls;
  el.classList.add(cls);
}
function clearMark() {
  mark?.classList.remove(markCls);
  mark = null; markCls = '';
}

$lists.addEventListener('dragstart', (e) => {
  const c = ctxOf(e.target);
  if (!c) return;
  const row = e.target.closest('.tab');
  if (row) {
    const i = +row.dataset.i, t = c.l.tabs[i];
    drag = { kind: 'tab', from: c.l.id, i };
    e.dataTransfer.effectAllowed = 'copyMove';
    // Lets you drop a saved tab onto the tab bar to open it.
    e.dataTransfer.setData('text/uri-list', t.url);
    e.dataTransfer.setData('text/plain', t.url);
    row.classList.add('dragging');
  } else if (e.target.closest('.card-h')) {
    drag = { kind: 'list', id: c.l.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', nameOf(c.l));
    c.card.classList.add('dragging');
  }
});

$lists.addEventListener('dragover', (e) => {
  if (!drag) return;
  const card = e.target.closest('.card');
  if (!card) return clearMark();
  if (drag.kind === 'tab') {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest('.tab');
    if (row && !card.classList.contains('collapsed')) {
      const r = row.getBoundingClientRect();
      setMark(row, e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    } else setMark(card, 'drop-into');
  } else {
    if (card.dataset.id === drag.id) return clearMark();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = card.getBoundingClientRect();
    setMark(card, e.clientY < r.top + Math.min(r.height / 2, 48) ? 'drop-before' : 'drop-after');
  }
});

$lists.addEventListener('dragleave', (e) => { if (!$lists.contains(e.relatedTarget)) clearMark(); });

$lists.addEventListener('drop', async (e) => {
  if (!drag || !mark) return;
  e.preventDefault();
  const d = drag, m = mark, cls = markCls;
  clearMark();
  const toId = m.closest('.card').dataset.id;
  if (d.kind === 'tab') {
    let j = cls === 'drop-into' ? Infinity : +m.dataset.i + (cls === 'drop-after' ? 1 : 0);
    if (toId === d.from && (j === d.i || j === d.i + 1)) return;
    if (j === Infinity) j = state.byId.get(toId)?.tabs.length ?? 0;
    await moveTab(d.from, d.i, toId, j);
  } else {
    const arr = state.lists.filter((x) => x.id !== d.id);
    await moveListTo(d.id, arr.findIndex((x) => x.id === toId) + (cls === 'drop-after' ? 1 : 0));
  }
});

$lists.addEventListener('dragend', () => {
  clearMark();
  drag = null;
  for (const x of document.querySelectorAll('.dragging')) x.classList.remove('dragging');
});

// ---------------------------------------------------------------- search

function collectRanges(card, terms, out) {
  const nodes = card.querySelectorAll('.title, .tab:not([hidden]) .t, .tab:not([hidden]) .u');
  for (const el of nodes) {
    const node = el.firstChild;
    if (!node || node.nodeType !== 3) continue;
    const text = node.data.toLowerCase();
    for (const term of terms) {
      let at = text.indexOf(term);
      while (at >= 0 && out.length < 3000) {
        const r = new Range();
        r.setStart(node, Math.min(at, node.length));
        r.setEnd(node, Math.min(at + term.length, node.length));
        out.push(r);
        at = text.indexOf(term, at + term.length);
      }
    }
  }
}

function applySearch() {
  const terms = state.terms, on = terms.length > 0;
  document.body.classList.toggle('searching', on);
  const hl = globalThis.CSS?.highlights;
  hl?.delete('q');
  if (on) ensureAllCards();
  let nt = 0, nl = 0;
  const ranges = [];
  for (const l of state.lists) {
    const card = state.cards.get(l.id);
    if (!card) continue;
    if (!on) {
      card.hidden = false;
      for (const r of card.querySelectorAll('.tab[hidden]')) r.hidden = false;
      continue;
    }
    const titleHit = !!l.title && terms.every((t) => l.title.toLowerCase().includes(t));
    const match = titleHit ? null : l.tabs.map((t) => terms.every((x) => t.title.toLowerCase().includes(x) || t.url.toLowerCase().includes(x)));
    const hits = titleHit ? l.tabs.length : match.reduce((s, m) => s + m, 0);
    card.hidden = hits === 0;
    if (hits) {
      fillRows(card, l); // only lists with matches get their rows built
      const rows = card.querySelector('.tabs').children;
      for (let i = 0; i < rows.length; i++) rows[i].hidden = !titleHit && !match[i];
    }
    if (hits) {
      nl++; nt += hits;
      if (hl && ranges.length < 3000) collectRanges(card, terms, ranges);
    }
  }
  if (hl && ranges.length && typeof Highlight === 'function') hl.set('q', new Highlight(...ranges));
  $('no-results').hidden = !on || nl > 0;
  if (on) $stats.textContent = `${nt === 1 ? '1 match' : nt.toLocaleString() + ' matches'} in ${plural(nl, 'list')}`;
  else updateChrome();
}

const runSearch = debounce(() => {
  state.terms = $q.value.toLowerCase().split(/\s+/).filter(Boolean);
  applySearch();
}, 120);
$q.addEventListener('input', runSearch);
$q.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $q.value) { e.preventDefault(); $q.value = ''; runSearch(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  $q.focus();
  $q.select();
});

// ---------------------------------------------------------------- settings

const SETTINGS = [
  { group: 'Toolbar button' },
  { key: 'action', label: 'When I click the toolbar button', choices: [['popup', 'Show the menu'], ['save-window', 'Save all tabs in this window'], ['save-selected', 'Save the selected tabs'], ['open-lists', 'Show saved lists']] },
  { group: 'Saving tabs' },
  { key: 'showAfterSave', label: 'Show the lists after saving all tabs' },
  { key: 'skipPinned', label: 'Leave pinned tabs open' },
  { key: 'dedupe', label: 'Skip duplicate tabs within a list' },
  { key: 'lockNew', label: 'Lock new lists', note: 'Locked lists stay after you restore them.' },
  { key: 'pageMenu', label: 'Add Tabstash to the right-click menu on web pages' },
  { group: 'Opening tabs' },
  { key: 'itemClick', label: 'When I click a saved tab', choices: [['open-remove', 'Open it and remove it from the list'], ['open', 'Open it and keep it']] },
  { key: 'popupClick', label: 'When I click a list in the toolbar menu', choices: [['restore', 'Restore it in this window'], ['restore-window', 'Restore it in a new window']] },
  { key: 'restorePos', label: 'Put restored tabs', choices: [['end', 'At the end of the tab bar'], ['after', 'Next to the current tab']] },
  { key: 'lazyRestore', label: 'Load restored tabs only when I switch to them', note: 'Restoring 100 tabs stays fast and light on memory.', ff: true },
  { key: 'confirmDelete', label: 'Ask before deleting a list', note: 'Off: you can undo a delete for a few seconds.' },
  { group: 'Appearance' },
  { key: 'theme', label: 'Theme', choices: [['system', 'Match the system'], ['light', 'Light'], ['dark', 'Dark']] },
  { key: 'density', label: 'Spacing', choices: [['comfortable', 'Comfortable'], ['compact', 'Compact']] },
  { key: 'display', label: 'Show for each tab', choices: [['both', 'Title and address'], ['title', 'Title only'], ['url', 'Address only']] },
  { key: 'remoteIcons', label: 'Load site icons from the websites', note: 'Off by default: no network requests at all, letter icons instead. On: each site sees your IP address whenever this page shows its icon.', ff: true },
];

let settingsBuilt = false;
function buildSettings() {
  const body = $('settings-body');
  body.replaceChildren(h('div', { class: 'privacy' }, icon('shield'), h('div', null,
    h('b', null, 'Private by design. '),
    'Tabstash never connects to the internet: no analytics, no crash reports, no accounts, no sync servers. Your lists are stored only in this browser profile. Tabs in private windows are never saved.')));
  for (const s of SETTINGS) {
    if (s.ff && !isFirefox) continue;
    if (s.group) { body.append(h('h3', null, s.group)); continue; }
    const label = h('span', null, s.label, s.note ? h('small', null, s.note) : null);
    let ctl;
    if (s.choices) {
      ctl = h('select', { id: 'opt-' + s.key }, s.choices.map(([v, t]) => h('option', { value: v }, t)));
      ctl.addEventListener('change', () => saveOpt(s.key, ctl.value));
    } else {
      ctl = h('input', { type: 'checkbox', class: 'switch', id: 'opt-' + s.key });
      ctl.addEventListener('change', () => saveOpt(s.key, ctl.checked));
    }
    body.append(h('label', { class: 'opt' + (s.choices ? '' : ' check') }, label, ctl));
  }
  body.append(h('h3', null, 'Keyboard shortcuts'));
  const shortcuts = h('p', { class: 'muted' }, isFirefox
    ? 'Set shortcuts in Add-ons and themes → ⚙ → Manage Extension Shortcuts.'
    : 'Set shortcuts at chrome://extensions/shortcuts.');
  body.append(shortcuts);
  if (typeof api.commands?.openShortcutSettings === 'function') {
    body.append(h('button', { class: 'btn ghost', onclick: () => api.commands.openShortcutSettings() }, 'Open shortcut settings'));
  }
  const bytes = new Blob([JSON.stringify(state.lists)]).size;
  body.append(h('p', { class: 'muted foot' }, `Version ${api.runtime.getManifest().version} · ${(bytes / 1048576).toFixed(bytes < 1048576 ? 2 : 1)} MB of saved data`));
  settingsBuilt = true;
  syncSettings();
}
function syncSettings() {
  if (!settingsBuilt) return;
  for (const s of SETTINGS) {
    const el = $('opt-' + s.key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!state.opts[s.key];
    else el.value = state.opts[s.key];
  }
}
async function saveOpt(k, v) {
  await S.setOpts({ [k]: v });
  toast('Saved', { ms: 1500 });
}

function openDialog(id) {
  const d = $(id);
  if (id === 'dlg-settings') buildSettings();
  if (!d.open) d.showModal();
}
for (const d of document.querySelectorAll('dialog.dlg')) {
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  d.addEventListener('close', () => { if (location.hash) history.replaceState(null, '', location.pathname); });
}
$('btn-settings').addEventListener('click', () => openDialog('dlg-settings'));
$('btn-io').addEventListener('click', () => openDialog('dlg-io'));
$('btn-empty-import').addEventListener('click', () => openDialog('dlg-io'));
addEventListener('hashchange', () => { if (location.hash === '#settings') openDialog('dlg-settings'); });

// ---------------------------------------------------------------- import / export

const stamp = () => new Date().toISOString().slice(0, 10);
$('exp-json').addEventListener('click', () => download(IO.toJSON(state.lists), `tabstash-backup-${stamp()}.json`, 'application/json'));
$('exp-text').addEventListener('click', () => download(IO.toOneTab(state.lists), `onetab-export-${stamp()}.txt`, 'text/plain'));
$('exp-copy').addEventListener('click', () => copy(IO.toOneTab(state.lists), 'Copied all lists as OneTab text'));

async function doImport(text) {
  const msg = $('imp-msg');
  try {
    const lists = IO.parseImport(text);
    await S.putLists(lists);
    const nt = lists.reduce((s, l) => s + l.tabs.length, 0);
    msg.textContent = `Imported ${plural(lists.length, 'list')} with ${plural(nt, 'tab')}.`;
    $('imp-text').value = '';
  } catch (err) {
    msg.textContent = err.message || 'Import failed';
  }
}
$('imp-go').addEventListener('click', () => doImport($('imp-text').value));
$('imp-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 200 * 1048576) { $('imp-msg').textContent = 'That file is too large.'; return; }
  doImport(await f.text());
});

// ---------------------------------------------------------------- start

const all = await api.storage.local.get(null);
state.opts = { ...S.DEFAULTS, ...(all.opts || {}) };
state.lists = S.listsFrom(all);
for (const l of state.lists) state.byId.set(l.id, l);
applyTheme(state.opts);
renderAll();
if (location.hash === '#settings') openDialog('dlg-settings');
