import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { annotateMessage, parseStatistics, shareAdded } from '../../dist/packages/core/src/statistics.js';

const fixture = async name => JSON.parse(await readFile(new URL(`../fixtures/git-ai-1.7.5/${name}.json`, import.meta.url), 'utf8'));

test('versioned statistics use the filtered denominator, unknown category and N/A', async () => {
	assert.equal(shareAdded(parseStatistics(await fixture('mixed-partial'))), '66.67%');
	assert.equal(shareAdded(parseStatistics(await fixture('explicit-ignore'))), '50.00%');
	assert.equal(shareAdded(parseStatistics(await fixture('zero-additions'))), 'N/A');
	assert.equal(parseStatistics(await fixture('missing-note')).unknown_additions, 1);
});

test('invalid counts cannot silently become zero or human attribution', async () => {
	const valid = await fixture('mixed-partial');

	for (const value of [null, [], {}, {
		...valid,
		ai_additions: -1
	}, {
		...valid,
		human_additions: '1'
	}, {
		...valid,
		unknown_additions: 0.5
	}, {
		...valid,
		git_diff_added_lines: 4
	}]) {
		assert.throws(() => parseStatistics(value), /statistics|count|reconcile/);
	}
});

test('annotation preserves body and unrelated trailers and is idempotent', async () => {
	const message = 'feat: example\n\nBody with AI-Lines-Added: as an example.\n\nSigned-off-by: Example <example@example.invalid>\nReviewed-by: Reviewer\n';
	const stats = parseStatistics(await fixture('mixed-partial'));
	const updated = annotateMessage(message, stats);
	assert(updated.startsWith(message));
	assert.match(updated, /AI-Share-Added: 66\.67%\n$/);
	assert.equal(annotateMessage(updated, stats), updated);
	assert.equal(updated.match(/AI-Stats-Version:/g).length, 1);
});

test('existing ACS fields are replaced while following unrelated trailers survive', async () => {
	const stats = parseStatistics(await fixture('mixed-partial'));
	const message = `${annotateMessage('subject\n', stats)}Reviewed-by: Reviewer\n`;
	const updated = annotateMessage(message, parseStatistics(await fixture('zero-additions')));
	assert.match(updated, /Reviewed-by: Reviewer/);
	assert.match(updated, /AI-Share-Added: N\/A/);
	assert.equal(updated.match(/AI-Stats-Version:/g).length, 1);
	assert.equal(annotateMessage(updated, parseStatistics(await fixture('zero-additions'))), updated);
});

test('a different trailer version is preserved by rejecting annotation', async () => {
	const stats = parseStatistics(await fixture('zero-additions'));
	assert.throws(() => annotateMessage('subject\n\nAI-Stats-Version: 2\n', stats), /Unsupported AI-Stats-Version/);
});

test('multiline unrelated trailers survive updating an existing ACS footer', async () => {
	const stats = parseStatistics(await fixture('mixed-partial'));
	const message = `${annotateMessage('subject\n', stats)}Reviewed-by: Reviewer\n continuation text\n`;
	const updated = annotateMessage(message, stats);
	assert.match(updated, /Reviewed-by: Reviewer\n continuation text/);
	assert.equal(updated.match(/AI-Stats-Version:/g).length, 1);
	assert.equal(annotateMessage(updated, stats), updated);
});
