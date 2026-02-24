#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildCrossFileFingerprint,
  writeCrossFileInferenceCache
} from '../../../../src/index/type-inference-crossfile/cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'crossfile-cache-fingerprint-and-size-cap');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const chunks = [
  {
    chunkUid: 'uid:alpha',
    file: 'src/alpha.js',
    name: 'alpha',
    kind: 'function',
    start: 0,
    end: 32,
    codeRelations: {
      calls: [['alpha', 'beta']]
    },
    docmeta: {
      signature: 'alpha()'
    }
  }
];

const fileRelationsA = new Map([
  ['src/alpha.js', {
    usages: ['Widget'],
    imports: ['./beta.js']
  }]
]);
const fileRelationsB = new Map([
  ['src/alpha.js', {
    usages: ['Widget'],
    imports: ['./gamma.js']
  }]
]);

const fingerprintA = buildCrossFileFingerprint({
  chunks,
  enableTypeInference: true,
  enableRiskCorrelation: true,
  useTooling: false,
  fileRelations: fileRelationsA
});
const fingerprintB = buildCrossFileFingerprint({
  chunks,
  enableTypeInference: true,
  enableRiskCorrelation: true,
  useTooling: false,
  fileRelations: fileRelationsB
});
assert.notEqual(
  fingerprintA,
  fingerprintB,
  'cross-file fingerprint must change when relation payload changes, even if usage counts match'
);

const cacheDir = path.join(tempRoot, 'cache', 'cross-file');
const cachePath = path.join(cacheDir, 'output-cache.json');

const oversizedChunk = {
  chunkUid: 'uid:oversized',
  file: 'src/oversized.js',
  name: 'oversized',
  kind: 'function',
  start: 0,
  end: 1,
  codeRelations: {
    calls: Array.from({ length: 120 }, (_, index) => ['oversized', `callee_${index}`])
  },
  docmeta: {
    summary: 'x'.repeat(4096)
  }
};

await writeCrossFileInferenceCache({
  cacheDir,
  cachePath,
  chunks: [oversizedChunk],
  crossFileFingerprint: 'oversized-fingerprint',
  stats: {
    linkedCalls: 120
  },
  maxBytes: 350,
  log: () => {}
});

const missingAfterCap = await fs.access(cachePath).then(() => false).catch(() => true);
assert.equal(
  missingAfterCap,
  true,
  'cache file should not be written when estimated payload exceeds maxBytes'
);

await writeCrossFileInferenceCache({
  cacheDir,
  cachePath,
  chunks,
  crossFileFingerprint: 'small-fingerprint',
  stats: {
    linkedCalls: 1
  },
  maxBytes: 1024 * 1024,
  log: () => {}
});

const writtenPayload = JSON.parse(await fs.readFile(cachePath, 'utf8'));
assert.equal(writtenPayload.fingerprint, 'small-fingerprint', 'expected cache fingerprint to match write input');
assert.equal(Array.isArray(writtenPayload.rows), true, 'expected persisted rows array');
assert.equal(writtenPayload.rows.length, 1, 'expected one cached row for compact input');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('cross-file cache fingerprint and size cap test passed');
