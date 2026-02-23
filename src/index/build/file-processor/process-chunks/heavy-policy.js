const HEAVY_FILE_MAX_BYTES_DEFAULT = 512 * 1024;
const HEAVY_FILE_MAX_LINES_DEFAULT = 6000;
const HEAVY_FILE_MAX_CHUNKS_DEFAULT = 64;
const HEAVY_FILE_PATH_MIN_BYTES_DEFAULT = 64 * 1024;
const HEAVY_FILE_PATH_MIN_LINES_DEFAULT = 1200;
const HEAVY_FILE_PATH_MIN_CHUNKS_DEFAULT = HEAVY_FILE_MAX_CHUNKS_DEFAULT;
const HEAVY_FILE_SKIP_TOKENIZATION_ENABLED_DEFAULT = true;
const HEAVY_FILE_SKIP_TOKENIZATION_MAX_BYTES_DEFAULT = HEAVY_FILE_MAX_BYTES_DEFAULT * 2;
const HEAVY_FILE_SKIP_TOKENIZATION_MAX_LINES_DEFAULT = HEAVY_FILE_MAX_LINES_DEFAULT * 2;
const HEAVY_FILE_SKIP_TOKENIZATION_MAX_CHUNKS_DEFAULT = HEAVY_FILE_MAX_CHUNKS_DEFAULT * 2;
const HEAVY_FILE_SKIP_TOKENIZATION_COALESCE_MAX_CHUNKS_DEFAULT = 16;
const HEAVY_FILE_CHUNK_ONLY_MIN_BYTES_DEFAULT = 96 * 1024;
const HEAVY_FILE_CHUNK_ONLY_MIN_LINES_DEFAULT = 1200;
const HEAVY_FILE_SKIP_TOKENIZATION_CHUNK_ONLY_MIN_BYTES_DEFAULT = 256 * 1024;
const HEAVY_FILE_SKIP_TOKENIZATION_CHUNK_ONLY_MIN_LINES_DEFAULT = 3000;
const HEAVY_FILE_SWIFT_HOT_PATH_TARGET_CHUNKS_DEFAULT = 24;
const HEAVY_FILE_SWIFT_HOT_PATH_MIN_CHUNKS_DEFAULT = 48;
const HEAVY_FILE_SWIFT_HOT_PATH_PARTS = [
  '/test/',
  '/tests/',
  '/validation-test/',
  '/unittests/',
  '/utils/'
];
const HEAVY_FILE_PATH_PREFIXES = [
  '/3rdparty/',
  '/third_party/',
  '/thirdparty/',
  '/vendor/',
  '/single_include/',
  '/include/fmt/',
  '/include/spdlog/fmt/',
  '/include/nlohmann/',
  '/modules/core/include/opencv2/core/hal/',
  '/modules/core/src/',
  '/modules/dnn/',
  '/modules/js/perf/',
  '/sources/cniollhttp/',
  '/sources/nio/',
  '/sources/niocore/',
  '/sources/nioposix/',
  '/tests/nio/',
  '/test/api-digester/inputs/',
  '/test/remote-run/',
  '/test/stdlib/inputs/',
  '/tests/abi/',
  '/test/gtest/',
  '/utils/unicodedata/',
  '/utils/gen-unicode-data/',
  '/samples/',
  '/docs/mkdocs/',
  '/cmake/',
  '/.github/workflows/'
];

/**
 * Normalize heavy-file policy thresholds used by parser/downgrade decisions.
 *
 * @param {object|null|undefined} languageOptions
 * @returns {object}
 */
export const normalizeHeavyFilePolicy = (languageOptions) => {
  const raw = languageOptions?.heavyFile;
  const config = raw && typeof raw === 'object' ? raw : {};
  const enabled = config.enabled !== false;
  const maxBytesRaw = Number(config.maxBytes);
  const maxLinesRaw = Number(config.maxLines);
  const maxChunksRaw = Number(config.maxChunks);
  const pathMinBytesRaw = Number(config.pathMinBytes);
  const pathMinLinesRaw = Number(config.pathMinLines);
  const pathMinChunksRaw = Number(config.pathMinChunks);
  const chunkOnlyMinBytesRaw = Number(config.chunkOnlyMinBytes);
  const chunkOnlyMinLinesRaw = Number(config.chunkOnlyMinLines);
  const skipTokenizationMaxBytesRaw = Number(config.skipTokenizationMaxBytes);
  const skipTokenizationMaxLinesRaw = Number(config.skipTokenizationMaxLines);
  const skipTokenizationMaxChunksRaw = Number(config.skipTokenizationMaxChunks);
  const skipTokenizationChunkOnlyMinBytesRaw = Number(config.skipTokenizationChunkOnlyMinBytes);
  const skipTokenizationChunkOnlyMinLinesRaw = Number(config.skipTokenizationChunkOnlyMinLines);
  const skipTokenizationCoalesceMaxChunksRaw = Number(config.skipTokenizationCoalesceMaxChunks);
  const swiftHotPathTargetChunksRaw = Number(config.swiftHotPathTargetChunks);
  const swiftHotPathMinChunksRaw = Number(config.swiftHotPathMinChunks);
  const maxBytes = Number.isFinite(maxBytesRaw) && maxBytesRaw > 0
    ? Math.floor(maxBytesRaw)
    : HEAVY_FILE_MAX_BYTES_DEFAULT;
  const maxLines = Number.isFinite(maxLinesRaw) && maxLinesRaw > 0
    ? Math.floor(maxLinesRaw)
    : HEAVY_FILE_MAX_LINES_DEFAULT;
  const maxChunks = Number.isFinite(maxChunksRaw) && maxChunksRaw > 0
    ? Math.floor(maxChunksRaw)
    : HEAVY_FILE_MAX_CHUNKS_DEFAULT;
  const hasExplicitMaxChunks = Number.isFinite(maxChunksRaw) && maxChunksRaw > 0;
  const pathMinBytes = Number.isFinite(pathMinBytesRaw) && pathMinBytesRaw > 0
    ? Math.floor(pathMinBytesRaw)
    : HEAVY_FILE_PATH_MIN_BYTES_DEFAULT;
  const pathMinLines = Number.isFinite(pathMinLinesRaw) && pathMinLinesRaw > 0
    ? Math.floor(pathMinLinesRaw)
    : HEAVY_FILE_PATH_MIN_LINES_DEFAULT;
  const pathMinChunks = Number.isFinite(pathMinChunksRaw) && pathMinChunksRaw > 0
    ? Math.floor(pathMinChunksRaw)
    : HEAVY_FILE_PATH_MIN_CHUNKS_DEFAULT;
  const skipTokenizationEnabled = config.skipTokenization !== false
    ? HEAVY_FILE_SKIP_TOKENIZATION_ENABLED_DEFAULT
    : false;
  const skipTokenizationMaxBytes = Number.isFinite(skipTokenizationMaxBytesRaw) && skipTokenizationMaxBytesRaw > 0
    ? Math.floor(skipTokenizationMaxBytesRaw)
    : HEAVY_FILE_SKIP_TOKENIZATION_MAX_BYTES_DEFAULT;
  const skipTokenizationMaxLines = Number.isFinite(skipTokenizationMaxLinesRaw) && skipTokenizationMaxLinesRaw > 0
    ? Math.floor(skipTokenizationMaxLinesRaw)
    : HEAVY_FILE_SKIP_TOKENIZATION_MAX_LINES_DEFAULT;
  const skipTokenizationMaxChunks = Number.isFinite(skipTokenizationMaxChunksRaw) && skipTokenizationMaxChunksRaw > 0
    ? Math.floor(skipTokenizationMaxChunksRaw)
    : HEAVY_FILE_SKIP_TOKENIZATION_MAX_CHUNKS_DEFAULT;
  const hasExplicitSkipTokenizationMaxChunks = Number.isFinite(skipTokenizationMaxChunksRaw)
    && skipTokenizationMaxChunksRaw > 0;
  const chunkOnlyMinBytes = Number.isFinite(chunkOnlyMinBytesRaw) && chunkOnlyMinBytesRaw > 0
    ? Math.floor(chunkOnlyMinBytesRaw)
    : (hasExplicitMaxChunks ? 0 : HEAVY_FILE_CHUNK_ONLY_MIN_BYTES_DEFAULT);
  const chunkOnlyMinLines = Number.isFinite(chunkOnlyMinLinesRaw) && chunkOnlyMinLinesRaw > 0
    ? Math.floor(chunkOnlyMinLinesRaw)
    : (hasExplicitMaxChunks ? 0 : HEAVY_FILE_CHUNK_ONLY_MIN_LINES_DEFAULT);
  const skipTokenizationChunkOnlyMinBytes = Number.isFinite(skipTokenizationChunkOnlyMinBytesRaw)
    && skipTokenizationChunkOnlyMinBytesRaw > 0
    ? Math.floor(skipTokenizationChunkOnlyMinBytesRaw)
    : (hasExplicitSkipTokenizationMaxChunks ? 0 : HEAVY_FILE_SKIP_TOKENIZATION_CHUNK_ONLY_MIN_BYTES_DEFAULT);
  const skipTokenizationChunkOnlyMinLines = Number.isFinite(skipTokenizationChunkOnlyMinLinesRaw)
    && skipTokenizationChunkOnlyMinLinesRaw > 0
    ? Math.floor(skipTokenizationChunkOnlyMinLinesRaw)
    : (hasExplicitSkipTokenizationMaxChunks ? 0 : HEAVY_FILE_SKIP_TOKENIZATION_CHUNK_ONLY_MIN_LINES_DEFAULT);
  const skipTokenizationCoalesceMaxChunks = Number.isFinite(skipTokenizationCoalesceMaxChunksRaw)
    && skipTokenizationCoalesceMaxChunksRaw > 0
    ? Math.floor(skipTokenizationCoalesceMaxChunksRaw)
    : HEAVY_FILE_SKIP_TOKENIZATION_COALESCE_MAX_CHUNKS_DEFAULT;
  const swiftHotPathTargetChunks = Number.isFinite(swiftHotPathTargetChunksRaw)
    && swiftHotPathTargetChunksRaw > 0
    ? Math.floor(swiftHotPathTargetChunksRaw)
    : HEAVY_FILE_SWIFT_HOT_PATH_TARGET_CHUNKS_DEFAULT;
  const swiftHotPathMinChunks = Number.isFinite(swiftHotPathMinChunksRaw)
    && swiftHotPathMinChunksRaw > 0
    ? Math.floor(swiftHotPathMinChunksRaw)
    : HEAVY_FILE_SWIFT_HOT_PATH_MIN_CHUNKS_DEFAULT;
  return {
    enabled,
    maxBytes,
    maxLines,
    maxChunks,
    pathMinBytes,
    pathMinLines,
    pathMinChunks,
    chunkOnlyMinBytes,
    chunkOnlyMinLines,
    skipTokenizationEnabled,
    skipTokenizationMaxBytes,
    skipTokenizationMaxLines,
    skipTokenizationMaxChunks,
    skipTokenizationChunkOnlyMinBytes,
    skipTokenizationChunkOnlyMinLines,
    skipTokenizationCoalesceMaxChunks,
    swiftHotPathTargetChunks,
    swiftHotPathMinChunks
  };
};

/**
 * Match paths that are known to produce heavy parser/tokenization workloads.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
const isHeavyFilePath = (relPath) => {
  const normalized = String(relPath || '').replace(/\\/g, '/').toLowerCase();
  const bounded = `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
  return HEAVY_FILE_PATH_PREFIXES.some((prefix) => bounded.startsWith(prefix));
};

/**
 * Decide whether file should downshift based on heavy-path thresholds.
 *
 * @param {{
 *   relPath:string,
 *   fileBytes:number,
 *   fileLines:number,
 *   chunkCount:number,
 *   heavyFilePolicy:object
 * }} input
 * @returns {boolean}
 */
export const shouldDownshiftForHeavyPath = ({
  relPath,
  fileBytes,
  fileLines,
  chunkCount,
  heavyFilePolicy
}) => {
  if (!isHeavyFilePath(relPath)) return false;
  return (
    fileBytes >= heavyFilePolicy.pathMinBytes
    || fileLines >= heavyFilePolicy.pathMinLines
    || chunkCount >= heavyFilePolicy.pathMinChunks
  );
};

/**
 * Enable extra coalescing for large Swift test/utility hot paths.
 *
 * @param {{relPath:string,ext:string,chunkCount:number,heavyFilePolicy:object}} input
 * @returns {boolean}
 */
export const shouldApplySwiftHotPathCoalescing = ({
  relPath,
  ext,
  chunkCount,
  heavyFilePolicy
}) => {
  if (String(ext || '').toLowerCase() !== '.swift') return false;
  if (chunkCount < heavyFilePolicy.swiftHotPathMinChunks) return false;
  const normalized = String(relPath || '').replace(/\\/g, '/').toLowerCase();
  const bounded = `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
  return HEAVY_FILE_SWIFT_HOT_PATH_PARTS.some((part) => bounded.includes(part));
};

/**
 * Merge adjacent chunks into bounded groups for heavy-file downshift paths.
 *
 * Preserves deterministic ordering and line coverage while dropping
 * segment-specific metadata only for chunks that were actually merged.
 *
 * @param {Array<object>} chunks
 * @param {number} maxChunks
 * @returns {Array<object>}
 */
export const coalesceHeavyChunks = (chunks, maxChunks) => {
  if (!Array.isArray(chunks) || chunks.length <= 1) return chunks;
  const target = Number.isFinite(Number(maxChunks))
    ? Math.max(1, Math.floor(Number(maxChunks)))
    : HEAVY_FILE_MAX_CHUNKS_DEFAULT;
  if (chunks.length <= target) return chunks;
  const groupSize = Math.max(1, Math.ceil(chunks.length / target));
  const merged = [];
  for (let i = 0; i < chunks.length; i += groupSize) {
    const first = chunks[i];
    const lastIndex = Math.min(chunks.length - 1, i + groupSize - 1);
    const last = chunks[lastIndex];
    if (!first || !last) continue;
    const next = { ...first, start: first.start, end: last.end };
    if (last.meta && typeof last.meta === 'object') {
      next.meta = { ...(next.meta || {}), endLine: last.meta.endLine ?? next.meta?.endLine };
    }
    const mergedChunkCount = (lastIndex - i) + 1;
    if (mergedChunkCount > 1) {
      delete next.segment;
      delete next.segmentUid;
    }
    delete next.chunkUid;
    delete next.chunkId;
    delete next.spanIndex;
    merged.push(next);
  }
  return merged;
};
