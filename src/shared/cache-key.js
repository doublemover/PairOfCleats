import { sha1 } from './hash.js';
import { stableStringifyForSignature } from './stable-json.js';
import { getEnvConfig } from './env.js';

export const CACHE_KEY_VERSION = 'ck1';
export const DEFAULT_CACHE_NAMESPACE = 'pairofcleats';
export const LOCAL_CACHE_KEY_VERSION = 'lk1';
const LOCAL_CACHE_DIGEST_MEMO_MAX = 65536;
const localCacheDigestMemo = new Map();
const localCacheSimpleKeyMemo = new Map();

const normalizeToken = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

const tryStringifySignaturePrimitive = (value) => {
  if (value === undefined) return undefined;
  if (typeof value === 'bigint') {
    return `{"__type":"bigint","value":${JSON.stringify(value.toString())}}`;
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  return null;
};

const tryStableStringifyJsonSignature = (value, { arrayUndefinedAsNull = false } = {}) => {
  const primitive = tryStringifySignaturePrimitive(value);
  if (primitive !== null) {
    return primitive === undefined && arrayUndefinedAsNull ? 'null' : primitive;
  }
  if (Array.isArray(value)) {
    const parts = [];
    for (const entry of value) {
      const serialized = tryStableStringifyJsonSignature(entry, { arrayUndefinedAsNull: true });
      if (serialized === null) return null;
      parts.push(serialized === undefined ? 'null' : serialized);
    }
    return `[${parts.join(',')}]`;
  }
  if (!value || typeof value !== 'object' || value.constructor !== Object) {
    return null;
  }
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    const serialized = tryStableStringifyJsonSignature(value[key]);
    if (serialized === null) return null;
    if (serialized === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(',')}}`;
};

const serializeLocalCacheInput = ({ namespace, version, payload }) => {
  const serializedPayload = tryStableStringifyJsonSignature(payload ?? null);
  if (serializedPayload === null || serializedPayload === undefined) {
    return stableStringifyForSignature({
      namespace,
      version,
      payload: payload ?? null
    });
  }
  return `{"namespace":${JSON.stringify(namespace)},"payload":${serializedPayload},"version":${JSON.stringify(version)}}`;
};

const tryPrimitiveMemoToken = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? `number:${value}` : 'null';
  if (typeof value === 'boolean') return value ? 'boolean:true' : 'boolean:false';
  if (typeof value === 'string') return `string:${value.length}:${value}`;
  return null;
};

const tryBuildSimpleLocalCacheMemoKey = ({ namespace, version, payload }) => {
  const value = payload ?? null;
  const primitive = tryPrimitiveMemoToken(value);
  const prefix = `${namespace.length}:${namespace}|${version.length}:${version}|`;
  if (primitive !== null) {
    return `${prefix}${primitive}`;
  }
  if (!value || typeof value !== 'object' || value.constructor !== Object) return null;
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    const serialized = tryPrimitiveMemoToken(value[key]);
    if (serialized === null) return null;
    if (serialized === undefined) continue;
    parts.push(`${key.length}:${key}=${serialized}`);
  }
  return `${prefix}{${parts.join(',')}}`;
};

const hashMemoizedSerialized = (serialized) => {
  const cached = localCacheDigestMemo.get(serialized);
  if (cached) {
    return cached;
  }
  const digest = sha1(serialized);
  localCacheDigestMemo.set(serialized, digest);
  while (localCacheDigestMemo.size > LOCAL_CACHE_DIGEST_MEMO_MAX) {
    const oldest = localCacheDigestMemo.keys().next().value;
    localCacheDigestMemo.delete(oldest);
  }
  return digest;
};

const rememberSimpleLocalCacheKey = (memoKey, entry) => {
  if (!memoKey) return;
  localCacheSimpleKeyMemo.set(memoKey, entry);
  while (localCacheSimpleKeyMemo.size > LOCAL_CACHE_DIGEST_MEMO_MAX) {
    const oldest = localCacheSimpleKeyMemo.keys().next().value;
    localCacheSimpleKeyMemo.delete(oldest);
  }
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
  const digest = hashMemoizedSerialized(serialized);
  return {
    key: `${namespace}:${version}:${digest}`,
    namespace,
    version,
    digest,
    serialized,
    payload
  };
};

export const buildLocalCacheKey = ({ namespace = 'local', version, payload } = {}) => {
  const resolvedNamespace = normalizeCacheNamespace(namespace || 'local');
  const resolvedVersion = normalizeToken(version) || LOCAL_CACHE_KEY_VERSION;
  const memoKey = tryBuildSimpleLocalCacheMemoKey({
    namespace: resolvedNamespace,
    version: resolvedVersion,
    payload: payload ?? null
  });
  const cached = memoKey ? localCacheSimpleKeyMemo.get(memoKey) : null;
  if (cached) {
    return {
      key: cached.key,
      namespace: resolvedNamespace,
      version: resolvedVersion,
      digest: cached.digest,
      serialized: cached.serialized,
      payload
    };
  }
  const serialized = serializeLocalCacheInput({
    namespace: resolvedNamespace,
    version: resolvedVersion,
    payload: payload ?? null
  });
  const digest = hashMemoizedSerialized(serialized);
  const key = `${resolvedNamespace}:${resolvedVersion}:${digest}`;
  rememberSimpleLocalCacheKey(memoKey, { key, digest, serialized });
  return {
    key,
    namespace: resolvedNamespace,
    version: resolvedVersion,
    digest,
    serialized,
    payload
  };
};
