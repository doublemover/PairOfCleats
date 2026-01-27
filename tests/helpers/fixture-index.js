import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getIndexDir, getMetricsDir, getRepoCacheRoot, loadUserConfig, resolveSqlitePaths } from '../../tools/dict-utils.js';
import { hasIndexMeta } from '../../src/retrieval/cli/index-loader.js';
import { MAX_JSON_BYTES, loadChunkMeta, readCompatibilityKey } from '../../src/shared/artifact-io.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ensureDir = async (dir) => {
  await fsPromises.mkdir(dir, { recursive: true });
};

const resolveCacheName = (baseName) => {
  const suffixRaw = typeof process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX === 'string'
    ? process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX.trim()
    : '';
  if (!suffixRaw) return baseName;
  if (baseName.endsWith(`-${suffixRaw}`)) return baseName;
  return `${baseName}-${suffixRaw}`;
};

const createFixtureEnv = (cacheRoot, overrides = {}) => ({
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_WORKER_POOL: 'off',
  ...overrides
});

const hasChunkMeta = (dir) => hasIndexMeta(dir);

const hasRiskTags = (codeDir) => {
  try {
    const chunkMetaPath = path.join(codeDir, 'chunk_meta.json');
    if (!fs.existsSync(chunkMetaPath)) return false;
    const raw = JSON.parse(fs.readFileSync(chunkMetaPath, 'utf8'));
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
    return readCompatibilityKey(dir, { maxBytes: MAX_JSON_BYTES, strict: true }).key;
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
    const chunkMeta = await loadChunkMeta(dir, { strict: true });
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
  const fixtureRoot = path.join(ROOT, 'tests', 'fixtures', fixtureName);
  const cacheRoot = path.join(ROOT, '.testCache', resolveCacheName(cacheName));
  await ensureDir(cacheRoot);
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
    await fsPromises.rm(repoCacheRoot, { recursive: true, force: true });
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
  const sqlitePaths = resolveSqlitePaths(fixtureRoot, userConfig);
  if (!fs.existsSync(sqlitePaths.codePath) || !fs.existsSync(sqlitePaths.prosePath)) {
    run(
      [path.join(ROOT, 'tools', 'build-sqlite-index.js'), '--repo', fixtureRoot],
      'build sqlite index',
      { cwd: fixtureRoot, env, stdio: 'inherit' }
    );
  }
  return sqlitePaths;
};

export const loadFixtureIndexMeta = (fixtureRoot, userConfig) => {
  const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
  const chunkMetaPath = path.join(codeDir, 'chunk_meta.json');
  if (!fs.existsSync(chunkMetaPath)) {
    console.error(`Missing chunk meta at ${chunkMetaPath}`);
    process.exit(1);
  }
  const chunkMeta = JSON.parse(fs.readFileSync(chunkMetaPath, 'utf8'));
  const fileMetaPath = path.join(codeDir, 'file_meta.json');
  const fileMeta = fs.existsSync(fileMetaPath)
    ? JSON.parse(fs.readFileSync(fileMetaPath, 'utf8'))
    : [];
  const fileById = new Map(
    (Array.isArray(fileMeta) ? fileMeta : []).map((entry) => [entry.id, entry.file])
  );
  const resolveChunkFile = (chunk) => chunk?.file || fileById.get(chunk?.fileId) || null;
  const fileRelationsPath = path.join(codeDir, 'file_relations.json');
  let fileRelations = null;
  if (fs.existsSync(fileRelationsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(fileRelationsPath, 'utf8'));
      if (Array.isArray(raw)) {
        fileRelations = new Map();
        raw.forEach((entry) => {
          if (entry?.file) fileRelations.set(entry.file, entry.relations || null);
        });
      }
    } catch {}
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

