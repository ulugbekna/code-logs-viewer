# Code Logs Viewer

A VS Code extension that opens VS Code Output-pane style log files (`*.out.md`, `*.log`) in a rich webview with filtering, search, and a timeline.

## Features

- **Faceted filters**: level (error / warning / info / …) and source/component, multi-select with live counts.
- **Search**: text or regex, with case / whole-word toggles, match counter, and `Enter` / `Shift+Enter` to jump between matches.
- **Timeline minimap**: density bars colored by log level. Drag to brush a time range; double-click to clear.
- **Grouped entries**: multi-line continuations (stack traces, JSON blobs) collapse under their header. JSON bodies are pretty-printed with collapsible nodes.
- **Copy filtered**: copies only the currently visible entries to the clipboard in the original log format.
- **Live tail**: the file is watched and updates re-parse automatically.
- **Virtualized list**: smooth scrolling for large files.

## Usage

1. Open or right-click a `*.out.md` or `*.log` file.
2. Run **Logs: Open with Log Viewer** from the command palette, the editor title menu, or the Explorer context menu.

## Keyboard shortcuts (in the viewer)

- `Cmd/Ctrl+F` — focus search
- `Enter` / `Shift+Enter` — next / previous match
- `Esc` — clear search

## Log format

Headers of the form `YYYY-MM-DD HH:MM:SS.mmm [level] [Source] message` are parsed as entries. Subsequent lines that don't match this pattern attach to the previous entry as its body.
