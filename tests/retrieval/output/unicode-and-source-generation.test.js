import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanContext } from '../../../src/retrieval/output/context.js';
import { buildHighlightRegex, highlightText } from '../../../src/retrieval/cli/highlight.js';
import { getBodySummary } from '../../../src/retrieval/output/summary.js';
import { buildResultBundles, RESULT_BUNDLE_SCHEMA_VERSION } from '../../../src/retrieval/output/format/bundle.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

assert.deepEqual(cleanContext(['中文说明', 'Русский текст', 'العربية', '१२३', '---', '```js', '  ']),
  ['中文说明', 'Русский текст', 'العربية', '१२३']);
const style = text => `<${text}>`;
for (const text of ['café', 'cafe\u0301', 'ｃａｆé']) {
  assert.equal(highlightText(text, buildHighlightRegex(['café']), style), `<${text}>`);
}
assert.equal(highlightText('ﬃ', buildHighlightRegex(['f']), style), '<ﬃ>', 'overlapping normalized matches style one complete grapheme');
assert.equal(highlightText('각 😀', buildHighlightRegex(['각']), style), '<각> 😀');
assert.equal(highlightText('Alpha alpha', buildHighlightRegex(['Alpha'], { caseSensitive: true }), style), '<Alpha> alpha');
const bundles = buildResultBundles({ code: [{ id: 0 }, { id: 1, file: '__no_file__:code:0' },
  { id: 2, file: '["missing-file","code",0]' }], prose: [{ id: 3 }] });
assert.equal(bundles.schemaVersion, RESULT_BUNDLE_SCHEMA_VERSION);
assert.equal(bundles.groups.length, 4);
assert.equal(new Set(bundles.groups.map(group => group.bundleId)).size, 4);
const { dir } = await prepareIsolatedTestCacheDir('summary-source-generation');
try {
  const file = path.join(dir, 'body.txt');
  await fs.writeFile(file, 'first value');
  const chunk = { file: 'body.txt', start: 0, end: 11 };
  assert.equal(getBodySummary(dir, chunk), 'first value');
  await fs.writeFile(file, 'other value');
  await fs.utimes(file, new Date('2026-10-21T00:00:00Z'), new Date('2026-10-21T00:00:00Z'));
  assert.equal(getBodySummary(dir, chunk), 'other value', 'same byte length and span must observe a source edit');
  assert.equal(getBodySummary(dir, { ...chunk, file: '../outside.txt' }), '(Could not load summary)');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Unicode excerpts preserve original graphemes and summaries follow source generations.');
