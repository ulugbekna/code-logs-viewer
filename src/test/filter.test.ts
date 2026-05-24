import * as assert from 'assert';
import { entryText, recomputeFiltered, type FilterOptions } from '../../shared/filter';
import type { LogEntry } from '../../shared/types';

function entry(p: Partial<LogEntry> & { id: number }): LogEntry {
    return { ts: 0, tsRaw: '', level: 'info', message: '', body: [], ...p };
}

const DEFAULT_OPTS: FilterOptions = {
    levels: {},
    sources: {},
    search: '',
    search2: '',
    searchOptions: { caseSensitive: false, wholeWord: false, regex: false },
    filterBySearch: false,
};

suite('filter/entryText', () => {
    test('concatenates header fields and body', () => {
        const e = entry({ id: 0, tsRaw: '2026-01-01', level: 'warning', source: 'src', message: 'msg', body: ['b1', 'b2'] });
        assert.strictEqual(entryText(e), '2026-01-01 warning src msg\nb1\nb2');
    });

    test('handles missing source', () => {
        const e = entry({ id: 0, tsRaw: 't', level: 'info', message: 'm' });
        assert.strictEqual(entryText(e), 't info  m\n');
    });
});

suite('filter/recomputeFiltered', () => {
    const entries: LogEntry[] = [
        entry({ id: 0, level: 'error', source: 'A', message: 'boom', ts: 100 }),
        entry({ id: 1, level: 'info', source: 'A', message: 'hello', ts: 200 }),
        entry({ id: 2, level: 'info', source: 'B', message: 'world', ts: 300 }),
        entry({ id: 3, level: 'warning', source: 'B', message: 'careful', ts: 400 }),
    ];

    test('empty filters: keep all, no matches', () => {
        const r = recomputeFiltered(entries, DEFAULT_OPTS);
        assert.strictEqual(r.filtered.length, 4);
        assert.deepStrictEqual(r.matchPositions, []);
    });

    test('level filter restricts to selected levels', () => {
        const r = recomputeFiltered(entries, { ...DEFAULT_OPTS, levels: { error: true, warning: true } });
        assert.deepStrictEqual(r.filtered.map(e => e.id), [0, 3]);
    });

    test('source filter restricts to selected sources', () => {
        const r = recomputeFiltered(entries, { ...DEFAULT_OPTS, sources: { B: true } });
        assert.deepStrictEqual(r.filtered.map(e => e.id), [2, 3]);
    });

    test('time bounds use inclusive endpoints', () => {
        const r = recomputeFiltered(entries, { ...DEFAULT_OPTS, timeMin: 200, timeMax: 300 });
        assert.deepStrictEqual(r.filtered.map(e => e.id), [1, 2]);
    });

    test('zero-ts entries bypass time filter', () => {
        const e = entry({ id: 9, message: 'no ts' });
        const r = recomputeFiltered([e], { ...DEFAULT_OPTS, timeMin: 100, timeMax: 200 });
        assert.deepStrictEqual(r.filtered.map(x => x.id), [9]);
    });

    test('highlight mode: search records match positions but does not filter', () => {
        const r = recomputeFiltered(entries, { ...DEFAULT_OPTS, search: 'world' });
        assert.strictEqual(r.filtered.length, 4);
        assert.deepStrictEqual(r.matchPositions, [2]);
    });

    test('filter mode: search drops non-matching rows', () => {
        const r = recomputeFiltered(entries, { ...DEFAULT_OPTS, search: 'world', filterBySearch: true });
        assert.strictEqual(r.filtered.length, 1);
        assert.deepStrictEqual(r.matchPositions, [0]);
    });

    test('filter mode with both searches: AND', () => {
        const r = recomputeFiltered(entries, {
            ...DEFAULT_OPTS,
            search: 'info',
            search2: 'world',
            filterBySearch: true,
        });
        assert.deepStrictEqual(r.filtered.map(e => e.id), [2]);
    });

    test('match navigation falls back to secondary when primary is empty', () => {
        const r = recomputeFiltered(entries, { ...DEFAULT_OPTS, search2: 'careful' });
        assert.deepStrictEqual(r.matchPositions, [3]);
    });

    test('match positions index into the filtered array (not the source)', () => {
        const r = recomputeFiltered(entries, {
            ...DEFAULT_OPTS,
            levels: { info: true },           // keeps ids 1, 2
            search: 'world',
        });
        assert.deepStrictEqual(r.filtered.map(e => e.id), [1, 2]);
        assert.deepStrictEqual(r.matchPositions, [1]); // 'world' is at index 1 of filtered
    });
});
