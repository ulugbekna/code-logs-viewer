import * as assert from 'assert';
import { buildHighlightRegex, buildSearchMatcher, type SearchOptions } from '../../shared/search';

const DEFAULT: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false };

suite('search/buildSearchMatcher', () => {
	test('returns undefined for empty query', () => {
		assert.strictEqual(buildSearchMatcher('', DEFAULT), undefined);
	});

	test('case-insensitive substring match by default', () => {
		const m = buildSearchMatcher('hello', DEFAULT)!;
		assert.ok(m('Hello world'));
		assert.ok(m('HELLO'));
		assert.ok(!m('helo'));
	});

	test('caseSensitive disables casefold', () => {
		const m = buildSearchMatcher('Hello', { ...DEFAULT, caseSensitive: true })!;
		assert.ok(m('Hello'));
		assert.ok(!m('hello'));
	});

	test('wholeWord wraps in word boundaries', () => {
		const m = buildSearchMatcher('cat', { ...DEFAULT, wholeWord: true })!;
		assert.ok(m('a cat sat'));
		assert.ok(!m('concatenate'));
	});

	test('regex mode parses the query as a regex', () => {
		const m = buildSearchMatcher('h.l+o', { ...DEFAULT, regex: true })!;
		assert.ok(m('hello'));
		assert.ok(m('hxlllo'));
	});

	test('regex literal characters are escaped when regex=false', () => {
		const m = buildSearchMatcher('a.b', DEFAULT)!;
		assert.ok(m('a.b'));
		assert.ok(!m('axb'));
	});

	test('invalid regex yields a matcher that always returns false', () => {
		const m = buildSearchMatcher('[unclosed', { ...DEFAULT, regex: true })!;
		assert.strictEqual(m('[unclosed'), false);
		assert.strictEqual(m(''), false);
	});

	test('reusing the matcher resets lastIndex', () => {
		const m = buildSearchMatcher('foo', DEFAULT)!;
		assert.ok(m('foo'));
		assert.ok(m('foo'));   // would fail if lastIndex weren't reset
		assert.ok(m('foofoo'));
	});
});

suite('search/buildHighlightRegex', () => {
	// Helper: stateless single-shot test that ignores `g`-flag lastIndex.
	const has = (re: RegExp, s: string) => s.match(re) !== null;

	test('returns undefined when all queries empty', () => {
		assert.strictEqual(buildHighlightRegex(['', ''], DEFAULT), undefined);
	});

	test('combines multiple queries with alternation', () => {
		const re = buildHighlightRegex(['foo', 'bar'], DEFAULT)!;
		assert.ok(has(re, 'xxx foo xxx'));
		assert.ok(has(re, 'xxx bar xxx'));
		assert.ok(!has(re, 'xxx baz xxx'));
	});

	test('top-level alternation inside a user regex stays grouped', () => {
		// User wrote `a|b`; combined with `c` we want `(?:a|b)|(?:c)`,
		// which must still match `a`, `b`, or `c`.
		const re = buildHighlightRegex(['a|b', 'c'], { ...DEFAULT, regex: true })!;
		assert.ok(has(re, 'xax'));
		assert.ok(has(re, 'xbx'));
		assert.ok(has(re, 'xcx'));
		assert.ok(!has(re, 'xdx'));
	});

	test('returns undefined for invalid regex', () => {
		assert.strictEqual(buildHighlightRegex(['[bad'], { ...DEFAULT, regex: true }), undefined);
	});

	test('case-insensitive by default', () => {
		const re = buildHighlightRegex(['hello'], DEFAULT)!;
		assert.ok(has(re, 'HELLO'));
	});

	test('regex is global so replace replaces all matches', () => {
		const re = buildHighlightRegex(['foo'], DEFAULT)!;
		assert.strictEqual('foo foo foo'.replace(re, 'X'), 'X X X');
	});
});
