// Mock WebExtension API for UI testing outside the browser's extension system.
// Storage persists in localStorage so reloads and other tabs (popup) see the same data.
// URL flags: ?chrome=1 (pretend Chrome), ?reset=1 (fresh seed), ?n=500 (500 extra lists), ?empty=1
(() => {
  const q = new URLSearchParams(location.search);
  const KEY = '__mock_storage';
  const asChrome = q.has('chrome');
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const listeners = [];
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { store = {}; }

  const now = Date.now();
  const seedTabs = (pairs) => pairs.map(([url, title]) => ({ url, title }));
  function seed() {
    const s = {};
    const add = (id, l) => { s['l:' + id] = { id, tags: [], expand: true, color: '', pinned: false, updatedAt: now, ...l }; };
    add('a1', { title: 'Recipes', color: 'teal', pinned: true, time: now - 3 * 60e3, pos: -now + 1, tabs: seedTabs([
      ['https://en.wikipedia.org/wiki/Crème_brûlée', 'Crème brûlée - Wikipedia'],
      ['https://en.wikipedia.org/wiki/Ramen', 'Ramen (ラーメン) - Wikipedia'],
      ['https://en.wikipedia.org/wiki/Sourdough', 'Sourdough - Wikipedia'],
      ['https://example.org/recipes/pancakes?servings=4#steps', 'Pancakes — example recipe'],
    ]) });
    add('a2', { title: '', time: now - 5 * 3600e3, pos: -now + 2, tabs: seedTabs([
      ['https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create', 'tabs.create() - Mozilla | MDN'],
      ['https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API', 'CSS Custom Highlight API - Web APIs | MDN'],
      ['https://github.com/cnwangjie/better-onetab', 'cnwangjie/better-onetab: A better OneTab for Chrome'],
      ['https://github.com/cnwangjie/better-onetab', 'cnwangjie/better-onetab: A better OneTab for Chrome'],
      ['https://web.dev/articles/content-visibility', 'content-visibility: the new CSS property that boosts your rendering performance'],
      ['https://news.ycombinator.com/', 'Hacker News'],
      ['https://www.rust-lang.org/learn', 'Learn Rust - Rust Programming Language'],
    ]) });
    add('a3', { title: 'Reading list', color: 'purple', time: now - 4 * 86400e3, pos: -now + 3, tabs: seedTabs([
      ['https://en.wikipedia.org/wiki/Alan_Turing', 'Alan Turing - Wikipedia'],
      ['https://en.wikipedia.org/wiki/Ada_Lovelace', 'Ada Lovelace - Wikipedia'],
      ['https://en.wikipedia.org/wiki/Grace_Hopper', 'Grace Hopper - Wikipedia'],
      ['https://en.wikipedia.org/wiki/Unix', 'Unix - Wikipedia'],
    ]) });
    add('a4', { title: 'Old stuff', expand: false, time: now - 90 * 86400e3, pos: -now + 4, tabs: seedTabs(Array.from({ length: 24 }, (_, i) => [`https://example.com/article/${i + 1}`, `Archived article number ${i + 1}`])) });
    add('a5', { title: '', color: 'orange', time: now - 400 * 86400e3, pos: -now + 5, tabs: seedTabs([
      ['https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster', 'Why is processing a sorted array faster than an unsorted array? - Stack Overflow'],
      ['ftp://ftp.example.org/pub/', 'ftp.example.org'],
      ['https://a-very-long-domain-name-for-testing-overflow.example.net/some/really/long/path/that/keeps/going/and/going/forever?with=query&and=more', 'A page with an extremely long title that should be truncated nicely with an ellipsis instead of breaking the layout of the row'],
    ]) });
    const n = +q.get('n') || 0;
    for (let k = 0; k < n; k++) {
      add('big' + k, { title: k % 3 ? '' : 'Bulk list ' + k, time: now - (k + 10) * 86400e3, pos: -now + 10 + k, expand: k % 4 !== 0,
        tabs: seedTabs(Array.from({ length: 20 + (k % 40) }, (_, i) => [`https://site${(k * 7 + i) % 97}.example.com/page/${k}/${i}`, `Bulk page ${k}.${i} about topic ${(k * 13 + i) % 51}`])) });
    }
    return s;
  }
  if (q.has('reset') || !localStorage.getItem(KEY)) store = q.has('empty') ? {} : seed();
  const persist = () => localStorage.setItem(KEY, JSON.stringify(store));
  persist();

  const fire = (ch) => listeners.forEach((f) => { try { f(clone(ch), 'local'); } catch (e) { console.error(e); } });
  addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const next = JSON.parse(e.newValue || '{}'), ch = {};
    for (const k of new Set([...Object.keys(store), ...Object.keys(next)])) {
      if (JSON.stringify(store[k]) !== JSON.stringify(next[k])) ch[k] = { oldValue: store[k], newValue: next[k] };
    }
    store = next;
    if (Object.keys(ch).length) fire(ch);
  });

  const local = {
    async get(keys) {
      const ks = keys == null ? Object.keys(store) : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const o = {};
      for (const k of ks) if (k in store) o[k] = clone(store[k]);
      return o;
    },
    async set(obj) {
      const ch = {};
      for (const [k, v] of Object.entries(obj)) { ch[k] = { oldValue: store[k], newValue: clone(v) }; store[k] = clone(v); }
      persist(); setTimeout(() => fire(ch));
    },
    async remove(keys) {
      const ch = {};
      for (const k of [].concat(keys)) if (k in store) { ch[k] = { oldValue: store[k] }; delete store[k]; }
      persist(); setTimeout(() => fire(ch));
    },
  };

  // Fake window with some tabs.
  let nextId = 100;
  const tabs = [
    { id: 1, windowId: 1, index: 0, url: 'https://www.wikipedia.org/', title: 'Wikipedia', highlighted: false, active: false, pinned: true },
    { id: 2, windowId: 1, index: 1, url: 'https://example.com/a', title: 'Example A', highlighted: true, active: true, pinned: false },
    { id: 3, windowId: 1, index: 2, url: 'about:newtab', title: 'New Tab', highlighted: false, active: false, pinned: false },
    { id: 4, windowId: 1, index: 3, url: location.origin + '/lists.html', title: 'Tabstash', highlighted: false, active: false, pinned: false },
  ];
  window.__tabs = tabs; window.__created = [];
  const reindex = () => tabs.forEach((t, i) => { t.index = i; });
  const ok = (v) => Promise.resolve(v);
  const noop = () => {};
  const ev = () => ({ addListener: noop, removeListener: noop });

  const permissions = asChrome ? ['tabs', 'storage', 'contextMenus', 'favicon', 'unlimitedStorage'] : ['tabs', 'storage', 'menus'];
  const runtime = {
    id: 'mock-ext',
    getURL: (p = '') => location.origin + '/' + String(p).replace(/^\//, ''),
    getManifest: () => ({ version: '2.0.0-test', permissions }),
    sendMessage: async (m) => { console.log('[mock] sendMessage', m); window.__lastMessage = m; return { ok: true }; },
    onMessage: ev(), onInstalled: ev(), onStartup: ev(), lastError: undefined,
  };
  if (!asChrome) runtime.getBrowserInfo = () => ok({ name: 'Firefox', version: '145.0' });

  const api = {
    runtime,
    storage: { local, onChanged: { addListener: (f) => listeners.push(f), removeListener: noop } },
    tabs: {
      query: async (o = {}) => clone(tabs.filter((t) => (o.windowId == null || t.windowId === o.windowId) && (o.highlighted == null || t.highlighted === o.highlighted) && (o.active == null || t.active === o.active))),
      create: async (p) => {
        if (/^(about|chrome):/.test(p.url) && p.url !== 'about:blank') throw new Error('Illegal URL');
        const t = { id: nextId++, windowId: p.windowId ?? 1, url: p.url, title: p.title || p.url, highlighted: false, active: !!p.active, pinned: !!p.pinned, discarded: !!p.discarded };
        if (p.index != null) tabs.splice(p.index, 0, t); else tabs.push(t);
        reindex(); window.__created.push(clone(p));
        return clone(t);
      },
      update: async (id, p) => { const t = tabs.find((x) => x.id === id); if (t) Object.assign(t, p); return clone(t); },
      remove: async (ids) => { for (const id of [].concat(ids)) { const i = tabs.findIndex((t) => t.id === id); if (i >= 0) tabs.splice(i, 1); } reindex(); },
    },
    windows: {
      getCurrent: async () => ({ id: 1 }),
      getLastFocused: async () => ({ id: 1 }),
      getAll: async (o = {}) => [{ id: 1, tabs: o.populate ? clone(tabs) : undefined }],
      create: async (p) => { const t = { id: nextId++, windowId: 2, url: p.url, index: 0 }; window.__created.push({ newWindow: true, ...p }); return { id: 2, tabs: [t] }; },
      update: async () => ({}),
    },
    action: { setPopup: async () => {}, setTitle: async () => {}, onClicked: ev() },
    commands: { onCommand: ev() },
    i18n: { getMessage: (k) => k },
  };
  const m = { create: (p, cb) => { cb && cb(); return p.id; }, removeAll: async () => {}, onClicked: ev() };
  if (asChrome) { api.contextMenus = m; window.chrome = api; } else { api.menus = m; window.browser = api; }
})();
