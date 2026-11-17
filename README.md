# Tabstash

Save your open tabs into lists and bring them back later. It's a private, modern rewrite of
[Better OneTab](https://github.com/cnwangjie/better-onetab) (MIT), which was abandoned in 2021 and archived in 2025.

- **Private.** It never connects to the internet: no analytics, no crash reports, no accounts, no sync servers.
  The extension's own security policy (`connect-src 'none'`) makes the browser block any network request, even by mistake.
- **Fast.** No framework and no dependencies. Each list is stored separately, so a change rewrites one list instead of everything.
  Tested with 79,000 tabs in 2,000 lists: the first screen appears at once and search takes about 20–50 ms.
- **Firefox first**, with Chrome supported. Manifest V3.

## Features

- Save the selected tabs, all tabs in a window, all windows, tabs to the left or right, or everything except the selection.
  You can do it from the toolbar menu, the right-click menu (on the tab bar in Firefox) or keyboard shortcuts.
- Save tabs into a named list you already have.
- Restore a list in the current window or in a new one. In Firefox, restored tabs only load when you switch to them, which stays fast with 100 tabs.
- Lock a list so it stays after restoring.
- Search every saved tab by title and address, with highlighted matches. Press `/` to start searching.
- Drag tabs between lists and drag lists to reorder them. You can also drop a saved tab on the tab bar to open it.
- Rename, color, merge, remove duplicates, copy links or Markdown.
- Undo after deleting a tab or a list.
- Light and dark themes that follow the system, plus a compact spacing option.
- Import from OneTab (text) and from Better OneTab or Tabstash (JSON). Export to both formats.
  Backups stay compatible with the original Better OneTab.

## Privacy audit of the original Better OneTab (v1.4.7)

These are the problems found in the original and how each one was fixed:

| Original behavior | Risk | Fix |
|---|---|---|
| Google Analytics (`UA-65598064-4`) in the background page. It sent page views, every command, every menu click and every settings change. | Usage tracking by Google | Removed |
| Sentry crash reporting to `sentry.io`. Every console message was attached as a "breadcrumb", including storage changes that contained **your saved tab URLs and titles**. | Browsing data sent to a third party | Removed |
| Missing icons were loaded from `google.com/s2/favicons?domain=…` | Google got the domain of every saved tab each time you opened the list | Removed. Firefox shows letter icons, and loading real icons is an opt-in setting. Chrome uses its own local icon cache. |
| A "sync server" at `boss.cnwangjie.com` received all your lists. A content script read a login token from that site. | Your tabs stored on a private person's server. If that domain expires and someone else buys it, they get the data. | Removed |
| Google Drive sync asked for the **full Drive scope** (`auth/drive`) | Read and write access to every file in your Drive | Removed |
| Security policy allowed `'unsafe-eval'` and scripts from `google-analytics.com` and `apis.google.com` | Remote code could run inside the extension | Strict MV3 policy: own scripts only, no network |
| `runtime.onMessageExternal` accepted commands from any other extension | Any extension could save or restore your tabs | Removed. Only the extension's own pages are listened to. |
| The `history` permission was used to add saved tabs to history | Access to your full browsing history | Feature and permission dropped |
| Ran in private windows if allowed | Private-browsing tabs written to disk | `"incognito": "not_allowed"`: private tabs are never touched |

Other hardening: tab titles and addresses are always inserted as plain text, never as HTML.
Imports drop `javascript:`, `data:` and `blob:` addresses and are size-limited.
Links open with no referrer.

Permissions used now: `tabs` (to read tab titles and addresses), `storage`, and `menus`/`contextMenus`.
Chrome also uses `favicon` (local icon cache) and `unlimitedStorage`. There are no host permissions.

## Install

### Firefox (permanent, self-signed through Mozilla)

1. Run `.\build.ps1`. It creates `dist\tabstash-firefox.zip`.
2. On [addons.mozilla.org/developers](https://addons.mozilla.org/developers/), choose **Submit a New Add-on**, then **On your own**, and upload the zip.
   It is signed automatically and is not listed publicly.
3. Download the signed `.xpi` and open it in Firefox.

For a quick try without signing, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick `src\manifest.json`.
It is removed again when Firefox restarts.

### Chrome / Edge / Brave

Run `.\build.ps1`, unzip `dist\tabstash-chrome.zip` to a folder, open `chrome://extensions`, turn on
**Developer mode**, click **Load unpacked**, and pick that folder.

### Moving your lists over

The new extension can't read another extension's storage, so move your lists by hand:

1. In OneTab, choose **Export URLs**. In Better OneTab, use **Export / Import → Export to JSON**.
2. In Tabstash, click the download icon at the top and paste the text or choose the file.

## Development

There is no build step and nothing to install. `src\` is the extension.

- UI test harness: `node test\server.js src 47841`, then open `http://127.0.0.1:47841/lists.html?reset=1`.
  It uses a mock browser API (`test\mock.js`) and enforces the extension's real security policy.
  URL flags: `?reset=1` loads fresh sample data, `?n=2000` adds 2000 bulk lists, `?chrome=1` pretends to be Chrome, `?empty=1` starts with no lists.
- Before a release, bump `version` in `src\manifest.json` and run `.\build.ps1`.

## License

MIT. See [LICENSE](LICENSE). Based on Better OneTab by Wang Jie.
Tabstash is not affiliated with OneTab or with the original Better OneTab. Those names are only used to describe import compatibility.
