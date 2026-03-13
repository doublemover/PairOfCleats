import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { buildAutoPolicy } from '../../src/shared/auto-policy.js';
import { getEnvConfig, getTestEnvConfig } from '../../src/shared/env.js';
import { getCacheRoot as getResolvedCacheRoot, getCacheRootBase } from '../../src/shared/cache-roots.js';
import { readJsoncFile } from '../../src/shared/jsonc.js';
import { isPlainObject, mergeConfig } from '../../src/shared/config.js';
import { validateConfig } from '../../src/config/validate.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { assertKnownIndexProfileId } from '../../src/contracts/index-profile.js';
import { DEFAULT_DP_MAX_BY_FILE_COUNT } from './constants.js';
import { resolveToolRoot } from './tool.js';

const isPlainRecord = (value) => (
  value != null
  && typeof value === 'object'
  && !Array.isArray(value)
  && value.constructor === Object
);

const sanitizeForStableHash = (value, active = new WeakSet()) => {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForStableHash(entry, active));
  }
  if (!isPlainRecord(value)) return value;
  if (active.has(value)) return '[Circular]';
  active.add(value);
  try {
    const out = {};
    for (const key of Object.keys(value)) {
      try {
        out[key] = sanitizeForStableHash(value[key], active);
      } catch {
        // Skip keys whose getters throw to keep config hashing resilient.
      }
    }
    return out;
  } finally {
    active.delete(value);
  }
};

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
  if (!fs.existsSync(configPath)) return applyTestOverrides(normalizeUserConfig({}, repoRoot));
  const base = readJsoncFile(configPath);
  if (!isPlainObject(base)) {
    throw new Error('Config root must be a JSON object.');
  }
  const schemaPath = path.join(resolveToolRoot(), 'docs', 'config', 'schema.json');
  const schemaRaw = fs.readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(schemaRaw);
  const result = validateConfig(schema, base);
  if (!result.ok) {
    const details = result.errors.map((err) => `- ${err}`).join('\n');
    throw new Error(`Config errors in ${configPath}:\n${details}`);
  }
  return applyTestOverrides(normalizeUserConfig(base, repoRoot));
}

/**
 * Compute a stable hash of the effective config inputs for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getEffectiveConfigHash(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const payload = { config: sanitizeForStableHash(cfg) };
  const json = stableStringify(payload);
  return crypto.createHash('sha1').update(json).digest('hex');
}

export async function getAutoPolicy(repoRoot, userConfig = null, options = {}) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  return buildAutoPolicy({ repoRoot, config: cfg, scanLimits: options.scanLimits });
}

function normalizeUserConfig(baseConfig, repoRoot = null) {
  if (!isPlainObject(baseConfig)) return {};
  const normalized = {};
  if (isPlainObject(baseConfig.cache)) {
    const rootRaw = typeof baseConfig.cache.root === 'string' && baseConfig.cache.root.trim()
      ? baseConfig.cache.root.trim()
      : undefined;
    const root = rootRaw
      ? (path.isAbsolute(rootRaw)
        ? path.resolve(rootRaw)
        : path.resolve(repoRoot || process.cwd(), rootRaw))
      : undefined;
    const runtime = isPlainObject(baseConfig.cache.runtime) ? baseConfig.cache.runtime : undefined;
    const cache = {};
    if (root) cache.root = root;
    if (runtime) cache.runtime = runtime;
    if (Object.keys(cache).length) normalized.cache = cache;
  }
  if (typeof baseConfig.quality === 'string' && baseConfig.quality.trim()) {
    normalized.quality = baseConfig.quality.trim();
  }
  if (baseConfig.threads !== undefined) {
    const threads = Number(baseConfig.threads);
    if (Number.isFinite(threads)) normalized.threads = threads;
  }
  if (isPlainObject(baseConfig.indexing)) {
    const indexing = baseConfig.indexing;
    const normalizedIndexing = {};
    if (indexing.profile !== undefined) {
      normalizedIndexing.profile = assertKnownIndexProfileId(indexing.profile);
    }
    if (indexing.segmenting) normalizedIndexing.segmenting = indexing.segmenting;
    if (indexing.commentExtraction) normalizedIndexing.commentExtraction = indexing.commentExtraction;
    if (indexing.documentExtraction) normalizedIndexing.documentExtraction = indexing.documentExtraction;
    if (indexing.artifacts) normalizedIndexing.artifacts = indexing.artifacts;
    if (indexing.postings) normalizedIndexing.postings = indexing.postings;
    if (isPlainObject(indexing.lexicon)) normalizedIndexing.lexicon = indexing.lexicon;
    if (indexing.codeMap) normalizedIndexing.codeMap = indexing.codeMap;
    if (indexing.records) normalizedIndexing.records = indexing.records;
    if (indexing.extractedProse) normalizedIndexing.extractedProse = indexing.extractedProse;
    if (indexing.embeddings) normalizedIndexing.embeddings = indexing.embeddings;
    if (indexing.pythonAst) normalizedIndexing.pythonAst = indexing.pythonAst;
    if (indexing.typeInference) normalizedIndexing.typeInference = indexing.typeInference;
    if (indexing.typeInferenceCrossFile !== undefined) {
      normalizedIndexing.typeInferenceCrossFile = indexing.typeInferenceCrossFile;
    }
    if (indexing.riskAnalysis !== undefined) normalizedIndexing.riskAnalysis = indexing.riskAnalysis;
    if (indexing.riskAnalysisCrossFile !== undefined) {
      normalizedIndexing.riskAnalysisCrossFile = indexing.riskAnalysisCrossFile;
    }
    if (isPlainObject(indexing.riskInterprocedural)) {
      normalizedIndexing.riskInterprocedural = indexing.riskInterprocedural;
    }
    if (isPlainObject(indexing.graph)) {
      const graph = {};
      if (isPlainObject(indexing.graph.caps)) graph.caps = indexing.graph.caps;
      if (Object.keys(graph).length) normalizedIndexing.graph = graph;
    }
    if (isPlainObject(indexing.snapshots)) {
      const snapshots = {};
      if (indexing.snapshots.keepPointer !== undefined) {
        snapshots.keepPointer = indexing.snapshots.keepPointer;
      }
      if (indexing.snapshots.keepFrozen !== undefined) {
        snapshots.keepFrozen = indexing.snapshots.keepFrozen;
      }
      if (indexing.snapshots.maxAgeDays !== undefined) {
        snapshots.maxAgeDays = indexing.snapshots.maxAgeDays;
      }
      if (indexing.snapshots.protectedTagGlobs !== undefined) {
        snapshots.protectedTagGlobs = indexing.snapshots.protectedTagGlobs;
      }
      if (indexing.snapshots.stagingMaxAgeHours !== undefined) {
        snapshots.stagingMaxAgeHours = indexing.snapshots.stagingMaxAgeHours;
      }
      if (indexing.snapshots.maxPointerSnapshots !== undefined) {
        snapshots.maxPointerSnapshots = indexing.snapshots.maxPointerSnapshots;
      }
      if (indexing.snapshots.maxFrozenSnapshots !== undefined) {
        snapshots.maxFrozenSnapshots = indexing.snapshots.maxFrozenSnapshots;
      }
      if (indexing.snapshots.retainDays !== undefined) {
        snapshots.retainDays = indexing.snapshots.retainDays;
      }
      if (indexing.snapshots.keepTags !== undefined) {
        snapshots.keepTags = indexing.snapshots.keepTags;
      }
      if (Object.keys(snapshots).length) normalizedIndexing.snapshots = snapshots;
    }
    if (isPlainObject(indexing.diffs)) {
      const diffs = {};
      if (indexing.diffs.keep !== undefined) diffs.keep = indexing.diffs.keep;
      if (indexing.diffs.maxAgeDays !== undefined) diffs.maxAgeDays = indexing.diffs.maxAgeDays;
      if (indexing.diffs.compute !== undefined) diffs.compute = indexing.diffs.compute;
      if (indexing.diffs.maxDiffs !== undefined) diffs.maxDiffs = indexing.diffs.maxDiffs;
      if (indexing.diffs.retainDays !== undefined) diffs.retainDays = indexing.diffs.retainDays;
      if (indexing.diffs.maxEvents !== undefined) diffs.maxEvents = indexing.diffs.maxEvents;
      if (indexing.diffs.maxBytes !== undefined) diffs.maxBytes = indexing.diffs.maxBytes;
      if (Object.keys(diffs).length) normalizedIndexing.diffs = diffs;
    }
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
  if (isPlainObject(baseConfig.tooling)) {
    const tooling = baseConfig.tooling;
    const normalizedTooling = {};
    if (tooling.dir) normalizedTooling.dir = tooling.dir;
    if (tooling.autoInstallOnDetect !== undefined) normalizedTooling.autoInstallOnDetect = tooling.autoInstallOnDetect;
    if (tooling.autoEnableOnDetect !== undefined) normalizedTooling.autoEnableOnDetect = tooling.autoEnableOnDetect;
    if (tooling.installScope) normalizedTooling.installScope = tooling.installScope;
    if (tooling.allowGlobalFallback !== undefined) normalizedTooling.allowGlobalFallback = tooling.allowGlobalFallback;
    if (tooling.strict !== undefined) normalizedTooling.strict = tooling.strict;
    if (tooling.timeoutMs !== undefined) normalizedTooling.timeoutMs = tooling.timeoutMs;
    if (tooling.maxRetries !== undefined) normalizedTooling.maxRetries = tooling.maxRetries;
    if (tooling.circuitBreakerThreshold !== undefined) {
      normalizedTooling.circuitBreakerThreshold = tooling.circuitBreakerThreshold;
    }
    if (isPlainObject(tooling.lifecycle)) normalizedTooling.lifecycle = tooling.lifecycle;
    if (tooling.logDir) normalizedTooling.logDir = tooling.logDir;
    if (tooling.enabledTools) normalizedTooling.enabledTools = tooling.enabledTools;
    if (tooling.disabledTools) normalizedTooling.disabledTools = tooling.disabledTools;
    if (tooling.providerOrder) normalizedTooling.providerOrder = tooling.providerOrder;
    if (isPlainObject(tooling.vfs)) {
      const vfs = {};
      if (tooling.vfs.strict !== undefined) vfs.strict = tooling.vfs.strict;
      if (tooling.vfs.maxVirtualFileBytes !== undefined) {
        vfs.maxVirtualFileBytes = tooling.vfs.maxVirtualFileBytes;
      }
      if (tooling.vfs.hashRouting !== undefined) vfs.hashRouting = tooling.vfs.hashRouting;
      if (tooling.vfs.coalesceSegments !== undefined) vfs.coalesceSegments = tooling.vfs.coalesceSegments;
      if (tooling.vfs.tokenMode !== undefined) vfs.tokenMode = tooling.vfs.tokenMode;
      if (isPlainObject(tooling.vfs.ioBatching)) vfs.ioBatching = tooling.vfs.ioBatching;
      if (tooling.vfs.coldStartCache !== undefined) vfs.coldStartCache = tooling.vfs.coldStartCache;
      if (Object.keys(vfs).length) normalizedTooling.vfs = vfs;
    }
    if (isPlainObject(tooling.lsp)) {
      const lsp = { ...tooling.lsp };
      if (tooling.lsp.enabled !== undefined) lsp.enabled = tooling.lsp.enabled;
      if (tooling.lsp.servers) lsp.servers = tooling.lsp.servers;
      if (Object.keys(lsp).length) normalizedTooling.lsp = lsp;
    }
    if (isPlainObject(tooling.cache)) {
      const cache = {};
      if (tooling.cache.enabled !== undefined) cache.enabled = tooling.cache.enabled;
      if (tooling.cache.dir) cache.dir = tooling.cache.dir;
      if (tooling.cache.maxBytes !== undefined) cache.maxBytes = tooling.cache.maxBytes;
      if (tooling.cache.maxEntries !== undefined) cache.maxEntries = tooling.cache.maxEntries;
      if (Object.keys(cache).length) normalizedTooling.cache = cache;
    }
    if (isPlainObject(tooling.typescript)) {
      const typescript = tooling.typescript;
      const normalizedTs = {};
      if (typescript.enabled !== undefined) normalizedTs.enabled = typescript.enabled;
      if (typescript.resolveOrder) normalizedTs.resolveOrder = typescript.resolveOrder;
      if (typescript.useTsconfig !== undefined) normalizedTs.useTsconfig = typescript.useTsconfig;
      if (typescript.tsconfigPath) normalizedTs.tsconfigPath = typescript.tsconfigPath;
      if (typescript.allowJs !== undefined) normalizedTs.allowJs = typescript.allowJs;
      if (typescript.checkJs !== undefined) normalizedTs.checkJs = typescript.checkJs;
      if (typescript.includeJsx !== undefined) normalizedTs.includeJsx = typescript.includeJsx;
      if (typescript.maxFiles !== undefined) normalizedTs.maxFiles = typescript.maxFiles;
      if (typescript.maxFileBytes !== undefined) normalizedTs.maxFileBytes = typescript.maxFileBytes;
      if (typescript.maxProgramFiles !== undefined) normalizedTs.maxProgramFiles = typescript.maxProgramFiles;
      if (Object.keys(normalizedTs).length) normalizedTooling.typescript = normalizedTs;
    }
    if (isPlainObject(tooling.clangd)) {
      const clangd = tooling.clangd;
      const normalizedClangd = {};
      if (clangd.requireCompilationDatabase !== undefined) {
        normalizedClangd.requireCompilationDatabase = clangd.requireCompilationDatabase;
      }
      if (clangd.compileCommandsDir) normalizedClangd.compileCommandsDir = clangd.compileCommandsDir;
      if (Object.keys(normalizedClangd).length) normalizedTooling.clangd = normalizedClangd;
    }
    if (isPlainObject(tooling.gopls)) normalizedTooling.gopls = tooling.gopls;
    if (isPlainObject(tooling.jdtls)) normalizedTooling.jdtls = tooling.jdtls;
    if (isPlainObject(tooling.csharp)) normalizedTooling.csharp = tooling.csharp;
    if (isPlainObject(tooling.solargraph)) normalizedTooling.solargraph = tooling.solargraph;
    if (isPlainObject(tooling.elixir)) normalizedTooling.elixir = tooling.elixir;
    if (isPlainObject(tooling.phpactor)) normalizedTooling.phpactor = tooling.phpactor;
    if (isPlainObject(tooling.haskell)) normalizedTooling.haskell = tooling.haskell;
    if (isPlainObject(tooling.dart)) normalizedTooling.dart = tooling.dart;
    if (isPlainObject(tooling.pyright)) normalizedTooling.pyright = tooling.pyright;
    if (isPlainObject(tooling.sourcekit)) normalizedTooling.sourcekit = tooling.sourcekit;
    if (Object.keys(normalizedTooling).length) normalized.tooling = normalizedTooling;
  }
  if (isPlainObject(baseConfig.mcp)) {
    const mcp = baseConfig.mcp;
    const normalizedMcp = {};
    if (typeof mcp.mode === 'string' && mcp.mode.trim()) {
      normalizedMcp.mode = mcp.mode.trim();
    }
    if (mcp.queueMax !== undefined) normalizedMcp.queueMax = mcp.queueMax;
    if (mcp.maxBufferBytes !== undefined) normalizedMcp.maxBufferBytes = mcp.maxBufferBytes;
    if (mcp.toolTimeoutMs !== undefined) normalizedMcp.toolTimeoutMs = mcp.toolTimeoutMs;
    if (isPlainObject(mcp.toolTimeouts)) normalizedMcp.toolTimeouts = mcp.toolTimeouts;
    if (Object.keys(normalizedMcp).length) normalized.mcp = normalizedMcp;
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
    if (runtime.ioOversubscribe !== undefined) normalizedRuntime.ioOversubscribe = runtime.ioOversubscribe;
    if (Object.keys(normalizedRuntime).length) normalized.runtime = normalizedRuntime;
  }
  if (isPlainObject(baseConfig.sqlite)) {
    const sqlite = baseConfig.sqlite;
    const normalizedSqlite = {};
    if (sqlite.use !== undefined) normalizedSqlite.use = sqlite.use;
    if (sqlite.ann !== undefined) normalizedSqlite.ann = sqlite.ann;
    if (sqlite.annCandidates !== undefined) normalizedSqlite.annCandidates = sqlite.annCandidates;
    if (isPlainObject(sqlite.vectorExtension)) {
      normalizedSqlite.vectorExtension = sqlite.vectorExtension;
    }
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
      if (Number.isFinite(chunkThreshold)) {
        search.sqliteAutoChunkThreshold = Math.max(0, Math.floor(chunkThreshold));
      }
    }
    if (baseConfig.search.sqliteAutoArtifactBytes !== undefined) {
      const artifactBytes = Number(baseConfig.search.sqliteAutoArtifactBytes);
      if (Number.isFinite(artifactBytes)) {
        search.sqliteAutoArtifactBytes = Math.max(0, Math.floor(artifactBytes));
      }
    }
    if (Object.keys(search).length) normalized.search = search;
  }
  if (isPlainObject(baseConfig.retrieval)) {
    const retrieval = baseConfig.retrieval;
    const normalizedRetrieval = {};
    if (retrieval.annCandidateCap !== undefined) {
      normalizedRetrieval.annCandidateCap = retrieval.annCandidateCap;
    }
    if (retrieval.annCandidateMinDocCount !== undefined) {
      normalizedRetrieval.annCandidateMinDocCount = retrieval.annCandidateMinDocCount;
    }
    if (retrieval.annCandidateMaxDocCount !== undefined) {
      normalizedRetrieval.annCandidateMaxDocCount = retrieval.annCandidateMaxDocCount;
    }
    if (isPlainObject(retrieval.relationBoost)) {
      normalizedRetrieval.relationBoost = retrieval.relationBoost;
    }
    if (isPlainObject(retrieval.dense)) {
      normalizedRetrieval.dense = retrieval.dense;
    }
    if (isPlainObject(retrieval.ann)) {
      normalizedRetrieval.ann = retrieval.ann;
    }
    if (isPlainObject(retrieval.graph)) {
      const graph = {};
      if (isPlainObject(retrieval.graph.caps)) graph.caps = retrieval.graph.caps;
      if (Object.keys(graph).length) normalizedRetrieval.graph = graph;
    }
    if (isPlainObject(retrieval.graphRanking)) {
      normalizedRetrieval.graphRanking = retrieval.graphRanking;
    }
    if (isPlainObject(retrieval.contextExpansion)) {
      normalizedRetrieval.contextExpansion = retrieval.contextExpansion;
    }
    if (Object.keys(normalizedRetrieval).length) normalized.retrieval = normalizedRetrieval;
  }
  return normalized;
}

/**
 * Resolve the cache root directory.
 * @returns {string}
 */
export function getCacheRoot() {
  return getResolvedCacheRoot();
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
  const envConfig = getEnvConfig();
  const envDictDir = envConfig.dictDir || '';
  const dpMaxTokenLengthByFileCount = normalizeDpMaxTokenLengthByFileCount(
    dict.dpMaxTokenLengthByFileCount
  );
  return {
    // Dictionaries are shared and durable across cache-key versions; keep them outside repo cache data.
    dir: envDictDir || dict.dir || path.join(getCacheRootBase(), 'dictionaries'),
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
