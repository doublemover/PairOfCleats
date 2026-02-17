#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { getIndexDir } from '../../../tools/shared/dict-utils.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { loadChunkMeta, loadPiecesManifest, readJsonFile } from '../../../src/shared/artifact-io.js';

applyTestEnv();
const testConfig = {
  triage: { recordsDir: './records' },
  indexing: { embeddings: { enabled: false } },
  sqlite: { use: false },
  lmdb: { use: false }
};
process.env.PAIROFCLEATS_TEST_CONFIG = JSON.stringify(testConfig);

const { fixtureRoot, userConfig, codeDir, proseDir } = await ensureFixtureIndex({
  fixtureName: 'public-surface',
  cacheName: 'fixture-public-surface',
  envOverrides: { PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig) }
});

const modes = [];
if (hasIndexMeta(codeDir)) modes.push('code');
if (hasIndexMeta(proseDir)) modes.push('prose');

const extractedDir = getIndexDir(fixtureRoot, 'extracted-prose', userConfig);
if (hasIndexMeta(extractedDir)) modes.push('extracted-prose');

const recordsDir = getIndexDir(fixtureRoot, 'records', userConfig);
if (hasIndexMeta(recordsDir)) modes.push('records');

assert.ok(modes.includes('code'), 'fixture must emit code index');
assert.ok(modes.includes('prose'), 'fixture must emit prose index');
assert.ok(modes.includes('records'), 'fixture must emit records index');

const indexRoot = path.dirname(codeDir);
const report = await validateIndexArtifacts({
  root: fixtureRoot,
  indexRoot,
  modes,
  userConfig,
  strict: true,
  sqliteEnabled: false
});

if (!report.ok) {
  const issues = report.issues.join('\n');
  throw new Error(`golden surface strict validation failed:\n${issues}`);
}

for (const mode of modes) {
  const dir = getIndexDir(fixtureRoot, mode, userConfig, { indexRoot });
  const manifest = loadPiecesManifest(dir, { strict: true });
  assert.ok(manifest.compatibilityKey, `${mode} manifest missing compatibilityKey`);
  const indexState = readJsonFile(path.join(dir, 'index_state.json'));
  assert.ok(indexState?.compatibilityKey, `${mode} index_state missing compatibilityKey`);
  assert.equal(
    indexState.compatibilityKey,
    manifest.compatibilityKey,
    `${mode} compatibilityKey mismatch between index_state and manifest`
  );
  const chunkMeta = await loadChunkMeta(dir, { manifest, strict: true });
  assert.ok(Array.isArray(chunkMeta), `${mode} chunk_meta not loaded`);
}

console.log('golden surface suite test passed');
