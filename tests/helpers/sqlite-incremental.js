import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadUserConfig, resolveSqlitePaths } from '../../tools/dict-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'sample');

const stripMaxOldSpaceFlag = (options) => {
  if (!options) return '';
  return options
    .replace(/--max-old-space-size=\d+/g, '')
    .replace(/--max-old-space-size\s+\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const run = (args, label, options) => {
  const result = spawnSync(process.execPath, args, options);
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
  return result;
};

export const setupIncrementalRepo = async ({ name }) => {
  if (!name) throw new Error('name is required');
  const tempRoot = path.join(root, '.testCache', 'sqlite-incremental', name);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');

  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(tempRoot, { recursive: true });
  await fsPromises.cp(FIXTURE_ROOT, repoRoot, { recursive: true });

  const nodeOptions = stripMaxOldSpaceFlag(process.env.NODE_OPTIONS || '');
  const env = {
    ...process.env,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub',
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_MAX_OLD_SPACE_MB: '8192'
  };
  if (nodeOptions) {
    env.NODE_OPTIONS = nodeOptions;
  } else {
    delete env.NODE_OPTIONS;
  }
  process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  process.env.PAIROFCLEATS_WORKER_POOL = 'off';
  process.env.PAIROFCLEATS_MAX_OLD_SPACE_MB = '8192';
  if (nodeOptions) {
    process.env.NODE_OPTIONS = nodeOptions;
  } else {
    delete process.env.NODE_OPTIONS;
  }

  return {
    root: ROOT,
    repoRoot,
    cacheRoot,
    env,
    userConfig: loadUserConfig(repoRoot),
    run,
    runCapture: (args, label) => run(args, label, { cwd: repoRoot, env, encoding: 'utf8' })
  };
};

export const ensureSqlitePaths = (repoRoot, userConfig) => resolveSqlitePaths(repoRoot, userConfig);

