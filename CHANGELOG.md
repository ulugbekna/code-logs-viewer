# Change Log

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
