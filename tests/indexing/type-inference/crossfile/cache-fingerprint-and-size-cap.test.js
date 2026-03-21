#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildCrossFileFingerprint,
  readCrossFileInferenceCache,
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

const partialCachePath = path.join(cacheDir, 'output-cache-partial.json');
const partialLogs = [];
const partialChunks = [
  {
    chunkUid: 'uid:small-relations',
    file: 'src/small-relations.js',
    name: 'smallRelations',
    kind: 'function',
    start: 0,
    end: 1,
    codeRelations: {
      calls: [['smallRelations', 'callee']]
    },
    docmeta: null
  },
  {
    chunkUid: 'uid:huge-docmeta',
    file: 'src/huge-docmeta.js',
    name: 'hugeDocmeta',
    kind: 'function',
    start: 0,
    end: 1,
    codeRelations: null,
    docmeta: {
      summary: 'y'.repeat(4096)
    }
  }
];

await writeCrossFileInferenceCache({
  cacheDir,
  cachePath: partialCachePath,
  chunks: partialChunks,
  crossFileFingerprint: 'partial-fingerprint',
  stats: {
    linkedCalls: 1
  },
  maxBytes: 700,
  log: (line) => partialLogs.push(String(line || ''))
});

const partialPayload = JSON.parse(await fs.readFile(partialCachePath, 'utf8'));
assert.equal(partialPayload.admission?.mode, 'value-ranked-partial', 'expected partial admission mode');
assert.equal(partialPayload.admission?.retainedRows, 1, 'expected one retained row under tight cap');
assert.equal(partialPayload.admission?.droppedRows, 1, 'expected one dropped row under tight cap');
assert.deepEqual(
  partialPayload.admission?.breakdown?.retained?.counts,
  { 'relations-only': 1 },
  'expected higher-value relations row to be retained'
);
assert.deepEqual(
  partialPayload.admission?.breakdown?.dropped?.counts,
  { 'docmeta-only': 1 },
  'expected oversized docmeta row to be dropped'
);
assert.equal(partialPayload.rows.length, 1, 'expected one persisted row after partial admission');
assert.equal(partialPayload.rows[0]?.id, 'uid:small-relations', 'expected retained row to be the smaller higher-value entry');
assert.equal(
  partialLogs.some((line) => line.includes('cross-file cache write truncated')),
  true,
  'expected truncation log for partial cache admission'
);

const restoredChunks = partialChunks.map((chunk) => ({
  ...chunk,
  codeRelations: null,
  docmeta: null
}));
const readLogs = [];
const restoredStats = await readCrossFileInferenceCache({
  cachePath: partialCachePath,
  chunks: restoredChunks,
  crossFileFingerprint: 'partial-fingerprint',
  log: (line) => readLogs.push(String(line || ''))
});
assert.ok(restoredStats && typeof restoredStats === 'object', 'expected partial cache read to restore stats');
assert.ok(restoredChunks[0]?.codeRelations, 'expected retained row relations to restore from partial cache');
assert.equal(restoredChunks[1]?.docmeta, null, 'expected dropped row docmeta to remain absent');
assert.equal(
  readLogs.some((line) => line.includes('partial, dropped=1')),
  true,
  'expected partial cache hit log to surface dropped rows'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('cross-file cache fingerprint and size cap test passed');
