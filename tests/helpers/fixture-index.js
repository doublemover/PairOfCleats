import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getIndexDir, getMetricsDir, loadUserConfig, resolveSqlitePaths } from '../../tools/dict-utils.js';
import { hasIndexMeta } from '../../src/retrieval/cli/index-loader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ensureDir = async (dir) => {
  await fsPromises.mkdir(dir, { recursive: true });
};

const createFixtureEnv = (cacheRoot, overrides = {}) => ({
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_WORKER_POOL: 'off',
  ...overrides
});

const hasChunkMeta = (dir) => hasIndexMeta(dir);

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
  envOverrides = {}
} = {}) => {
  if (!fixtureName) throw new Error('fixtureName is required');
  const fixtureRoot = path.join(ROOT, 'tests', 'fixtures', fixtureName);
  const cacheRoot = path.join(ROOT, 'tests', '.cache', cacheName);
  await ensureDir(cacheRoot);
  process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  const env = createFixtureEnv(cacheRoot, envOverrides);
  const userConfig = loadUserConfig(fixtureRoot);
  let codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
  let proseDir = getIndexDir(fixtureRoot, 'prose', userConfig);
  if (!hasChunkMeta(codeDir)) {
    run(
      [path.join(ROOT, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot],
      `build index (${fixtureName})`,
      { cwd: fixtureRoot, env, stdio: 'inherit' }
    );
    codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
    proseDir = getIndexDir(fixtureRoot, 'prose', userConfig);
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
