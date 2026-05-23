# Change Log

## Unreleased

- Secondary "Within results…" search next to the main search box: AND-narrows visible rows on top of the primary search, respects the Highlight/Filter mode, and highlights both terms.
- Pretty-print JSON embedded in log entries: click a body-less entry whose message contains a JSON blob to render it as an interactive collapsible tree (instead of wrapping the long line). Right-click any entry for a "Pretty-print JSON" / "Show raw" toggle.
- Support untitled/unsaved editors: invoke **Logs: Open with Log Viewer** from the command palette on an in-memory document and the viewer re-renders on every edit.

## 0.0.4

- Search: Highlight / Filter segmented mode (default Highlight; matches stay in place).
- Wrap: toolbar wrap toggle and click-to-wrap on single-line entries.
- Larger fold caret.
- Stable scroll on expand/wrap (toggled row stays anchored on screen).
- Fix: scrollbar no longer flickers/snaps when scrolling with expanded entries (eliminated CSS scroll-anchoring feedback loop and unstable virtual-list spacers; switched to absolute positioning with explicit total height).
- Diagnostics button to copy renderer state for bug reports.

## 0.0.3

- Fold/unfold now toggles reliably on subsequent clicks.

## 0.0.2

- Every log entry is now expandable; rows without a body show a details panel (time, level, source, full message).
- Hover affordance on rows.

## 0.0.1

- Initial release.
