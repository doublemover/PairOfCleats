import fs from 'node:fs/promises';
import path from 'node:path';
import { getCurrentBuildInfo, getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';

export const normalizeFixturePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

export const findFixtureEntryBySuffix = (entries, suffix) => {
  const normalizedSuffix = normalizeFixturePath(suffix);
  if (!Array.isArray(entries) || !normalizedSuffix) return null;
  return entries.find((entry) => normalizeFixturePath(entry?.file).endsWith(normalizedSuffix)) || null;
};

export const setupExtractedProseFixture = async (name, { root = process.cwd() } = {}) => {
  const tempRoot = path.join(root, '.testCache', name);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  const docsDir = path.join(repoRoot, 'docs');

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(docsDir, { recursive: true });
  await fs.mkdir(cacheRoot, { recursive: true });

  return {
    root,
    tempRoot,
    repoRoot,
    cacheRoot,
    docsDir
  };
};

export const inspectExtractedProseState = (repoRoot) => {
  const userConfig = loadUserConfig(repoRoot);
  const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: 'extracted-prose' });
  const indexRoot = buildInfo?.activeRoot || buildInfo?.buildRoot || null;
  const indexDir = indexRoot
    ? getIndexDir(repoRoot, 'extracted-prose', userConfig, { indexRoot })
    : null;

  return {
    userConfig,
    buildInfo,
    indexRoot,
    indexDir,
    buildStatePath: indexRoot ? path.join(indexRoot, 'build_state.json') : null,
    fileListsPath: indexDir ? path.join(indexDir, '.filelists.json') : null
  };
};
