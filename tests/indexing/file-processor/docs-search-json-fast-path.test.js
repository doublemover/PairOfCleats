#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  compactDocsSearchJsonText,
  isDocsSearchIndexJsonPath
} from '../../../src/index/build/file-processor/docs-search-json.js';

assert.equal(
  isDocsSearchIndexJsonPath({
    mode: 'prose',
    ext: '.json',
    relPath: 'docs/search.json'
  }),
  true,
  'expected docs/search.json to use docs search index fast path'
);

assert.equal(
  isDocsSearchIndexJsonPath({
    mode: 'code',
    ext: '.json',
    relPath: 'docs/search.json'
  }),
  false,
  'expected code mode to skip docs search index fast path'
);

assert.equal(
  isDocsSearchIndexJsonPath({
    mode: 'prose',
    ext: '.json',
    relPath: 'src/search.json'
  }),
  false,
  'expected non-docs search.json to skip docs search index fast path'
);

const raw = JSON.stringify({
  'Classes/Request.html': {
    name: 'Request',
    abstract: '<p>Request docs for <code>URLSession</code>.</p>'
  },
  'Classes/DataRequest.html#/s:test': {
    name: 'data()',
    parent_name: 'DataRequest',
    abstract: '<p>Returns &lt;Data&gt; &amp; metadata.</p>'
  }
});

const compacted = compactDocsSearchJsonText(raw);
assert.ok(typeof compacted === 'string' && compacted.length > 0, 'expected compacted docs search json text');
assert.ok(compacted.includes('Classes/Request.html | Request | Request docs for URLSession.'), 'expected normalized first entry');
assert.ok(compacted.includes('Classes/DataRequest.html#/s:test | data() | DataRequest | Returns <Data> & metadata.'), 'expected normalized second entry');
assert.ok(!compacted.includes('<p>') && !compacted.includes('<code>'), 'expected html tags stripped from compacted text');

const invalidCompacted = compactDocsSearchJsonText('{');
assert.equal(invalidCompacted, null, 'expected invalid json to skip compaction');

console.log('docs search json fast path test passed');
