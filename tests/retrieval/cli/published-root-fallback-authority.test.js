import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { getBuildsRoot, getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { resolveIndexDir } from '../../../src/retrieval/cli-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';

const { dir: root } = await prepareIsolatedTestCacheDir('published-root-fallback-authority');
applyTestEnv({ cacheRoot: root });
const repoRoot = path.join(root, 'repo');
await fs.mkdir(repoRoot);
try {
  const buildsRoot = getBuildsRoot(repoRoot, {}), cache = getRepoCacheRoot(repoRoot, {});
  const pinned = path.join(buildsRoot, 'pinned'), staging = path.join(buildsRoot, 'newer-staging');
  await seedPublishedArtifacts({ buildRoot: pinned, mode: 'code' });
  for (const index of [path.join(staging, 'index-code'), path.join(repoRoot, 'index-code'), path.join(cache, 'index-code')]) {
    await fs.mkdir(path.join(index, 'pieces'), { recursive: true });
    await fs.writeFile(path.join(index, 'chunk_meta.json'), '[{"file":"staging-only.js"}]');
    await fs.writeFile(path.join(index, 'pieces/manifest.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [] }));
  }
  const pointer = path.join(buildsRoot, 'current.json');
  const publish = roots => fs.writeFile(pointer, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: 'pinned', buildRoot: path.relative(cache, pinned), buildRootsByMode: roots }));
  await publish({ code: path.relative(cache, pinned) });
  assert.equal(resolveIndexDir(repoRoot, 'code', {}), path.join(pinned, 'index-code'));
  await fs.rm(path.join(pinned, 'index-code'), { recursive: true });
  assert.throws(() => resolveIndexDir(repoRoot, 'code', {}), /published generation is unavailable/,
    'neither newer marker files nor repo-local/cache-root markers replace a broken promoted pointer');
  await publish({ prose: path.relative(cache, pinned) });
  assert.throws(() => resolveIndexDir(repoRoot, 'code', {}), /published generation is unavailable/,
    'an explicitly absent mode cannot fall back to the primary generation');
  assert.equal(resolveIndexDir(repoRoot, 'code', {}, { explicitRef: true, indexDirByMode: { code: path.join(staging, 'index-code') } }),
    path.join(staging, 'index-code'), 'explicit reference resolution remains separate from normal fallback authority');
  assert.throws(() => resolveIndexDir(repoRoot, 'code', {}, { explicitRef: true, indexDirByMode: {} }), /explicit as-of target/);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Normal search never replaces missing promoted modes with staging or local marker-only data.');
