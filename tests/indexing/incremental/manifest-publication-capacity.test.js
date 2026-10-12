import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SIGNATURE_VERSION } from '../../../src/index/build/indexer/signatures.js';
import { loadIncrementalState } from '../../../src/index/build/incremental/planning.js';
import { INCREMENTAL_MANIFEST_MAX_BYTES, decodeIncrementalManifest, encodeIncrementalManifest } from '../../../src/index/build/incremental/manifest-codec.js';
import { loadIncrementalManifest, writeIncrementalManifest } from '../../../src/storage/sqlite/incremental.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-manifest-capacity-'));
try {
  const state = await loadIncrementalState({ repoRoot: root, repoCacheRoot: root, mode: 'code', enabled: true });
  const dependencySignatures = Object.fromEntries(['parse', 'lexical', 'enrichment', 'embeddings', 'artifacts'].map(key => [key, 'a'.repeat(40)]));
  state.manifest.signatureVersion = SIGNATURE_VERSION;
  for (let index = 0; index < 14000; index++) state.manifest.files[`src/file-${index}.js`] = {
    hash: 'a'.repeat(40), size: 10, mtimeMs: 123.25, dependencySignatures, bundles: []
  };
  assert.ok(await writeIncrementalManifest(state.manifestPath, state.manifest));
  const before = await fs.readFile(state.manifestPath);
  assert.ok(before.length <= INCREMENTAL_MANIFEST_MAX_BYTES);
  const formatContext = { repoRoot: root, indexPath: state.manifestPath };
  const decoded = decodeIncrementalManifest(JSON.parse(before), formatContext);
  assert.equal(Object.keys(decoded.files).length, 14000);
  assert.equal(decoded.files['src/file-0.js'].dependencySignatures, decoded.files['src/file-1.js'].dependencySignatures,
    'dependency table restores shared identities rather than duplicate object trees');
  assert.equal(Object.keys(loadIncrementalManifest(root, 'code', { repoRoot: root }).manifest.files).length, 14000);
  assert.equal(Object.keys((await loadIncrementalState({ repoRoot: root, repoCacheRoot: root, mode: 'code', enabled: true })).manifest.files).length, 14000);
  await assert.rejects(writeIncrementalManifest(state.manifestPath, { ...state.manifest, notes: 'x'.repeat(INCREMENTAL_MANIFEST_MAX_BYTES) }),
    { code: 'ERR_INCREMENTAL_MANIFEST_CAPACITY' });
  assert.deepEqual(await fs.readFile(state.manifestPath), before, 'capacity refusal preserves prior readable manifest');
  assert.throws(() => decodeIncrementalManifest({ ...JSON.parse(before), version: 5 }, formatContext), { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });
  await assert.rejects(writeIncrementalManifest(state.manifestPath, { ...state.manifest, artifactSurfaceVersion: 'old' }),
    { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });
  assert.deepEqual(await fs.readFile(state.manifestPath), before, 'unsupported artifact writer preserves the prior snapshot');
  const oversized = encodeIncrementalManifest({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: {} });
  await fs.writeFile(state.manifestPath, oversized.slice(0, -1) + ',"notes":"' + 'x'.repeat(INCREMENTAL_MANIFEST_MAX_BYTES) + '"}');
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(loadIncrementalState({ repoRoot: root, repoCacheRoot: root, mode: 'code', enabled: true }),
      { code: 'ERR_INCREMENTAL_JSON_OVERSIZE' });
  }
  assert.equal((await fs.readdir(state.incrementalDir)).filter(name => name.includes('.corrupt-')).length, 0);
  console.log('Compact manifest capacity refusal preserves prior snapshots and rejects old layouts');
} finally { await fs.rm(root, { recursive: true, force: true }); }
