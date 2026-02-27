import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadUserConfig, resolveSqlitePaths } from '../../tools/shared/dict-utils.js';
import { applyTestEnv } from './test-env.js';
import { rmDirRecursive } from './temp.js';
import { resolveTestCacheDir } from './test-cache.js';

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

const compactLabel = (value, maxLen = 32) => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!normalized) return 'run';
  return normalized.length > maxLen ? normalized.slice(0, maxLen) : normalized;
};

const run = (args, label, options) => {
  const result = spawnSync(process.execPath, args, options);
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
  return result;
};

export const setupIncrementalRepo = async ({ name, testConfig = null }) => {
  if (!name) throw new Error('name is required');
  const suffixRaw = typeof process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX === 'string'
    ? process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX.trim()
    : '';
  const scopedName = suffixRaw ? `${name}-${suffixRaw}` : name;
  const scopeHash = createHash('sha1').update(scopedName).digest('hex').slice(0, 8);
  const runToken = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
  const label = compactLabel(name, 18);
  const { dir: incrementalRoot } = resolveTestCacheDir('sqlite-incremental', { root: ROOT });
  const tempRoot = path.join(incrementalRoot, `${label}-${scopeHash}-${runToken}`);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');

  await rmDirRecursive(tempRoot, { retries: 10, delayMs: 100 });
  await fsPromises.mkdir(tempRoot, { recursive: true });
  await fsPromises.cp(FIXTURE_ROOT, repoRoot, { recursive: true });

  const nodeOptions = stripMaxOldSpaceFlag(process.env.NODE_OPTIONS || '');
  const effectiveTestConfig =
    testConfig ?? {
      tooling: {
        autoEnableOnDetect: false
      }
    };
  const env = applyTestEnv({
    testing: '1',
    cacheRoot,
    embeddings: 'stub',
    testConfig: effectiveTestConfig,
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off',
      PAIROFCLEATS_MAX_OLD_SPACE_MB: '8192',
      NODE_OPTIONS: nodeOptions || null
    }
  });

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

