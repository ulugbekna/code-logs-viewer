import { randomBytes } from 'crypto';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { HostToWebview, WebviewToHost } from '../shared/types';
import { parseLog } from './parser';

export function activate(context: vscode.ExtensionContext) {
	const manager = new LogViewerManager(context);
	context.subscriptions.push(
		vscode.commands.registerCommand('code-logs-viewer.open', async (uri?: vscode.Uri) => {
			const target = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (!target) {
				void vscode.window.showErrorMessage('No file selected to open in Log Viewer.');
				return;
			}
			await manager.open(target);
		}),
		vscode.commands.registerCommand('code-logs-viewer.showVSCodeLog', async () => {
			const picked = await pickVSCodeLogFile(context);
			if (picked) { await manager.open(picked); }
		}),
	);
}

// `context.logUri` is `<logs>/<session>/exthost/<publisher.ext>`; the session
// folder (sibling folders: exthost, renderer, main, ptyhost, ...) is two levels up.
function getSessionLogsRoot(context: vscode.ExtensionContext): vscode.Uri {
	return vscode.Uri.joinPath(context.logUri, '..', '..');
}

async function collectLogFiles(root: vscode.Uri): Promise<vscode.Uri[]> {
	const results: vscode.Uri[] = [];
	async function walk(dir: vscode.Uri): Promise<void> {
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(dir);
		} catch {
			return;
		}
		await Promise.all(entries.map(async ([name, type]) => {
			const child = vscode.Uri.joinPath(dir, name);
			if (type & vscode.FileType.Directory) {
				await walk(child);
			} else if (type & vscode.FileType.File) {
				if (name.toLowerCase().endsWith('.log')) { results.push(child); }
			}
		}));
	}
	await walk(root);
	return results;
}

async function pickVSCodeLogFile(context: vscode.ExtensionContext): Promise<vscode.Uri | undefined> {
	const root = getSessionLogsRoot(context);
	const files = await collectLogFiles(root);
	if (files.length === 0) {
		void vscode.window.showInformationMessage(`No .log files found under ${root.fsPath}.`);
		return undefined;
	}
	const rootPath = root.fsPath + path.sep;
	const items = files
		.map(uri => {
			const rel = uri.fsPath.startsWith(rootPath) ? uri.fsPath.slice(rootPath.length) : uri.fsPath;
			const parts = rel.split(path.sep);
			const label = parts[parts.length - 1];
			const description = parts.slice(0, -1).join(path.sep);
			return { label, description, uri };
		})
		.sort((a, b) => (a.description + '/' + a.label).localeCompare(b.description + '/' + b.label));
	const choice = await vscode.window.showQuickPick(items, {
		title: 'Open VS Code Log',
		placeHolder: 'Select a .log file from the current session',
		matchOnDescription: true,
	});
	return choice?.uri;
}

export function deactivate() { /* no-op */ }

class LogViewerManager {
	private readonly panels = new Map<string, LogViewerPanel>();
	constructor(private readonly context: vscode.ExtensionContext) { }

	async open(uri: vscode.Uri): Promise<void> {
		const key = uri.toString();
		const existing = this.panels.get(key);
		if (existing) { existing.reveal(); return; }
		const panel = await LogViewerPanel.create(this.context, uri);
		this.panels.set(key, panel);
		panel.onDidDispose(() => this.panels.delete(key));
	}
}

function findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
	const target = uri.toString();
	return vscode.workspace.textDocuments.find(d => d.uri.toString() === target);
}

function displayName(uri: vscode.Uri): string {
	if (uri.scheme !== 'file') {
		// For untitled / in-memory documents, prefer the user-facing title (e.g., "Untitled-1").
		const doc = findOpenDocument(uri);
		if (doc) { return doc.isUntitled ? doc.fileName : path.basename(doc.fileName); }
	}
	return path.basename(uri.fsPath);
}

class LogViewerPanel {
	static async create(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<LogViewerPanel> {
		const panel = vscode.window.createWebviewPanel(
			'codeLogsViewer',
			displayName(uri),
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(context.extensionUri, 'dist'),
					vscode.Uri.joinPath(context.extensionUri, 'media'),
				],
			},
		);
		const inst = new LogViewerPanel(context, panel, uri);
		await inst.refresh();
		return inst;
	}

	private readonly disposables: vscode.Disposable[] = [];
	private readonly disposeEmitter = new vscode.EventEmitter<void>();
	readonly onDidDispose = this.disposeEmitter.event;

	private constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly panel: vscode.WebviewPanel,
		private readonly uri: vscode.Uri,
	) {
		panel.webview.html = this.getHtml();
		panel.onDidDispose(() => this.dispose(), null, this.disposables);
		panel.webview.onDidReceiveMessage((msg: WebviewToHost) => this.onMessage(msg), null, this.disposables);

		if (uri.scheme === 'file') {
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath)),
			);
			this.disposables.push(watcher);
			// Debounce: trace channels can flush many times per second.
			watcher.onDidChange(() => this.scheduleRefresh(), null, this.disposables);
		} else {
			// Untitled / in-memory documents: react to in-editor edits and to the
			// document being closed (e.g., user discards the untitled buffer).
			// Coalesce rapid edits so a paste of a large log doesn't trigger
			// one parse per character.
			vscode.workspace.onDidChangeTextDocument(e => {
				if (e.document.uri.toString() === this.uri.toString()) {
					this.scheduleRefresh();
				}
			}, null, this.disposables);
			vscode.workspace.onDidCloseTextDocument(doc => {
				if (doc.uri.toString() === this.uri.toString()) {
					this.panel.dispose();
				}
			}, null, this.disposables);
		}
	}

	reveal(): void { this.panel.reveal(); }

	dispose(): void {
		this.disposeEmitter.fire();
		if (this.refreshTimer !== undefined) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
		while (this.disposables.length) {
			try { this.disposables.pop()?.dispose(); } catch (err) { console.error('LogViewerPanel: dispose error', err); }
		}
	}

	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private static readonly REFRESH_DEBOUNCE_MS = 150;
	private scheduleRefresh(): void {
		if (this.refreshTimer !== undefined) { clearTimeout(this.refreshTimer); }
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refresh(true);
		}, LogViewerPanel.REFRESH_DEBOUNCE_MS);
	}

	// Streaming state for file-backed logs: lets us read only the appended tail
	// when the file grows rather than re-parsing the entire log on every flush.
	private streamSize = 0;        // bytes already consumed and parsed
	private streamHead = '';       // first ~256 bytes seen; used as a cheap "is this still the same file?" check
	private static readonly HEAD_PROBE_BYTES = 256;
	// Matches the leading timestamp of `parser.ts`'s HEADER_RE. Kept in sync there.
	private static readonly HEADER_PREFIX_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \[/;
	private nextEntryId = 0;

	private async refresh(isUpdate = false): Promise<void> {
		if (this.uri.scheme === 'file' && isUpdate) {
			const appended = await this.tryReadAppendedTail();
			if (appended !== undefined) {
				const entries = parseLog(appended);
				if (entries.length === 0) { return; }
				// Re-number to be contiguous with the existing entries on the webview side.
				for (const e of entries) { e.id = this.nextEntryId++; }
				const message: HostToWebview = {
					type: 'append',
					entries,
					fileName: displayName(this.uri),
				};
				void this.panel.webview.postMessage(message);
				return;
			}
		}
		const text = await this.readText();
		const entries = parseLog(text);
		// Reset the id sequence so subsequent appends continue from the highest id+1.
		this.nextEntryId = entries.length > 0 ? entries[entries.length - 1].id + 1 : 0;
		const message: HostToWebview = {
			type: isUpdate ? 'update' : 'init',
			entries,
			fileName: displayName(this.uri),
		};
		void this.panel.webview.postMessage(message);
	}

	/**
	 * If the file has only grown since the last read and its prefix is unchanged,
	 * return just the appended bytes as text. Otherwise return `undefined` so the
	 * caller falls back to a full re-read.
	 *
	 * We hold back any trailing partial line (no terminating `\n`) and additionally
	 * reject tails that don't start with a log-entry header — those would be a
	 * continuation of an already-shipped entry's body, which `parseLog` can't
	 * reattach without the parent's state. The full-reparse fallback handles that.
	 */
	private async tryReadAppendedTail(): Promise<string | undefined> {
		if (this.uri.scheme !== 'file') { return undefined; }
		let fd: import('fs').promises.FileHandle | undefined;
		try {
			const stat = await fsp.stat(this.uri.fsPath);
			if (stat.size < this.streamSize) { return undefined; }    // truncated/rotated
			if (stat.size === this.streamSize) { return ''; }          // no growth
			fd = await fsp.open(this.uri.fsPath, 'r');
			// Cheap rotation check: head bytes unchanged.
			if (this.streamHead.length > 0) {
				const headLen = Math.min(LogViewerPanel.HEAD_PROBE_BYTES, stat.size);
				const headBuf = Buffer.allocUnsafe(headLen);
				await fd.read(headBuf, 0, headLen, 0);
				if (headBuf.toString('utf-8') !== this.streamHead) { return undefined; }
			}
			const remaining = stat.size - this.streamSize;
			const tailBuf = Buffer.allocUnsafe(remaining);
			const { bytesRead } = await fd.read(tailBuf, 0, remaining, this.streamSize);
			const usable = bytesRead < remaining ? tailBuf.subarray(0, bytesRead) : tailBuf;
			// Find last newline in raw bytes — newline (0x0A) is a single-byte UTF-8
			// code unit so this is also a safe text boundary.
			let lastNl = -1;
			for (let i = usable.length - 1; i >= 0; i--) {
				if (usable[i] === 0x0A) { lastNl = i; break; }
			}
			if (lastNl < 0) { return ''; }
			const completeBytes = usable.subarray(0, lastNl + 1);
			const complete = completeBytes.toString('utf-8');
			if (!LogViewerPanel.HEADER_PREFIX_RE.test(complete)) { return undefined; }
			this.streamSize += completeBytes.length;
			return complete;
		} catch {
			return undefined;
		} finally {
			if (fd) { try { await fd.close(); } catch { /* ignore */ } }
		}
	}

	private async readText(): Promise<string> {
		if (this.uri.scheme !== 'file') {
			const doc = findOpenDocument(this.uri);
			if (!doc) {
				throw new Error(`Document is no longer open: ${this.uri.toString()}`);
			}
			// Untitled docs are re-parsed in full; no streaming state to update.
			return doc.getText();
		}
		const bytes = await vscode.workspace.fs.readFile(this.uri);
		this.streamSize = bytes.byteLength;
		this.streamHead = new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(LogViewerPanel.HEAD_PROBE_BYTES, bytes.byteLength)));
		return new TextDecoder('utf-8').decode(bytes);
	}

	private onMessage(msg: WebviewToHost): void {
		switch (msg.type) {
			case 'reload':
				void this.refresh(true);
				return;
			case 'info':
				void vscode.window.showInformationMessage(msg.text);
				return;
		}
	}

	private getHtml(): string {
		const webview = this.panel.webview;
		const nonce = createNonce();
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css'));
		const csp = [
			`default-src 'none'`,
			`style-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
			`font-src ${webview.cspSource}`,
			`img-src ${webview.cspSource} data:`,
		].join('; ');
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>Log Viewer</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function createNonce(): string {
	// CSP nonce: 16 cryptographically random bytes (=128 bits) hex-encoded.
	return randomBytes(16).toString('hex');
}
