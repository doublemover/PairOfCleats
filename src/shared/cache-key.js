import { sha1 } from './hash.js';
import { stableStringifyForSignature } from './stable-json.js';
import { getEnvConfig } from './env.js';

export const CACHE_KEY_VERSION = 'ck1';
export const DEFAULT_CACHE_NAMESPACE = 'pairofcleats';

const normalizeToken = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

export const normalizeCacheNamespace = (value) => {
  const raw = normalizeToken(value).toLowerCase();
  if (!raw) return DEFAULT_CACHE_NAMESPACE;
  const normalized = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_CACHE_NAMESPACE;
};

export const normalizeCacheFlags = (value) => {
  if (!value) return '';
  const list = Array.isArray(value) ? value : String(value).split(',');
  const normalized = list
    .map((entry) => normalizeToken(entry))
    .filter(Boolean)
    .sort();
  return normalized.join(',');
};

export const resolvePathPolicy = (value) => {
  if (value === 'posix' || value === 'native') return value;
  if (value === true) return 'native';
  if (value === false) return 'posix';
  return process.platform === 'win32' ? 'native' : 'posix';
};

export const normalizeCacheExtra = (value) => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return stableStringifyForSignature(value);
  } catch {
    return '';
  }
};

export const resolveCacheNamespace = (options = {}) => {
  const override = normalizeToken(options.namespace);
  if (override) return normalizeCacheNamespace(override);
  const envConfig = options.envConfig || getEnvConfig();
  if (envConfig?.cacheNamespace) return normalizeCacheNamespace(envConfig.cacheNamespace);
  return DEFAULT_CACHE_NAMESPACE;
};

export const buildCacheKeyPayload = ({
  repoHash,
  buildConfigHash,
  mode,
  schemaVersion,
  featureFlags,
  pathPolicy,
  extra
} = {}) => {
  const normalizedFlags = normalizeCacheFlags(featureFlags);
  const normalizedPathPolicy = resolvePathPolicy(pathPolicy);
  return {
    repoHash: normalizeToken(repoHash),
    buildConfigHash: normalizeToken(buildConfigHash),
    mode: normalizeToken(mode),
    schemaVersion: normalizeToken(schemaVersion),
    featureFlags: normalizedFlags,
    pathPolicy: normalizedPathPolicy,
    extra: normalizeCacheExtra(extra)
  };
};

export const serializeCacheKeyPayload = (payload = {}) => {
  const parts = [
    normalizeToken(payload.repoHash),
    normalizeToken(payload.buildConfigHash),
    normalizeToken(payload.mode),
    normalizeToken(payload.schemaVersion),
    normalizeCacheFlags(payload.featureFlags),
    resolvePathPolicy(payload.pathPolicy)
  ];
  const extra = normalizeCacheExtra(payload.extra);
  if (extra) parts.push(extra);
  return parts.join('|');
};

export const hashCacheKeyPayload = (payload = {}) => sha1(serializeCacheKeyPayload(payload));

export const buildCacheKey = (options = {}) => {
  const namespace = resolveCacheNamespace(options);
  const version = normalizeToken(options.version) || CACHE_KEY_VERSION;
  const payload = buildCacheKeyPayload(options);
  const serialized = serializeCacheKeyPayload(payload);
  const digest = sha1(serialized);
  return {
    key: `${namespace}:${version}:${digest}`,
    namespace,
    version,
    digest,
    serialized,
    payload
  };
};
