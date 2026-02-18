import util from 'node:util';
import { analyzeComplexity, lintChunk } from '../../../analysis.js';
import { getLanguageForFile } from '../../../language-registry.js';
import { getChunkAuthorsFromLines } from '../../../scm/annotate.js';
import { isJsLike } from '../../../constants.js';
import { detectFrameworkProfile } from '../../../framework-profile.js';
import {
  classifyTokenBuckets,
  createTokenClassificationRuntime,
  createFileLineTokenStream,
  createTokenizationBuffers,
  resolveTokenDictWords,
  sliceFileLineTokenStream,
  tokenizeChunkText
} from '../../tokenization.js';
import { assignCommentsToChunks } from '../chunk.js';
import { buildChunkPayload } from '../assemble.js';
import { attachEmbeddings } from '../embeddings.js';
import { formatError } from '../meta.js';
import { createLineReader, stripCommentText } from '../utils.js';
import { resolveSegmentTokenMode } from '../../../segments/config.js';
import { attachCallDetailsByChunkIndex } from './dedupe.js';
import { buildChunkEnrichment } from './enrichment.js';
import { prepareChunkIds } from './ids.js';
import { collectChunkComments } from './limits.js';

/**
 * Resolve framework profile once per file and reuse across chunk iterations.
 *
 * `detectFrameworkProfile` inspects full-file text and path heuristics, so calling it per chunk
 * would repeatedly rescan the same content on large files.
 *
 * @param {{relPath:string,ext:string,text:string,detect?:(input:{relPath:string,ext:string,text:string})=>object|null}} input
 * @returns {() => object|null}
 */
export const createFrameworkProfileResolver = ({
  relPath,
  ext,
  text,
  detect = detectFrameworkProfile
}) => {
  let resolved = false;
  let cachedProfile = null;
  return () => {
    if (resolved) return cachedProfile;
    cachedProfile = detect({
      relPath,
      ext,
      text
    }) || null;
    resolved = true;
    return cachedProfile;
  };
};

export const canUseLineTokenStreamSlice = ({
  chunkStart,
  chunkEnd,
  startLine,
  endLine,
  lineIndex,
  fileLength
}) => {
  if (!Array.isArray(lineIndex) || !lineIndex.length) return false;
  if (!Number.isFinite(chunkStart) || !Number.isFinite(chunkEnd)) return false;
  const startLineNumber = Math.max(1, Math.floor(Number(startLine) || 1));
  const endLineNumber = Math.max(startLineNumber, Math.floor(Number(endLine) || startLineNumber));
  const startLineOffset = lineIndex[startLineNumber - 1];
  if (!Number.isFinite(startLineOffset)) return false;
  const nextLineOffset = lineIndex[endLineNumber];
  const endLineOffset = Number.isFinite(nextLineOffset)
    ? nextLineOffset
    : (Number.isFinite(fileLength) ? fileLength : null);
  if (!Number.isFinite(endLineOffset)) return false;
  return chunkStart === startLineOffset && chunkEnd === endLineOffset;
};

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

const normalizeHeavyFilePolicy = (languageOptions) => {
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

const isHeavyFilePath = (relPath) => {
  const normalized = String(relPath || '').replace(/\\/g, '/').toLowerCase();
  const bounded = `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
  return HEAVY_FILE_PATH_PREFIXES.some((prefix) => bounded.startsWith(prefix));
};

const shouldDownshiftForHeavyPath = ({
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

const shouldApplySwiftHotPathCoalescing = ({
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

const coalesceHeavyChunks = (chunks, maxChunks) => {
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
    if (groupSize > 1) {
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

export const processChunks = async (context) => {
  const {
    sc,
    text,
    ext,
    rel,
    relKey,
    fileStat,
    fileHash,
    fileHashAlgo,
    fileLineCount,
    fileLanguageId,
    lang,
    languageContext,
    languageOptions,
    mode,
    relationsEnabled,
    fileRelations,
    callIndex,
    fileStructural,
    commentEntries,
    commentRanges,
    normalizedCommentsConfig,
    tokenDictWords,
    dictConfig,
    tokenContext,
    postingsConfig,
    contextWin,
    tokenMode,
    embeddingEnabled,
    embeddingNormalize,
    embeddingBatchSize,
    getChunkEmbedding,
    getChunkEmbeddings,
    runEmbedding,
    runProc,
    workerPool,
    workerDictOverride,
    workerState,
    tokenizationStats,
    tokenizeEnabled = true,
    complexityEnabled,
    lintEnabled,
    complexityCache,
    lintCache,
    log,
    logLine,
    perfEventLogger,
    crashLogger,
    riskAnalysisEnabled,
    riskConfig,
    typeInferenceEnabled,
    analysisPolicy,
    astDataflowEnabled,
    controlFlowEnabled,
    toolInfo,
    lineIndex,
    lineAuthors,
    fileGitMeta,
    vfsManifestConcurrency,
    addLineSpan,
    addSettingMetric,
    addEnrichDuration,
    addTokenizeDuration,
    addComplexityDuration,
    addLintDuration,
    addEmbeddingDuration,
    showLineProgress,
    totalLines,
    failFile,
    buildStage
  } = context;

  const containerExt = ext;
  const containerLanguageId = fileLanguageId || lang?.id || null;
  const updateCrashStage = (substage, extra = {}) => {
    if (!crashLogger?.enabled) return;
    crashLogger.updateFile({
      phase: 'processing',
      mode,
      stage: buildStage || null,
      file: relKey,
      substage,
      ...extra
    });
  };
  const sourceChunks = Array.isArray(sc) ? sc : [];
  const processChunksStartedAt = Date.now();
  updateCrashStage('process-chunks:start', { totalChunks: sourceChunks.length, languageId: containerLanguageId });
  const canEmitPerfEvent = perfEventLogger && typeof perfEventLogger.emit === 'function';
  const fileBytes = fileStat?.size ?? Buffer.byteLength(text || '', 'utf8');
  const fileLines = fileLineCount || 0;
  const heavyFilePolicy = normalizeHeavyFilePolicy(languageOptions);
  const heavyByBytes = fileBytes >= heavyFilePolicy.maxBytes;
  const heavyByLines = fileLines >= heavyFilePolicy.maxLines;
  const heavyByChunks = sourceChunks.length >= heavyFilePolicy.maxChunks;
  const heavyByChunkOnly = heavyByChunks
    && (
      fileBytes >= heavyFilePolicy.chunkOnlyMinBytes
      || fileLines >= heavyFilePolicy.chunkOnlyMinLines
    );
  const heavyByPath = shouldDownshiftForHeavyPath({
    relPath: relKey,
    fileBytes,
    fileLines,
    chunkCount: sourceChunks.length,
    heavyFilePolicy
  });
  const heavyFileDownshift = mode === 'code'
    && heavyFilePolicy.enabled
    && (
      heavyByBytes
      || heavyByLines
      || heavyByChunkOnly
      || heavyByPath
    );
  const skipTokenizationByBytes = fileBytes >= heavyFilePolicy.skipTokenizationMaxBytes;
  const skipTokenizationByLines = fileLines >= heavyFilePolicy.skipTokenizationMaxLines;
  const skipTokenizationByChunks = sourceChunks.length >= heavyFilePolicy.skipTokenizationMaxChunks;
  const skipTokenizationByChunkOnly = skipTokenizationByChunks
    && (
      fileBytes >= heavyFilePolicy.skipTokenizationChunkOnlyMinBytes
      || fileLines >= heavyFilePolicy.skipTokenizationChunkOnlyMinLines
    );
  const heavyFileSkipTokenization = heavyFileDownshift
    && heavyFilePolicy.skipTokenizationEnabled
    && (
      skipTokenizationByBytes
      || skipTokenizationByLines
      || skipTokenizationByChunkOnly
    );
  const heavyFileTargetChunksBase = heavyFileSkipTokenization
    ? Math.min(heavyFilePolicy.maxChunks, heavyFilePolicy.skipTokenizationCoalesceMaxChunks)
    : heavyFilePolicy.maxChunks;
  const heavyFileSwiftHotPath = heavyFileDownshift
    && shouldApplySwiftHotPathCoalescing({
      relPath: relKey,
      ext: containerExt,
      chunkCount: sourceChunks.length,
      heavyFilePolicy
    });
  const heavyFileTargetChunks = heavyFileSwiftHotPath
    ? Math.max(1, Math.min(heavyFileTargetChunksBase, heavyFilePolicy.swiftHotPathTargetChunks))
    : heavyFileTargetChunksBase;
  const chunksForProcessing = heavyFileDownshift
    ? coalesceHeavyChunks(sourceChunks, heavyFileTargetChunks)
    : sourceChunks;
  const heavyFileWasCoalesced = chunksForProcessing.length !== sourceChunks.length;
  if (heavyFileDownshift && typeof log === 'function' && !canEmitPerfEvent) {
    log(
      `[perf] heavy-file downshift enabled for ${relKey} `
      + `(${fileBytes} bytes, ${fileLines} lines, ${sourceChunks.length} chunks).`
    );
    if (heavyFileWasCoalesced) {
      log(
        `[perf] heavy-file chunks coalesced for ${relKey} `
        + `(${sourceChunks.length} -> ${chunksForProcessing.length}).`
      );
    }
    if (heavyFileSkipTokenization) {
      log(`[perf] heavy-file tokenization skipped for ${relKey}.`);
    }
  }

  const strictIdentity = analysisPolicy?.identity?.strict !== false;
  const chunkUidNamespaceKey = mode === 'extracted-prose' ? 'repo:extracted-prose' : 'repo';
  let chunkLineRanges = [];
  let vfsManifestRows = null;
  try {
    const prepared = await prepareChunkIds({
      chunks: chunksForProcessing,
      text,
      relKey,
      namespaceKey: chunkUidNamespaceKey,
      containerExt,
      containerLanguageId,
      lineIndex,
      fileHash,
      fileHashAlgo,
      vfsManifestConcurrency,
      strict: strictIdentity,
      log
    });
    chunkLineRanges = prepared.chunkLineRanges;
    vfsManifestRows = prepared.vfsManifestRows;
  } catch (err) {
    if (failFile) return failFile('identity', 'chunk-uid', err);
    throw err;
  }
  const commentAssignments = assignCommentsToChunks(commentEntries, chunksForProcessing);
  const commentRangeAssignments = assignCommentsToChunks(commentRanges, chunksForProcessing);
  const chunks = [];
  const tokenBuffers = createTokenizationBuffers();
  const dictWordsCache = new Map();
  const effectiveLangCache = new Map();
  const codeTexts = embeddingEnabled ? [] : null;
  const docTexts = embeddingEnabled ? [] : null;
  const wantsFieldTokens = postingsConfig?.fielded !== false
    || postingsConfig?.chargramSource === 'fields'
    || postingsConfig?.phraseSource === 'fields';
  const tokenizationFileStreamEnabled = languageOptions?.tokenization?.fileStream === true;
  const fileTokenStreamCache = new Map();
  const fileTokenContext = tokenContext && typeof tokenContext === 'object'
    ? { ...tokenContext }
    : { tokenClassification: { enabled: false } };
  if (!fileTokenContext.tokenClassification || typeof fileTokenContext.tokenClassification !== 'object') {
    fileTokenContext.tokenClassification = { enabled: false };
  } else {
    fileTokenContext.tokenClassification = { ...fileTokenContext.tokenClassification };
  }
  if (heavyFileDownshift) {
    fileTokenContext.tokenClassification.enabled = false;
  }
  fileTokenContext.tokenClassificationRuntime = createTokenClassificationRuntime({
    context: fileTokenContext,
    fileBytes
  });
  attachCallDetailsByChunkIndex(callIndex, chunksForProcessing);
  const proseWorkerMinBytesRaw = Number(languageOptions?.tokenization?.proseWorkerMinBytes);
  const proseWorkerMinBytes = Number.isFinite(proseWorkerMinBytesRaw) && proseWorkerMinBytesRaw > 0
    ? Math.floor(proseWorkerMinBytesRaw)
    : 128 * 1024;
  // Small prose files are faster on the main thread and avoid proc-queue
  // contention; route only larger prose documents through tokenize workers.
  const shouldUseProseWorker = tokenMode === 'prose'
    && fileBytes >= proseWorkerMinBytes;
  const useWorkerForTokens = (tokenMode === 'code' || shouldUseProseWorker)
    && !workerState.tokenWorkerDisabled
    && workerPool
    && workerPool.shouldUseForFile
    ? workerPool.shouldUseForFile(fileBytes)
    : false;
  const runTokenize = useWorkerForTokens && typeof workerPool?.runTokenize === 'function'
    ? (payload) => (runProc ? runProc(() => workerPool.runTokenize(payload)) : workerPool.runTokenize(payload))
    : null;
  let fileComplexity = {};
  let fileLint = [];
  if (isJsLike(ext) && mode === 'code') {
    const effectiveComplexityEnabled = complexityEnabled && !heavyFileDownshift;
    const effectiveLintEnabled = lintEnabled && !heavyFileDownshift;
    if (effectiveComplexityEnabled) {
      const cacheKey = fileHash ? `${rel}:${fileHash}` : rel;
      let cachedComplexity = complexityCache.get(cacheKey);
      if (!cachedComplexity) {
        const enrichStart = Date.now();
        const fullCode = text;
        const compResult = await analyzeComplexity(fullCode, rel);
        complexityCache.set(cacheKey, compResult);
        cachedComplexity = compResult;
        const enrichDurationMs = Date.now() - enrichStart;
        addComplexityDuration(enrichDurationMs);
      }
      fileComplexity = cachedComplexity || {};
    }
    if (effectiveLintEnabled) {
      const cacheKey = fileHash ? `${rel}:${fileHash}` : rel;
      let cachedLint = lintCache.get(cacheKey);
      if (!cachedLint) {
        const enrichStart = Date.now();
        const fullCode = text;
        const lintResult = await lintChunk(fullCode, rel);
        lintCache.set(cacheKey, lintResult);
        cachedLint = lintResult;
        const enrichDurationMs = Date.now() - enrichStart;
        addLintDuration(enrichDurationMs);
      }
      fileLint = cachedLint || [];
    }
  }

  let lastLineLogged = 0;
  let lastLineLogMs = 0;
  const effectiveContextWin = heavyFileDownshift ? 0 : contextWin;
  const lineReader = effectiveContextWin > 0 ? createLineReader(text, lineIndex) : null;
  const filterLintForChunk = (entries, startLine, endLine, includeUnscoped) => {
    if (!entries.length) return entries;
    return entries.filter((entry) => {
      const entryLine = Number(entry?.line);
      if (!Number.isFinite(entryLine)) return includeUnscoped;
      const entryEnd = Number.isFinite(Number(entry?.endLine)) ? Number(entry.endLine) : entryLine;
      return entryLine <= endLine && entryEnd >= startLine;
    });
  };
  const createLintChunkResolver = (entries) => {
    if (!Array.isArray(entries) || entries.length === 0) {
      return () => [];
    }
    const scoped = [];
    const unscoped = [];
    for (const entry of entries) {
      const entryLine = Number(entry?.line);
      if (!Number.isFinite(entryLine)) {
        unscoped.push(entry);
        continue;
      }
      const entryEnd = Number.isFinite(Number(entry?.endLine)) ? Number(entry.endLine) : entryLine;
      scoped.push({ entry, start: entryLine, end: entryEnd });
    }
    scoped.sort((a, b) => a.start - b.start || a.end - b.end);
    const active = [];
    let cursor = 0;
    let lastStart = Number.NEGATIVE_INFINITY;
    return (startLine, endLine, includeUnscoped = false) => {
      if (startLine < lastStart) {
        return filterLintForChunk(entries, startLine, endLine, includeUnscoped);
      }
      lastStart = startLine;
      while (cursor < scoped.length && scoped[cursor].start <= endLine) {
        active.push(scoped[cursor]);
        cursor += 1;
      }
      let writeIndex = 0;
      for (let i = 0; i < active.length; i += 1) {
        if (active[i].end >= startLine) {
          active[writeIndex] = active[i];
          writeIndex += 1;
        }
      }
      active.length = writeIndex;
      if (!includeUnscoped && !active.length) return [];
      const out = [];
      if (includeUnscoped && unscoped.length) {
        out.push(...unscoped);
      }
      for (const item of active) out.push(item.entry);
      return out;
    };
  };
  const resolveLintForChunk = fileLint.length ? createLintChunkResolver(fileLint) : null;

  const baseTypeInferenceEnabled = typeof analysisPolicy?.typeInference?.local?.enabled === 'boolean'
    ? analysisPolicy.typeInference.local.enabled
    : typeInferenceEnabled;
  const baseRiskAnalysisEnabled = typeof analysisPolicy?.risk?.enabled === 'boolean'
    ? analysisPolicy.risk.enabled
    : riskAnalysisEnabled;
  const effectiveTypeInferenceEnabled = heavyFileDownshift ? false : baseTypeInferenceEnabled;
  const effectiveRiskAnalysisEnabled = heavyFileDownshift ? false : baseRiskAnalysisEnabled;
  const effectiveRelationsEnabled = heavyFileDownshift ? false : relationsEnabled;
  const effectiveTokenizeEnabled = tokenizeEnabled && !heavyFileSkipTokenization;
  const resolveFrameworkProfile = createFrameworkProfileResolver({
    relPath: rel,
    ext: containerExt,
    text
  });

  for (let ci = 0; ci < chunksForProcessing.length; ++ci) {
    const c = chunksForProcessing[ci];
    updateCrashStage('chunk', {
      chunkIndex: ci,
      chunkId: c?.chunkId || null,
      start: c?.start ?? null,
      end: c?.end ?? null
    });
    const ctext = text.slice(c.start, c.end);
    let tokenText = ctext;
    const lineRange = chunkLineRanges[ci] || { startLine: 1, endLine: fileLineCount || 1 };
    const startLine = lineRange.startLine;
    const endLine = lineRange.endLine;
    const chunkLineCount = Math.max(1, endLine - startLine + 1);
    const segmentTokenMode = c.segment ? resolveSegmentTokenMode(c.segment) : tokenMode;
    const chunkMode = segmentTokenMode || tokenMode;
    const effectiveExt = c.segment?.ext || containerExt;
    const fileFrameworkProfile = resolveFrameworkProfile();
    const langCacheKey = effectiveExt || '';
    let effectiveLang = effectiveLangCache.get(langCacheKey);
    if (effectiveLang === undefined) {
      effectiveLang = getLanguageForFile(effectiveExt, relKey) || null;
      effectiveLangCache.set(langCacheKey, effectiveLang);
    }
    const effectiveLanguageId = effectiveLang?.id || c.segment?.languageId || containerLanguageId || 'unknown';
    const chunkLanguageId = effectiveLanguageId;
    const dictCacheKey = `${chunkMode}:${chunkLanguageId || ''}`;
    let dictWordsForChunk = dictWordsCache.get(dictCacheKey);
    if (!dictWordsForChunk) {
      dictWordsForChunk = resolveTokenDictWords({
        context: fileTokenContext,
        mode: chunkMode,
        languageId: chunkLanguageId
      });
      dictWordsCache.set(dictCacheKey, dictWordsForChunk);
    }
    const activeLang = effectiveLang || lang;
    const activeContext = effectiveLang && lang && effectiveLang.id === lang.id
      ? languageContext
      : null;
    const diagnostics = {
      containerExt,
      effectiveExt,
      containerLanguageId,
      effectiveLanguageId,
      segmentLanguageId: c.segment?.languageId || null,
      segmentExt: c.segment?.ext || null
    };
    addLineSpan(chunkLanguageId, startLine, endLine);
    if (showLineProgress) {
      const currentLine = chunkLineRanges[ci]?.endLine ?? totalLines;
      const now = Date.now();
      const shouldLog = currentLine >= totalLines
        || currentLine - lastLineLogged >= 200
        || now - lastLineLogMs >= 1000;
      if (shouldLog && currentLine > lastLineLogged) {
        lastLineLogged = currentLine;
        lastLineLogMs = now;
        logLine(`Line ${currentLine}/${totalLines}`, {
          kind: 'line-progress',
          mode,
          stage: 'processing',
          file: rel,
          current: currentLine,
          total: totalLines
        });
      }
    }

    const enrichment = buildChunkEnrichment({
      chunkMode,
      text,
      chunkText: ctext,
      chunk: c,
      chunkIndex: ci,
      activeLang,
      activeContext,
      languageOptions,
      fileRelations,
      callIndex,
      relationsEnabled: effectiveRelationsEnabled,
      fileStructural,
      chunkLineCount,
      chunkLanguageId,
      resolvedTypeInferenceEnabled: effectiveTypeInferenceEnabled,
      resolvedRiskAnalysisEnabled: effectiveRiskAnalysisEnabled,
      riskConfig,
      astDataflowEnabled,
      controlFlowEnabled,
      addSettingMetric,
      addEnrichDuration,
      updateCrashStage,
      failFile,
      diagnostics,
      startLine,
      endLine,
      totalLines,
      fileFrameworkProfile
    });
    if (enrichment?.skip) {
      return enrichment.skip;
    }
    let { codeRelations, docmeta } = enrichment;

    let assignedRanges = [];
    let commentFieldTokens = [];
    if (commentAssignments.size || commentRangeAssignments.size) {
      const assigned = commentAssignments.get(ci) || [];
      assignedRanges = commentRangeAssignments.get(ci) || [];
      if (assigned.length) {
        const commentResult = collectChunkComments({
          assigned,
          assignedRanges,
          chunkMode,
          normalizedCommentsConfig,
          tokenDictWords,
          dictConfig,
          effectiveExt,
          chunkStart: c.start,
          includeTokens: wantsFieldTokens
        });
        commentFieldTokens = commentResult.commentFieldTokens;
        assignedRanges = commentResult.assignedRanges;
        if (commentResult.docmetaPatch) {
          docmeta = { ...docmeta, ...commentResult.docmetaPatch };
        }
      }
    }
    if (chunkMode === 'code' && normalizedCommentsConfig.includeInCode !== true && assignedRanges.length) {
      tokenText = stripCommentText(ctext, c.start, assignedRanges);
    }

    // Chargrams are built during postings construction (appendChunk), where we can
    // honor postingsConfig.chargramSource without duplicating tokenization work here.
    const fieldChargramTokens = null;

    let tokenPayload = null;
    let pretokenized = null;
    const useLineTokenStream = effectiveTokenizeEnabled
      && tokenizationFileStreamEnabled
      && tokenText === ctext
      && canUseLineTokenStreamSlice({
        chunkStart: c.start,
        chunkEnd: c.end,
        startLine,
        endLine,
        lineIndex,
        fileLength: text.length
      });
    if (useLineTokenStream) {
      let tokenStream = fileTokenStreamCache.get(dictCacheKey);
      if (!tokenStream) {
        tokenStream = createFileLineTokenStream({
          text,
          mode: chunkMode,
          ext: effectiveExt,
          dictWords: dictWordsForChunk,
          dictConfig
        });
        fileTokenStreamCache.set(dictCacheKey, tokenStream);
      }
      pretokenized = sliceFileLineTokenStream({
        stream: tokenStream,
        startLine,
        endLine
      });
    }
    let usedWorkerTokenize = false;
    if (effectiveTokenizeEnabled && runTokenize && !pretokenized) {
      try {
        const tokenStart = Date.now();
        updateCrashStage('tokenize-worker', { chunkIndex: ci });
        tokenPayload = await runTokenize({
          text: tokenText,
          mode: chunkMode,
          ext: effectiveExt,
          languageId: chunkLanguageId,
          file: relKey,
          size: fileStat.size,
          // chargramTokens is intentionally omitted (see note above).
          ...(workerDictOverride ? { dictConfig: workerDictOverride } : {})
        });
        const tokenDurationMs = Date.now() - tokenStart;
        addTokenizeDuration(tokenDurationMs);
        if (tokenPayload) {
          usedWorkerTokenize = true;
          addSettingMetric('tokenize', chunkLanguageId, chunkLineCount, tokenDurationMs);
        }
      } catch (err) {
        if (!workerState.workerTokenizeFailed) {
          const message = formatError(err);
          const detail = err?.stack || err?.cause || null;
          log(`Worker tokenization failed; falling back to main thread. ${message}`);
          if (detail) log(`Worker tokenization detail: ${detail}`);
          workerState.workerTokenizeFailed = true;
        }
        workerState.tokenWorkerDisabled = true;
        if (crashLogger?.enabled) {
          crashLogger.logError({
            phase: 'worker-tokenize',
            file: relKey,
            size: fileStat?.size || null,
            languageId: fileLanguageId || lang?.id || null,
            message: formatError(err),
            stack: err?.stack || null,
            raw: util.inspect(err, {
              depth: 5,
              breakLength: 120,
              showHidden: true,
              getters: true
            }),
            ownProps: err && typeof err === 'object'
              ? Object.getOwnPropertyNames(err)
              : [],
            ownSymbols: err && typeof err === 'object'
              ? Object.getOwnPropertySymbols(err).map((sym) => sym.toString())
              : []
          });
        }
      }
    }
    if (effectiveTokenizeEnabled && !tokenPayload) {
      const tokenStart = Date.now();
      updateCrashStage('tokenize', { chunkIndex: ci });
      tokenPayload = tokenizeChunkText({
        text: tokenText,
        mode: chunkMode,
        ext: effectiveExt,
        context: fileTokenContext,
        languageId: chunkLanguageId,
        pretokenized,
        // chargramTokens is intentionally omitted (see note above).
        buffers: tokenBuffers
      });
      const tokenDurationMs = Date.now() - tokenStart;
      addTokenizeDuration(tokenDurationMs);
      addSettingMetric('tokenize', chunkLanguageId, chunkLineCount, tokenDurationMs);
    }
    if (!effectiveTokenizeEnabled) {
      tokenPayload = {
        tokens: [],
        tokenIds: [],
        seq: [],
        minhashSig: [],
        stats: {},
        identifierTokens: [],
        keywordTokens: [],
        operatorTokens: [],
        literalTokens: []
      };
    }

    const tokenClassificationEnabled = effectiveTokenizeEnabled
      && fileTokenContext?.tokenClassification?.enabled === true
      && chunkMode === 'code';
    if (tokenClassificationEnabled && usedWorkerTokenize) {
      // Tokenization workers intentionally do not run tree-sitter classification to avoid
      // multiplying parser/grammar memory across --threads. Attach buckets here using the
      // main thread tree-sitter runtime (global caps).
      const classification = classifyTokenBuckets({
        text: tokenText,
        tokens: Array.isArray(tokenPayload.tokens) ? tokenPayload.tokens : [],
        languageId: chunkLanguageId,
        ext: effectiveExt,
        dictWords: dictWordsForChunk,
        dictConfig,
        context: fileTokenContext
      });
      tokenPayload = {
        ...tokenPayload,
        identifierTokens: classification.identifierTokens,
        keywordTokens: classification.keywordTokens,
        operatorTokens: classification.operatorTokens,
        literalTokens: classification.literalTokens
      };
    }

    const {
      tokens,
      tokenIds,
      seq,
      minhashSig,
      stats,
      identifierTokens,
      keywordTokens,
      operatorTokens,
      literalTokens
    } = tokenPayload;

    if (tokenizationStats && effectiveTokenizeEnabled) {
      tokenizationStats.chunks += 1;
      tokenizationStats.tokens += tokens.length;
      tokenizationStats.seq += seq.length;
      // Phrase ngrams and chargrams are computed during postings construction (appendChunk).
      // We don't materialize them during tokenization to avoid large transient allocations.
    }

    if (effectiveTokenizeEnabled && !seq.length) continue;

    const docText = typeof docmeta.doc === 'string' ? docmeta.doc : '';

    const complexity = fileComplexity;
    const lint = resolveLintForChunk
      ? resolveLintForChunk(startLine, endLine, ci === 0)
      : fileLint;

    let preContext = [], postContext = [];
    if (effectiveContextWin > 0 && lineReader) {
      if (ci > 0) {
        const prev = chunkLineRanges[ci - 1];
        const startLine = Math.max(prev.endLine - effectiveContextWin + 1, prev.startLine);
        preContext = lineReader.getLines(startLine, prev.endLine);
      }
      if (ci + 1 < chunksForProcessing.length) {
        const next = chunkLineRanges[ci + 1];
        const endLine = Math.min(next.startLine + effectiveContextWin - 1, next.endLine);
        postContext = lineReader.getLines(next.startLine, endLine);
      }
    }
    const chunkAuthors = lineAuthors
      ? getChunkAuthorsFromLines(lineAuthors, startLine, endLine)
      : [];
    const gitMeta = {
      ...fileGitMeta,
      ...(chunkAuthors.length ? { chunk_authors: chunkAuthors, chunkAuthors } : {})
    };
    const chunkRecord = { ...c, startLine, endLine };
    const chunkPayload = buildChunkPayload({
      chunk: chunkRecord,
      rel,
      relKey,
      ext: containerExt,
      effectiveExt,
      languageId: effectiveLanguageId || null,
      containerLanguageId,
      fileHash,
      fileHashAlgo,
      fileSize: fileStat.size,
      tokens,
      tokenIds,
      identifierTokens,
      keywordTokens,
      operatorTokens,
      literalTokens,
      seq,
      codeRelations,
      docmeta,
      stats,
      complexity,
      lint,
      preContext,
      postContext,
      minhashSig,
      commentFieldTokens,
      dictWords: dictWordsForChunk,
      dictConfig,
      postingsConfig,
      emitFieldTokens: effectiveTokenizeEnabled,
      tokenMode: chunkMode,
      fileRelations,
      relationsEnabled: effectiveRelationsEnabled,
      toolInfo,
      gitMeta,
      analysisPolicy
    });

    chunks.push(chunkPayload);
    if (embeddingEnabled && codeTexts && docTexts) {
      codeTexts.push(tokenText);
      docTexts.push(docText.trim() ? docText : '');
    }
  }

  updateCrashStage('attach-embeddings', { chunkCount: chunks.length });
  const embeddingResult = await attachEmbeddings({
    chunks,
    codeTexts,
    docTexts,
    embeddingEnabled,
    embeddingNormalize,
    getChunkEmbedding,
    getChunkEmbeddings,
    runEmbedding,
    embeddingBatchSize,
    fileLanguageId,
    languageOptions
  });
  addEmbeddingDuration(embeddingResult.embeddingMs);
  if (mode === 'code' && canEmitPerfEvent) {
    const processingDurationMs = Math.max(0, Date.now() - processChunksStartedAt);
    const sourceChunkCount = sourceChunks.length;
    const workingChunkCount = chunksForProcessing.length;
    const outputChunkCount = chunks.length;
    const coalescedChunks = Math.max(0, sourceChunkCount - workingChunkCount);
    const coalesceRatio = sourceChunkCount > 0
      ? Number((workingChunkCount / sourceChunkCount).toFixed(6))
      : null;
    const outputRatio = sourceChunkCount > 0
      ? Number((outputChunkCount / sourceChunkCount).toFixed(6))
      : null;
    const throughputChunksPerSecond = processingDurationMs > 0
      ? Number(((workingChunkCount * 1000) / processingDurationMs).toFixed(3))
      : null;
    perfEventLogger.emit('perf.heavy_file_policy', {
      mode,
      file: relKey,
      ext: containerExt,
      languageId: containerLanguageId,
      fileBytes,
      fileLines,
      sourceChunks: sourceChunkCount,
      workingChunks: workingChunkCount,
      outputChunks: outputChunkCount,
      heavyDownshift: heavyFileDownshift,
      coalesced: heavyFileWasCoalesced,
      coalescedChunks,
      coalesceRatio,
      outputRatio,
      skipTokenization: heavyFileSkipTokenization,
      throughputChunksPerSecond,
      processingDurationMs,
      heavyReasonBytes: heavyByBytes,
      heavyReasonLines: heavyByLines,
      heavyReasonChunks: heavyByChunks,
      heavyReasonChunkOnly: heavyByChunkOnly,
      heavyReasonPath: heavyByPath,
      skipReasonBytes: skipTokenizationByBytes,
      skipReasonLines: skipTokenizationByLines,
      skipReasonChunks: skipTokenizationByChunks,
      skipReasonChunkOnly: skipTokenizationByChunkOnly,
      heavyReasonSwiftHotPath: heavyFileSwiftHotPath,
      policyMaxBytes: heavyFilePolicy.maxBytes,
      policyMaxLines: heavyFilePolicy.maxLines,
      policyMaxChunks: heavyFilePolicy.maxChunks,
      policyTargetChunks: heavyFileTargetChunks,
      policySwiftHotPathTargetChunks: heavyFilePolicy.swiftHotPathTargetChunks,
      policySwiftHotPathMinChunks: heavyFilePolicy.swiftHotPathMinChunks,
      policyPathMinBytes: heavyFilePolicy.pathMinBytes,
      policyPathMinLines: heavyFilePolicy.pathMinLines,
      policyPathMinChunks: heavyFilePolicy.pathMinChunks,
      policySkipTokenizationMaxBytes: heavyFilePolicy.skipTokenizationMaxBytes,
      policySkipTokenizationMaxLines: heavyFilePolicy.skipTokenizationMaxLines,
      policySkipTokenizationMaxChunks: heavyFilePolicy.skipTokenizationMaxChunks,
      policySkipTokenizationCoalesceMaxChunks: heavyFilePolicy.skipTokenizationCoalesceMaxChunks
    });
  }

  return { chunks, vfsManifestRows };
};
