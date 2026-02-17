#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { getIndexDir } from '../../../tools/shared/dict-utils.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';

process.env.PAIROFCLEATS_TESTING = '1';

const MODE_LIST = ['code', 'prose', 'extracted-prose', 'records'];

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
  const artifacts = state?.artifacts || {};
  const present = artifacts.present || {};
  const omitted = Array.isArray(artifacts.omitted) ? artifacts.omitted : [];
  const omittedSet = new Set(omitted);
  assert.equal(omittedSet.size, omitted.length, `${mode} artifacts.omitted contains duplicates`);
  for (const [name, isPresent] of Object.entries(present)) {
    if (isPresent === true) {
      assert.equal(
        omittedSet.has(name),
        false,
        `${mode} artifacts.omitted should not include present artifact "${name}"`
      );
    } else {
      assert.equal(
        omittedSet.has(name),
        true,
        `${mode} artifacts.omitted should include missing artifact "${name}"`
      );
    }
  }
}

console.log('profile artifacts present/omitted consistency test passed');
