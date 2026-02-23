#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendChunk, createIndexState, mergeIndexState } from '../../../src/index/build/state.js';

const postingsConfig = {
  typed: false,
  enablePhraseNgrams: false,
  enableChargrams: false,
  fielded: true
};

const target = createIndexState({ postingsConfig });
appendChunk(
  target,
  {
    file: 'src/target.js',
    tokens: ['alpha'],
    seq: ['alpha'],
    fieldTokens: {
      name: ['target'],
      doc: ['alpha'],
      body: ['alpha']
    }
  },
  postingsConfig
);
target.scannedFiles.push('src/target.js');
target.discoveredFiles = ['src/target.js'];
target.discoveryHash = 'target-discovery-hash';
target.fileListHash = 'target-file-list-hash';
target.fileInfoByPath.set('src/shared.js', { owner: 'target' });
target.fileDetailsByPath.set('src/shared.js', { owner: 'target' });
target.chunkUidToFile.set('uid-shared', 'src/target.js');
target.vfsManifestRows.push({ path: 'src/target.js', size: 1 });
target.vfsManifestStats = { rows: 1, bytes: 5 };

const source = createIndexState({ postingsConfig });
appendChunk(
  source,
  {
    file: 'src/source.js',
    tokens: ['beta', 'beta'],
    seq: ['beta', 'beta'],
    fieldTokens: {
      name: ['source'],
      doc: ['beta'],
      body: ['beta', 'beta']
    }
  },
  postingsConfig
);
source.scannedFiles.push('src/source.js');
source.discoveredFiles = ['src/source.js'];
source.discoveryHash = 'source-discovery-hash';
source.fileListHash = 'source-file-list-hash';
source.fileInfoByPath.set('src/shared.js', { owner: 'source' });
source.fileInfoByPath.set('src/source-only.js', { owner: 'source-only' });
source.fileDetailsByPath.set('src/shared.js', { owner: 'source' });
source.fileDetailsByPath.set('src/source-only.js', { owner: 'source-only' });
source.chunkUidToFile.set('uid-shared', 'src/source.js');
source.chunkUidToFile.set('uid-source', 'src/source.js');
source.vfsManifestRows.push({ path: 'src/source.js', size: 2 });
source.vfsManifestStats = { rows: 2, bytes: 11, note: 'ignore-non-numeric' };

mergeIndexState(target, source);

assert.equal(target.chunks.length, 2, 'expected source chunks appended');
assert.equal(target.chunks[1].id, 1, 'expected source chunk id offset remap');
assert.equal(target.docLengths[1], 2, 'expected source doc lengths remapped by offset');
assert.deepEqual(target.tokenPostings.get('beta'), [[1, 2]], 'expected token postings remapped by offset');
assert.deepEqual(target.fieldTokens[1].doc, ['beta'], 'expected field token payload remapped by offset');
assert.equal(target.totalTokens, 3, 'expected total token counters to merge additively');

assert.deepEqual(target.scannedFiles, ['src/target.js', 'src/source.js'], 'expected scanned files append');
assert.deepEqual(target.discoveredFiles, ['src/target.js'], 'expected discovery file list first-writer-wins');
assert.equal(target.discoveryHash, 'target-discovery-hash', 'expected discovery hash first-writer-wins');
assert.equal(target.fileListHash, 'target-file-list-hash', 'expected file list hash first-writer-wins');

assert.deepEqual(target.fileInfoByPath.get('src/shared.js'), { owner: 'target' }, 'expected file info first-writer-wins');
assert.deepEqual(
  target.fileInfoByPath.get('src/source-only.js'),
  { owner: 'source-only' },
  'expected source-only file info to merge'
);
assert.deepEqual(
  target.fileDetailsByPath.get('src/shared.js'),
  { owner: 'target' },
  'expected file details first-writer-wins'
);
assert.deepEqual(
  target.fileDetailsByPath.get('src/source-only.js'),
  { owner: 'source-only' },
  'expected source-only file details to merge'
);
assert.equal(target.chunkUidToFile.get('uid-shared'), 'src/target.js', 'expected chunkUid first-writer-wins');
assert.equal(target.chunkUidToFile.get('uid-source'), 'src/source.js', 'expected source-only chunkUid mapping to merge');

assert.deepEqual(
  target.vfsManifestRows,
  [
    { path: 'src/target.js', size: 1 },
    { path: 'src/source.js', size: 2 }
  ],
  'expected manifest rows append'
);
assert.deepEqual(target.vfsManifestStats, { rows: 3, bytes: 16 }, 'expected numeric manifest stats to add');

console.log('merge index state semantics test passed');
