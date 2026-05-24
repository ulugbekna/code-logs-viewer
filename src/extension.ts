import { randomBytes } from 'crypto';
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
	);
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
			watcher.onDidChange(() => void this.refresh(true), null, this.disposables);
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

	private async refresh(isUpdate = false): Promise<void> {
		const text = await this.readText();
		const entries = parseLog(text);
		const message: HostToWebview = {
			type: isUpdate ? 'update' : 'init',
			entries,
			fileName: displayName(this.uri),
		};
		void this.panel.webview.postMessage(message);
	}

	private async readText(): Promise<string> {
		if (this.uri.scheme !== 'file') {
			const doc = findOpenDocument(this.uri);
			if (!doc) {
				throw new Error(`Document is no longer open: ${this.uri.toString()}`);
			}
			return doc.getText();
		}
		const bytes = await vscode.workspace.fs.readFile(this.uri);
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
