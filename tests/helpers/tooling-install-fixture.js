import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot as resolveRepoRoot } from './root.js';
import { prepareTestCacheDir } from './test-cache.js';

export const setupToolingInstallWorkspace = async (
  name,
  {
    root = resolveRepoRoot(),
    includeOutsideRoot = false
  } = {}
) => {
  const { dir: tempRoot } = await prepareTestCacheDir(name, { root });
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  const outsideRoot = includeOutsideRoot ? path.join(tempRoot, 'outside') : null;

  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(cacheRoot, { recursive: true });
  if (outsideRoot) {
    await fs.mkdir(outsideRoot, { recursive: true });
  }

  return {
    root,
    tempRoot,
    repoRoot,
    cacheRoot,
    outsideRoot
  };
};
