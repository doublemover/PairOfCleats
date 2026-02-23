import fs from 'node:fs';
import path from 'node:path';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

export const loadPackageScripts = (root) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.scripts || {};
};

export const resolveFailureLogRoot = ({ root, logDirOverride }) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return logDirOverride
    ? path.resolve(logDirOverride)
    : path.join(root, '.testLogs', timestamp);
};

export const resolveScriptCoveragePaths = ({ root, logDirOverride, baseCacheRootOverride = '' }) => {
  const baseCacheRoot = baseCacheRootOverride
    ? path.resolve(baseCacheRootOverride)
    : resolveTestCachePath(root, 'script-coverage');
  const repoCacheRoot = path.join(baseCacheRoot, 'repo');
  const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
  const failureLogRoot = resolveFailureLogRoot({ root, logDirOverride });
  return {
    baseCacheRoot,
    repoCacheRoot,
    fixtureRoot,
    failureLogRoot,
    ciOutDir: path.join(baseCacheRoot, 'ci-artifacts'),
    mergeDir: path.join(baseCacheRoot, 'merge'),
    shellWorkDir: path.join(baseCacheRoot, 'shell')
  };
};
