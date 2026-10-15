import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readIndexCoverage, compareIndexRevision } from '../../../src/integrations/core/status-coverage.js';
import { compareIndexedFiles } from '../../../src/integrations/core/status-freshness.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { sha1 } from '../../../src/shared/hash.js';

assert.equal(compareIndexRevision({ commit: 'a', dirty: false }, { commit: 'b', dirty: false }), 'revision-changed');
assert.equal(compareIndexRevision({ commit: 'a', dirty: false }, { commit: 'a', dirty: true }), 'working-tree-unverified');
assert.equal(compareIndexRevision({ commit: 'a', dirty: false }, { commit: 'a', dirty: false }), 'same-clean-revision');
assert.equal(compareIndexRevision(null, { commit: 'a' }), 'unknown');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-coverage-'));
try {
  const indexDir = path.join(root, 'active');
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  const rows = ['same.js', 'changed.js', 'missing.js', '../outside.js'].map((file, id) => ({ id, file, hash: sha1('before'), hashAlgo: 'sha1' }));
  const json = JSON.stringify(rows);
  await fs.writeFile(path.join(indexDir, 'file_meta.json'), json);
  await fs.writeFile(path.join(indexDir, 'pieces/manifest.json'), JSON.stringify({ version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [
      { name: 'file_meta', path: 'file_meta.json', bytes: Buffer.byteLength(json), count: rows.length }
    ] }));
  await fs.writeFile(path.join(root, 'same.js'), 'before');
  await fs.writeFile(path.join(root, 'changed.js'), 'after');
  const comparison = await compareIndexedFiles({ repoRoot: root, indexDir });
  assert.equal(comparison.status, 'compared');
  assert.equal(comparison.unchanged, 1);
  assert.deepEqual(comparison.changed, ['changed.js']);
  assert.deepEqual(comparison.missing, ['missing.js']);
  assert.deepEqual(comparison.unknown, ['../outside.js']);
  assert.equal(comparison.newFilesChecked, false);
  assert.equal((await compareIndexedFiles({ repoRoot: root, indexDir, maxFiles: 1 })).truncated, true);
  await fs.writeFile(path.join(root, 'index-code.json'), JSON.stringify({
    indexDir, generatedAt: '2026-10-14', files: { scanned: 8, skipped: 2, skippedByReason: { tooLarge: 2 } }, chunks: { total: 12 }
  }));
  const read = (target) => readIndexCoverage({ metricsDir: root, repoCacheRoot: root, indexes: { code: target } });
  assert.equal(read(indexDir).modes.code.files.skipped, 2);
  assert.equal(read(indexDir).workingTreeComparison, 'not-performed');
  assert.equal(read(path.join(root, 'other')).modes.code.status, 'unavailable', 'old metrics cannot describe a different active index');
  await fs.writeFile(path.join(root, 'watch-state.json'), '{bad');
  assert.equal(read(indexDir).watcher, null);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('coverage is bounded, generation-associated and honest about live freshness');
