import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rmDirRecursive } from './temp.js';
import { resolveTestCacheDir } from './test-cache.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const getTriageContext = async ({ name }) => {
  const repoRoot = path.join(ROOT, 'tests', 'fixtures', 'sample');
  const triageFixtureRoot = path.join(ROOT, 'tests', 'fixtures', 'triage');
  const { dir: cacheRootBase } = resolveTestCacheDir(name, { root: ROOT });
  const cacheSuffix = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  const cacheRoot = `${cacheRootBase}-${cacheSuffix}`;
  const traceArtifactIo = process.env.PAIROFCLEATS_TRACE_ARTIFACT_IO === '1';
  const testLogRoot = process.env.PAIROFCLEATS_TEST_LOG_DIR
    || process.env.npm_config_test_log_dir
    || '';
  const resolvedTestLogRoot = testLogRoot ? path.resolve(testLogRoot) : '';

  if (traceArtifactIo) {
    console.log(`[triage-test] preparing cache root: ${cacheRoot}`);
  }
  await rmDirRecursive(cacheRoot, { retries: 20, delayMs: 40 });
  if (traceArtifactIo) {
    console.log(`[triage-test] ready cache root: ${cacheRoot}`);
  }
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  const env = {
    ...process.env,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub'
  };

  const writeTestLog = async (fileName, payload) => {
    if (!resolvedTestLogRoot) return;
    const outPath = path.join(resolvedTestLogRoot, fileName);
    try {
      await fsPromises.mkdir(resolvedTestLogRoot, { recursive: true });
      await fsPromises.writeFile(outPath, JSON.stringify(payload, null, 2));
    } catch (err) {
      console.warn(`Failed to write test log ${outPath}: ${err?.message || err}`);
    }
  };

  return { root: ROOT, repoRoot, triageFixtureRoot, cacheRoot, env, writeTestLog };
};

export const runJson = (label, args, options = {}) => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    console.error(result.stderr || result.stdout || '');
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout || '{}');
  } catch (error) {
    console.error(`Failed to parse JSON output for ${label}: ${error?.message || error}`);
    process.exit(1);
  }
};

export const run = (label, args, options = {}) => {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

