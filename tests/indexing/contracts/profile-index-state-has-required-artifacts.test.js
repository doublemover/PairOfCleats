#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { getIndexDir } from '../../../tools/shared/dict-utils.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';

process.env.PAIROFCLEATS_TESTING = '1';

const MODE_LIST = ['code', 'prose', 'extracted-prose', 'records'];
const REQUIRED_DEFAULT = ['chunk_meta', 'token_postings', 'index_state', 'filelists'];

const testConfig = {
  indexing: {
    profile: 'default',
    embeddings: {
      enabled: false,
      mode: 'off',
      hnsw: { enabled: false },
      lancedb: { enabled: false }
    }
  },
  sqlite: { use: false },
  lmdb: { use: false }
};

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'phase18-profile-default',
  envOverrides: { PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig) }
});

for (const mode of MODE_LIST) {
  const dir = getIndexDir(fixtureRoot, mode, userConfig);
  if (!hasIndexMeta(dir)) continue;
  const statePath = path.join(dir, 'index_state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const required = Array.isArray(state?.artifacts?.requiredForSearch)
    ? state.artifacts.requiredForSearch
    : [];
  const requiredSet = new Set(required);
  const present = state?.artifacts?.present || {};
  for (const name of REQUIRED_DEFAULT) {
    assert.equal(requiredSet.has(name), true, `${mode} requiredForSearch missing "${name}"`);
    assert.equal(present[name], true, `${mode} expected present["${name}"] = true`);
  }
}

console.log('profile index_state required artifacts test passed');
