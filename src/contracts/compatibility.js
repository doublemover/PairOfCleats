import { sha1 } from '../shared/hash.js';
import { stableStringify } from '../shared/stable-json.js';
import { ARTIFACT_SCHEMA_HASH } from './registry.js';
import { SCHEMA_VERSION as SQLITE_SCHEMA_VERSION } from '../storage/sqlite/schema.js';
import { ARTIFACT_SURFACE_VERSION, parseSemver } from './versioning.js';
import {
  INDEX_PROFILE_DEFAULT,
  INDEX_PROFILE_SCHEMA_VERSION,
  normalizeIndexProfileId
} from './index-profile.js';

const normalizeModes = (modes) => Array.from(new Set(modes || [])).sort();

export const CHUNK_ID_ALGO_VERSION = 2;

const VOLATILE_LANGUAGE_OPTION_KEYS = new Set([
  'rootDir',
  'repoRoot',
  'sourceRoot',
  'projectRoot',
  'workspaceRoot',
  'buildRoot',
  'cachePersistentDir',
  'cacheDir',
  'cacheRoot',
  'tempDir',
  'tmpDir',
  'workDir',
  'outputDir',
  'indexRoot'
]);

const sanitizeVolatileConfig = (value) => {
  if (Array.isArray(value)) return value.map((entry) => sanitizeVolatileConfig(entry));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (VOLATILE_LANGUAGE_OPTION_KEYS.has(key)) continue;
    out[key] = sanitizeVolatileConfig(entry);
  }
  return out;
};

const resolveProfilePayload = (runtime) => {
  const runtimeProfile = runtime?.profile && typeof runtime.profile === 'object'
    ? runtime.profile
    : {};
  const id = normalizeIndexProfileId(
    runtimeProfile.id ?? runtime?.indexingConfig?.profile,
    INDEX_PROFILE_DEFAULT
  );
  const schemaVersion = Number.isFinite(Number(runtimeProfile.schemaVersion))
    ? Math.max(1, Math.floor(Number(runtimeProfile.schemaVersion)))
    : INDEX_PROFILE_SCHEMA_VERSION;
  return { id, schemaVersion };
};

export const buildLanguagePolicyKey = (runtime) => {
  const languageOptions = sanitizeVolatileConfig(runtime?.languageOptions || {});
  const payload = {
    segmentsConfig: sanitizeVolatileConfig(runtime?.segmentsConfig || {}),
    languageOptions,
    commentsConfig: sanitizeVolatileConfig(runtime?.commentsConfig || {})
  };
  return sha1(stableStringify(payload));
};

export const buildEmbeddingsKey = (runtime) => {
  const enabled = runtime?.embeddingEnabled || runtime?.embeddingService;
  if (!enabled) return null;
  const payload = {
    modelId: runtime?.modelId || null,
    mode: runtime?.embeddingMode || null,
    provider: runtime?.embeddingProvider || null,
    onnx: sanitizeVolatileConfig(runtime?.embeddingOnnx || null),
    service: runtime?.embeddingService === true,
    stub: runtime?.useStubEmbeddings === true
  };
  return sha1(stableStringify(payload));
};

export const buildCompatibilityKey = ({ runtime, modes, tokenizationKeys }) => {
  const parsed = parseSemver(ARTIFACT_SURFACE_VERSION);
  const payload = {
    artifactSurfaceMajor: parsed?.major ?? null,
    schemaHash: ARTIFACT_SCHEMA_HASH,
    tokenizationKeys: tokenizationKeys || {},
    profile: resolveProfilePayload(runtime),
    embeddingsKey: buildEmbeddingsKey(runtime),
    languagePolicyKey: buildLanguagePolicyKey(runtime),
    chunkIdAlgoVersion: CHUNK_ID_ALGO_VERSION,
    sqliteSchemaVersion: SQLITE_SCHEMA_VERSION,
    modes: normalizeModes(modes)
  };
  return sha1(stableStringify(payload));
};

export const buildCohortKey = ({ runtime, mode, tokenizationKeys }) => {
  const parsed = parseSemver(ARTIFACT_SURFACE_VERSION);
  const normalizedMode = typeof mode === 'string' ? mode.trim() : '';
  const payload = {
    artifactSurfaceMajor: parsed?.major ?? null,
    schemaHash: ARTIFACT_SCHEMA_HASH,
    tokenizationKey: normalizedMode
      ? (tokenizationKeys?.[normalizedMode] || null)
      : null,
    profile: resolveProfilePayload(runtime),
    embeddingsKey: buildEmbeddingsKey(runtime),
    languagePolicyKey: buildLanguagePolicyKey(runtime),
    chunkIdAlgoVersion: CHUNK_ID_ALGO_VERSION,
    sqliteSchemaVersion: SQLITE_SCHEMA_VERSION,
    mode: normalizedMode || null
  };
  return sha1(stableStringify(payload));
};
