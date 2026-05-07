import * as assert from 'assert';
import { parseLog, serializeEntries } from '../parser';

suite('parser', () => {
	test('parses single-line entry with source', () => {
		const text = '2026-05-07 18:50:28.343 [info] [CopilotCLIChatSessionContentProvider] listSessions took 121ms';
		const entries = parseLog(text);
		assert.strictEqual(entries.length, 1);
		const e = entries[0];
		assert.strictEqual(e.level, 'info');
		assert.strictEqual(e.source, 'CopilotCLIChatSessionContentProvider');
		assert.strictEqual(e.message, 'listSessions took 121ms');
		assert.strictEqual(e.body.length, 0);
		assert.ok(e.ts > 0);
	});

	test('parses entry without source', () => {
		const text = '2026-05-07 18:50:28.582 [info] hello world';
		const e = parseLog(text)[0];
		assert.strictEqual(e.source, undefined);
		assert.strictEqual(e.message, 'hello world');
	});

	test('groups continuation lines as body and detects JSON', () => {
		const text = [
			'2026-05-07 18:50:46.409 [error] [CopilotCLI] error (Request-ID AA2F)',
			'2026-05-07 18:50:46.409 [error] [CopilotCLI] {',
			'  "status": 400,',
			'  "code": "invalid"',
			'}',
		].join('\n');
		const entries = parseLog(text);
		assert.strictEqual(entries.length, 2);
		assert.strictEqual(entries[1].message, '{');
		assert.deepStrictEqual(entries[1].body, ['  "status": 400,', '  "code": "invalid"', '}']);
		assert.strictEqual(entries[1].bodyKind, 'json');
	});

	test('detects group markers', () => {
		const text = [
			'2026-05-07 18:50:31.530 [info] [CopilotCLI] --- Start of group: configured settings: ---',
			'2026-05-07 18:50:31.530 [info] [CopilotCLI] --- End of group ---',
		].join('\n');
		const [a, b] = parseLog(text);
		assert.strictEqual(a.groupStart, 'configured settings:');
		assert.strictEqual(b.groupEnd, true);
	});

	test('serializeEntries round-trips header + body', () => {
		const text = [
			'2026-05-07 18:50:46.409 [error] [CopilotCLI] error',
			'  detail line 1',
			'  detail line 2',
		].join('\n');
		const round = serializeEntries(parseLog(text));
		assert.strictEqual(round, text);
	});
});
