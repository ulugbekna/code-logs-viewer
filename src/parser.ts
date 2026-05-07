// Parser for VS Code "Output pane" style log files.
//
// Each entry header looks like:
//   2026-05-07 18:50:28.239 [warning] [SourceComponent] message text
// The `[Source]` segment is optional. Lines that do not match the header regex
// are treated as continuation of the previous entry's body (e.g. JSON blobs,
// stack traces, indented sub-lines).

export type LogLevel = 'error' | 'warning' | 'info' | 'debug' | 'trace' | 'log' | string;

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

const HEADER_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[([A-Za-z]+)\](?: \[([^\]]+)\])? ?(.*)$/;
const GROUP_START_RE = /^---\s*Start of group:\s*(.*?)\s*---\s*$/;
const GROUP_END_RE = /^---\s*End of group\s*---\s*$/;

function parseTs(raw: string): number {
    // "YYYY-MM-DD HH:MM:SS.mmm" -> Date in local time
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(raw);
    if (!m) { return 0; }
    return new Date(
        Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7])
    ).getTime();
}

function detectBodyKind(body: string[]): 'json' | 'text' | undefined {
    if (body.length === 0) { return undefined; }
    const first = body.find(l => l.trim().length > 0)?.trim() ?? '';
    if (first.startsWith('{') || first.startsWith('[')) { return 'json'; }
    return 'text';
}

export function parseLog(text: string): LogEntry[] {
    // Strip BOM, normalize line endings.
    if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); }
    const lines = text.split(/\r?\n/);
    const entries: LogEntry[] = [];
    let current: LogEntry | undefined;
    let id = 0;

    for (const line of lines) {
        const m = HEADER_RE.exec(line);
        if (m) {
            if (current) {
                current.bodyKind = detectBodyKind(current.body);
                entries.push(current);
            }
            const tsRaw = m[1];
            const level = m[2].toLowerCase();
            const source = m[3];
            const message = m[4];
            current = {
                id: id++,
                ts: parseTs(tsRaw),
                tsRaw,
                level,
                source,
                message,
                body: [],
            };
            const gs = GROUP_START_RE.exec(message);
            if (gs) { current.groupStart = gs[1]; }
            else if (GROUP_END_RE.test(message)) { current.groupEnd = true; }
        } else {
            if (current) {
                // Skip a single trailing empty line after each entry from being
                // pushed as a meaningful body line — but keep them between content.
                current.body.push(line);
            } else if (line.trim().length > 0) {
                // Header-less prelude: synthesize a synthetic entry.
                current = {
                    id: id++,
                    ts: 0,
                    tsRaw: '',
                    level: 'log',
                    message: line,
                    body: [],
                };
            }
        }
    }
    if (current) {
        current.bodyKind = detectBodyKind(current.body);
        entries.push(current);
    }

    // Trim trailing all-empty body lines.
    for (const e of entries) {
        while (e.body.length > 0 && e.body[e.body.length - 1].trim() === '') {
            e.body.pop();
        }
    }
    return entries;
}

/** Re-serialize entries to their original text form (used by "Copy filtered"). */
export function serializeEntries(entries: ReadonlyArray<LogEntry>): string {
    const out: string[] = [];
    for (const e of entries) {
        const sourcePart = e.source ? ` [${e.source}]` : '';
        const head = e.tsRaw
            ? `${e.tsRaw} [${e.level}]${sourcePart} ${e.message}`
            : e.message;
        out.push(head);
        for (const b of e.body) { out.push(b); }
    }
    return out.join('\n');
}
