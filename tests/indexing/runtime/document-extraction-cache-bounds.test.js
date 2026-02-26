#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DOCUMENT_EXTRACTION_CACHE_FILE,
  DOCUMENT_EXTRACTION_CACHE_MAX_LOAD_BYTES,
  compactDocumentExtractionCacheEntries,
  loadDocumentExtractionCacheState
} from '../../../src/index/build/indexer/steps/process-files.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-doc-cache-bounds-'));
const runtimeDir = path.join(tempRoot, 'runtime');
await fs.mkdir(runtimeDir, { recursive: true });
const cachePath = path.join(runtimeDir, DOCUMENT_EXTRACTION_CACHE_FILE);

const oversizedPayload = '{"version":1,"entries":{"oversized":{"text":"' + 'a'.repeat(DOCUMENT_EXTRACTION_CACHE_MAX_LOAD_BYTES + 1024) + '"}}}';
await fs.writeFile(cachePath, oversizedPayload);

const loadLogs = [];
const loadedState = await loadDocumentExtractionCacheState({
  runtime: { repoCacheRoot: tempRoot },
  log: (line) => loadLogs.push(String(line || ''))
});

assert.deepEqual(loadedState?.entries || {}, {}, 'expected oversized cache payload to be ignored');
assert.ok(
  loadLogs.some((line) => line.includes('exceeds load limit')),
  'expected oversized cache load warning'
);

const compacted = compactDocumentExtractionCacheEntries(
  {
    oldest: { text: 'oldest' },
    middle: { text: 'middle' },
    newest: { text: 'newest' }
  },
  {
    maxEntries: 2,
    maxTotalEntryBytes: Number.MAX_SAFE_INTEGER,
    maxEntryTextBytes: 1024
  }
);

assert.deepEqual(
  Object.keys(compacted.entries),
  ['middle', 'newest'],
  'expected compaction to keep most-recent entries when entry cap is hit'
);
assert.equal(compacted.stats.droppedForMaxEntries, 1, 'expected one max-entry eviction');

const textCapped = compactDocumentExtractionCacheEntries(
  {
    keep: { text: 'ok' },
    drop: { text: 'this text is too large' }
  },
  {
    maxEntries: 10,
    maxTotalEntryBytes: Number.MAX_SAFE_INTEGER,
    maxEntryTextBytes: 3
  }
);

assert.deepEqual(Object.keys(textCapped.entries), ['keep'], 'expected entry text-size cap to evict oversize text');
assert.equal(textCapped.stats.droppedForEntryTextBytes, 1, 'expected one text-size eviction');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('document extraction cache bounds test passed');
