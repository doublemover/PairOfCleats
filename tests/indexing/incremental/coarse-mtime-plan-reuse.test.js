import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { sha1 } from '../../../src/shared/hash.js';
import { loadIncrementalState } from '../../../src/index/build/incremental/planning.js';
import { loadIncrementalPlan } from '../../../src/index/build/indexer/steps/incremental.js';
import { writeIncrementalManifest } from '../../../src/storage/sqlite/incremental.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-coarse-plan-'));
try {
  const abs = path.join(root, 'source.js'), outDir = path.join(root, 'out');
  const text = 'const A = 1;';
  await fs.writeFile(abs, text); await fs.utimes(abs, 1000, 1000);
  const stat = await fs.stat(abs);
  await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'index_state.json'), JSON.stringify({ stage: 'stage2', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION }));
  await fs.writeFile(path.join(outDir, 'pieces', 'manifest.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [{ path: 'chunk_meta.json' }] }));
  await fs.writeFile(path.join(outDir, 'chunk_meta.json'), '[]');
  const state = await loadIncrementalState({ repoRoot: root, repoCacheRoot: root, mode: 'code', enabled: true });
  state.manifest.files['source.js'] = { size: stat.size, mtimeMs: stat.mtimeMs, hash: sha1(text), dependencySignatures: null };
  await writeIncrementalManifest(state.manifestPath, state.manifest);
  const runtime = { root, repoCacheRoot: root, incrementalEnabled: true, incrementalBundleFormat: 'json',
    stage: 'stage2', semanticPolicy: { enabled: false }, buildId: 'fixture' };
  const plan = () => loadIncrementalPlan({ runtime, mode: 'code', outDir, entries: [{ rel: 'source.js', abs, stat }] });
  assert.equal((await plan()).reused, true);
  await fs.writeFile(abs, 'const B = 2;'); await fs.utimes(abs, 1000, 1000);
  assert.equal((await plan()).reused, false, 'same-size coarse timestamp rewrite must invalidate public plan reuse');
  await fs.writeFile(abs, text); await fs.utimes(abs, 1000, 1000);
  assert.equal((await plan()).reused, true);
  await fs.unlink(abs);
  assert.equal((await plan()).reused, false, 'unreadable required hash is never reusable');
  console.log('Existing-root plan checks exact content for coarse source timestamps');
} finally { await fs.rm(root, { recursive: true, force: true }); }
