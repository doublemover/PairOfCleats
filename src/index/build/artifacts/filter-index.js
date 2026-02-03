import {
  buildFilterIndex,
  releaseFilterIndexMemory,
  serializeFilterIndex
} from '../../../retrieval/filter-index.js';
import { getEnvConfig } from '../../../shared/env.js';
import { buildContentConfigHash } from '../runtime/hash.js';

const FILTER_INDEX_SCHEMA_VERSION = 2;

const resolveConfigHash = (root, userConfig) => {
  if (!root) return null;
  try {
    const envConfig = getEnvConfig() || {};
    const { apiToken, ...envWithoutSecrets } = envConfig;
    return buildContentConfigHash(userConfig || {}, envWithoutSecrets);
  } catch {
    return null;
  }
};

export const buildSerializedFilterIndex = ({ chunks, resolvedConfig, userConfig, root }) => {
  const filePrefilterConfig = userConfig?.search?.filePrefilter || {};
  const fileChargramN = Number.isFinite(Number(filePrefilterConfig.chargramN))
    ? Math.max(2, Math.floor(Number(filePrefilterConfig.chargramN)))
    : resolvedConfig.chargramMinN;
  const index = buildFilterIndex(chunks, {
    fileChargramN,
    includeBitmaps: false
  });
  const serialized = serializeFilterIndex(index);
  releaseFilterIndexMemory(index);
  return {
    ...serialized,
    schemaVersion: FILTER_INDEX_SCHEMA_VERSION,
    configHash: resolveConfigHash(root, userConfig)
  };
};
