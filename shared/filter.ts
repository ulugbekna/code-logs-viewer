// Pure filtering / matching pipeline used by the webview.
// Decoupled from DOM and global state so it can be unit-tested.

import { buildSearchMatcher, type SearchOptions } from './search';
import type { LogEntry } from './types';

export interface FilterOptions {
    levels: Record<string, boolean>;       // empty object => "any"
    sources: Record<string, boolean>;      // empty object => "any"
    timeMin?: number;
    timeMax?: number;
    search: string;
    search2: string;
    searchOptions: SearchOptions;
    /** When true, search/search2 also restrict membership; when false they only mark navigation matches. */
    filterBySearch: boolean;
}

export interface FilterResult {
    filtered: LogEntry[];
    /** Indices into `filtered` whose text matched the (primary or fallback) search. */
    matchPositions: number[];
}

/** Concatenate header fields and body to a single searchable string. */
export function entryText(e: LogEntry): string {
    return `${e.tsRaw} ${e.level} ${e.source ?? ''} ${e.message}\n${e.body.join('\n')}`;
}

/**
 * Apply level/source/time filters, then build navigation match positions
 * from the (possibly two) search queries. When `filterBySearch` is true,
 * non-matching rows are dropped from `filtered` as well.
 *
 * Pure: does not read or mutate any global state.
 */
export function recomputeFiltered(
    entries: readonly LogEntry[],
    opts: FilterOptions,
    getEntryText: (e: LogEntry) => string = entryText,
): FilterResult {
    const { levels, sources, timeMin, timeMax, search, search2, searchOptions, filterBySearch } = opts;
    const anyLevel = !Object.values(levels).some(v => v);
    const anySource = !Object.values(sources).some(v => v);
    const matcher = buildSearchMatcher(search, searchOptions);
    const matcher2 = buildSearchMatcher(search2, searchOptions);

    const filtered: LogEntry[] = [];
    const matchPositions: number[] = [];
    for (const e of entries) {
        if (!anyLevel && !levels[e.level]) { continue; }
        if (!anySource && !(e.source && sources[e.source])) { continue; }
        if (timeMin !== undefined && e.ts && e.ts < timeMin) { continue; }
        if (timeMax !== undefined && e.ts && e.ts > timeMax) { continue; }

        const text = getEntryText(e);
        const isMatch = matcher ? matcher(text) : false;
        const isMatch2 = matcher2 ? matcher2(text) : false;
        if (filterBySearch) {
            if (matcher && !isMatch) { continue; }
            if (matcher2 && !isMatch2) { continue; }
        }
        // Match navigation prefers primary; falls back to secondary if only
        // the secondary query is set so the arrows / counter stay useful.
        const navMatch = matcher ? isMatch : (matcher2 ? isMatch2 : false);
        if (navMatch) { matchPositions.push(filtered.length); }
        filtered.push(e);
    }
    return { filtered, matchPositions };
}
