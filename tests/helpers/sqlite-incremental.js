import fsPromises from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadUserConfig, resolveSqlitePaths } from '../../tools/shared/dict-utils.js';
import { applyTestEnv } from './test-env.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'sample');

const RETRYABLE_RM_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);
const MAX_RM_ATTEMPTS = 10;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rmWithRetry = async (targetPath) => {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RM_ATTEMPTS; attempt += 1) {
    try {
      await fsPromises.rm(targetPath, { recursive: true, force: true });
      if (!fsSync.existsSync(targetPath)) return;
    } catch (err) {
      lastError = err;
      if (!RETRYABLE_RM_CODES.has(err?.code)) break;
      await sleep(100 * (attempt + 1));
    }
  }
  try {
    await fsPromises.access(targetPath);
    const tombstone = `${targetPath}.pending-delete-${Date.now()}-${process.pid}`;
    await fsPromises.rename(targetPath, tombstone);
    for (let attempt = 0; attempt < MAX_RM_ATTEMPTS; attempt += 1) {
      try {
        await fsPromises.rm(tombstone, { recursive: true, force: true });
        if (!fsSync.existsSync(tombstone)) return;
      } catch (err) {
        if (!RETRYABLE_RM_CODES.has(err?.code) || attempt >= MAX_RM_ATTEMPTS - 1) break;
        await sleep(100 * (attempt + 1));
      }
    }
  } catch {}
  if (!fsSync.existsSync(targetPath)) return;
  if (lastError && !RETRYABLE_RM_CODES.has(lastError?.code)) {
    throw lastError;
  }
};

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

export const setupIncrementalRepo = async ({ name }) => {
  if (!name) throw new Error('name is required');
  const suffixRaw = typeof process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX === 'string'
    ? process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX.trim()
    : '';
  const scopedName = suffixRaw ? `${name}-${suffixRaw}` : name;
  const scopeHash = createHash('sha1').update(scopedName).digest('hex').slice(0, 8);
  const runToken = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
  const label = compactLabel(name, 18);
  const tempRoot = path.join(ROOT, '.testCache', 'sqlite-incremental', `${label}-${scopeHash}-${runToken}`);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');

  await rmWithRetry(tempRoot);
  await fsPromises.mkdir(tempRoot, { recursive: true });
  await fsPromises.cp(FIXTURE_ROOT, repoRoot, { recursive: true });

  const nodeOptions = stripMaxOldSpaceFlag(process.env.NODE_OPTIONS || '');
  const env = applyTestEnv({
    testing: '1',
    cacheRoot,
    embeddings: 'stub',
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

