#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureOutputCaches, getFileTextCache, getSummaryCache } from '../../../src/retrieval/output/cache.js';
import { getBodySummary } from '../../../src/retrieval/output/summary.js';
import { DEFAULT_CACHE_MB, BYTES_PER_MB } from '../../../src/shared/cache/size.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-summary-cache-'));
const root = path.join(tempRoot, 'repo');
await fs.mkdir(root);
// Portable canonical spelling; physical reparse equivalence has a separate owner.
const aliasRoot = root + path.sep + '.';
const file = path.join(root, 'sample.txt');
await fs.writeFile(file, 'alpha beta gamma delta');
// Summary reads use canonical paths, including macOS's /var -> /private/var.
const canonicalFile = toRealPathSync(file);
const first = { file: 'sample.txt', start: 0, end: 10 };
const second = { file: 'sample.txt', start: 11, end: 22 };
const originalOpen = fsSync.openSync, originalRead = fsSync.readSync, originalClose = fsSync.closeSync;
const sourceDescriptors = new Set();
let reads = 0;
fsSync.openSync = function (input, ...args) {
  const fd = originalOpen.call(this, input, ...args);
  if (typeof input === 'string' && path.resolve(input) === canonicalFile) sourceDescriptors.add(fd);
  return fd;
};
fsSync.readSync = function (fd, ...args) {
  if (sourceDescriptors.has(fd)) reads++;
  return originalRead.call(this, fd, ...args);
};
fsSync.closeSync = function (fd) {
  const value = originalClose.call(this, fd); sourceDescriptors.delete(fd); return value;
};
try {
  await withTemporaryEnv({ PAIROFCLEATS_FILE_CACHE_MAX: undefined, PAIROFCLEATS_SUMMARY_CACHE_MAX: undefined }, () => {
    configureOutputCaches();
    assert.equal(getBodySummary(root, first), 'alpha beta');
    assert.equal(getBodySummary(root, first), 'alpha beta');
    assert.equal(getBodySummary(root, second), 'gamma delta');
    assert.equal(reads, 1, 'repeated and distinct chunks should reuse the admitted file text');
    assert.equal(getSummaryCache().stats.hits, 1);
    assert.equal(getFileTextCache().stats.hits, 2, 'even a summary hit first obtains render-owned source admission');
    assert.equal(getFileTextCache().stats.maxSizeBytes, DEFAULT_CACHE_MB.fileText * BYTES_PER_MB);
    assert.equal(getSummaryCache().stats.maxSizeBytes, DEFAULT_CACHE_MB.summary * BYTES_PER_MB);

    configureOutputCaches();
    reads = 0;
    assert.equal(getBodySummary(aliasRoot, first), 'alpha beta');
    assert.equal(getBodySummary(root, first), 'alpha beta');
    assert.equal(getBodySummary(root, second), 'gamma delta');
    assert.equal(reads, 1, 'canonical root spellings should share one admitted file read');
    assert.equal(getSummaryCache().stats.hits, 1);
    assert.equal(getFileTextCache().stats.hits, 2);

    configureOutputCaches({ cacheConfig: { fileText: { maxMb: 0.0001 }, summary: { maxMb: 0.0001 } } });
    for (const cache of [getFileTextCache(), getSummaryCache()]) {
      cache.set('a', 'a'.repeat(80));
      cache.set('b', 'b'.repeat(80));
      assert.equal(cache.get('a'), null, 'byte budgets still evict oversized combined contents');
      assert.equal(cache.get('b'), 'b'.repeat(80));
    }
    configureOutputCaches({ cacheConfig: { fileText: { maxMb: 0 }, summary: { maxMb: 0 } } });
    assert.equal(getFileTextCache().cache, null);
    assert.equal(getSummaryCache().cache, null);
  });
  await withTemporaryEnv({ PAIROFCLEATS_FILE_CACHE_MAX: '0', PAIROFCLEATS_SUMMARY_CACHE_MAX: '0' }, () => {
    configureOutputCaches();
    assert.equal(getFileTextCache().cache, null, 'explicit zero still disables the cache');
    assert.equal(getSummaryCache().cache, null);
  });
  await withTemporaryEnv({ PAIROFCLEATS_FILE_CACHE_MAX: '2', PAIROFCLEATS_SUMMARY_CACHE_MAX: '2' }, () => {
    configureOutputCaches({ cacheConfig: { fileText: { maxMb: 0 }, summary: { maxMb: 0 } } });
    for (const cache of [getFileTextCache(), getSummaryCache()]) {
      cache.set('a', 'first');
      cache.set('b', 'second');
      cache.set('c', 'third');
      assert.equal(cache.get('a'), null);
      assert.equal(cache.get('b'), 'second');
      assert.equal(cache.get('c'), 'third');
      assert.equal(cache.stats.maxEntries, 2, 'explicit entry limits preserve their existing precedence');
    }
  });
  console.log('summary cache defaults passed: actual one-read reuse, byte caps, explicit zero/entry controls');
} finally {
  fsSync.openSync = originalOpen; fsSync.readSync = originalRead; fsSync.closeSync = originalClose;
  configureOutputCaches();
  await fs.rm(tempRoot, { recursive: true, force: true });
}
