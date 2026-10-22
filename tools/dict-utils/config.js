import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { buildAutoPolicy } from '../../src/shared/auto-policy/build.js';
import { getEnvConfig } from '../../src/shared/env/runtime.js';
import { getTestEnvConfig } from '../../src/shared/env/testing.js';
import { getCacheRoot as getResolvedCacheRoot, getCacheRootBase, getStorageCategorySelection } from '../../src/shared/cache-roots.js';
import { readJsoncFile, parseJsoncText } from '../../src/shared/jsonc.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';
import { isPlainObject, mergeConfig } from '../../src/shared/config.js';
import { applyRepoConfigAuthority, resolveTrustedConfigPath, isRepoTrusted } from '../../src/shared/config-authority.js';
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
const hasSensitiveSource = (value, key = '') => {
  if (/(?:secret|password|passwd|token|credential|authorization|cookie|api.?key|private.?key|^env$|nodeOptions)/i.test(key)) return true;
  if (typeof value === 'string') return redactDiagnosticText(value, value.length + 1) !== value;
  return value && typeof value === 'object'
    ? Object.entries(value).some(([name, entry]) => hasSensitiveSource(entry, name)) : false;
};
const discardedConfigPaths = (before, after, prefix = '') => {
  if (!before || typeof before !== 'object' || Array.isArray(before)) return [];
  return Object.keys(before).flatMap(key => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (!Object.hasOwn(after || {}, key)) return [name];
    return discardedConfigPaths(before[key], after[key], name);
  });
};

let shippedSchemaCache = null;
const freezeShippedSchema = schema => {
  if (!schema || typeof schema !== 'object' || Object.isFrozen(schema)) return schema;
  for (const child of Object.values(schema)) freezeShippedSchema(child);
  return Object.freeze(schema);
};
const schemaIdentity = stat => [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(':');
/** One shipped tool schema identity; repository and trusted values are never cached. */
export const readShippedConfigSchema = schemaPath => {
  const absolute = path.resolve(schemaPath);
  const before = fs.statSync(absolute,{ bigint: true });
  const identity = schemaIdentity(before);
  if (shippedSchemaCache?.path === absolute && shippedSchemaCache.identity === identity) return shippedSchemaCache.schema;
  const schema = freezeShippedSchema(JSON.parse(fs.readFileSync(absolute,'utf8')));
  if (schemaIdentity(fs.statSync(absolute,{ bigint: true })) !== identity) throw new Error('Shipped config schema changed while being read.');
  shippedSchemaCache = { path: absolute,identity,schema };
  return schema;
};

/** Optional source callback reports loader facts without changing the config value contract. */
export function loadUserConfig(repoRoot, { env = process.env, onSources = null, configPath: selectedConfigPath = null } = {}) {
  const metadata = { version: 1, files: [], repoTrusted: isRepoTrusted(repoRoot, env),
    discardedAuthorityPaths: [], trustedMerge: false, testOverlay: { applied: false, source: 'test-environment' } };
  const readSource = (filename, source, optional = false) => {
    let raw;
    const evidence = { path: filename, source, exists: false, contentHash: null };
    metadata.files.push(evidence);
    try { raw = fs.readFileSync(filename, 'utf8'); }
    catch (error) {
      evidence.errorCode = error.code || 'UNKNOWN';
      if (optional && error.code === 'ENOENT') return {};
      throw error;
    }
    evidence.exists = true;
    const value = parseJsoncText(raw, filename);
    if (hasSensitiveSource(value)) evidence.contentHashOmitted = 'sensitive-source';
    else evidence.contentHash = crypto.createHash('sha256').update(raw).digest('hex');
    return value;
  };
  try {
    const configPath = selectedConfigPath ? path.resolve(selectedConfigPath) : path.join(repoRoot, '.pairofcleats.json');
    const base = readSource(configPath, 'repository', !selectedConfigPath);
    if (!isPlainObject(base)) throw new Error('Config root must be a JSON object.');
    const schemaPath = path.join(resolveToolRoot(), 'docs', 'config', 'schema.json');
    const schema = readShippedConfigSchema(schemaPath);
    const result = validateConfig(schema, base);
    if (!result.ok) {
      const details = result.errors.map((err) => `- ${err}`).join('\n');
      throw new Error(`Config errors in ${configPath}:\n${details}`);
    }
    const trustedPath = resolveTrustedConfigPath(repoRoot, env);
    const trusted = trustedPath ? readSource(trustedPath, 'trusted-external') : {};
    const trustedResult = validateConfig(schema, trusted);
    if (!trustedResult.ok) throw Object.assign(new Error('Invalid user-owned trusted configuration:\n'
      + trustedResult.errors.map(error => `- ${error}`).join('\n')), {
      code: 'ERR_TRUSTED_CONFIG_INVALID', configPath: trustedPath,
      errors: trustedResult.errors.map(message => ({ code: 'schema', message }))
    });
    const safe = applyRepoConfigAuthority(base, repoRoot, env);
    metadata.discardedAuthorityPaths = discardedConfigPaths(base, safe);
    metadata.trustedMerge = Boolean(trustedPath);
    const normalized = normalizeUserConfig(mergeConfig(safe, trusted), repoRoot);
    const testEnv = getTestEnvConfig(env);
    metadata.testOverlay.applied = Boolean(testEnv.testing && testEnv.config);
    return metadata.testOverlay.applied ? mergeConfig(normalized, testEnv.config) : normalized;
  } finally {
    if (typeof onSources === 'function') onSources(metadata);
  }
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

/**
 * Preserve schema-validated settings; runtime consumers own defaults and bounds.
 * Do not project another allowlist here: permissive schema namespaces also carry
 * runtime-owned settings such as indexing.typeInference and indexing.workerPool.
 * Only transformations that are part of the loader contract belong here.
 */
function normalizeUserConfig(baseConfig, repoRoot = null) {
  if (!isPlainObject(baseConfig)) return {};
  const normalized = { ...baseConfig };
  if (isPlainObject(baseConfig.cache)) {
    const cache = { ...baseConfig.cache };
    const rootRaw = typeof cache.root === 'string' ? cache.root.trim() : '';
    if (rootRaw) {
      cache.root = path.resolve(repoRoot || process.cwd(), rootRaw);
    } else {
      delete cache.root;
    }
    normalized.cache = cache;
  }
  if (isPlainObject(baseConfig.indexing)) {
    normalized.indexing = { ...baseConfig.indexing };
    if (baseConfig.indexing.profile !== undefined) {
      normalized.indexing.profile = assertKnownIndexProfileId(baseConfig.indexing.profile);
    }
    if (baseConfig.indexing.maxFileLines !== undefined) {
      console.warn(
        '[config] indexing.maxFileLines is unsupported and has no effect; '
        + 'use indexing.fileCaps.default.maxLines instead.'
      );
    }
  }
  if (isPlainObject(baseConfig.search)) {
    const search = { ...baseConfig.search };
    for (const key of ['sqliteAutoChunkThreshold', 'sqliteAutoArtifactBytes']) {
      if (search[key] !== undefined) {
        search[key] = Math.max(0, Math.floor(search[key]));
      }
    }
    normalized.search = search;
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
    dir: envDictDir || dict.dir || getStorageCategorySelection('dictionaries') || path.join(getCacheRootBase(), 'dictionaries'),
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
