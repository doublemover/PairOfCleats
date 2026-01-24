import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { buildAutoPolicy } from '../../src/shared/auto-policy.js';
import { getTestEnvConfig } from '../../src/shared/env.js';
import { readJsoncFile } from '../../src/shared/jsonc.js';
import { isPlainObject, mergeConfig } from '../../src/shared/config.js';
import { validateConfig } from '../../src/config/validate.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { DEFAULT_DP_MAX_BY_FILE_COUNT } from './constants.js';
import { resolveToolRoot } from './tool.js';

/**
 * Load repo-local configuration from .pairofcleats.json.
 * @param {string} repoRoot
 * @returns {object}
 */
export function loadUserConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.pairofcleats.json');
  const applyTestOverrides = (baseConfig) => {
    const testEnv = getTestEnvConfig();
    if (!testEnv.testing || !testEnv.config) return baseConfig;
    return mergeConfig(baseConfig, testEnv.config);
  };
  if (!fs.existsSync(configPath)) return applyTestOverrides(normalizeUserConfig({}));
  const base = readJsoncFile(configPath);
  if (!isPlainObject(base)) {
    throw new Error('Config root must be a JSON object.');
  }
  const schemaPath = path.join(resolveToolRoot(), 'docs', 'config-schema.json');
  const schemaRaw = fs.readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(schemaRaw);
  const result = validateConfig(schema, base);
  if (!result.ok) {
    const details = result.errors.map((err) => `- ${err}`).join('\n');
    throw new Error(`Config errors in ${configPath}:\n${details}`);
  }
  return applyTestOverrides(normalizeUserConfig(base));
}

/**
 * Compute a stable hash of the effective config inputs for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getEffectiveConfigHash(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const payload = { config: cfg };
  const json = stableStringify(payload);
  return crypto.createHash('sha1').update(json).digest('hex');
}

export async function getAutoPolicy(repoRoot, userConfig = null, options = {}) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  return buildAutoPolicy({ repoRoot, config: cfg, scanLimits: options.scanLimits });
}

function normalizeUserConfig(baseConfig) {
  if (!isPlainObject(baseConfig)) return {};
  const normalized = {};
  if (isPlainObject(baseConfig.cache)) {
    const root = typeof baseConfig.cache.root === 'string' && baseConfig.cache.root.trim()
      ? baseConfig.cache.root.trim()
      : undefined;
    const runtime = isPlainObject(baseConfig.cache.runtime) ? baseConfig.cache.runtime : undefined;
    const cache = {};
    if (root) cache.root = root;
    if (runtime) cache.runtime = runtime;
    if (Object.keys(cache).length) normalized.cache = cache;
  }
  if (isPlainObject(baseConfig.indexing)) {
    const indexing = baseConfig.indexing;
    const normalizedIndexing = {};
    if (indexing.segmenting) normalizedIndexing.segmenting = indexing.segmenting;
    if (indexing.commentExtraction) normalizedIndexing.commentExtraction = indexing.commentExtraction;
    if (indexing.documentExtraction) normalizedIndexing.documentExtraction = indexing.documentExtraction;
    if (indexing.artifacts) normalizedIndexing.artifacts = indexing.artifacts;
    if (indexing.postings) normalizedIndexing.postings = indexing.postings;
    if (indexing.codeMap) normalizedIndexing.codeMap = indexing.codeMap;
    if (indexing.records) normalizedIndexing.records = indexing.records;
    if (indexing.embeddings) normalizedIndexing.embeddings = indexing.embeddings;
    if (indexing.pythonAst) normalizedIndexing.pythonAst = indexing.pythonAst;
    if (indexing.typeInference) normalizedIndexing.typeInference = indexing.typeInference;
    if (indexing.treeSitter) normalizedIndexing.treeSitter = indexing.treeSitter;
    if (indexing.fileFilters) normalizedIndexing.fileFilters = indexing.fileFilters;
    if (Object.keys(normalizedIndexing).length) normalized.indexing = normalizedIndexing;
  }
  if (isPlainObject(baseConfig.dictionary)) {
    const dict = baseConfig.dictionary;
    const normalizedDict = {};
    if (dict.dir) normalizedDict.dir = dict.dir;
    if (dict.languages) normalizedDict.languages = dict.languages;
    if (dict.files) normalizedDict.files = dict.files;
    if (dict.includeSlang !== undefined) normalizedDict.includeSlang = dict.includeSlang;
    if (dict.slangDirs) normalizedDict.slangDirs = dict.slangDirs;
    if (dict.slangFiles) normalizedDict.slangFiles = dict.slangFiles;
    if (dict.enableRepoDictionary !== undefined) normalizedDict.enableRepoDictionary = dict.enableRepoDictionary;
    if (dict.segmentation) normalizedDict.segmentation = dict.segmentation;
    if (dict.dpMaxTokenLength !== undefined) normalizedDict.dpMaxTokenLength = dict.dpMaxTokenLength;
    if (dict.dpMaxTokenLengthByFileCount) normalizedDict.dpMaxTokenLengthByFileCount = dict.dpMaxTokenLengthByFileCount;
    if (Object.keys(normalizedDict).length) normalized.dictionary = normalizedDict;
  }
  if (isPlainObject(baseConfig.triage)) {
    const triage = baseConfig.triage;
    const normalizedTriage = {};
    if (triage.recordsDir) normalizedTriage.recordsDir = triage.recordsDir;
    if (triage.storeRawPayload !== undefined) normalizedTriage.storeRawPayload = triage.storeRawPayload;
    if (triage.promoteFields) normalizedTriage.promoteFields = triage.promoteFields;
    if (triage.contextPack) normalizedTriage.contextPack = triage.contextPack;
    if (Object.keys(normalizedTriage).length) normalized.triage = normalizedTriage;
  }
  if (isPlainObject(baseConfig.runtime)) {
    const runtime = baseConfig.runtime;
    const normalizedRuntime = {};
    if (runtime.nodeOptions) normalizedRuntime.nodeOptions = runtime.nodeOptions;
    if (runtime.maxOldSpaceMb !== undefined) normalizedRuntime.maxOldSpaceMb = runtime.maxOldSpaceMb;
    if (runtime.uvThreadpoolSize !== undefined) normalizedRuntime.uvThreadpoolSize = runtime.uvThreadpoolSize;
    if (Object.keys(normalizedRuntime).length) normalized.runtime = normalizedRuntime;
  }
  if (isPlainObject(baseConfig.sqlite)) {
    const sqlite = baseConfig.sqlite;
    const normalizedSqlite = {};
    if (sqlite.use !== undefined) normalizedSqlite.use = sqlite.use;
    if (sqlite.ann !== undefined) normalizedSqlite.ann = sqlite.ann;
    if (sqlite.annCandidates !== undefined) normalizedSqlite.annCandidates = sqlite.annCandidates;
    if (Object.keys(normalizedSqlite).length) normalized.sqlite = normalizedSqlite;
  }
  if (isPlainObject(baseConfig.lmdb)) {
    const lmdb = baseConfig.lmdb;
    const normalizedLmdb = {};
    if (lmdb.use !== undefined) normalizedLmdb.use = lmdb.use;
    if (Object.keys(normalizedLmdb).length) normalized.lmdb = normalizedLmdb;
  }
  if (isPlainObject(baseConfig.search)) {
    const search = {};
    if (baseConfig.search.sqliteAutoChunkThreshold !== undefined) {
      const chunkThreshold = Number(baseConfig.search.sqliteAutoChunkThreshold);
      const artifactBytes = Number(baseConfig.search.sqliteAutoArtifactBytes);
      if (Number.isFinite(chunkThreshold)) {
        search.sqliteAutoChunkThreshold = Math.max(0, Math.floor(chunkThreshold));
      }
      if (Number.isFinite(artifactBytes)) {
        search.sqliteAutoArtifactBytes = Math.max(0, Math.floor(artifactBytes));
      }
    }
    if (Object.keys(search).length) normalized.search = search;
  }
  return normalized;
}

/**
 * Resolve the cache root directory.
 * @returns {string}
 */
export function getCacheRoot() {
  const testRoot = resolveTestCacheRoot(process.env);
  if (testRoot) return testRoot;
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'PairOfCleats');
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'pairofcleats');
  return path.join(os.homedir(), '.cache', 'pairofcleats');
}

function resolveTestCacheRoot(env) {
  const testing = env?.PAIROFCLEATS_TESTING === '1' || env?.PAIROFCLEATS_TESTING === 'true';
  if (!testing) return '';
  const raw = typeof env.PAIROFCLEATS_CACHE_ROOT === 'string' ? env.PAIROFCLEATS_CACHE_ROOT.trim() : '';
  return raw || '';
}

/**
 * Resolve dictionary configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {object}
 */
export function getDictConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const dict = cfg.dictionary || {};
  const dpMaxTokenLengthByFileCount = normalizeDpMaxTokenLengthByFileCount(
    dict.dpMaxTokenLengthByFileCount
  );
  return {
    dir: dict.dir || path.join(getCacheRoot(), 'dictionaries'),
    languages: Array.isArray(dict.languages) ? dict.languages : ['en'],
    files: Array.isArray(dict.files) ? dict.files : [],
    includeSlang: dict.includeSlang !== false,
    slangDirs: Array.isArray(dict.slangDirs) ? dict.slangDirs : [],
    slangFiles: Array.isArray(dict.slangFiles) ? dict.slangFiles : [],
    enableRepoDictionary: dict.enableRepoDictionary === true,
    segmentation: typeof dict.segmentation === 'string' ? dict.segmentation : 'auto',
    dpMaxTokenLength: Number.isFinite(Number(dict.dpMaxTokenLength))
      ? Number(dict.dpMaxTokenLength)
      : 32,
    dpMaxTokenLengthByFileCount
  };
}

function normalizeDpMaxTokenLengthByFileCount(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    return DEFAULT_DP_MAX_BY_FILE_COUNT.map((entry) => ({ ...entry }));
  }
  const normalized = raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const maxFiles = Number(entry.maxFiles);
      const dpMaxTokenLength = Number(entry.dpMaxTokenLength);
      if (!Number.isFinite(maxFiles) || maxFiles <= 0) return null;
      if (!Number.isFinite(dpMaxTokenLength) || dpMaxTokenLength <= 0) return null;
      return {
        maxFiles,
        dpMaxTokenLength: Math.max(4, Math.floor(dpMaxTokenLength))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.maxFiles - b.maxFiles);
  return normalized.length ? normalized : DEFAULT_DP_MAX_BY_FILE_COUNT.map((entry) => ({ ...entry }));
}

export function applyAdaptiveDictConfig(dictConfig, fileCount) {
  if (!dictConfig || typeof dictConfig !== 'object') return dictConfig || {};
  const count = Number(fileCount);
  if (!Number.isFinite(count) || count <= 0) return dictConfig;
  const mode = typeof dictConfig.segmentation === 'string'
    ? dictConfig.segmentation.trim().toLowerCase()
    : 'auto';
  if (mode !== 'auto' && mode !== 'dp') return dictConfig;
  const thresholds = Array.isArray(dictConfig.dpMaxTokenLengthByFileCount)
    && dictConfig.dpMaxTokenLengthByFileCount.length
    ? dictConfig.dpMaxTokenLengthByFileCount
    : DEFAULT_DP_MAX_BY_FILE_COUNT;
  const match = thresholds.find((entry) => count <= entry.maxFiles) || thresholds[thresholds.length - 1];
  if (!match || !Number.isFinite(match.dpMaxTokenLength)) return dictConfig;
  if (dictConfig.dpMaxTokenLength === match.dpMaxTokenLength) return dictConfig;
  return {
    ...dictConfig,
    dpMaxTokenLength: match.dpMaxTokenLength
  };
}
