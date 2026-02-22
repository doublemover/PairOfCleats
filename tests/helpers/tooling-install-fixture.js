import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot as resolveRepoRoot } from './root.js';

export const setupToolingInstallWorkspace = async (
  name,
  {
    root = resolveRepoRoot(),
    includeOutsideRoot = false
  } = {}
) => {
  const tempRoot = path.join(root, '.testCache', name);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  const outsideRoot = includeOutsideRoot ? path.join(tempRoot, 'outside') : null;

  await fs.rm(tempRoot, { recursive: true, force: true });
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
