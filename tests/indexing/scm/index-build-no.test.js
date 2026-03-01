#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

const tempRoot = await makeTempDir('poc-scm-none-provider-');
const repoRootRaw = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

try {
  await fsPromises.mkdir(repoRootRaw, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  const repoRoot = toRealPathSync(repoRootRaw);

  const trackedFile = path.join(repoRoot, 'alpha.js');
  await fsPromises.writeFile(trackedFile, 'export const alpha = 1;\n');

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    syncProcess: false
  });
  const buildResult = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'build_index.js'),
      '--stub-embeddings',
      '--repo',
      repoRoot,
      '--mode',
      'code',
      '--scm-provider',
      'none'
    ],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (buildResult.status !== 0) {
    console.error('no-scm build test failed: build_index failed');
    process.exit(buildResult.status ?? 1);
  }

  await withTemporaryEnv({ PAIROFCLEATS_CACHE_ROOT: cacheRoot }, async () => {
    const userConfig = loadUserConfig(repoRoot);
    const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'code' });
    assert(buildInfo?.buildRoot, 'expected current build info');
    const buildState = JSON.parse(
      await fsPromises.readFile(path.join(buildInfo.buildRoot, 'build_state.json'), 'utf8')
    );
    assert.equal(buildState?.repo?.provider, 'none');
    assert.equal(buildState?.repo?.head, null);

    const codeDir = getIndexDir(repoRoot, 'code', userConfig);
    const fileMetaResult = await loadJsonArrayArtifact(codeDir, 'file_meta');
    const fileMeta = Array.isArray(fileMetaResult?.records)
      ? fileMetaResult.records
      : (Array.isArray(fileMetaResult) ? fileMetaResult : []);
    const files = new Set(fileMeta.map((entry) => entry?.file).filter(Boolean));
    assert(files.has('alpha.js'), 'expected alpha.js to be indexed');
  });
} finally {
  await rmDirRecursive(tempRoot);
}

console.log('no-scm build ok');
