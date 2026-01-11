import { buildFilterIndex, serializeFilterIndex } from '../../../retrieval/filter-index.js';

export const buildSerializedFilterIndex = ({ chunks, resolvedConfig, userConfig }) => {
  const filePrefilterConfig = userConfig?.search?.filePrefilter || {};
  const fileChargramN = Number.isFinite(Number(filePrefilterConfig.chargramN))
    ? Math.max(2, Math.floor(Number(filePrefilterConfig.chargramN)))
    : resolvedConfig.chargramMinN;
  return serializeFilterIndex(buildFilterIndex(chunks, {
    fileChargramN,
    includeBitmaps: false
  }));
};
