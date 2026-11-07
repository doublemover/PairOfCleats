import assert from 'node:assert/strict';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = '<!doctype html><html><head><title>Example &amp; demo</title><meta name="description" content="Demo">'
  + '<meta name="keywords" content="one,two"><script src="./app.js"></script>'
  + '<link rel="stylesheet" href="./app.css"></head><body><main><h1>Body</h1></main></body></html>';
const input = { ext: '.html', relPath: 'web/page.html', mode: 'code', text, options: {} };
const { lang, context } = await buildLanguageContext(input);
const relations = lang.buildRelations({ ...input, context });
assert.deepEqual(relations.imports, ['./app.js', './app.css']);
assert.ok(context.htmlChunks.length, 'real parser chunks are retained');
const chunk = context.htmlChunks[0];
for (const fileRelations of [relations, { ...relations, imports: [] }, null]) {
  const metadata = lang.extractDocMeta({ text, chunk, fileRelations, context });
  assert.equal(metadata.title, 'Example & demo');
  assert.equal(metadata.description, 'Demo');
  assert.deepEqual(metadata.keywords, ['one', 'two']);
  assert.deepEqual(metadata.scripts, ['./app.js']);
  assert.deepEqual(metadata.links, ['./app.css']);
}
console.log('HTML registry carries real parsed imports and summary metadata independently of filtered/disabled relations.');
