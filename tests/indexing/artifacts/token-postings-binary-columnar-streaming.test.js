#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { enqueueTokenPostingsArtifacts } from '../../../src/index/build/artifacts/token-postings.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const testRoot = resolveTestCachePath(root, 'token-postings-binary-columnar-streaming');
const outDir = path.join(testRoot, 'out');

await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const queued = [];
const pieceFiles = [];

const postings = {
  tokenVocab: ['alpha', 'beta', 'gamma'],
  tokenPostingsList: [
    [[1, 2], [7, 1], [19, 4]],
    [[0, 1], [4, 3]],
    [[2, 5]]
  ],
  avgDocLen: 3
};
const state = {
  docLengths: [3, 5, 6],
  tokenVocabIds: null
};

await enqueueTokenPostingsArtifacts({
  outDir,
  postings,
  state,
  tokenPostingsFormat: 'json',
  tokenPostingsUseShards: false,
  tokenPostingsShardSize: 100,
  tokenPostingsBinaryColumnar: true,
  tokenPostingsCompression: null,
  tokenPostingsEstimatedBytes: 1024 * 1024,
  enqueueJsonObject: () => {},
  enqueueWrite: (label, job, meta = {}) => {
    queued.push({ label, job, meta });
  },
  addPieceFile: (entry, filePath) => {
    pieceFiles.push({ entry, filePath });
  },
  formatArtifactLabel: (filePath) => path.relative(outDir, filePath).replace(/\\/g, '/')
});

const binaryWrite = queued.find((entry) => entry.label === 'token_postings.binary-columnar.bundle');
assert.ok(binaryWrite, 'expected token_postings binary-columnar write to be queued');

const phaseLog = [];
const result = await binaryWrite.job({
  setPhase: (phase) => {
    phaseLog.push(String(phase || ''));
  }
});

assert.equal(result?.directFdStreaming, true, 'expected token_postings binary-columnar write to stream directly to disk');
assert.deepEqual(
  phaseLog,
  ['materialize:token-postings-binary-columnar', 'publish:token-postings-binary-meta'],
  'expected token_postings binary-columnar write to report materialize/publish phases'
);

const dataPath = path.join(outDir, 'token_postings.binary-columnar.bin');
const offsetsPath = path.join(outDir, 'token_postings.binary-columnar.offsets.bin');
const lengthsPath = path.join(outDir, 'token_postings.binary-columnar.lengths.varint');
const metaPath = path.join(outDir, 'token_postings.binary-columnar.meta.json');

await Promise.all([
  fs.access(dataPath),
  fs.access(offsetsPath),
  fs.access(lengthsPath),
  fs.access(metaPath)
]);

const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
assert.equal(meta.format, 'binary-columnar-v1', 'expected binary-columnar format marker');
assert.equal(meta.count, postings.tokenVocab.length, 'expected binary-columnar row count');

assert.ok(
  pieceFiles.some((entry) => entry.entry?.name === 'token_postings_binary_columnar'),
  'expected token_postings binary-columnar piece registration'
);

await fs.rm(testRoot, { recursive: true, force: true });

console.log('token postings binary-columnar streaming test passed');
