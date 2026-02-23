import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { applyTestEnv } from './test-env.js';
import { rmDirRecursive } from './temp.js';

import { resolveTestCachePath } from './test-cache.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALID_CACHE_SCOPES = new Set(['isolated', 'shared']);

/**
 * Run git command for fixture setup and fail fast on non-zero exit.
 *
 * @param {string[]} args
 * @param {string} label
 * @param {string} cwd
 * @param {Record<string, string>} [envOverride]
 * @returns {void}
 */
const runGit = (args, label, cwd, envOverride = {}) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...envOverride }
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
};

const hasGit = () => {
  const check = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return check.status === 0;
};

const hasChunkMeta = (repoRoot) => {
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
  return fs.existsSync(path.join(codeDir, 'chunk_meta.json'))
    && fs.existsSync(path.join(proseDir, 'chunk_meta.json'));
};

const buildIndex = (repoRoot, env) => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'build_index.js'),
      '--stub-embeddings',
      '--stage',
      'stage2',
      '--repo',
      repoRoot
    ],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    const exitLabel = result.status ?? 'unknown';
    console.error(`Failed: build_index (exit ${exitLabel})`);
    if (result.error) console.error(result.error.message || result.error);
    process.exit(result.status ?? 1);
  }
};

const normalizeCacheScope = (cacheScope) => {
  const normalized = String(cacheScope || 'shared').trim().toLowerCase();
  if (!VALID_CACHE_SCOPES.has(normalized)) {
    throw new Error(`Unsupported cacheScope: ${cacheScope}`);
  }
  return normalized;
};

const sleep = (delayMs) => new Promise((resolve) => {
  setTimeout(resolve, delayMs);
});

const isStaleLock = async (lockDir, staleMs) => {
  try {
    const stat = await fsPromises.stat(lockDir);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch {
    return false;
  }
};

/**
 * Execute callback under directory lock with stale-lock eviction.
 *
 * @template T
 * @param {string} lockDir
 * @param {() => Promise<T>} callback
 * @param {{pollMs?:number,staleMs?:number,maxWaitMs?:number}} [options]
 * @returns {Promise<T>}
 */
const withDirectoryLock = async (
  lockDir,
  callback,
  {
    pollMs = 120,
    staleMs = 10 * 60 * 1000,
    maxWaitMs = 15 * 60 * 1000
  } = {}
) => {
  const startedAt = Date.now();
  await fsPromises.mkdir(path.dirname(lockDir), { recursive: true });
  while (true) {
    try {
      await fsPromises.mkdir(lockDir);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (await isStaleLock(lockDir, staleMs)) {
        await fsPromises.rm(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - startedAt > maxWaitMs) {
        throw new Error(`Timed out waiting for search-filters lock at ${lockDir}`);
      }
      await sleep(pollMs);
    }
  }
  try {
    return await callback();
  } finally {
    await rmDirRecursive(lockDir, {
      retries: 3,
      delayMs: 50,
      ignoreRetryableFailure: true
    });
  }
};

/**
 * Ensure deterministic git fixture repo exists for search filter tests.
 *
 * @param {{cacheScope?:'isolated'|'shared'}} [options]
 * @returns {Promise<{root:string,repoRoot:string,cacheRoot:string,env:object,branchName:string|null}|null>}
 */
export const ensureSearchFiltersRepo = async ({ cacheScope = 'shared' } = {}) => {
  if (!hasGit()) {
    console.log('[skip] git not available');
    return null;
  }
  const normalizedCacheScope = normalizeCacheScope(cacheScope);
  const tempRoot = resolveTestCachePath(ROOT, 'search-filters');
  const runSuffix = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  const repoRoot = normalizedCacheScope === 'shared'
    ? path.join(tempRoot, 'repo')
    : path.join(tempRoot, `repo-${runSuffix}`);
  const cacheRoot = normalizedCacheScope === 'shared'
    ? path.join(tempRoot, 'cache')
    : path.join(tempRoot, `cache-${runSuffix}`);
  const lockDir = normalizedCacheScope === 'shared'
    ? path.join(tempRoot, '.bootstrap.lock')
    : path.join(tempRoot, `.bootstrap-${runSuffix}.lock`);

  return withDirectoryLock(lockDir, async () => {
    await fsPromises.mkdir(repoRoot, { recursive: true });
    await fsPromises.mkdir(cacheRoot, { recursive: true });

    const requiredFiles = [
      'alpha.txt',
      'beta.txt',
      'CaseFile.TXT',
      'sample.js'
    ];
    const gitDir = path.join(repoRoot, '.git');
    const needsBootstrap = !fs.existsSync(gitDir)
      || requiredFiles.some((filename) => !fs.existsSync(path.join(repoRoot, filename)));

    if (needsBootstrap) {
      if (!fs.existsSync(gitDir)) {
        runGit(['init'], 'git init', repoRoot);
      }
      runGit(['config', 'user.email', 'test@example.com'], 'git config email', repoRoot);
      runGit(['config', 'user.name', 'Test User'], 'git config name', repoRoot);

      const dayMs = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const dateOld = new Date(now - 5 * dayMs).toISOString();
      const dateNew = new Date(now - 1 * dayMs).toISOString();

      const ensureFileCommit = async ({
        filename,
        content,
        author,
        date,
        message,
        label
      }) => {
        const filePath = path.join(repoRoot, filename);
        if (fs.existsSync(filePath)) return;
        await fsPromises.writeFile(filePath, content);
        runGit(['add', filename], `git add ${label}`, repoRoot);
        runGit(
          ['commit', '-m', message, '--author', author, '--date', date],
          `git commit ${label}`,
          repoRoot,
          { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
        );
      };

      await ensureFileCommit({
        filename: 'alpha.txt',
        content: 'alpha beta\nalpha beta\n',
        author: 'Alice <alice@example.com>',
        date: dateOld,
        message: 'add alpha',
        label: 'alpha'
      });
      await ensureFileCommit({
        filename: 'beta.txt',
        content: 'alpha gamma\nalpha delta\n',
        author: 'Bob <bob@example.com>',
        date: dateNew,
        message: 'add beta',
        label: 'beta'
      });
      await ensureFileCommit({
        filename: 'CaseFile.TXT',
        content: 'AlphaCase alpha\n',
        author: 'Casey <casey@example.com>',
        date: dateNew,
        message: 'add case file',
        label: 'CaseFile'
      });
      await ensureFileCommit({
        filename: 'sample.js',
        content: 'const equal = (a, b) => a && b;\nfunction check(a, b) {\n  return a && b;\n}\n',
        author: 'Dana <dana@example.com>',
        date: dateNew,
        message: 'add sample.js',
        label: 'sample.js'
      });
    }

    const env = applyTestEnv({
      cacheRoot,
      embeddings: 'stub',
      testConfig: {
        indexing: {
          embeddings: {
            hnsw: { enabled: false },
            lancedb: { enabled: false }
          }
        }
      },
      extraEnv: process.platform === 'win32'
        ? {
          PAIROFCLEATS_THREADS: '1',
          PAIROFCLEATS_WORKER_POOL: 'auto'
        }
        : null
    });

    if (!hasChunkMeta(repoRoot)) {
      buildIndex(repoRoot, env);
    }

    const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    const branchName = branchResult.status === 0 ? branchResult.stdout.trim() : null;

    return { root: ROOT, repoRoot, cacheRoot, env, branchName };
  });
};

/**
 * Run JSON search against filter fixture repo with stable defaults.
 *
 * @param {{
 *  root?:string,
 *  repoRoot:string,
 *  env:object,
 *  query:string,
 *  args?:string[],
 *  mode?:string,
 *  backend?:string
 * }} input
 * @returns {object}
 */
export const runFilterSearch = ({
  root = ROOT,
  repoRoot,
  env,
  query,
  args = [],
  mode = 'prose',
  backend = 'memory'
}) => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'search.js'),
      query,
      '--mode',
      mode,
      '--json',
      '--no-ann',
      '--repo',
      repoRoot,
      ...(backend ? ['--backend', backend] : []),
      ...args
    ],
    { cwd: repoRoot, env, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error('Failed: search');
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout || '{}');
  } catch (err) {
    console.error(`Failed to parse search output: ${err?.message || err}`);
    process.exit(1);
  }
};

