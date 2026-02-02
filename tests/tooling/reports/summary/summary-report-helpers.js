import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const TEMP_ROOT = path.join(ROOT, '.testCache', 'summary-report');
const CACHE_ROOT = path.join(TEMP_ROOT, 'cache');
const REPO_ROOT = path.join(TEMP_ROOT, 'repo');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'sample');
const MARKER_PATH = path.join(TEMP_ROOT, 'build-complete.json');
const LOCK_PATH = path.join(ROOT, '.testCache', 'summary-report.lock');

const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L12-v2';

const modelSlug = (value) => {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);
  return `${safe || 'model'}-${hash}`;
};

const baseEnv = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const runBuild = (label, envOverrides, args) => {
  const result = spawnSync(
    process.execPath,
    args,
    { env: { ...baseEnv, ...envOverrides }, encoding: 'utf8', cwd: REPO_ROOT }
  );
  if (result.status !== 0) {
    console.error(`summary report build failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
};

const waitForBuild = async () => {
  const timeoutMs = 180000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(MARKER_PATH)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error('summary report fixture failed: build did not finish in time.');
  process.exit(1);
};

export const ensureSummaryReportFixture = async ({ modelId = DEFAULT_MODEL_ID } = {}) => {
  await fsPromises.mkdir(path.dirname(TEMP_ROOT), { recursive: true });
  if (fs.existsSync(MARKER_PATH)) {
    return {
      tempRoot: TEMP_ROOT,
      cacheRoot: CACHE_ROOT,
      repoRoot: REPO_ROOT,
      modelCacheRoot: path.join(CACHE_ROOT, 'model-compare', modelSlug(modelId))
    };
  }

  let lockHandle = null;
  try {
    lockHandle = await fsPromises.open(LOCK_PATH, 'wx');
  } catch {
    lockHandle = null;
  }

  if (!lockHandle) {
    await waitForBuild();
    return {
      tempRoot: TEMP_ROOT,
      cacheRoot: CACHE_ROOT,
      repoRoot: REPO_ROOT,
      modelCacheRoot: path.join(CACHE_ROOT, 'model-compare', modelSlug(modelId))
    };
  }

  try {
    await fsPromises.rm(TEMP_ROOT, { recursive: true, force: true });
    await fsPromises.mkdir(CACHE_ROOT, { recursive: true });
    await fsPromises.cp(FIXTURE_ROOT, REPO_ROOT, { recursive: true });

    const repoEnv = {
      PAIROFCLEATS_CACHE_ROOT: CACHE_ROOT
    };
    runBuild('build index (repo cache)', repoEnv, [
      path.join(ROOT, 'build_index.js'),
      '--stub-embeddings',
      '--repo',
      REPO_ROOT
    ]);
    runBuild('build sqlite (repo cache)', repoEnv, [
      path.join(ROOT, 'tools', 'build-sqlite-index.js'),
      '--repo',
      REPO_ROOT
    ]);

    const modelCacheRoot = path.join(CACHE_ROOT, 'model-compare', modelSlug(modelId));
    const modelEnv = {
      PAIROFCLEATS_CACHE_ROOT: modelCacheRoot,
      PAIROFCLEATS_MODEL: modelId
    };
    runBuild('build index (model cache)', modelEnv, [
      path.join(ROOT, 'build_index.js'),
      '--stub-embeddings',
      '--repo',
      REPO_ROOT
    ]);
    runBuild('build sqlite (model cache)', modelEnv, [
      path.join(ROOT, 'tools', 'build-sqlite-index.js'),
      '--repo',
      REPO_ROOT
    ]);

    await fsPromises.writeFile(
      MARKER_PATH,
      JSON.stringify({ completedAt: new Date().toISOString() }, null, 2)
    );

    return {
      tempRoot: TEMP_ROOT,
      cacheRoot: CACHE_ROOT,
      repoRoot: REPO_ROOT,
      modelCacheRoot
    };
  } finally {
    await lockHandle.close();
    await fsPromises.rm(LOCK_PATH, { force: true });
  }
};
