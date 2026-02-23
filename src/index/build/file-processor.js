import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeSegmentsConfig } from '../segments.js';
import { normalizeCommentConfig } from '../comments.js';
import { createLruCache, estimateJsonBytes } from '../../shared/cache.js';
import { fromPosix, toPosix } from '../../shared/files.js';
import { log, logLine } from '../../shared/progress.js';
import { getDocumentExtractorTestConfig, getEnvConfig } from '../../shared/env.js';
import { readTextFileWithHash } from '../../shared/encoding.js';
import { sha1 } from '../../shared/hash.js';
import { buildPostingsPayloadMetadata } from './postings-payload.js';
import { createFileScanner } from './file-scan.js';
import { createTokenizationContext } from './tokenization.js';
import { reuseCachedBundle } from './file-processor/cached-bundle.js';
import { processFileCpu } from './file-processor/cpu.js';
import { loadCachedBundleForFile, writeBundleForFile } from './file-processor/incremental.js';
import { resolveBinarySkip, resolvePreReadSkip } from './file-processor/skip.js';
import { createFileTimingTracker } from './file-processor/timings.js';
import { resolveExt } from './file-processor/read.js';
import {
  compactDocsSearchJsonText,
  isDocsSearchIndexJsonPath
} from './file-processor/docs-search-json.js';
import { getLanguageForFile } from '../language-registry.js';
import { extractPdf, loadPdfExtractorRuntime } from '../extractors/pdf.js';
import { extractDocx, loadDocxExtractorRuntime } from '../extractors/docx.js';
import {
  EXTRACTION_NORMALIZATION_POLICY,
  normalizeDocumentExtractionPolicy,
  sha256Hex
} from '../extractors/common.js';
import {
  buildDocxExtractionText,
  buildPdfExtractionText,
  isDocumentExt,
  normalizeFallbackLanguageFromExt
} from './file-processor/extraction.js';

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
    treeSitterScheduler = null,
    dictConfig,
    dictWords,
    dictShared,
    codeDictWords,
    codeDictWordsByLanguage,
    codeDictLanguages,
    scmProvider = null,
    scmProviderImpl = null,
    scmRepoRoot = null,
    scmConfig = null,
    scmFileMetaByPath = null,
    scmMetaCache = null,
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
    generatedPolicy = null,
    skippedFiles = null,
    embeddingEnabled = true,
    embeddingNormalize = true,
    toolInfo = null,
    tokenizationStats = null,
    tokenizeEnabled = true,
    featureMetrics = null,
    perfEventLogger = null,
    buildStage = null,
    documentExtractionConfig = null,
    documentExtractionCache = null,
    extractedProseYieldProfile = null,
    extractedProseExtrasCache = null,
    primeExtractedProseExtrasCache = false,
    abortSignal = null
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
    ...(languageOptions || {}),
    abortSignal
  };
  const { astDataflowEnabled, controlFlowEnabled } = resolvedLanguageOptions;
  const resolvedDocumentExtraction = documentExtractionConfig && typeof documentExtractionConfig === 'object'
    ? documentExtractionConfig
    : {};
  const documentExtractorTestConfig = getDocumentExtractorTestConfig();
  const documentExtractionEnabled = mode === 'extracted-prose'
    && resolvedDocumentExtraction.enabled === true;
  const documentExtractionPolicy = normalizeDocumentExtractionPolicy(resolvedDocumentExtraction);
  const supportsDocumentExtractionCache = Boolean(
    documentExtractionCache
    && typeof documentExtractionCache.get === 'function'
    && typeof documentExtractionCache.set === 'function'
  );
  const cloneDocumentExtractionCacheRecord = (record) => {
    if (!record || typeof record !== 'object') return null;
    return {
      sourceType: record.sourceType === 'docx' ? 'docx' : 'pdf',
      extractor: record.extractor && typeof record.extractor === 'object'
        ? {
          name: record.extractor.name || null,
          version: record.extractor.version || null,
          target: record.extractor.target || null
        }
        : null,
      text: typeof record.text === 'string' ? record.text : '',
      counts: record.counts && typeof record.counts === 'object'
        ? {
          pages: Math.max(0, Math.floor(Number(record.counts.pages) || 0)),
          paragraphs: Math.max(0, Math.floor(Number(record.counts.paragraphs) || 0)),
          totalUnits: Math.max(0, Math.floor(Number(record.counts.totalUnits) || 0))
        }
        : { pages: 0, paragraphs: 0, totalUnits: 0 },
      units: Array.isArray(record.units)
        ? record.units
          .filter((unit) => unit && typeof unit === 'object')
          .map((unit) => ({
            type: unit.type === 'docx' ? 'docx' : 'pdf',
            ...(Number.isFinite(Number(unit.pageNumber)) ? { pageNumber: Math.floor(Number(unit.pageNumber)) } : {}),
            ...(Number.isFinite(Number(unit.index)) ? { index: Math.floor(Number(unit.index)) } : {}),
            ...(typeof unit.style === 'string' ? { style: unit.style } : {}),
            start: Math.max(0, Math.floor(Number(unit.start) || 0)),
            end: Math.max(0, Math.floor(Number(unit.end) || 0))
          }))
        : [],
      normalizationPolicy: record.normalizationPolicy || EXTRACTION_NORMALIZATION_POLICY,
      warnings: Array.isArray(record.warnings)
        ? record.warnings.slice(0, 32).map((item) => String(item))
        : []
    };
  };
  const resolveDocumentExtractorIdentity = async (sourceType) => {
    if (sourceType === 'pdf') {
      if (documentExtractorTestConfig.stubPdfExtract) {
        return { name: 'pdf-test-stub', version: 'test', target: 'stub' };
      }
      const runtimeInfo = await loadPdfExtractorRuntime();
      return {
        name: runtimeInfo?.name || 'pdfjs-dist',
        version: runtimeInfo?.version || null,
        target: runtimeInfo?.target || null
      };
    }
    if (documentExtractorTestConfig.stubDocxExtract) {
      return { name: 'docx-test-stub', version: 'test', target: 'stub' };
    }
    const runtimeInfo = await loadDocxExtractorRuntime();
    return {
      name: runtimeInfo?.name || 'mammoth',
      version: runtimeInfo?.version || null,
      target: runtimeInfo?.target || null
    };
  };
  const buildDocumentExtractionCacheKey = ({ sourceBytesHash, extractor }) => {
    const bytesHash = typeof sourceBytesHash === 'string' ? sourceBytesHash.trim() : '';
    if (!bytesHash) return null;
    return sha256Hex([
      bytesHash,
      extractor?.name || 'unknown',
      extractor?.version || 'unknown',
      extractor?.target || ''
    ].join('|'));
  };
  const loadCachedDocumentExtraction = (cacheKey) => {
    if (!supportsDocumentExtractionCache || !cacheKey) return null;
    const cached = documentExtractionCache.get(cacheKey);
    return cloneDocumentExtractionCacheRecord(cached);
  };
  const storeCachedDocumentExtraction = (cacheKey, record) => {
    if (!supportsDocumentExtractionCache || !cacheKey || !record) return;
    documentExtractionCache.set(cacheKey, cloneDocumentExtractionCacheRecord(record));
  };
  const ioQueue = queues?.io || null;
  const cpuQueue = queues?.cpu || null;
  const embeddingQueue = queues?.embedding || null;
  const procQueue = queues?.proc || null;
  const vfsManifestConcurrency = cpuQueue
    ? Math.min(4, Math.max(1, Math.floor(cpuQueue.concurrency || 1)))
    : 1;
  const runIo = ioQueue ? (fn) => ioQueue.add(fn) : (fn) => fn();
  const runCpu = cpuQueue && useCpuQueue ? (fn) => cpuQueue.add(fn) : (fn) => fn();
  const runEmbedding = embeddingQueue ? (fn) => embeddingQueue.add(fn) : (fn) => fn();
  const runProc = procQueue ? (fn) => procQueue.add(fn) : (fn) => fn();
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
    postingsConfig,
    codeDictWords,
    codeDictWordsByLanguage,
    codeDictLanguages,
    treeSitter: languageOptions?.treeSitter || null
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
  /**
   * Serialize Tree-sitter executions to avoid parser/runtime contention.
   *
   * This preserves FIFO execution order while keeping the chain alive after
   * failures by swallowing the previous rejection in the queue tail.
   *
   * @param {Function} fn
   * @returns {Promise<any>}
   */
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
  async function processFile(fileEntry, fileIndex, options = {}) {
    const signal = options?.signal && typeof options.signal === 'object'
      ? options.signal
      : null;
    const onScmProcQueueWait = typeof options?.onScmProcQueueWait === 'function'
      ? options.onScmProcQueueWait
      : null;
    const throwIfAborted = () => {
      if (!signal?.aborted) return;
      const reason = signal.reason;
      if (reason instanceof Error) throw reason;
      const err = new Error('File processing aborted');
      err.code = 'FILE_PROCESS_ABORTED';
      throw err;
    };
    throwIfAborted();
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
      ? fromPosix(fileEntry.rel)
      : path.relative(root, abs);
    const fileStructural = structuralMatches?.get(relKey) || null;
    if (seenFiles) seenFiles.add(relKey);
    const updateCrashStage = (substage, extra = {}) => {
      if (!crashLogger?.enabled) return;
      const entry = {
        phase: 'processing',
        mode,
        stage: buildStage || null,
        fileIndex: Number.isFinite(fileIndex) ? fileIndex : null,
        file: relKey,
        substage,
        ...extra
      };
      if (typeof crashLogger.traceFileStage === 'function') {
        crashLogger.traceFileStage(entry);
      }
    };
    const formatCrashErrorMeta = (err) => ({
      errorCode: typeof err?.code === 'string' ? err.code : null,
      errorName: typeof err?.name === 'string' ? err.name : null,
      errorMessage: err?.message || String(err)
    });
    const ext = typeof fileEntry === 'object' && typeof fileEntry.ext === 'string'
      ? fileEntry.ext
      : resolveExt(abs);
    const languageHint = getLanguageForFile(ext, relKey);
    let fileLanguageId = languageHint?.id || null;
    let fileLineCount = 0;
    let fileStat;
    updateCrashStage('pre-cpu:lstat:start', { ext });
    try {
      fileStat = typeof fileEntry === 'object' && fileEntry.stat
        ? fileEntry.stat
        : await runIo(() => fs.lstat(abs));
      updateCrashStage('pre-cpu:lstat:done', {
        size: Number.isFinite(Number(fileStat?.size)) ? Number(fileStat.size) : null
      });
    } catch {
      updateCrashStage('pre-cpu:lstat:error');
      return null;
    }
    if (fileStat?.isSymbolicLink?.()) {
      updateCrashStage('pre-cpu:skip:symlink');
      recordSkip(abs, 'symlink');
      return null;
    }
    updateCrashStage('pre-cpu:resolve-pre-read-skip:start');
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
      maxFileBytes,
      bypassBinaryMinifiedSkip: documentExtractionEnabled && isDocumentExt(ext),
      rel: relKey,
      generatedPolicy,
      extractedProseYieldProfile
    });
    updateCrashStage('pre-cpu:resolve-pre-read-skip:done', {
      skipped: Boolean(preReadSkip)
    });
    if (preReadSkip) {
      const { reason, ...extra } = preReadSkip;
      updateCrashStage('pre-cpu:skip:pre-read', { reason: reason || 'oversize' });
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
    let documentExtraction = null;
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
    updateCrashStage('pre-cpu:load-cached-bundle:start');
    const cachedResult = await loadCachedBundleForFile({
      runIo,
      incrementalState,
      absPath: abs,
      relKey,
      fileStat
    });
    updateCrashStage('pre-cpu:load-cached-bundle:done', {
      hasCachedBundle: Boolean(cachedResult?.cachedBundle),
      hasBuffer: Buffer.isBuffer(cachedResult?.buffer),
      hasHash: typeof cachedResult?.fileHash === 'string' && cachedResult.fileHash.length > 0
    });
    throwIfAborted();
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
      updateCrashStage('pre-cpu:skip:cache-reuse', { reason: reason || 'oversize' });
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }
    if (cachedOutcome?.result) {
      updateCrashStage('pre-cpu:cache-reuse:hit');
      if (!cachedOutcome.result.postingsPayload) {
        cachedOutcome.result.postingsPayload = buildPostingsPayloadMetadata({
          chunks: cachedOutcome.result.chunks,
          fileRelations: cachedOutcome.result.fileRelations,
          vfsManifestRows: cachedOutcome.result.vfsManifestRows
        });
      }
      warnEncodingFallback(relKey, cachedOutcome.result.fileInfo);
      return cachedOutcome.result;
    }

    if (!fileBuffer) {
      throwIfAborted();
      updateCrashStage('pre-cpu:read-file:start');
      try {
        fileBuffer = await runIo(() => fs.readFile(abs));
        updateCrashStage('pre-cpu:read-file:done', {
          bytes: Buffer.isBuffer(fileBuffer) ? fileBuffer.length : null
        });
      } catch (err) {
        const code = err?.code || null;
        updateCrashStage('pre-cpu:read-file:error', formatCrashErrorMeta(err));
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
    if (documentExtractionEnabled && isDocumentExt(ext)) {
      const sourceType = ext === '.pdf' ? 'pdf' : 'docx';
      let sourceHashBuffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : null;
      if (!sourceHashBuffer) {
        try {
          updateCrashStage('pre-cpu:extract:source-read:start');
          sourceHashBuffer = await runIo(() => fs.readFile(abs));
          updateCrashStage('pre-cpu:extract:source-read:done', {
            bytes: Buffer.isBuffer(sourceHashBuffer) ? sourceHashBuffer.length : null
          });
          if (Buffer.isBuffer(sourceHashBuffer)) fileBuffer = sourceHashBuffer;
        } catch {
          updateCrashStage('pre-cpu:extract:source-read:error');
          sourceHashBuffer = null;
        }
      }
      const sourceBytesHash = sourceHashBuffer ? sha256Hex(sourceHashBuffer) : null;
      const extractorIdentity = await resolveDocumentExtractorIdentity(sourceType);
      const extractionCacheKey = buildDocumentExtractionCacheKey({
        sourceBytesHash,
        extractor: extractorIdentity
      });
      const cachedExtraction = loadCachedDocumentExtraction(extractionCacheKey);
      let extractionCacheHit = false;
      let extracted = null;
      let joined = null;
      if (cachedExtraction?.text) {
        extractionCacheHit = true;
        joined = {
          text: cachedExtraction.text,
          units: Array.isArray(cachedExtraction.units) ? cachedExtraction.units : [],
          counts: cachedExtraction.counts || { pages: 0, paragraphs: 0, totalUnits: 0 }
        };
        text = joined.text;
        updateCrashStage('pre-cpu:extract:cache-hit', {
          sourceType,
          reasonCode: DOCUMENT_EXTRACTION_CACHE_HIT_REASON_CODE
        });
      } else {
        updateCrashStage('pre-cpu:extract:start', { sourceType });
        extracted = sourceType === 'pdf'
          ? await extractPdf({ filePath: abs, buffer: fileBuffer, policy: documentExtractionPolicy })
          : await extractDocx({ filePath: abs, buffer: fileBuffer, policy: documentExtractionPolicy });
        updateCrashStage('pre-cpu:extract:done', {
          ok: extracted?.ok === true,
          sourceType,
          reasonCode: DOCUMENT_EXTRACTION_CACHE_MISS_REASON_CODE
        });
        if (!extracted?.ok) {
          updateCrashStage('pre-cpu:skip:extract', {
            reason: extracted?.reason || 'extract_failed',
            sourceType
          });
          recordSkip(abs, extracted?.reason || 'extract_failed', {
            stage: 'extract',
            sourceType,
            warnings: extracted?.warnings || []
          });
          return null;
        }
        joined = sourceType === 'pdf'
          ? buildPdfExtractionText(extracted.pages)
          : buildDocxExtractionText(extracted.paragraphs);
        if (!joined.text) {
          updateCrashStage('pre-cpu:skip:unsupported-scanned', { sourceType });
          recordSkip(abs, 'unsupported_scanned', {
            stage: 'extract',
            sourceType
          });
          return null;
        }
        text = joined.text;
        storeCachedDocumentExtraction(extractionCacheKey, {
          sourceType,
          extractor: extracted.extractor || extractorIdentity || null,
          text: joined.text,
          counts: joined.counts,
          units: joined.units.map((unit) => ({
            type: unit.type,
            ...(Number.isFinite(unit.pageNumber) ? { pageNumber: unit.pageNumber } : {}),
            ...(Number.isFinite(unit.index) ? { index: unit.index } : {}),
            ...(unit.style ? { style: unit.style } : {}),
            start: unit.start,
            end: unit.end
          })),
          normalizationPolicy: EXTRACTION_NORMALIZATION_POLICY,
          warnings: extracted.warnings || []
        });
      }
      if (!fileHash && sourceHashBuffer) {
        fileHash = sha1(sourceHashBuffer);
        fileHashAlgo = 'sha1';
      }
      fileEncoding = 'document-extracted';
      fileEncodingFallback = null;
      fileEncodingConfidence = null;
      documentExtraction = {
        sourceType,
        status: 'ok',
        extractor: extractionCacheHit
          ? (cachedExtraction?.extractor || extractorIdentity || null)
          : (extracted?.extractor || extractorIdentity || null),
        sourceBytesHash: sourceBytesHash || null,
        sourceBytesHashAlgo: 'sha256',
        counts: joined?.counts || { pages: 0, paragraphs: 0, totalUnits: 0 },
        units: joined.units.map((unit) => ({
          type: unit.type,
          ...(Number.isFinite(unit.pageNumber) ? { pageNumber: unit.pageNumber } : {}),
          ...(Number.isFinite(unit.index) ? { index: unit.index } : {}),
          ...(unit.style ? { style: unit.style } : {}),
          start: unit.start,
          end: unit.end
        })),
        normalizationPolicy: EXTRACTION_NORMALIZATION_POLICY,
        warnings: extractionCacheHit
          ? Array.from(new Set([
            ...(Array.isArray(cachedExtraction?.warnings) ? cachedExtraction.warnings : []),
            DOCUMENT_EXTRACTION_CACHE_HIT_REASON_CODE
          ]))
          : (extracted?.warnings || []),
        cache: {
          status: extractionCacheHit ? 'hit' : 'miss',
          reasonCode: extractionCacheHit
            ? DOCUMENT_EXTRACTION_CACHE_HIT_REASON_CODE
            : DOCUMENT_EXTRACTION_CACHE_MISS_REASON_CODE,
          key: extractionCacheKey || null
        }
      };
    } else {
      updateCrashStage('pre-cpu:resolve-binary-skip:start');
      const binarySkip = await resolveBinarySkip({
        abs,
        fileBuffer,
        fileScanner
      });
      updateCrashStage('pre-cpu:resolve-binary-skip:done', {
        skipped: Boolean(binarySkip)
      });
      if (binarySkip) {
        const { reason, ...extra } = binarySkip;
        updateCrashStage('pre-cpu:skip:binary', { reason: reason || 'binary' });
        recordSkip(abs, reason || 'binary', extra);
        return null;
      }
      if (!text || !fileHash) {
        updateCrashStage('pre-cpu:decode:start');
        const decoded = await readTextFileWithHash(abs, { buffer: fileBuffer, stat: fileStat });
        updateCrashStage('pre-cpu:decode:done', {
          bytes: Buffer.isBuffer(fileBuffer) ? fileBuffer.length : null,
          encoding: decoded?.encoding || null
        });
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
      if (isDocsSearchIndexJsonPath({ mode, ext, relPath: relKey })) {
        const compacted = compactDocsSearchJsonText(text);
        if (typeof compacted === 'string' && compacted.length > 0) {
          text = compacted;
        }
      }
    }

    const fileInfo = {
      size: fileStat.size,
      hash: fileHash,
      hashAlgo: fileHashAlgo || null,
      encoding: fileEncoding || null,
      encodingFallback: typeof fileEncodingFallback === 'boolean' ? fileEncodingFallback : null,
      encodingConfidence: Number.isFinite(fileEncodingConfidence) ? fileEncodingConfidence : null,
      ...(documentExtraction ? { extraction: documentExtraction } : {})
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

    updateCrashStage('pre-cpu:handoff-to-cpu:start');
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
      documentExtraction,
      fileStat,
      fileHash,
      fileHashAlgo,
      fileCaps,
      fileStructural,
      scmProvider,
      scmProviderImpl,
      scmRepoRoot,
      scmConfig,
      scmFileMetaByPath,
      scmMetaCache,
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
      tokenizeEnabled,
      embeddingEnabled,
      embeddingNormalize,
      embeddingBatchSize,
      getChunkEmbedding,
      getChunkEmbeddings,
      runEmbedding,
      runProc,
      runTreeSitterSerial,
      runIo,
      log,
      logLine,
      showLineProgress,
      toolInfo,
      treeSitterScheduler,
      timing,
      languageHint,
      perfEventLogger,
      crashLogger,
      vfsManifestConcurrency,
      complexityCache,
      lintCache,
      buildStage,
      extractedProseExtrasCache,
      primeExtractedProseExtrasCache,
      onScmProcQueueWait
    }));
    updateCrashStage('pre-cpu:handoff-to-cpu:done');
    throwIfAborted();
    if (cpuResult?.defer) {
      updateCrashStage('processing:deferred');
      return cpuResult;
    }
    fileLanguageId = cpuResult?.fileLanguageId ?? fileLanguageId;
    fileLineCount = cpuResult?.fileLineCount ?? fileLineCount;
    const {
      chunks: fileChunks,
      fileRelations,
      lexiconFilterStats,
      skip
    } = cpuResult || {};
    const vfsManifestRows = cpuResult?.vfsManifestRows || null;
    if (skip) {
      const { reason, ...extra } = skip;
      updateCrashStage('processing:skip', { reason: reason || 'oversize' });
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }

    const metricsLanguageId = fileLanguageId || normalizeFallbackLanguageFromExt(ext) || null;
    const { languageLines: resolvedLanguageLines, languageSetKey: resolvedLanguageSetKey } =
      finalizeLanguageLines({ fileLineCount, fileLanguageId: metricsLanguageId });
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

    throwIfAborted();
    updateCrashStage('post-cpu:write-bundle:start');
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
    updateCrashStage('post-cpu:write-bundle:done', {
      hasManifestEntry: Boolean(manifestEntry)
    });
    throwIfAborted();

    const fileDurationMs = Date.now() - fileStart;
    const fileMetrics = buildFileMetrics({
      fileLineCount,
      fileStat,
      fileDurationMs,
      fileLanguageId,
      cached: false
    });
    const postingsPayload = buildPostingsPayloadMetadata({
      chunks: fileChunks,
      fileRelations,
      vfsManifestRows
    });
    recordFileMetrics({
      fileLineCount,
      fileStat,
      fileDurationMs,
      languageLines,
      languageSetKey
    });
    updateCrashStage('processing:done', { durationMs: Date.now() - fileStart });
    return {
      abs,
      relKey,
      fileIndex,
      cached: false,
      durationMs: fileDurationMs,
      chunks: fileChunks,
      fileRelations,
      lexiconFilterStats,
      vfsManifestRows,
      postingsPayload,
      fileInfo,
      manifestEntry,
      fileMetrics
    };
  }

  return { processFile };
}
