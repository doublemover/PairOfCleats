#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CROSS_FILE_CACHE_SCHEMA_VERSION,
  readCrossFileInferenceCache,
  resolveChunkIdentity
} from '../../../src/index/type-inference-crossfile/cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'type-inference-crossfile-cache-degraded-stats');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const cachePath = path.join(tempRoot, 'output-cache.json');
const chunks = [{
  chunkUid: 'uid-alpha',
  file: 'src/alpha.js',
  name: 'alpha',
  start: 0,
  end: 24,
  codeRelations: {},
  docmeta: {}
}];
const rowId = resolveChunkIdentity(chunks[0], 0);

const writePayload = async (stats) => {
  await fs.writeFile(cachePath, JSON.stringify({
    schemaVersion: CROSS_FILE_CACHE_SCHEMA_VERSION,
    fingerprint: 'degraded-fingerprint',
    stats,
    rows: [{
      id: rowId,
      codeRelations: { calls: [] },
      docmeta: { signature: 'alpha()' }
    }]
  }), 'utf8');
};

await writePayload({
  linkedCalls: 1,
  linkedUsages: 2,
  inferredReturns: 3,
  riskFlows: 4,
  toolingDegradedProviders: 2,
  toolingDegradedWarnings: 5,
  toolingDegradedErrors: 1,
  toolingProvidersExecuted: 3,
  toolingProvidersContributed: 1,
  toolingRequests: 7,
  toolingRequestFailures: 2,
  toolingRequestTimeouts: 1
});

const withDegraded = await readCrossFileInferenceCache({
  cachePath,
  chunks,
  crossFileFingerprint: 'degraded-fingerprint',
  log: () => {}
});
assert.equal(withDegraded.toolingDegradedProviders, 2, 'expected degraded provider count to round-trip from cache');
assert.equal(withDegraded.toolingDegradedWarnings, 5, 'expected degraded warning count to round-trip from cache');
assert.equal(withDegraded.toolingDegradedErrors, 1, 'expected degraded error count to round-trip from cache');
assert.equal(withDegraded.toolingProvidersExecuted, 3, 'expected providers executed count to round-trip from cache');
assert.equal(withDegraded.toolingProvidersContributed, 1, 'expected providers contributed count to round-trip from cache');
assert.equal(withDegraded.toolingRequests, 7, 'expected requests count to round-trip from cache');
assert.equal(withDegraded.toolingRequestFailures, 2, 'expected request failures count to round-trip from cache');
assert.equal(withDegraded.toolingRequestTimeouts, 1, 'expected request timeout count to round-trip from cache');

await writePayload({
  linkedCalls: 7,
  linkedUsages: 8,
  inferredReturns: 9,
  riskFlows: 10
});

const withoutDegraded = await readCrossFileInferenceCache({
  cachePath,
  chunks,
  crossFileFingerprint: 'degraded-fingerprint',
  log: () => {}
});
assert.equal(withoutDegraded.toolingDegradedProviders, 0, 'expected missing degraded provider count to normalize to zero');
assert.equal(withoutDegraded.toolingDegradedWarnings, 0, 'expected missing degraded warning count to normalize to zero');
assert.equal(withoutDegraded.toolingDegradedErrors, 0, 'expected missing degraded error count to normalize to zero');
assert.equal(withoutDegraded.toolingProvidersExecuted, 0, 'expected missing providers executed count to normalize to zero');
assert.equal(withoutDegraded.toolingProvidersContributed, 0, 'expected missing providers contributed count to normalize to zero');
assert.equal(withoutDegraded.toolingRequests, 0, 'expected missing request count to normalize to zero');
assert.equal(withoutDegraded.toolingRequestFailures, 0, 'expected missing request failures count to normalize to zero');
assert.equal(withoutDegraded.toolingRequestTimeouts, 0, 'expected missing request timeout count to normalize to zero');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('cross-file cache degraded stats normalization test passed');
