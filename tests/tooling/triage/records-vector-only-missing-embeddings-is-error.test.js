#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecordsIndexForRepo } from '../../../src/integrations/triage/index-records.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, `triage-records-vector-only-missing-embeddings-${Date.now()}-${process.pid}`);
const repoRoot = path.join(tempRoot, 'repo');
const buildRoot = path.join(tempRoot, 'builds', 'test-build');
const recordPath = path.join(repoRoot, 'record.md');

await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(buildRoot, { recursive: true });
await fs.writeFile(recordPath, '# CVE-2024-0001\nVector-only records test\n', 'utf8');

const runtime = {
  root: repoRoot,
  buildRoot,
  userConfig: {
    cache: {
      root: path.join(tempRoot, 'cache')
    }
  },
  postingsConfig: {
    enablePhraseNgrams: true,
    enableChargrams: true,
    fielded: true
  },
  dictWords: new Set(),
  dictConfig: {},
  modelId: 'stub-model',
  useStubEmbeddings: false,
  workerPool: null,
  getChunkEmbedding: async () => [],
  profile: { id: 'vector_only', schemaVersion: 1 },
  indexingConfig: { profile: 'vector_only' },
  compatibilityKey: 'compat-test',
  cohortKeys: { records: 'cohort-test' },
  buildId: 'test-build',
  repoId: 'repo-test',
  stage: 'stage2',
  embeddingMode: 'off',
  embeddingEnabled: false,
  embeddingService: false,
  shards: { enabled: false },
  twoStage: { enabled: true },
  dictSummary: null,
  repoProvenance: null
};

let failed = false;
try {
  await buildRecordsIndexForRepo({
    runtime,
    discovery: {
      entries: [
        {
          abs: recordPath,
          rel: 'record.md',
          skip: false,
          record: {
            source: 'repo',
            recordType: 'record'
          }
        }
      ]
    }
  });
} catch (err) {
  failed = true;
  assert.match(
    String(err?.message || err),
    /indexing\.profile=vector_only requires embeddings/i,
    'expected vector_only records build to fail with embedding requirement guidance'
  );
}

if (!failed) {
  throw new Error('Expected vector_only records build without embeddings to fail');
}

console.log('triage records vector-only missing embeddings rejection test passed');
