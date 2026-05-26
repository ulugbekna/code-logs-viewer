# Change Log

## Unreleased

### Features

- **Logs: Show VS Code Log...** command — pick any `.log` file from the current window's VS Code logs folder (Window, Main, Renderer, Extension Host, and every `LogOutputChannel`) and open it directly in the viewer.

### Performance

- Live log files are now streamed incrementally: when a watched file grows, only the appended tail is read and parsed, and only the new entries are sent to the webview. Makes trace-level Output channels viable without re-parsing the whole file on every flush.
- File-watcher refreshes are debounced (~150 ms), matching the untitled-document path, so bursty writes don't trigger one parse per flush.

## 0.1.0

### Features

- Untitled/unsaved editors: invoke **Logs: Open with Log Viewer** on an in-memory document; the viewer re-renders on every edit (debounced).
- Pretty-print JSON embedded in log entries: click a body-less entry whose message contains a JSON blob to render it as an interactive collapsible tree. Right-click any entry for a "Pretty-print JSON" / "Show raw" toggle.
- Secondary "Within results…" search next to the main search box: AND-narrows visible rows on top of the primary search, respects the Highlight/Filter mode, and highlights both terms.
- Right-click context menu on log rows: **Copy selection**, **Copy entry**, **Copy message**, **Copy as JSON** (when JSON is extractable), plus the pretty-print toggle.
- Drag-to-select text in any row now works reliably — clicks no longer toggle the row while a selection is in progress, and the virtual list suspends recycling while the mouse button is held.

### UI

- Highlight / Filter segmented toggle moved to the leftmost position in the toolbar.

### Performance

- Cached per-entry text concatenation so search/filter recomputation isn't quadratic on body-heavy logs.
- Lazy-render JSON tree children: containers with >32 keys/items render collapsed and populate on first expand. Pretty-printing a giant blob no longer freezes the page.
- Minimap min/max computed in a single pass (avoids `RangeError: too many function arguments` on very large logs).
- Untitled-document refreshes are debounced (~150 ms) so a paste of a big log isn't re-parsed per keystroke.

### Correctness & state

- Persisted UI state has a version discriminator; mismatches reset to defaults to avoid silent semantic drift.
- `wrapAll` is now persisted along with the other toolbar toggles.
- The time-brush is cleared when a fresh file is opened (was silently filtering new logs to zero rows if the previously persisted range didn't overlap).
- Parser correctly classifies as JSON entries whose `{` opens on the header line.

### Security

- CSP `style-src` no longer includes `'unsafe-inline'`.
- Webview script nonce uses `crypto.randomBytes` (128 bits) instead of `Math.random`.

### Internal

- Shared types and pure helpers (`escape`, `search`, `jsonExtract`, `filter`) extracted into a top-level `shared/` module consumed by both the extension and the webview.
- Webview is now type-checked and linted in CI.
- Unit-test suite expanded to 51 tests covering the shared helpers and parser edge cases (BOM, CRLF, headerless prelude, multi-entry round-trip).

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
