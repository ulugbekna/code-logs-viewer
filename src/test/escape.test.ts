import * as assert from 'assert';
import { escapeHtml, escapeRe } from '../../shared/escape';

suite('escape', () => {
    test('escapeHtml replaces all dangerous chars', () => {
        assert.strictEqual(
            escapeHtml(`<a href="x">&'</a>`),
            '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
        );
    });

    test('escapeHtml is identity for benign text', () => {
        assert.strictEqual(escapeHtml('hello world 123'), 'hello world 123');
    });

    test('escapeRe escapes regex metacharacters', () => {
        const re = new RegExp(escapeRe('a.b*c+d?'));
        assert.ok(re.test('a.b*c+d?'));
        assert.ok(!re.test('axbxcxd'));
    });

    test('escapeRe leaves alphanumerics alone', () => {
        assert.strictEqual(escapeRe('abc123'), 'abc123');
    });
});
