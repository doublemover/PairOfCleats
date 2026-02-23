import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from './test-env.js';
import { makeTempDir } from './temp.js';
import { runNode } from './run-node.js';
import { runSearchCliWithSpawnSync } from '../../tools/shared/search-cli-harness.js';
import { resolveTestCacheDir } from './test-cache.js';

const DEFAULT_SEARCH_TEST_CONFIG = {
  indexing: {
    scm: { provider: 'none' }
  }
};
const VALID_CACHE_SCOPES = new Set(['isolated', 'shared']);

const normalizeCacheScope = (cacheScope) => {
  const normalized = String(cacheScope || 'isolated').trim().toLowerCase();
  if (!VALID_CACHE_SCOPES.has(normalized)) {
    throw new Error(`Unsupported cacheScope: ${cacheScope}`);
  }
  return normalized;
};

export const createSearchLifecycle = async ({
  root = process.cwd(),
  tempPrefix = 'pairofcleats-search-',
  tempRoot,
  cacheScope = 'isolated',
  cacheName = 'search',
  repoDir = 'repo',
  cacheDir = 'cache',
  embeddings = 'stub',
  testConfig = DEFAULT_SEARCH_TEST_CONFIG,
  extraEnv
} = {}) => {
  const normalizedCacheScope = normalizeCacheScope(cacheScope);
  const { dir: sharedWorkspaceRoot } = resolveTestCacheDir(
    path.join('search-lifecycle', String(cacheName || 'search').trim() || 'search'),
    { root }
  );
  const workspaceRoot = tempRoot || (
    normalizedCacheScope === 'shared'
      ? sharedWorkspaceRoot
      : await makeTempDir(tempPrefix)
  );
  const repoRoot = path.join(workspaceRoot, repoDir);
  const cacheRoot = path.join(workspaceRoot, cacheDir);

  await fsPromises.mkdir(repoRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  const env = applyTestEnv({
    cacheRoot,
    embeddings,
    testConfig,
    extraEnv
  });

  const buildIndex = (buildOptions = 'build index') => {
    const options = typeof buildOptions === 'string'
      ? { label: buildOptions }
      : (buildOptions || {});
    const {
      label = 'build index',
      mode = null,
      extraArgs = []
    } = options;
    const args = [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot];
    if (typeof mode === 'string' && mode.trim()) {
      args.push('--mode', mode.trim());
    }
    if (Array.isArray(extraArgs) && extraArgs.length > 0) {
      args.push(...extraArgs);
    }
    return runNode(args, label, repoRoot, env);
  };

  const runSearch = (args, label = 'search', options = {}) => runNode(
    [path.join(root, 'search.js'), ...args],
    label,
    repoRoot,
    env,
    options
  );

  const runSearchCli = (query, { label = 'search', ...options } = {}) => {
    try {
      return runSearchCliWithSpawnSync({
        query,
        searchPath: path.join(root, 'search.js'),
        repo: repoRoot,
        cwd: repoRoot,
        env,
        ...options
      });
    } catch (error) {
      console.error(`Failed: ${label}`);
      const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
      if (stderr) console.error(stderr);
      process.exit(1);
    }
  };

  const runSearchPayload = (query, options = {}) => {
    const result = runSearchCli(query, options);
    return result?.payload || {};
  };

  return {
    root,
    workspaceRoot,
    repoRoot,
    cacheRoot,
    env,
    buildIndex,
    runSearch,
    runSearchCli,
    runSearchPayload
  };
};
