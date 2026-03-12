#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { collectSearchHits } = require('../../../extensions/vscode/search-contract.js');

const hits = collectSearchHits({
  code: [{ file: 'src/app.js', score: 1 }],
  prose: [{ file: 'README.md', score: 2 }],
  extractedProse: [{ file: 'docs/api.md', score: 3 }],
  records: [{ file: 'records.json', score: 4 }],
  ignored: [{ file: 'skip-me' }]
});

assert.equal(hits.length, 4, 'expected all supported result buckets to be collected');
assert.deepEqual(
  hits.map((hit) => hit.section),
  ['code', 'prose', 'extracted-prose', 'records']
);
assert.equal(hits[2].file, 'docs/api.md');

console.log('vscode search result sections test passed');
