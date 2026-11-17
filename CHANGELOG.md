# Changelog

## 1.0.0 — Tabstash (2026-11-17)

Complete rewrite of Better OneTab 1.4.7, under a new name.

- Manifest V3 for Firefox and Chrome. No framework, no dependencies, no build tools. The package went from about 1.5 MB to 33 KB.
- Privacy: removed Google Analytics, Sentry crash reporting, the Google favicon service, the third-party sync server,
  Google Drive access, external messaging and the history permission. A strict security policy blocks all network access.
  Private windows are never touched.
- Storage: one key per list and float positions for ordering, so edits rewrite one list. Tabs are written before they are closed.
- Firefox: restored tabs load only when you switch to them. There's a menu on the tab bar, and Reader View addresses are unwrapped.
- Empty new-tab pages are closed together with a save.
- New: search highlighting across all lists, undo for deletions, merge lists, remove duplicates, drag lists to reorder,
  copy as Markdown, colors, light/dark/system theme, compact spacing.
- Kept: save selected/all/all windows/left/right/others, save into a named list, lock (pin) lists,
  OneTab text and Better OneTab JSON import/export (backups remain compatible).
- Dropped: Google Drive and server sync, paging, the "open lists on new tab" toggle, the German and Chinese translations.
