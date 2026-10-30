import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadIndexState } from '../../../src/retrieval/cli/index-state.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';

const { dir } = await prepareIsolatedTestCacheDir('absent-index-state');
const options = { resolveOptions: { indexBaseRootByMode: { code: dir }, explicitRef: true }, onCompatibilityWarning() {} };
try {
  assert.equal(loadIndexState(dir, {}, 'code', options), null, 'an unbuilt mode has no state');
  const indexDir = path.join(dir, 'index-code');
  await fs.mkdir(indexDir);
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]');
  assert.throws(() => loadIndexState(dir, {}, 'code', options),
    { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' }, 'existing artifacts without a format identity remain rejected');
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({ artifactSurfaceVersion: 'superseded' }));
  assert.throws(() => loadIndexState(dir, {}, 'code', options), { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' });
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION }));
  assert.equal(loadIndexState(dir, {}, 'code', options).artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
  const cacheRoot = path.join(dir, 'cache', 'repos', 'direct-state');
  const directDir = path.join(cacheRoot, 'index-code');
  await fs.mkdir(directDir, { recursive: true });
  await fs.writeFile(path.join(directDir, 'index_state.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION }));
  const directOptions = { ...options, resolveOptions: { indexBaseRootByMode: { code: cacheRoot }, explicitRef: true } };
  const cleanup = await withExclusiveRepoCacheCleanup(cacheRoot, () => {
    assert.throws(() => loadIndexState(dir, {}, 'code', directOptions),
      { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' }, 'a direct state read must acquire admission before touching cache data');
  });
  assert.equal(cleanup.protected, false);
  assert.equal(loadIndexState(dir, {}, 'code', directOptions).artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Absent modes stay distinguishable from unsupported existing index artifacts');
