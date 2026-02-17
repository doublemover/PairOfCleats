import { applyTestEnv, syncProcessEnv } from './test-env.js';

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getIndexDir,
  getMetricsDir,
  getRepoCacheRoot,
  loadUserConfig,
  resolveSqlitePaths,
  toRealPathSync
} from '../../tools/shared/dict-utils.js';
import { hasIndexMeta } from '../../src/retrieval/cli/index-loader.js';
import {
  MAX_JSON_BYTES,
  loadChunkMeta,
  loadJsonArrayArtifactSync,
  readCompatibilityKey
} from '../../src/shared/artifact-io.js';

import { rmDirRecursive } from './temp.js';
import { isPlainObject, mergeConfig } from '../../src/shared/config.js';
import { runSqliteBuild } from './sqlite-builder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ensureDir = async (dir) => {
  await fsPromises.mkdir(dir, { recursive: true });
};

const resolveCacheName = (baseName) => {
  const MAX_CACHE_NAME_LENGTH = 64;
  const truncateWithHash = (value) => {
    const text = String(value || '').trim();
    if (!text) return 'fixture-cache';
    if (text.length <= MAX_CACHE_NAME_LENGTH) return text;
    const digest = crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
    const headLength = Math.max(8, MAX_CACHE_NAME_LENGTH - digest.length - 1);
    return `${text.slice(0, headLength)}-${digest}`;
  };
  const suffixRaw = typeof process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX === 'string'
    ? process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX.trim()
    : '';
  if (!suffixRaw) return truncateWithHash(baseName);
  if (baseName.endsWith(`-${suffixRaw}`)) return truncateWithHash(baseName);
  return truncateWithHash(`${baseName}-${suffixRaw}`);
};

const normalizeRepoSlug = (repoRoot) => String(path.basename(path.resolve(repoRoot)) || 'repo')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 24) || 'repo';

const getLegacyPrefixedRepoId = (repoRoot) => {
  const resolved = path.resolve(repoRoot);
  const prefix = normalizeRepoSlug(resolved);
  const hash = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
};

const DEFAULT_TEST_CONFIG = {
  indexing: {
    embeddings: {
      enabled: false,
      mode: 'off',
      lancedb: { enabled: false },
      hnsw: { enabled: false }
    }
  }
};

const mergeTestConfig = (rawOverride) => {
  if (typeof rawOverride !== 'string' || !rawOverride.trim()) {
    return DEFAULT_TEST_CONFIG;
  }
  try {
    const parsed = JSON.parse(rawOverride);
    if (!isPlainObject(parsed)) return DEFAULT_TEST_CONFIG;
    return mergeConfig(DEFAULT_TEST_CONFIG, parsed);
  } catch {
    return DEFAULT_TEST_CONFIG;
  }
};

const createFixtureEnv = (cacheRoot, overrides = {}) => {
  const { PAIROFCLEATS_TEST_CONFIG: testConfigOverride, ...restOverrides } = overrides;
  const mergedTestConfig = mergeTestConfig(testConfigOverride);
  const preservedPairOfCleatsKeys = new Set([
    'PAIROFCLEATS_TEST_CACHE_SUFFIX',
    'PAIROFCLEATS_TEST_LOG_SILENT',
    'PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY',
    'PAIROFCLEATS_TESTING'
  ]);
  const deletedKeys = new Set();
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => {
      if (!key.startsWith('PAIROFCLEATS_')) return true;
      if (preservedPairOfCleatsKeys.has(key)) return true;
      deletedKeys.add(key);
      return false;
    })
  );
  const env = {
    ...baseEnv,    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub',
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_CONFIG: JSON.stringify(mergedTestConfig),
    ...restOverrides
  };
  const syncKeys = new Set(Object.keys(env).filter((key) => key.startsWith('PAIROFCLEATS_')));
  for (const key of deletedKeys) syncKeys.add(key);
  syncProcessEnv(env, Array.from(syncKeys), { clearMissing: true });
  return env;
};

const hasChunkMeta = (dir) => hasIndexMeta(dir);

const hasRiskTags = (codeDir) => {
  try {
    const raw = loadJsonArrayArtifactSync(codeDir, 'chunk_meta', {
      maxBytes: MAX_JSON_BYTES,
      strict: false
    });
    return Array.isArray(raw) && raw.some((entry) => {
      const risk = entry?.metaV2?.risk || entry?.docmeta?.risk || null;
      if (!risk) return false;
      if (Array.isArray(risk.tags) && risk.tags.length) return true;
      if (Array.isArray(risk.flows) && risk.flows.length) return true;
      return false;
    });
  } catch {
    return false;
  }
};

const readIndexCompatibilityKey = (dir) => {
  try {
    return readCompatibilityKey(dir, { maxBytes: MAX_JSON_BYTES, strict: false }).key;
  } catch {
    return null;
  }
};

const hasCompatibleIndexes = ({ codeDir, proseDir, extractedProseDir }) => {
  if (!hasChunkMeta(codeDir) || !hasChunkMeta(proseDir) || !hasChunkMeta(extractedProseDir)) {
    return false;
  }
  const codeKey = readIndexCompatibilityKey(codeDir);
  const proseKey = readIndexCompatibilityKey(proseDir);
  const extractedKey = readIndexCompatibilityKey(extractedProseDir);
  const baseline = codeKey || proseKey || extractedKey;
  if (!baseline) {
    const testing = process.env.PAIROFCLEATS_TESTING === '1' || process.env.PAIROFCLEATS_TESTING === 'true';
    const allowMissing = testing
      && process.env.PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY !== '0'
      && process.env.PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY !== 'false';
    if (allowMissing) return true;
    return false;
  }
  return [codeKey, proseKey, extractedKey].every((key) => !key || key === baseline);
};

const hasChunkUids = async (dir) => {
  try {
    const chunkMeta = await loadChunkMeta(dir, { strict: false });
    if (!Array.isArray(chunkMeta) || chunkMeta.length === 0) return false;
    return chunkMeta.every((entry) => entry?.chunkUid || entry?.metaV2?.chunkUid);
  } catch {
    return false;
  }
};

const run = (args, label, options) => {
  const result = spawnSync(process.execPath, args, options);
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

export const ensureFixtureIndex = async ({
  fixtureName,
  cacheName = `fixture-${fixtureName}`,
  envOverrides = {},
  requireRiskTags = false
} = {}) => {
  if (!fixtureName) throw new Error('fixtureName is required');
  const fixtureRootRaw = path.join(ROOT, 'tests', 'fixtures', fixtureName);
  const fixtureRoot = toRealPathSync(fixtureRootRaw);
  const cacheRoot = path.join(ROOT, '.testCache', resolveCacheName(cacheName));
  await ensureDir(cacheRoot);
  applyTestEnv();
  process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  const env = createFixtureEnv(cacheRoot, envOverrides);
  const userConfig = loadUserConfig(fixtureRoot);
  let codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
  let proseDir = getIndexDir(fixtureRoot, 'prose', userConfig);
  let extractedProseDir = getIndexDir(fixtureRoot, 'extracted-prose', userConfig);
  const recordsDir = getIndexDir(fixtureRoot, 'records', userConfig);
  const needsRiskTags = requireRiskTags && !hasRiskTags(codeDir);
  const missingChunkUids = !await hasChunkUids(codeDir)
    || !await hasChunkUids(proseDir)
    || !await hasChunkUids(extractedProseDir)
    || (hasIndexMeta(recordsDir) && !await hasChunkUids(recordsDir));
  if (!hasCompatibleIndexes({ codeDir, proseDir, extractedProseDir }) || needsRiskTags || missingChunkUids) {
    const repoCacheRoot = getRepoCacheRoot(fixtureRoot, userConfig);
    const reposRoot = path.dirname(repoCacheRoot);
    const legacyRoots = new Set([
      path.join(reposRoot, getLegacyPrefixedRepoId(fixtureRootRaw)),
      path.join(reposRoot, getLegacyPrefixedRepoId(fixtureRoot))
    ]);
    for (const legacyRoot of legacyRoots) {
      if (legacyRoot !== repoCacheRoot) {
        await rmDirRecursive(legacyRoot, { retries: 8, delayMs: 150 });
      }
    }
    await rmDirRecursive(repoCacheRoot, { retries: 8, delayMs: 150 });
    await ensureDir(repoCacheRoot);
    run(
      [path.join(ROOT, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot],
      `build index (${fixtureName})`,
      { cwd: fixtureRoot, env, stdio: 'inherit' }
    );
    codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
    proseDir = getIndexDir(fixtureRoot, 'prose', userConfig);
    extractedProseDir = getIndexDir(fixtureRoot, 'extracted-prose', userConfig);
  }
  return { root: ROOT, fixtureRoot, cacheRoot, env, userConfig, codeDir, proseDir };
};

export const ensureFixtureSqlite = async ({ fixtureRoot, userConfig, env }) => {
  let sqlitePaths = resolveSqlitePaths(fixtureRoot, userConfig);
  if (!fs.existsSync(sqlitePaths.codePath) || !fs.existsSync(sqlitePaths.prosePath)) {
    await runSqliteBuild(fixtureRoot, { emitOutput: true });
    sqlitePaths = resolveSqlitePaths(fixtureRoot, userConfig);
  }
  if (!fs.existsSync(sqlitePaths.codePath) || !fs.existsSync(sqlitePaths.prosePath)) {
    throw new Error(
      `SQLite fixture paths are unavailable after build. `
      + `codePath=${sqlitePaths.codePath} prosePath=${sqlitePaths.prosePath}`
    );
  }
  return sqlitePaths;
};

export const loadFixtureIndexMeta = (fixtureRoot, userConfig) => {
  const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
  let chunkMeta = [];
  let fileMeta = [];
  try {
    chunkMeta = loadJsonArrayArtifactSync(codeDir, 'chunk_meta', {
      maxBytes: MAX_JSON_BYTES,
      strict: true
    });
    fileMeta = loadJsonArrayArtifactSync(codeDir, 'file_meta', {
      maxBytes: MAX_JSON_BYTES,
      strict: true
    });
  } catch (err) {
    console.error(`Failed to load fixture index metadata at ${codeDir}: ${err?.message || err}`);
    process.exit(1);
  }
  const fileById = new Map(
    (Array.isArray(fileMeta) ? fileMeta : []).map((entry) => [entry.id, entry.file])
  );
  const resolveChunkFile = (chunk) => chunk?.file || fileById.get(chunk?.fileId) || null;
  let fileRelations = null;
  try {
    const raw = loadJsonArrayArtifactSync(codeDir, 'file_relations', {
      maxBytes: MAX_JSON_BYTES,
      strict: false
    });
    if (Array.isArray(raw)) {
      fileRelations = new Map();
      raw.forEach((entry) => {
        if (entry?.file) fileRelations.set(entry.file, entry.relations || null);
      });
    }
  } catch {}
  if (!Array.isArray(chunkMeta) || chunkMeta.length === 0) {
    console.error(`Missing or empty chunk metadata for fixture index at ${codeDir}`);
    process.exit(1);
  }
  const getFileRelations = (file) => (fileRelations?.get(file) || null);
  return {
    codeDir,
    chunkMeta,
    fileMeta,
    fileById,
    resolveChunkFile,
    fileRelations,
    getFileRelations
  };
};

export const loadFixtureMetricsDir = (fixtureRoot, userConfig) =>
  getMetricsDir(fixtureRoot, userConfig);

export const runSearch = ({
  root = ROOT,
  fixtureRoot,
  env,
  query,
  args = [],
  mode = 'code'
}) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'search.js'), query, '--mode', mode, '--json', '--no-ann', '--repo', fixtureRoot, ...args],
    { cwd: fixtureRoot, env, encoding: 'utf8' }
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

