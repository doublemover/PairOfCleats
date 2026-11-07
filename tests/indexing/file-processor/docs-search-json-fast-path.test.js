#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  compactDocsSearchJsonText,
  isDocsSearchIndexJsonPath
} from '../../../src/index/build/file-processor/docs-search-json.js';

applyTestEnv();

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

const nestedObjectRaw = JSON.stringify({
  '/guide/a': {
    name: 'Guide A',
    abstract: '<p>Top level A.</p>',
    meta: {
      '/fake/nested-1': {
        name: 'Nested 1',
        abstract: '<p>Nested content.</p>'
      },
      '/fake/nested-2': {
        name: 'Nested 2',
        abstract: '<p>Nested content 2.</p>'
      }
    }
  },
  '/guide/b': {
    name: 'Guide B',
    abstract: '<p>Top level B.</p>'
  }
});
const nestedCompacted = compactDocsSearchJsonText(nestedObjectRaw, {
  maxEntries: 2,
  fastScanMinInputChars: 1,
  fastScanWindowChars: 1024
});
assert.ok(
  typeof nestedCompacted === 'string' && nestedCompacted.length > 0,
  'expected fast-scan compaction output for nested object payload'
);
assert.ok(
  nestedCompacted.includes('/guide/a | Guide A | Top level A.'),
  'expected fast-scan to retain first top-level route'
);
assert.ok(
  nestedCompacted.includes('/guide/b | Guide B | Top level B.'),
  'expected fast-scan to retain later top-level route instead of nested keys'
);
assert.ok(
  !nestedCompacted.includes('/fake/nested-1') && !nestedCompacted.includes('/fake/nested-2'),
  'expected nested payload keys to be excluded from top-level fast-scan routes'
);

// Original reproduction plus array/object nesting, escaped structural bytes,
// and a real default-threshold input must agree with the parse path.
for (const value of [
  { nested: { name: 'Wrong', abstract: 'Nested Wrong' }, name: 'Right', abstract: 'Info' },
  { nested: [{ name: 'Wrong', title: 'Wrong title', parent: 'Wrong parent', abstract: 'Wrong abstract' }],
    title: 'Right title', parent: 'Right parent', description: 'Right description' },
  { nested: { deep: { name: 'Wrong' } }, escaped: '\\" } ] name : abstract',
    name: 'Right \\" title', abstract: 'Info' },
  { nested: [{ name: 'Wrong' }], name: 'Right' }
]) {
  for (const shaped of [{ '/docs': value }, [{ route: '/docs', ...value }]]) {
    const text = JSON.stringify(shaped);
    const parsed = compactDocsSearchJsonText(text, { fastScanMinInputChars: 0 });
    const scanned = compactDocsSearchJsonText(text, { fastScanMinInputChars: 1 });
    assert.equal(scanned, parsed, text);
    assert.ok(!scanned.includes('Wrong'));
  }
}
const largeRaw = JSON.stringify({ '/docs': { nested: { name: 'Wrong' }, name: 'Right', abstract: 'Info' },
  '/padding': { name: 'Padding', content: 'x'.repeat(1_500_000) },
  '/later': { nested: [{ name: 'Wrong later' }], name: 'Later', abstract: 'Later info' } });
assert.ok(largeRaw.length >= 1_500_000);
const largeCompacted = compactDocsSearchJsonText(largeRaw);
assert.ok(largeCompacted.includes('/docs | Right | Info'));
assert.ok(largeCompacted.includes('/later | Later | Later info'));
assert.ok(!largeCompacted.includes('Wrong'));
// A truncated bounded window must not promote a nested field to fill a missing
// top-level field or borrow it from the following route.
const boundedRaw = JSON.stringify({ '/first': { nested: { name: 'Wrong' }, padding: 'x'.repeat(800), name: 'OutsideWindow' },
  '/second': { name: 'Second' } });
const bounded = compactDocsSearchJsonText(boundedRaw, { fastScanMinInputChars: 1, fastScanWindowChars: 512 });
assert.ok(bounded.startsWith('/first\n'));
assert.ok(bounded.includes('/second | Second'));
assert.ok(!bounded.includes('Wrong') && !bounded.includes('OutsideWindow'));

console.log('docs search json fast path test passed');
