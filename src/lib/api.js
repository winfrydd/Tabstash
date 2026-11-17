// Thin cross-browser layer. Firefox exposes `browser`, Chrome MV3 exposes promise-based `chrome`.
export const api = globalThis.browser ?? globalThis.chrome;
export const menus = api.menus ?? api.contextMenus;
export const isFirefox = typeof api.runtime.getBrowserInfo === 'function';
// Chrome's built-in favicon cache (no network). Only present in the Chrome build.
export const hasFaviconApi = (api.runtime.getManifest().permissions || []).includes('favicon');
export const appUrl = (p = '') => api.runtime.getURL(p);
