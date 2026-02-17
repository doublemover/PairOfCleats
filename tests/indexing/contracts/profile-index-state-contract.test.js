#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { getIndexDir } from '../../../tools/shared/dict-utils.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';

process.env.PAIROFCLEATS_TESTING = '1';

const MODE_LIST = ['code', 'prose', 'extracted-prose', 'records'];

const readIndexStates = async (fixtureRoot, userConfig) => {
  const states = new Map();
  for (const mode of MODE_LIST) {
    const dir = getIndexDir(fixtureRoot, mode, userConfig);
    if (!hasIndexMeta(dir)) continue;
    const statePath = path.join(dir, 'index_state.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    states.set(mode, state);
  }
  return states;
};

const assertProfileContract = (state, expectedId, mode) => {
  assert.equal(state?.profile?.id, expectedId, `${mode} index_state profile.id mismatch`);
  assert.equal(state?.profile?.schemaVersion, 1, `${mode} index_state profile.schemaVersion mismatch`);
  assert.equal(state?.artifacts?.schemaVersion, 1, `${mode} index_state artifacts.schemaVersion mismatch`);
  assert.ok(state?.artifacts?.present && typeof state.artifacts.present === 'object', `${mode} missing artifacts.present`);
  assert.ok(Array.isArray(state?.artifacts?.omitted), `${mode} missing artifacts.omitted`);
  assert.ok(Array.isArray(state?.artifacts?.requiredForSearch), `${mode} missing artifacts.requiredForSearch`);
};

const defaultConfig = {
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

const defaultFixture = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'phase18-profile-default',
  envOverrides: { PAIROFCLEATS_TEST_CONFIG: JSON.stringify(defaultConfig) }
});
const defaultStates = await readIndexStates(defaultFixture.fixtureRoot, defaultFixture.userConfig);
assert.ok(defaultStates.size > 0, 'expected at least one indexed mode for default profile fixture');
for (const [mode, state] of defaultStates.entries()) {
  assertProfileContract(state, 'default', mode);
}

const vectorOnlySampleState = {
  generatedAt: new Date().toISOString(),
  artifactSurfaceVersion: '0.0.1',
  mode: 'code',
  profile: { id: 'vector_only', schemaVersion: 1 },
  artifacts: {
    schemaVersion: 1,
    present: {
      chunk_meta: true,
      dense_vectors: true,
      index_state: true,
      filelists: true
    },
    omitted: [],
    requiredForSearch: ['chunk_meta', 'dense_vectors', 'index_state', 'filelists']
  }
};
const vectorValidation = validateArtifact('index_state', vectorOnlySampleState);
assert.equal(vectorValidation.ok, true, `vector_only index_state sample should validate: ${vectorValidation.errors.join('; ')}`);

console.log('profile index_state contract test passed');
