// JSON extraction from a log entry's message/body. Pure, no DOM.

import type { LogEntry } from './types';

/**
 * Return the largest balanced JSON substring starting at `start` (inclusive)
 * of `s`, or undefined if none is found. Tracks string escapes correctly.
 */
export function sliceBalancedJson(s: string, start: number): string | undefined {
    const open = s[start];
    const close = open === '{' ? '}' : open === '[' ? ']' : '';
    if (!close) { return undefined; }
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (esc) { esc = false; continue; }
        if (inStr) {
            if (c === '\\') { esc = true; }
            else if (c === '"') { inStr = false; }
            continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === open) { depth++; }
        else if (c === close) {
            depth--;
            if (depth === 0) { return s.slice(start, i + 1); }
        }
    }
    return undefined;
}

/**
 * Find a JSON value embedded in an entry's body (preferred) or message.
 * Returns the parsed JS value or undefined if none was found.
 *
 * Pure: does not memoize. Callers that need caching should wrap this.
 */
export function computeExtractedJson(e: LogEntry): unknown | undefined {
    if (e.body.length > 0) {
        const joined = e.body.join('\n').trim();
        if (joined.startsWith('{') || joined.startsWith('[')) {
            try { return JSON.parse(joined); } catch { /* fall through */ }
        }
    }
    const msg = e.message;
    for (let i = 0; i < msg.length; i++) {
        const c = msg[i];
        if (c !== '{' && c !== '[') { continue; }
        const balanced = sliceBalancedJson(msg, i);
        if (!balanced) { continue; }
        try { return JSON.parse(balanced); } catch { /* keep searching */ }
    }
    return undefined;
}
