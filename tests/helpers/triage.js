import fsPromises from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RETRYABLE_RM_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);
const RM_RETRY_ATTEMPTS = 20;
const RM_RETRY_BASE_DELAY_MS = 40;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rmWithRetry = async (targetPath) => {
  const removeTombstoneWithRetry = async (tombstonePath) => {
    for (let i = 0; i < RM_RETRY_ATTEMPTS; i += 1) {
      try {
        await fsPromises.rm(tombstonePath, { recursive: true, force: true });
        if (!fsSync.existsSync(tombstonePath)) return true;
      } catch (err) {
        if (!RETRYABLE_RM_CODES.has(err?.code)) break;
        const delayMs = Math.min(1000, RM_RETRY_BASE_DELAY_MS * (2 ** i));
        await sleep(delayMs);
      }
    }
    return false;
  };
  for (let attempt = 0; attempt < RM_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await fsPromises.rm(targetPath, { recursive: true, force: true });
      if (!fsSync.existsSync(targetPath)) return;
    } catch (err) {
      const isLastAttempt = attempt >= RM_RETRY_ATTEMPTS - 1;
      if (!RETRYABLE_RM_CODES.has(err?.code) || isLastAttempt) {
        if (isLastAttempt && RETRYABLE_RM_CODES.has(err?.code)) {
          // Final fallback: detach the directory name and retry delete on the
          // tombstoned path so active handles cannot recreate under the old path.
          const tombstone = `${targetPath}.pending-delete-${Date.now()}-${process.pid}`;
          try {
            await fsPromises.rename(targetPath, tombstone);
            if (await removeTombstoneWithRetry(tombstone)) return;
          } catch {}
        }
        if (!fsSync.existsSync(targetPath)) return;
        throw err;
      }
      const delayMs = Math.min(1000, RM_RETRY_BASE_DELAY_MS * (2 ** attempt));
      await sleep(delayMs);
    }
  }
};

export const getTriageContext = async ({ name }) => {
  const repoRoot = path.join(ROOT, 'tests', 'fixtures', 'sample');
  const triageFixtureRoot = path.join(ROOT, 'tests', 'fixtures', 'triage');
  const cacheRootBase = path.join(ROOT, '.testCache', name);
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
  await rmWithRetry(cacheRoot);
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

