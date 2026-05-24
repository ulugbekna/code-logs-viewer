import * as assert from 'assert';
import { computeExtractedJson, sliceBalancedJson } from '../../shared/jsonExtract';
import type { LogEntry } from '../../shared/types';

function entry(partial: Partial<LogEntry>): LogEntry {
    return {
        id: 0,
        ts: 0,
        tsRaw: '',
        level: 'info',
        message: '',
        body: [],
        ...partial,
    };
}

suite('jsonExtract/sliceBalancedJson', () => {
    test('extracts simple object', () => {
        assert.strictEqual(sliceBalancedJson('x={"a":1}y', 2), '{"a":1}');
    });

    test('extracts simple array', () => {
        assert.strictEqual(sliceBalancedJson('[1,2,3]', 0), '[1,2,3]');
    });

    test('handles nested braces', () => {
        assert.strictEqual(sliceBalancedJson('{"a":{"b":[1,2]}}', 0), '{"a":{"b":[1,2]}}');
    });

    test('treats braces inside strings as literal', () => {
        assert.strictEqual(sliceBalancedJson('{"k":"a}b"}', 0), '{"k":"a}b"}');
    });

    test('respects backslash escapes inside strings', () => {
        assert.strictEqual(sliceBalancedJson('{"k":"a\\"}b"}', 0), '{"k":"a\\"}b"}');
    });

    test('returns undefined when not started at brace/bracket', () => {
        assert.strictEqual(sliceBalancedJson('abc{"a":1}', 0), undefined);
    });

    test('returns undefined when unbalanced', () => {
        assert.strictEqual(sliceBalancedJson('{"a":1', 0), undefined);
    });
});

suite('jsonExtract/computeExtractedJson', () => {
    test('parses JSON-shaped body', () => {
        const e = entry({ body: ['{', '  "a": 1', '}'] });
        assert.deepStrictEqual(computeExtractedJson(e), { a: 1 });
    });

    test('parses JSON embedded in message', () => {
        const e = entry({ message: 'response: {"ok":true,"n":3} extra' });
        assert.deepStrictEqual(computeExtractedJson(e), { ok: true, n: 3 });
    });

    test('prefers body when both are present', () => {
        const e = entry({ message: '{"from":"msg"}', body: ['{"from":"body"}'] });
        assert.deepStrictEqual(computeExtractedJson(e), { from: 'body' });
    });

    test('returns undefined when nothing parses', () => {
        const e = entry({ message: 'hello { not json' });
        assert.strictEqual(computeExtractedJson(e), undefined);
    });

    test('skips past unparseable braces and finds later JSON', () => {
        const e = entry({ message: 'noise {bad json} valid {"a":1}' });
        assert.deepStrictEqual(computeExtractedJson(e), { a: 1 });
    });
});
