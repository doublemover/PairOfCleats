#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyImportResolutionCacheFileSetDiffInvalidation } from '../../../src/index/build/import-resolution-cache.js';

const cache = {
  cacheKey: 'cache-key-before-diff',
  fileSetFingerprint: 'fingerprint-before-diff',
  lookup: {
    fileSet: ['src/legacy.js']
  },
  files: {
    'src/legacy.js': {
      specs: Object.create(null)
    }
  }
};

const stats = {
  invalidationReasons: Object.create(null)
};

const outcome = applyImportResolutionCacheFileSetDiffInvalidation({
  cache,
  entries: [{ rel: 'src/current.js' }],
  cacheStats: stats
});

assert.equal(outcome?.fileSetChanged, true, 'expected file-set diff to be detected');
assert.equal(outcome?.removed, 1, 'expected previous file-set entry to be removed');
assert.equal(cache.cacheKey, 'cache-key-before-diff', 'expected cache key to remain available for downstream drift checks');
assert.equal(cache.lookup, null, 'expected lookup snapshot to reset after file-set diff');
assert.equal(cache.files['src/legacy.js'], undefined, 'expected stale importer cache entry to be invalidated');

// These are logical indexed identities. Windows normalizes trailing spaces on
// physical file creation, so the exact trailing-space case is admitted directly
// into the cache owner rather than pretending the filesystem retained that name.
for (const filename of [' foo.js', 'foo.js ']) {
  const specifier = './' + filename;
  const before = { cacheKey: 'retained', fileSetFingerprint: null,
    lookup: { fileSet: ['src/importer.js', 'src/foo.js'] },
    files: { 'src/importer.js': { specs: { [specifier]: { resolvedType: 'unresolved' } } },
      'src/unrelated.js': { specs: { './foo.js': { resolvedType: 'resolved', resolvedPath: 'src/foo.js' } } } } };
  const serialized = JSON.parse(JSON.stringify(before));
  const outcome = applyImportResolutionCacheFileSetDiffInvalidation({ cache: serialized,
    entries: ['src/importer.js', 'src/foo.js', 'src/' + filename] });
  assert.equal(outcome.added, 1);
  assert.equal(outcome.staleEdgeInvalidated, 1, 'the exact newly admitted literal target invalidates its unresolved importer');
  assert.equal(serialized.files['src/importer.js'], undefined);
  assert.ok(serialized.files['src/unrelated.js'], 'ordinary file remains a distinct dependency');
  assert.equal(serialized.cacheKey, 'retained');
  const fingerprint = serialized.fileSetFingerprint;
  const other = { files: {}, lookup: { fileSet: [] } };
  applyImportResolutionCacheFileSetDiffInvalidation({ cache: other, entries: ['src/importer.js', 'src/foo.js'] });
  assert.notEqual(fingerprint, other.fileSetFingerprint, 'significant filename whitespace changes the fingerprint');
  const removed = { lookup: { fileSet: ['src/foo.js', 'src/' + filename] },
    files: { 'src/importer.js': { specs: { [specifier]: { resolvedType: 'resolved', resolvedPath: 'src/' + filename } } } } };
  const removal = applyImportResolutionCacheFileSetDiffInvalidation({ cache: removed, entries: ['src/foo.js'] });
  assert.equal(removal.removed, 1); assert.equal(removed.files['src/importer.js'], undefined);
}

console.log('import cache file-set diff cache-key preservation test passed');
