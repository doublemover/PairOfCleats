import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeSegmentsConfig } from '../segments.js';
import { normalizeCommentConfig } from '../comments.js';
import { createLruCache, estimateJsonBytes } from '../../shared/cache.js';
import { toPosix } from '../../shared/files.js';
import { log, logLine } from '../../shared/progress.js';
import { getEnvConfig } from '../../shared/env.js';
import { readTextFileWithHash } from '../../shared/encoding.js';
import { createFileScanner } from './file-scan.js';
import { createTokenizationContext } from './tokenization.js';
import { reuseCachedBundle } from './file-processor/cached-bundle.js';
import { processFileCpu } from './file-processor/cpu.js';
import { loadCachedBundleForFile, writeBundleForFile } from './file-processor/incremental.js';
import { resolveBinarySkip, resolvePreReadSkip } from './file-processor/skip.js';
import { createFileTimingTracker } from './file-processor/timings.js';
import { resolveExt } from './file-processor/read.js';
import { getLanguageForFile } from '../language-registry.js';

let warnedNoWorkerPool = false;
/**
 * Create a file processor with shared caches.
 * @param {object} options
 * @returns {{processFile:(abs:string,fileIndex:number)=>Promise<object|null>}}
 */
export function createFileProcessor(options) {
  const {
    root,
    mode,
    fileTextCache,
    dictConfig,
    dictWords,
    dictShared,
    languageOptions,
    postingsConfig,
    segmentsConfig,
    commentsConfig,
    contextWin,
    incrementalState,
    getChunkEmbedding,
    getChunkEmbeddings,
    analysisPolicy,
    typeInferenceEnabled,
    riskAnalysisEnabled,
    riskConfig,
    relationsEnabled: relationsEnabledRaw,
    seenFiles,
    gitBlameEnabled,
    lintEnabled: lintEnabledRaw,
    complexityEnabled: complexityEnabledRaw,
    structuralMatches,
    cacheConfig,
    cacheReporter,
    queues,
    useCpuQueue = true,
    workerPool = null,
    embeddingBatchSize = 0,
    crashLogger = null,
    fileCaps = null,
    maxFileBytes = null,
    fileScan = null,
    skippedFiles = null,
    embeddingEnabled = true,
    toolInfo = null,
    tokenizationStats = null,
    featureMetrics = null,
    buildStage = null
  } = options;
  const lintEnabled = lintEnabledRaw !== false;
  const complexityEnabled = complexityEnabledRaw !== false;
  const relationsEnabled = relationsEnabledRaw !== false;
  const resolvedAnalysisPolicy = analysisPolicy && typeof analysisPolicy === 'object'
    ? analysisPolicy
    : null;
  const resolvePolicyFlag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  const resolvedTypeInferenceEnabled = resolvePolicyFlag(
    resolvedAnalysisPolicy?.typeInference?.local?.enabled,
    typeInferenceEnabled
  );
  const resolvedRiskAnalysisEnabled = resolvePolicyFlag(
    resolvedAnalysisPolicy?.risk?.enabled,
    riskAnalysisEnabled
  );
  const resolvedGitBlameEnabled = resolvePolicyFlag(
    resolvedAnalysisPolicy?.git?.blame ?? resolvedAnalysisPolicy?.git?.enabled,
    gitBlameEnabled
  );
  const resolvedLanguageOptions = {
    skipUnknownLanguages: true,
    ...(languageOptions || {})
  };
  const { astDataflowEnabled, controlFlowEnabled } = resolvedLanguageOptions;
  const ioQueue = queues?.io || null;
  const cpuQueue = queues?.cpu || null;
  const embeddingQueue = queues?.embedding || null;
  const runIo = ioQueue ? (fn) => ioQueue.add(fn) : (fn) => fn();
  const runCpu = cpuQueue && useCpuQueue ? (fn) => cpuQueue.add(fn) : (fn) => fn();
  const runEmbedding = embeddingQueue ? (fn) => embeddingQueue.add(fn) : (fn) => fn();
  const showLineProgress = getEnvConfig().verbose === true;
  const encodingWarnings = {
    seen: new Set(),
    count: 0,
    limit: 50
  };
  const warnEncodingFallback = (fileKey, info) => {
    if (!info?.encodingFallback) return;
    const key = fileKey || info?.file || '';
    if (!key || encodingWarnings.seen.has(key)) return;
    if (encodingWarnings.count >= encodingWarnings.limit) return;
    encodingWarnings.seen.add(key);
    encodingWarnings.count += 1;
    const confidence = Number.isFinite(info.encodingConfidence)
      ? info.encodingConfidence.toFixed(2)
      : null;
    const details = info.encoding
      ? ` (${info.encoding}${confidence ? `, conf=${confidence}` : ''})`
      : '';
    log(`[encoding] fallback decode used for ${key}${details}.`);
  };
  if (!workerPool && !warnedNoWorkerPool) {
    warnedNoWorkerPool = true;
    log('[tokenization] Worker pool unavailable; using main thread.');
  }
  const tokenDictWords = dictShared || dictWords;
  const tokenContext = createTokenizationContext({
    dictWords: tokenDictWords,
    dictConfig,
    postingsConfig
  });
  const normalizedSegmentsConfig = normalizeSegmentsConfig(segmentsConfig);
  const normalizedCommentsConfig = normalizeCommentConfig(commentsConfig);
  const fileScanner = createFileScanner(fileScan);
  const recordSkip = (filePath, reason, extra = {}) => {
    if (!skippedFiles) return;
    skippedFiles.push({ file: filePath, reason, ...extra });
  };
  const getWorkerDictOverride = () => {
    if (!workerPool?.dictConfig || !dictConfig) return null;
    const base = workerPool.dictConfig;
    const nextSegmentation = typeof dictConfig.segmentation === 'string'
      ? dictConfig.segmentation
      : base.segmentation;
    const nextMaxToken = Number.isFinite(Number(dictConfig.dpMaxTokenLength))
      ? Number(dictConfig.dpMaxTokenLength)
      : base.dpMaxTokenLength;
    if (base.segmentation === nextSegmentation && base.dpMaxTokenLength === nextMaxToken) {
      return null;
    }
    return { segmentation: nextSegmentation, dpMaxTokenLength: nextMaxToken };
  };
  const workerDictOverride = getWorkerDictOverride();
  const workerState = {
    tokenWorkerDisabled: false,
    workerTokenizeFailed: false
  };
  const lintCacheConfig = cacheConfig?.lint || {};
  const complexityCacheConfig = cacheConfig?.complexity || {};
  const lintCache = createLruCache({
    name: 'lint',
    maxMb: lintCacheConfig.maxMb,
    ttlMs: lintCacheConfig.ttlMs,
    sizeCalculation: estimateJsonBytes,
    reporter: cacheReporter
  });
  const complexityCache = createLruCache({
    name: 'complexity',
    maxMb: complexityCacheConfig.maxMb,
    ttlMs: complexityCacheConfig.ttlMs,
    sizeCalculation: estimateJsonBytes,
    reporter: cacheReporter
  });

  let treeSitterSerial = Promise.resolve();
  const runTreeSitterSerial = async (fn) => {
    const run = treeSitterSerial.then(fn, fn);
    treeSitterSerial = run.catch(() => {});
    return run;
  };
  /**
   * Process a file: read, chunk, analyze, and produce chunk payloads.
   * @param {string} abs
   * @param {number} fileIndex
   * @returns {Promise<object|null>}
   */
  async function processFile(fileEntry, fileIndex) {
    const abs = typeof fileEntry === 'string' ? fileEntry : fileEntry.abs;      
    const fileStart = Date.now();
    const timing = createFileTimingTracker({ mode, featureMetrics });
    const {
      finalizeLanguageLines,
      recordFeatureMetrics,
      recordFileMetrics,
      buildFileMetrics
    } = timing;
    const relKey = typeof fileEntry === 'object' && fileEntry.rel
      ? fileEntry.rel
      : toPosix(path.relative(root, abs));
    const rel = typeof fileEntry === 'object' && fileEntry.rel
      ? fileEntry.rel.split('/').join(path.sep)
      : path.relative(root, abs);
    const fileStructural = structuralMatches?.get(relKey) || null;
    if (seenFiles) seenFiles.add(relKey);
    const ext = resolveExt(abs);
    const languageHint = getLanguageForFile(ext, relKey);
    let fileLanguageId = languageHint?.id || null;
    let fileLineCount = 0;
    let fileStat;
    try {
      fileStat = typeof fileEntry === 'object' && fileEntry.stat
        ? fileEntry.stat
        : await runIo(() => fs.lstat(abs));
    } catch {
      return null;
    }
    if (fileStat?.isSymbolicLink?.()) {
      recordSkip(abs, 'symlink');
      return null;
    }
    const preReadSkip = await resolvePreReadSkip({
      abs,
      fileEntry,
      fileStat,
      ext,
      fileCaps,
      fileScanner,
      runIo,
      languageId: fileLanguageId,
      mode,
      maxFileBytes
    });
    if (preReadSkip) {
      const { reason, ...extra } = preReadSkip;
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }
    const knownLines = Number(fileEntry?.lines);

    let cachedBundle = null;
    let text = null;
    let fileHash = null;
    let fileHashAlgo = null;
    let fileBuffer = null;
    let fileEncoding = null;
    let fileEncodingFallback = null;
    let fileEncodingConfidence = null;
    if (fileTextCache?.get && relKey) {
      const cached = fileTextCache.get(relKey);
      if (cached && typeof cached === 'object') {
        if (typeof cached.text === 'string') text = cached.text;
        if (Buffer.isBuffer(cached.buffer)) fileBuffer = cached.buffer;
        if (cached.hash) {
          fileHash = cached.hash;
          fileHashAlgo = 'sha1';
        }
        if (typeof cached.encoding === 'string') fileEncoding = cached.encoding;
        if (typeof cached.encodingFallback === 'boolean') fileEncodingFallback = cached.encodingFallback;
        if (Number.isFinite(cached.encodingConfidence)) fileEncodingConfidence = cached.encodingConfidence;
        if (Number.isFinite(cached.size) && cached.size !== fileStat.size) {
          text = null;
          fileBuffer = null;
          fileHash = null;
          fileHashAlgo = null;
          fileEncoding = null;
          fileEncodingFallback = null;
          fileEncodingConfidence = null;
        }
        if (Number.isFinite(cached.mtimeMs) && cached.mtimeMs !== fileStat.mtimeMs) {
          text = null;
          fileBuffer = null;
          fileHash = null;
          fileHashAlgo = null;
          fileEncoding = null;
          fileEncodingFallback = null;
          fileEncodingConfidence = null;
        }
      } else if (typeof cached === 'string') {
        text = cached;
      }
    }
    const cachedResult = await loadCachedBundleForFile({
      runIo,
      incrementalState,
      absPath: abs,
      relKey,
      fileStat
    });
    cachedBundle = cachedResult.cachedBundle;
    fileHash = cachedResult.fileHash;
    if (fileHash) fileHashAlgo = 'sha1';
    fileBuffer = cachedResult.buffer;
    if (cachedBundle && typeof cachedBundle === 'object') {
      if (!fileEncoding && typeof cachedBundle.encoding === 'string') {
        fileEncoding = cachedBundle.encoding;
      }
      if (typeof cachedBundle.encodingFallback === 'boolean') {
        fileEncodingFallback = cachedBundle.encodingFallback;
      }
      if (Number.isFinite(cachedBundle.encodingConfidence)) {
        fileEncodingConfidence = cachedBundle.encodingConfidence;
      }
    }

    const cachedOutcome = reuseCachedBundle({
      abs,
      relKey,
      fileIndex,
      fileStat,
      fileHash,
      fileHashAlgo,
      ext,
      fileCaps,
      maxFileBytes,
      cachedBundle,
      incrementalState,
      fileStructural,
      toolInfo,
      analysisPolicy: resolvedAnalysisPolicy,
      fileStart,
      knownLines,
      fileLanguageId,
      mode
    });
    if (cachedOutcome?.skip) {
      const { reason, ...extra } = cachedOutcome.skip;
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }
    if (cachedOutcome?.result) {
      warnEncodingFallback(relKey, cachedOutcome.result.fileInfo);
      return cachedOutcome.result;
    }

    if (!fileBuffer) {
      try {
        fileBuffer = await runIo(() => fs.readFile(abs));
      } catch (err) {
        const code = err?.code || null;
        const reason = (code === 'EACCES' || code === 'EPERM' || code === 'EISDIR')
          ? 'unreadable'
          : 'read-failure';
        recordSkip(abs, reason, {
          code,
          message: err?.message || String(err)
        });
        return null;
      }
    }
    const binarySkip = await resolveBinarySkip({
      abs,
      fileBuffer,
      fileScanner
    });
    if (binarySkip) {
      const { reason, ...extra } = binarySkip;
      recordSkip(abs, reason || 'binary', extra);
      return null;
    }
    if (!text || !fileHash) {
      const decoded = await readTextFileWithHash(abs, { buffer: fileBuffer, stat: fileStat });
      if (!text) text = decoded.text;
      if (!fileHash) {
        fileHash = decoded.hash;
        fileHashAlgo = 'sha1';
      }
      fileEncoding = decoded.encoding || fileEncoding;
      fileEncodingFallback = decoded.usedFallback;
      fileEncodingConfidence = decoded.confidence;
      warnEncodingFallback(relKey, {
        encoding: fileEncoding,
        encodingFallback: fileEncodingFallback,
        encodingConfidence: fileEncodingConfidence
      });
    }

    const fileInfo = {
      size: fileStat.size,
      hash: fileHash,
      hashAlgo: fileHashAlgo || null,
      encoding: fileEncoding || null,
      encodingFallback: typeof fileEncodingFallback === 'boolean' ? fileEncodingFallback : null,
      encodingConfidence: Number.isFinite(fileEncodingConfidence) ? fileEncodingConfidence : null
    };
    warnEncodingFallback(relKey, fileInfo);
    if (fileTextCache?.set && relKey && (text || fileBuffer)) {
      fileTextCache.set(relKey, {
        text,
        buffer: fileBuffer,
        hash: fileHash,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        encoding: fileEncoding || null,
        encodingFallback: typeof fileEncodingFallback === 'boolean' ? fileEncodingFallback : null,
        encodingConfidence: Number.isFinite(fileEncodingConfidence) ? fileEncodingConfidence : null
      });
    }

    let languageLines = null;
    let languageSetKey = null;

    const cpuResult = await runCpu(() => processFileCpu({
      abs,
      root,
      mode,
      fileEntry,
      fileIndex,
      ext,
      rel,
      relKey,
      text,
      fileStat,
      fileHash,
      fileHashAlgo,
      fileCaps,
      fileStructural,
      languageOptions: resolvedLanguageOptions,
      astDataflowEnabled,
      controlFlowEnabled,
      normalizedSegmentsConfig,
      normalizedCommentsConfig,
      tokenDictWords,
      dictConfig,
      tokenContext,
      postingsConfig,
      contextWin,
      relationsEnabled,
      lintEnabled,
      complexityEnabled,
      analysisPolicy: resolvedAnalysisPolicy,
      typeInferenceEnabled: resolvedTypeInferenceEnabled,
      riskAnalysisEnabled: resolvedRiskAnalysisEnabled,
      riskConfig,
      gitBlameEnabled: resolvedGitBlameEnabled,
      workerPool,
      workerDictOverride,
      workerState,
      tokenizationStats,
      embeddingEnabled,
      embeddingBatchSize,
      getChunkEmbedding,
      getChunkEmbeddings,
      runEmbedding,
      runTreeSitterSerial,
      runIo,
      log,
      logLine,
      showLineProgress,
      toolInfo,
      timing,
      languageHint,
      crashLogger,
      complexityCache,
      lintCache,
      buildStage
    }));
    if (cpuResult?.defer) {
      return cpuResult;
    }
    fileLanguageId = cpuResult?.fileLanguageId ?? fileLanguageId;
    fileLineCount = cpuResult?.fileLineCount ?? fileLineCount;
    const { chunks: fileChunks, fileRelations, skip } = cpuResult || {};
    const vfsManifestRows = cpuResult?.vfsManifestRows || null;
    if (skip) {
      const { reason, ...extra } = skip;
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }

    const { languageLines: resolvedLanguageLines, languageSetKey: resolvedLanguageSetKey } =
      finalizeLanguageLines({ fileLineCount, fileLanguageId });
    if (resolvedLanguageLines) {
      languageLines = resolvedLanguageLines;
      languageSetKey = resolvedLanguageSetKey;
    }
    recordFeatureMetrics({
      gitBlameEnabled: resolvedGitBlameEnabled,
      embeddingEnabled,
      lintEnabled,
      complexityEnabled,
      fileLineCount,
      languageLines,
      languageSetKey
    });

    const manifestEntry = await writeBundleForFile({
      runIo,
      incrementalState,
      relKey,
      fileStat,
      fileHash,
      fileChunks,
      fileRelations,
      vfsManifestRows,
      fileEncoding: fileEncoding || null,
      fileEncodingFallback: typeof fileEncodingFallback === 'boolean' ? fileEncodingFallback : null,
      fileEncodingConfidence: Number.isFinite(fileEncodingConfidence) ? fileEncodingConfidence : null
    });

    const fileDurationMs = Date.now() - fileStart;
    const fileMetrics = buildFileMetrics({
      fileLineCount,
      fileStat,
      fileDurationMs,
      fileLanguageId,
      cached: false
    });
    recordFileMetrics({
      fileLineCount,
      fileStat,
      fileDurationMs,
      languageLines,
      languageSetKey
    });
    return {
      abs,
      relKey,
      fileIndex,
      cached: false,
      durationMs: fileDurationMs,
      chunks: fileChunks,
      fileRelations,
      vfsManifestRows,
      fileInfo,
      manifestEntry,
      fileMetrics
    };
  }

  return { processFile };
}
