import { buildFilterIndex, serializeFilterIndex } from '../../../retrieval/filter-index.js';
import { getEnvConfig } from '../../../shared/env.js';
import { buildContentConfigHash } from '../runtime/hash.js';

const FILTER_INDEX_SCHEMA_VERSION = 2;

const resolveConfigHash = (root, userConfig) => {
  if (!root) return null;
  try {
    return buildContentConfigHash(userConfig || {}, getEnvConfig());
  } catch {
    return null;
  }
};

export const buildSerializedFilterIndex = ({ chunks, resolvedConfig, userConfig, root }) => {
  const filePrefilterConfig = userConfig?.search?.filePrefilter || {};
  const fileChargramN = Number.isFinite(Number(filePrefilterConfig.chargramN))
    ? Math.max(2, Math.floor(Number(filePrefilterConfig.chargramN)))
    : resolvedConfig.chargramMinN;
  const serialized = serializeFilterIndex(buildFilterIndex(chunks, {
    fileChargramN,
    includeBitmaps: false
  }));
  return {
    ...serialized,
    schemaVersion: FILTER_INDEX_SCHEMA_VERSION,
    configHash: resolveConfigHash(root, userConfig)
  };
};
