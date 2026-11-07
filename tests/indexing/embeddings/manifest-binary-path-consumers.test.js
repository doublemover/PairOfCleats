import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { loadIndex } from '../../../src/retrieval/cli-index.js';
import { attachDenseVectorLoader } from '../../../src/retrieval/cli/ann-backends.js';
import { createBaseIndex, defaultUserConfig } from '../validate/helpers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { updatePiecesManifest } from '../../helpers/pieces-manifest.js';

const { dir } = await prepareIsolatedTestCacheDir('manifest-binary-path-consumers');
const families = [
  ['dense_vectors', 'dense_vectors_uint8', 'merged'],
  ['dense_vectors_doc', 'dense_vectors_doc_uint8', 'doc'],
  ['dense_vectors_code', 'dense_vectors_code_uint8', 'code']
];
try {
  for (const [family, base, channel] of families) {
    const fixture = await createBaseIndex({ rootDir: path.join(dir, family) });
    const metaPath = path.join(fixture.indexDir, base + '.bin.meta.json'), binaryPath = path.join(fixture.indexDir, base + '.bin');
    const meta = { format: 'uint8-row-major', path: base + '.bin', dims: 2, count: 1 };
    await fs.writeFile(binaryPath, Buffer.from([191, 64])); await fs.writeFile(metaPath, JSON.stringify(meta));
    await fs.writeFile(path.join(fixture.indexDir, 'unmanifested.bin'), Buffer.from([191, 64]));
    await updatePiecesManifest(fixture.indexDir, manifest => manifest.pieces.push(
      { name: family, type: 'embeddings', path: base + '.bin', format: 'bin', count: 1 },
      { name: family + '_binary_meta', type: 'embeddings', path: base + '.bin.meta.json', format: 'json', count: 1 }));
    const validate = () => validateIndexArtifacts({ root: fixture.repoRoot, indexRoot: fixture.indexRoot, modes: ['code'],
      userConfig: defaultUserConfig, strict: true, sqliteEnabled: false, lmdbEnabled: false });
    const direct = () => loadIndex(fixture.indexDir, { strict: true, includeHnsw: false, includeMinhash: false,
      includeFilterIndex: false, includeFileRelations: false, includeRepoMap: false });
    const lazy = () => {
      const idx = {};
      attachDenseVectorLoader({ idx, mode: 'code', dir: fixture.indexDir, strict: true,
        needsAnnArtifacts: true, lazyDenseVectorsEnabled: true, resolvedDenseVectorMode: channel });
      return idx.loadDenseVectors();
    };
    const healthy = await validate();
    assert.equal(healthy.ok, true, healthy.issues.join('; ')); await direct(); assert.ok(await lazy());
    await fs.writeFile(metaPath, JSON.stringify({ ...meta, path: 'unmanifested.bin' }));
    await fs.writeFile(binaryPath, Buffer.from([191]));
    assert.equal((await validate()).ok, false, 'full-size unmanifested binary cannot hide a short manifested binary');
    await assert.rejects(direct, { code: 'ERR_DENSE_VECTOR_PATH_MISMATCH' });
    await assert.rejects(lazy, { code: 'ERR_DENSE_VECTOR_PATH_MISMATCH' });
    await fs.writeFile(binaryPath, Buffer.from([191, 64]));
    for (const changed of [{ ...meta, path: '../escape.bin' }, { ...meta, count: null }]) {
      await fs.writeFile(metaPath, JSON.stringify(changed));
      assert.equal((await validate()).ok, false); await assert.rejects(direct); await assert.rejects(lazy);
    }
    const { path: omitted, ...defaultPath } = meta; void omitted;
    await fs.writeFile(metaPath, JSON.stringify(defaultPath));
    const missingPath = await validate();
    assert.equal(missingPath.ok, false, 'the authoritative persisted metadata schema still requires an explicit path');
    assert.ok(missingPath.issues.some(issue => issue.includes('path')));
    await direct(); assert.ok(await lazy(), 'reader-level omitted-path defaults retain their existing canonical binding');
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Merged/doc/code strict validator and actual direct/lazy search consumers reject two-contained-binary substitution and accept canonical default paths.');
