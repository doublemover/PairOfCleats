import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { shouldReuseIncrementalIndex } from '../../../src/index/build/incremental.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SIGNATURE_VERSION } from '../../../src/index/build/indexer/signatures.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

export const createReuseFixture = async label => {
  const { dir: tempRoot } = await prepareIsolatedTestCacheDir(label);
  const outDir = path.join(tempRoot, 'index');
  await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'src'));
  const indexState = { stage: 'stage2', mode: 'code', generatedAt: new Date().toISOString(), artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION };
  const pieceManifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [{ name: 'chunk_meta', path: 'chunk_meta.json' }] };
  await fs.writeFile(path.join(outDir, 'index_state.json'), JSON.stringify(indexState));
  await fs.writeFile(path.join(outDir, 'pieces/manifest.json'), JSON.stringify(pieceManifest));
  await fs.writeFile(path.join(outDir, 'chunk_meta.json'), '[]');
  const entries = [], files = {};
  for (const [rel, text] of [['src/a.js', 'const a=1;'], ['src/b.js', 'export const b = 20;\n']]) {
    const abs = path.join(tempRoot, rel);
    await fs.writeFile(abs, text);
    const stat = await fs.stat(abs);
    entries.push({ rel, abs, stat });
    files[rel] = { size: stat.size, mtimeMs: stat.mtimeMs, hash: createHash('sha1').update(text).digest('hex') };
  }
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, signatureVersion: SIGNATURE_VERSION, files };
  return { tempRoot, outDir, entries, manifest, pieceManifest };
};

/** Shared portable positive/content controls. Physical link escape remains
 * independently exercised by reuse.test.js on the capable CI authority runner. */
export const assertReuseSourceContract = async ({ outDir, entries, manifest }) => {
  const query = overrides => shouldReuseIncrementalIndex({ outDir, entries, manifest, stage: 'stage1', ...overrides });
  assert.equal(await query(), true, 'unchanged actual source bytes qualify reuse');
  assert.equal(await query({ manifest: { ...manifest, files: { ...manifest.files,
    'src/c.js': { size: 30, mtimeMs: 789 } } } }), false, 'deleted source refuses reuse');
  assert.equal(await query({ stage: 'stage2', entries: [{ ...entries[0], stat: { ...entries[0].stat, size: entries[0].stat.size + 1 } }, entries[1]] }),
    false, 'changed source size refuses reuse');
  assert.equal(await query({ manifest: { ...manifest, files: { ...manifest.files,
    'src/a.js': { ...manifest.files['src/a.js'], hash: '0'.repeat(40) } } } }), false,
  'identical timestamps cannot authorize different source bytes');
};
