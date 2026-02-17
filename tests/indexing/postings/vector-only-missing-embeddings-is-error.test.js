#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

applyTestEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const buildScript = path.join(root, 'build_index.js');
const cacheRoot = path.join(root, '.testCache', 'phase18-vector-only-missing-embeddings');

const testConfig = {
  indexing: {
    profile: 'vector_only',
    embeddings: {
      enabled: true,
      mode: 'off',
      hnsw: { enabled: false },
      lancedb: { enabled: false }
    }
  },
  sqlite: { use: false },
  lmdb: { use: false }
};

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^pairofcleats_/i.test(key))
);
const env = {
  ...baseEnv,  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_STAGE: '',
  PAIROFCLEATS_WORKER_POOL: 'off',
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig)
};

const result = spawnSync(
  process.execPath,
  [buildScript, '--repo', fixtureRoot, '--mode', 'code', '--stage', 'stage2'],
  { cwd: fixtureRoot, env, encoding: 'utf8' }
);

assert.notEqual(result.status, 0, 'expected vector_only build without embeddings to fail');
const output = `${result.stderr || ''}\n${result.stdout || ''}`;
assert.equal(
  output.includes('indexing.profile=vector_only requires embeddings'),
  true,
  'expected error output to mention vector_only embeddings requirement'
);

console.log('vector-only missing embeddings rejection test passed');
