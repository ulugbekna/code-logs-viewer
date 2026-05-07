import * as path from 'path';
import * as vscode from 'vscode';
import { LogEntry, parseLog } from './parser';

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

type HostToWebview =
	| { type: 'init'; entries: LogEntry[]; fileName: string }
	| { type: 'update'; entries: LogEntry[]; fileName: string };

type WebviewToHost =
	| { type: 'reload' }
	| { type: 'info'; text: string };

class LogViewerPanel {
	static async create(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<LogViewerPanel> {
		const panel = vscode.window.createWebviewPanel(
			'codeLogsViewer',
			path.basename(uri.fsPath),
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

		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath)),
		);
		this.disposables.push(watcher);
		watcher.onDidChange(() => void this.refresh(true), null, this.disposables);
	}

	reveal(): void { this.panel.reveal(); }

	dispose(): void {
		this.disposeEmitter.fire();
		while (this.disposables.length) {
			try { this.disposables.pop()?.dispose(); } catch { /* ignore */ }
		}
	}

	private async refresh(isUpdate = false): Promise<void> {
		const bytes = await vscode.workspace.fs.readFile(this.uri);
		const text = new TextDecoder('utf-8').decode(bytes);
		const entries = parseLog(text);
		const message: HostToWebview = {
			type: isUpdate ? 'update' : 'init',
			entries,
			fileName: path.basename(this.uri.fsPath),
		};
		void this.panel.webview.postMessage(message);
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
			`style-src ${webview.cspSource} 'unsafe-inline'`,
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
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let out = '';
	for (let i = 0; i < 32; i++) { out += chars.charAt(Math.floor(Math.random() * chars.length)); }
	return out;
}
