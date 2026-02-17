#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecordsIndexForRepo } from '../../../src/integrations/triage/index-records.js';

process.env.PAIROFCLEATS_TESTING = '1';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = path.join(root, '.testCache', `triage-records-service-artifacts-${Date.now()}-${process.pid}`);
const repoRoot = path.join(tempRoot, 'repo');
const buildRoot = path.join(tempRoot, 'builds', 'test-build');
const recordPath = path.join(repoRoot, 'record.md');

await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(buildRoot, { recursive: true });
await fs.writeFile(recordPath, '# CVE-2024-0001\nService regression report\n', 'utf8');

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
  profile: { id: 'default' },
  indexingConfig: { profile: 'default' },
  compatibilityKey: 'compat-test',
  cohortKeys: { records: 'cohort-test' },
  buildId: 'test-build',
  repoId: 'repo-test',
  stage: 'stage2',
  embeddingMode: 'service',
  embeddingEnabled: false,
  embeddingService: true,
  shards: { enabled: false },
  twoStage: { enabled: true },
  dictSummary: null,
  repoProvenance: null
};

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

const statePath = path.join(buildRoot, 'index-records', 'index_state.json');
const state = JSON.parse(await fs.readFile(statePath, 'utf8'));

assert.equal(state?.embeddings?.enabled, true, 'expected service-mode records build to report embeddings enabled');
assert.equal(state?.embeddings?.ready, false, 'expected service-mode records build to report embeddings unready');
assert.equal(state?.embeddings?.service, true, 'expected service-mode records build to report service embeddings');

const present = state?.artifacts?.present || {};
assert.equal(present.dense_vectors, false, 'expected dense_vectors artifact to remain absent before vectors are emitted');
assert.equal(
  present.dense_vectors_doc,
  false,
  'expected dense_vectors_doc artifact to remain absent before vectors are emitted'
);
assert.equal(
  present.dense_vectors_code,
  false,
  'expected dense_vectors_code artifact to remain absent before vectors are emitted'
);

console.log('triage records service embeddings pending artifact test passed');
