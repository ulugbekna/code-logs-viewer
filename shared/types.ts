// Types and constants shared between the extension host and the webview.
// Imported by both bundles (esbuild inlines on each side).

export const KNOWN_LEVELS = ['error', 'warning', 'info', 'debug', 'trace', 'log'] as const;
export type KnownLevel = typeof KNOWN_LEVELS[number];
export type LogLevel = KnownLevel | (string & {});

export interface LogEntry {
	id: number;
	ts: number;          // ms since epoch (parsed from local time)
	tsRaw: string;       // original timestamp text
	level: LogLevel;
	source?: string;
	message: string;
	body: string[];      // continuation lines (raw)
	bodyKind?: 'json' | 'text';
	groupStart?: string; // group label if message starts a group
	groupEnd?: boolean;
}

export type HostToWebview =
	| { type: 'init'; entries: LogEntry[]; fileName: string }
	| { type: 'update'; entries: LogEntry[]; fileName: string };

export type WebviewToHost =
	| { type: 'reload' }
	| { type: 'info'; text: string };
