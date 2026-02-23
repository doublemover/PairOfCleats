import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import { SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { resolveVersionedCacheRoot } from '../../../../src/shared/cache-roots.js';
import { hasChunkMetaArtifactsSync } from '../../../../src/shared/index-artifact-helpers.js';
import { getRepoId } from '../../../../tools/shared/dict-utils.js';

import { applyTestEnv } from '../../../helpers/test-env.js';
applyTestEnv();
const ROOT = process.cwd();
const TEMP_ROOT = path.join(ROOT, '.testCache', 'summary-report');
const CACHE_ROOT = path.join(TEMP_ROOT, 'cache');
const REPO_ROOT = path.join(TEMP_ROOT, 'repo');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'sample');
const MARKER_PATH = path.join(TEMP_ROOT, 'build-complete.json');
const LOCK_PATH = path.join(ROOT, '.testCache', 'summary-report.lock');
const REPO_ID = getRepoId(REPO_ROOT);

const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L12-v2';

const isMarkerValid = () => {
  if (!fs.existsSync(MARKER_PATH)) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(MARKER_PATH, 'utf8'));
    return marker && typeof marker === 'object' && marker.schemaVersion === SCHEMA_VERSION;
  } catch {
    return false;
  }
};

const modelSlug = (value) => {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);
  return `${safe || 'model'}-${hash}`;
};

const hasIndexModeArtifacts = (buildRoot, mode) => {
  const modeRoot = path.join(buildRoot, `index-${mode}`);
  if (!fs.existsSync(modeRoot)) return false;
  return hasChunkMetaArtifactsSync(modeRoot);
};

const resolveBuildRoot = (cacheRoot) => {
  const repoCacheRoot = path.join(resolveVersionedCacheRoot(cacheRoot), 'repos', REPO_ID);
  const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
  if (!fs.existsSync(currentPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(currentPath, 'utf8')) || {};
    const candidate = typeof data.buildRoot === 'string'
      ? path.resolve(repoCacheRoot, data.buildRoot)
      : (typeof data.buildId === 'string' ? path.join(repoCacheRoot, 'builds', data.buildId) : null);
    if (!candidate || !fs.existsSync(candidate)) return null;
    return candidate;
  } catch {
    return null;
  }
};

const hasBuildArtifacts = (cacheRoot) => {
  const buildRoot = resolveBuildRoot(cacheRoot);
  if (!buildRoot) return false;
  if (!hasIndexModeArtifacts(buildRoot, 'code')) return false;
  if (!hasIndexModeArtifacts(buildRoot, 'prose')) return false;
  const sqliteRoot = path.join(buildRoot, 'index-sqlite');
  const sqliteCandidates = [
    path.join(sqliteRoot, 'index.sqlite'),
    path.join(sqliteRoot, 'index.vec.sqlite'),
    path.join(sqliteRoot, 'index-code.db'),
    path.join(sqliteRoot, 'index-prose.db')
  ];
  return sqliteCandidates.some((candidate) => fs.existsSync(candidate));
};

const hasFixtureArtifacts = (modelId) => {
  const modelCacheRoot = path.join(CACHE_ROOT, 'model-compare', modelSlug(modelId));
  return hasBuildArtifacts(CACHE_ROOT) && hasBuildArtifacts(modelCacheRoot);
};

const baseEnv = {
  ...process.env,  PAIROFCLEATS_EMBEDDINGS: 'stub'
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

const waitForBuild = async ({ modelId }) => {
  const timeoutMs = 180000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isMarkerValid() && hasFixtureArtifacts(modelId)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error('summary report fixture failed: build did not finish in time.');
  process.exit(1);
};

export const ensureSummaryReportFixture = async ({ modelId = DEFAULT_MODEL_ID } = {}) => {
  await fsPromises.mkdir(path.dirname(TEMP_ROOT), { recursive: true });
  if (isMarkerValid() && hasFixtureArtifacts(modelId)) {
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
    await waitForBuild({ modelId });
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
      '--stage',
      '1',
      '--stub-embeddings',
      '--repo',
      REPO_ROOT
    ]);
    Object.assign(process.env, baseEnv, repoEnv);
    await runSqliteBuild(REPO_ROOT);

    const modelCacheRoot = path.join(CACHE_ROOT, 'model-compare', modelSlug(modelId));
    const modelEnv = {
      PAIROFCLEATS_CACHE_ROOT: modelCacheRoot,
      PAIROFCLEATS_MODEL: modelId
    };
    runBuild('build index (model cache)', modelEnv, [
      path.join(ROOT, 'build_index.js'),
      '--stage',
      '1',
      '--stub-embeddings',
      '--repo',
      REPO_ROOT
    ]);
    Object.assign(process.env, baseEnv, modelEnv);
    await runSqliteBuild(REPO_ROOT);

    await fsPromises.writeFile(
      MARKER_PATH,
      JSON.stringify({ completedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION }, null, 2)
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
