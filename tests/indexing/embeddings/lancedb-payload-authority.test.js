import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as lance from '@lancedb/lancedb';
import { assertLanceDbPayload } from '../../../src/shared/lancedb.js';
import { validateEmbeddingArtifacts } from '../../../src/index/validate/embeddings.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const { dir: root } = await prepareIsolatedTestCacheDir('lancedb-payload-authority');
const dir = path.join(root, 'declared-backend');
const meta = { version: 1, dims: 2, count: 1, expectedCount: 1, table: 'vectors', model: 'fixture',
  metric: 'l2', embeddingColumn: 'vector', idColumn: 'id' };
const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [
  { name: 'dense_vectors_lancedb', path: 'declared-backend', format: 'dir', checksum: null },
  { name: 'dense_vectors_lancedb_meta', path: 'declared.meta.json', format: 'json' }
] };
const validate = () => {
  const report = { issues: [], warnings: [], hints: [] };
  const modeReport = { ok: true, missing: [] };
  validateEmbeddingArtifacts({ report, mode: 'code', dir: root, manifest, strict: true,
    modeReport, chunkMeta: [{}], validateManifestCount() {}, lanceConfig: { enabled: true, table: 'vectors' },
    readJsonArtifact: name => name === 'dense_vectors_lancedb_meta' ? meta : null });
  return report;
};
try {
  await fs.writeFile(path.join(root, 'declared.meta.json'), JSON.stringify(meta));
  const db = await lance.connect(dir);
  let table;
  try { table = await db.createTable('vectors', [{ id: 0, vector: [1, 0] }]); }
  finally { await table?.close?.(); await db.close(); }
  assert.doesNotThrow(() => assertLanceDbPayload(dir, meta));
  assert.deepEqual(validate().issues, [], 'strict validation accepts a real installed native table');
  const saved = path.join(root, 'saved');
  await fs.cp(dir, saved, { recursive: true });
  for (const defect of ['regular-file', 'empty-directory', 'missing-manifest', 'missing-fragments', 'empty-manifest', 'empty-fragments']) {
    await fs.rm(dir, { recursive: true, force: true });
    if (defect === 'regular-file') await fs.writeFile(dir, 'not a database');
    else if (defect === 'empty-directory') await fs.mkdir(dir);
    else {
      await fs.cp(saved, dir, { recursive: true });
      const section = defect.includes('manifest') ? '_versions' : 'data';
      const sectionPath = path.join(dir, 'vectors.lance', section);
      if (defect.startsWith('missing')) await fs.rm(sectionPath, { recursive: true });
      else for (const file of await fs.readdir(sectionPath)) await fs.truncate(path.join(sectionPath, file), 0);
    }
    assert.throws(() => assertLanceDbPayload(dir, meta), undefined, defect);
    const report = validate();
    assert.equal(report.issues.length, 1, `${defect}: declared corruption fails strict validation`);
    assert.match(report.issues[0], /dense_vectors_lancedb payload invalid/);
  }
  const report = { issues: [], warnings: [], hints: [] };
  validateEmbeddingArtifacts({ report, mode: 'code', dir: root, manifest: { pieces: [] }, strict: true,
    modeReport: { ok: true, missing: [] }, chunkMeta: [{}], validateManifestCount() {},
    lanceConfig: { enabled: false }, readJsonArtifact: () => null });
  assert.deepEqual(report.issues, [], 'an absent optional backend is distinct from a declared corrupt backend');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Strict LanceDB admission rejects missing, empty and incorrectly typed native payloads.');
