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
  true,
  'expected code mode docs/search.json to still use docs search index compaction'
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

const fastScanRaw = JSON.stringify({
  'Classes/Session.html': {
    name: 'Session',
    abstract: '<p>Creates and manages requests.</p>'
  },
  'Classes/Request.html': {
    name: 'Request',
    parent_name: 'Session',
    abstract: '<p>Represents a single request.</p>'
  }
});
const fastScanned = compactDocsSearchJsonText(fastScanRaw, {
  fastScanMinInputChars: 1,
  fastScanWindowChars: 1024
});
assert.ok(typeof fastScanned === 'string' && fastScanned.length > 0, 'expected fast-scan compaction output');
assert.ok(
  fastScanned.includes('Classes/Session.html | Session | Creates and manages requests.'),
  'expected fast-scan path to preserve normalized route/name/abstract'
);

const fastScanArrayRaw = JSON.stringify([
  {
    route: '/guide/install',
    title: 'Install',
    abstract: '<p>Install guide.</p>'
  },
  {
    path: '/guide/config',
    name: 'Config',
    description: '<p>Config reference.</p>'
  }
]);
const fastScanArrayCompacted = compactDocsSearchJsonText(fastScanArrayRaw, {
  fastScanMinInputChars: 1,
  fastScanWindowChars: 1024
});
assert.ok(
  typeof fastScanArrayCompacted === 'string' && fastScanArrayCompacted.length > 0,
  'expected parser fallback when fast scan finds no object-shaped entries'
);
assert.ok(
  fastScanArrayCompacted.includes('/guide/install | Install | Install guide.'),
  'expected array-shaped search.json to compact via parser fallback'
);

console.log('docs search json fast path test passed');
