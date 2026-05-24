// Pure search/highlight regex builders, decoupled from any DOM.

import { escapeRe } from './escape';

export interface SearchOptions {
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
}

export type Matcher = (s: string) => boolean;

/**
 * Build a predicate that tests whether a string matches the user's query.
 * Returns `undefined` if the query is empty.
 * Returns a predicate that always returns false if the regex is invalid.
 */
export function buildSearchMatcher(query: string, opts: SearchOptions): Matcher | undefined {
	if (!query) { return undefined; }
	const flags = opts.caseSensitive ? 'g' : 'gi';
	let re: RegExp;
	try {
		if (opts.regex) {
			re = new RegExp(query, flags);
		} else {
			let pattern = escapeRe(query);
			if (opts.wholeWord) { pattern = `\\b${pattern}\\b`; }
			re = new RegExp(pattern, flags);
		}
	} catch {
		return () => false;
	}
	return (s: string) => { re.lastIndex = 0; return re.test(s); };
}

/**
 * Build a single regex that matches any of the given queries, for highlighting.
 * Empty queries are skipped. Returns `undefined` if every query is empty
 * or the combined regex fails to compile.
 */
export function buildHighlightRegex(queries: readonly string[], opts: SearchOptions): RegExp | undefined {
	const parts: string[] = [];
	for (const q of queries) {
		if (!q) { continue; }
		let pattern: string;
		if (opts.regex) {
			pattern = q;
		} else {
			pattern = escapeRe(q);
			if (opts.wholeWord) { pattern = `\\b${pattern}\\b`; }
		}
		parts.push(`(?:${pattern})`);
	}
	if (parts.length === 0) { return undefined; }
	const flags = opts.caseSensitive ? 'g' : 'gi';
	try { return new RegExp(parts.join('|'), flags); } catch { return undefined; }
}
