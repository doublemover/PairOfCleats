#!/usr/bin/env node
import { applyTestEnv, ensureTestingEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';

import {
  createVectorOnlyBuildEnv,
  createVectorOnlyBuildRoots
} from './helpers/vector-only-cleanup-fixture.js';

applyTestEnv();

const {
  buildScript,
  cacheRoot,
  fixtureRoot
} = createVectorOnlyBuildRoots('phase18-vector-only-service-embeddings');

const testConfig = {
  indexing: {
    profile: 'vector_only',
    twoStage: {
      enabled: false,
      stage2: {
        embeddings: {
          enabled: true,
          mode: 'service'
        }
      }
    },
    embeddings: {
      enabled: true,
      mode: 'service',
      hnsw: { enabled: false },
      lancedb: { enabled: false }
    }
  },
  sqlite: { use: false },
  lmdb: { use: false }
};

const env = createVectorOnlyBuildEnv({ cacheRoot, testConfig });
ensureTestingEnv(env);

await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const result = runNode(
  [buildScript, '--repo', fixtureRoot, '--mode', 'code', '--progress', 'log'],
  'vector-only service embeddings pending artifacts build index',
  fixtureRoot,
  env,
  { encoding: 'utf8', stdio: 'pipe', allowFailure: true }
);

const output = `${result.stderr || ''}\n${result.stdout || ''}`;
assert.equal(
  output.includes('indexing.profile=vector_only requires embeddings'),
  false,
  `expected vector_only service-embedding build to bypass inline-only guard:\n${output}`
);
assert.equal(
  output.includes('[embeddings] Queued embedding job'),
  true,
  `expected service-mode build to queue embeddings:\n${output}`
);

const indexDirLine = output
  .split(/\r?\n/)
  .find((line) => line.startsWith('[init] code index dir: '));
assert.ok(indexDirLine, `expected build output to include code index directory:\n${output}`);
const codeDir = indexDirLine.slice('[init] code index dir: '.length).trim();
assert.ok(codeDir, `expected parsed code index directory to be non-empty:\n${output}`);
const statePath = path.join(codeDir, 'index_state.json');
const state = JSON.parse(await fs.readFile(statePath, 'utf8'));

const embeddings = state?.embeddings || {};
assert.equal(embeddings.enabled, true, 'expected service-mode embeddings to be enabled');
assert.equal(embeddings.ready, false, 'expected service-mode embeddings to be unready during index build');
assert.equal(embeddings.pending, true, 'expected service-mode embeddings to be pending');
assert.equal(embeddings.service, true, 'expected service-mode embeddings to be flagged as service');

const present = state?.artifacts?.present || {};
assert.equal(present.dense_vectors, false, 'expected dense_vectors artifact to remain absent before service processing');
assert.equal(
  present.dense_vectors_code,
  false,
  'expected dense_vectors_code artifact to remain absent before service processing'
);

console.log('vector-only service embeddings pending artifact test passed');

