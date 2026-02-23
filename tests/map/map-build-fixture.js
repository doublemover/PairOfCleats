import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';
import { getIndexDir, resolveRepoConfig } from '../../tools/shared/dict-utils.js';
import { prepareTestCacheDir } from '../helpers/test-cache.js';

export async function prepareMapBuildFixture({
  tempName,
  files = [],
  envOverrides = {},
  buildIndexArgs = []
} = {}) {
  if (!tempName) {
    throw new Error('tempName is required');
  }

  const root = process.cwd();
  const { dir: tempRoot } = await prepareTestCacheDir(tempName);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  await fsPromises.mkdir(repoRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

  for (const [relPath, contents] of files) {
    const absolutePath = path.join(repoRoot, relPath);
    await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fsPromises.writeFile(absolutePath, contents);
  }

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: {
      indexing: {
        scm: { provider: 'none' }
      }
    },
    ...envOverrides
  });

  const buildArgs = [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--repo',
    repoRoot,
    ...buildIndexArgs
  ];

  const buildResult = spawnSync(process.execPath, buildArgs, {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  });

  if (buildResult.status !== 0) {
    const reason = buildResult.error?.message ?? `exit ${buildResult.status ?? '<unknown>'}`;
    throw new Error(`Failed to build index for ${tempName}: ${reason}`);
  }

  const { userConfig } = resolveRepoConfig(repoRoot);
  const indexDir = getIndexDir(repoRoot, 'code', userConfig, {});

  return { tempRoot, repoRoot, cacheRoot, indexDir, env };
}
