import fs from 'node:fs';
import path from 'node:path';
import { getExtensionsDir, loadUserConfig } from './dict-utils.js';
import { incFallback } from '../src/shared/metrics.js';

const DEFAULT_PROVIDER = 'sqlite-vec';
const DEFAULT_MODULE = 'vec0';
const DEFAULT_TABLE = 'dense_vectors_ann';
const DEFAULT_COLUMN = 'embedding';
const DEFAULT_ENCODING = 'float32';
const SQLITE_IN_LIMIT = 900;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPTION_RE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*([A-Za-z0-9_.-]+))?$/;

const PROVIDERS = {
  'sqlite-vec': {
    module: 'vec0',
    table: DEFAULT_TABLE,
    column: DEFAULT_COLUMN,
    encoding: DEFAULT_ENCODING
  }
};

const warningCache = new Set();

function warnOnce(key, message) {
  if (warningCache.has(key)) return;
  warningCache.add(key);
  console.warn(message);
}

function isSafeIdentifier(value) {
  return IDENTIFIER_RE.test(String(value || ''));
}

function normalizeOptionValue(value) {
  return String(value || '').replace(/\\/g, '/').trim();
}

function parseVectorOptions(raw) {
  if (!raw) return { ok: true, options: '' };
  const trimmed = normalizeOptionValue(raw);
  if (!trimmed) return { ok: true, options: '' };
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  const normalized = [];
  for (const part of parts) {
    const match = OPTION_RE.exec(part);
    if (!match) {
      return { ok: false, reason: 'invalid vector extension options' };
    }
    const key = match[1];
    const value = match[2];
    normalized.push(value ? `${key}=${value}` : key);
  }
  return { ok: true, options: normalized.join(', ') };
}

function sanitizeVectorExtensionConfig(config) {
  const issues = [];
  if (!isSafeIdentifier(config.module)) issues.push('module');
  if (!isSafeIdentifier(config.table)) issues.push('table');
  if (!isSafeIdentifier(config.column)) issues.push('column');
  const parsedOptions = parseVectorOptions(config.options);
  if (!parsedOptions.ok) issues.push('options');

  const sanitized = {
    ...config,
    options: parsedOptions.ok ? parsedOptions.options : '',
    disabledReason: null
  };
  if (sanitized.enabled && issues.length) {
    sanitized.enabled = false;
    sanitized.disabledReason = `invalid vector extension config (${issues.join(', ')})`;
    warnOnce('vector-extension-invalid', `[sqlite] Vector extension disabled: ${sanitized.disabledReason}`);
  }
  return sanitized;
}

/**
 * Resolve a path relative to the repo root.
 * @param {string} repoRoot
 * @param {string|null} value
 * @returns {string|null}
 */
function resolvePath(repoRoot, value) {
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  return path.join(repoRoot, value);
}

/**
 * Resolve the platform-specific dynamic library suffix.
 * @param {string} [platform]
 * @returns {string}
 */
export function getBinarySuffix(platform = process.platform) {
  if (platform === 'win32') return '.dll';
  if (platform === 'darwin') return '.dylib';
  return '.so';
}

/**
 * Build a platform key (platform-arch).
 * @param {string} [platform]
 * @param {string} [arch]
 * @returns {string}
 */
export function getPlatformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/**
 * Resolve vector extension configuration from repo config + overrides.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @param {object} [overrides]
 * @returns {object}
 */
export function getVectorExtensionConfig(repoRoot, userConfig = null, overrides = {}) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const configOverrides = cfg?.sqlite?.vectorExtension
    && typeof cfg.sqlite.vectorExtension === 'object'
    && !Array.isArray(cfg.sqlite.vectorExtension)
    ? cfg.sqlite.vectorExtension
    : {};
  const merged = { ...configOverrides, ...overrides };
  const provider = merged.provider || DEFAULT_PROVIDER;
  const providerDefaults = PROVIDERS[provider] || {};

  const legacyAnnMode = typeof cfg?.sqlite?.annMode === 'string' ? cfg.sqlite.annMode : null;
  const annModeRaw = merged.annMode || legacyAnnMode || 'auto';
  const annModeNormalized = String(annModeRaw).toLowerCase();
  const annMode = ['auto', 'extension', 'js'].includes(annModeNormalized) ? annModeNormalized : 'auto';
  const autoEnabled = annMode === 'extension' || annMode === 'auto';
  const enabled = merged.enabled === true
    ? true
    : (merged.enabled === false ? false : autoEnabled);

  const platform = merged.platform || process.platform;
  const arch = merged.arch || process.arch;
  const platformKey = getPlatformKey(platform, arch);
  const moduleName = merged.module || providerDefaults.module || DEFAULT_MODULE;
  const encoding = merged.encoding || providerDefaults.encoding || DEFAULT_ENCODING;
  const table = merged.table || providerDefaults.table || DEFAULT_TABLE;
  const column = merged.column || providerDefaults.column || DEFAULT_COLUMN;
  const options = merged.options || providerDefaults.options || '';

  const dir = merged.dir
    ? resolvePath(repoRoot, merged.dir)
    : getExtensionsDir(repoRoot, cfg);
  const filename = merged.filename
    || providerDefaults.filename
    || `${moduleName}${getBinarySuffix(platform)}`;
  const pathOverride = merged.path
    ? resolvePath(repoRoot, merged.path)
    : null;

  const url = merged.url || providerDefaults.url || null;
  const downloads = merged.downloads || providerDefaults.downloads || null;

  return sanitizeVectorExtensionConfig({
    annMode,
    enabled,
    provider,
    module: moduleName,
    encoding,
    table,
    column,
    options,
    dir,
    filename,
    path: pathOverride,
    url,
    downloads,
    platform,
    arch,
    platformKey
  });
}

/**
 * Resolve the extension binary path from config.
 * @param {object} config
 * @returns {string|null}
 */
export function resolveVectorExtensionPath(config) {
  if (!config) return null;
  if (config.path) return config.path;
  if (!config.dir || !config.provider || !config.filename) return null;
  return path.join(config.dir, config.provider, config.platformKey, config.filename);
}

const loadCache = new WeakMap();

const getLoadCache = (db) => {
  let cache = loadCache.get(db);
  if (!cache) {
    cache = new Map();
    loadCache.set(db, cache);
  }
  return cache;
};

const getLoadCacheKey = (config) => {
  const extPath = resolveVectorExtensionPath(config) || '';
  return [
    config?.provider || '',
    config?.module || '',
    config?.table || '',
    config?.column || '',
    config?.encoding || '',
    config?.options || '',
    extPath
  ].join('|');
};

/**
 * Load the vector extension into a SQLite connection (cached per db).
 * @param {import('better-sqlite3').Database} db
 * @param {object} config
 * @param {string} [label]
 * @returns {{ok:boolean,reason?:string,path?:string,label?:string}}
 */
export function loadVectorExtension(db, config, label = 'sqlite') {
  if (!db || !config?.enabled) {
    return { ok: false, reason: config?.disabledReason || 'disabled' };
  }
  const cache = getLoadCache(db);
  const cacheKey = getLoadCacheKey(config);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached.label === label ? cached : { ...cached, label };
  }
  const extPath = resolveVectorExtensionPath(config);
  if (!extPath || !fs.existsSync(extPath)) {
    const result = { ok: false, reason: `missing extension (${extPath || 'unset'})` };
    cache.set(cacheKey, result);
    return result;
  }
  try {
    db.loadExtension(extPath);
    const result = { ok: true, path: extPath, label };
    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    const result = { ok: false, reason: err?.message || String(err), label };
    cache.set(cacheKey, result);
    return result;
  }
}

/**
 * Check whether a vector table exists.
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @returns {boolean}
 */
export function hasVectorTable(db, tableName) {
  if (!db || !tableName) return false;
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(tableName);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Ensure the vector table exists for the given embedding dimension.
 * @param {import('better-sqlite3').Database} db
 * @param {object} config
 * @param {number} dims
 * @returns {{ok:boolean,reason?:string,tableName?:string,column?:string}}
 */
export function ensureVectorTable(db, config, dims) {
  if (!db || !config?.module || !config?.table) {
    return { ok: false, reason: 'missing config' };
  }
  if (!config.enabled) {
    return { ok: false, reason: config.disabledReason || 'disabled' };
  }
  if (!isSafeIdentifier(config.module) || !isSafeIdentifier(config.table)) {
    return { ok: false, reason: 'invalid vector extension config' };
  }
  if (!Number.isFinite(dims) || dims <= 0) {
    return { ok: false, reason: 'invalid dims' };
  }
  const column = config.column || DEFAULT_COLUMN;
  if (!isSafeIdentifier(column)) {
    return { ok: false, reason: 'invalid vector extension config' };
  }
  const options = config.options ? `, ${config.options}` : '';
  let trustedSchema = null;
  let restoreTrustedSchema = false;
  try {
    try {
      trustedSchema = db.pragma('trusted_schema', { simple: true });
      if (trustedSchema !== 1) {
        db.pragma('trusted_schema = 1');
        restoreTrustedSchema = true;
      }
    } catch {}
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${config.table} USING ${config.module}(${column} float[${Math.floor(dims)}]${options})`
    );
    return { ok: true, tableName: config.table, column };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  } finally {
    if (restoreTrustedSchema && trustedSchema !== null) {
      try {
        db.pragma(`trusted_schema = ${trustedSchema}`);
      } catch {}
    }
  }
}

/**
 * Encode a vector into a format accepted by the extension.
 * @param {ArrayLike<number>} vector
 * @param {object} config
 * @returns {Buffer|string|null}
 */
export function encodeVector(vector, config) {
  if (!vector || typeof vector.length !== 'number') return null;
  const encoding = String(config?.encoding || DEFAULT_ENCODING).toLowerCase();
  if (encoding === 'json') {
    return JSON.stringify(Array.from(vector));
  }
  if (vector instanceof Float32Array) {
    return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  }
  const floats = Float32Array.from(Array.from(vector));
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

/**
 * Query the vector ANN index and return scored hits.
 * @param {import('better-sqlite3').Database} db
 * @param {object} config
 * @param {ArrayLike<number>} embedding
 * @param {number} topN
 * @param {Set<number>|null} candidateSet
 * @returns {Array<{idx:number,sim:number}>}
 */
export function queryVectorAnn(db, config, embedding, topN, candidateSet) {
  if (!db || !embedding || !config?.enabled) return [];
  const table = config?.table || DEFAULT_TABLE;
  const column = config?.column || DEFAULT_COLUMN;
  if (!isSafeIdentifier(table) || !isSafeIdentifier(column)) {
    warnOnce('vector-extension-unsafe', '[sqlite] Vector extension disabled: invalid identifiers');
    return [];
  }
  const limit = Math.max(1, Number(topN) || 1);
  const candidateSize = candidateSet?.size || 0;
  const canPushdown = candidateSize > 0 && candidateSize <= SQLITE_IN_LIMIT;
  const candidates = canPushdown ? Array.from(candidateSet) : null;
  const queryLimit = canPushdown ? limit : (candidateSize ? limit * 5 : limit);
  const encoded = encodeVector(embedding, config);
  if (!encoded) return [];
  try {
    const candidateClause = canPushdown
      ? ` AND rowid IN (${candidates.map(() => '?').join(',')})`
      : '';
    const params = canPushdown
      ? [encoded, ...candidates, queryLimit]
      : [encoded, queryLimit];
    if (candidateSize && !canPushdown) {
      warnOnce('vector-extension-candidates', '[sqlite] Vector extension candidate set too large; using best-effort fallback.');
      incFallback({ surface: 'search', reason: 'vector-candidates' });
    }
    const stmt = db.prepare(
      `SELECT rowid, distance FROM ${table} WHERE ${column} MATCH ?${candidateClause} ORDER BY distance LIMIT ?`
    );
    const rows = stmt.all(...params);
    let hits = rows.map((row) => {
      const rowId = Number(row.rowid ?? row.id);
      const raw = row.distance ?? row.score ?? row.similarity ?? row.sim ?? 0;
      const sim = row.distance !== undefined ? -raw : raw;
      return { idx: rowId, sim };
    });
    if (candidateSet && candidateSet.size && !canPushdown) {
      hits = hits.filter((hit) => candidateSet.has(hit.idx));
    }
    return hits
      .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx))
      .slice(0, limit);
  } catch {
    return [];
  }
}
