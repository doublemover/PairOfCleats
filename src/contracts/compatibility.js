import { sha1 } from '../shared/hash.js';
import { stableStringify } from '../shared/stable-json.js';
import { ARTIFACT_SCHEMA_HASH } from './registry.js';
import { ARTIFACT_SURFACE_VERSION, parseSemver } from './versioning.js';

const normalizeModes = (modes) => Array.from(new Set(modes || [])).sort();

export const buildLanguagePolicyKey = (runtime) => {
  const languageOptions = runtime?.languageOptions
    ? { ...runtime.languageOptions }
    : {};
  if (languageOptions.rootDir) delete languageOptions.rootDir;
  const payload = {
    segmentsConfig: runtime?.segmentsConfig || {},
    languageOptions,
    commentsConfig: runtime?.commentsConfig || {}
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
    onnx: runtime?.embeddingOnnx || null,
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
    embeddingsKey: buildEmbeddingsKey(runtime),
    languagePolicyKey: buildLanguagePolicyKey(runtime),
    modes: normalizeModes(modes)
  };
  return sha1(stableStringify(payload));
};
