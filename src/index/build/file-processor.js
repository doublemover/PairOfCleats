import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeSegmentsConfig } from '../segments.js';
import { normalizeCommentConfig } from '../comments.js';
import { createLruCache, estimateJsonBytes } from '../../shared/cache.js';
import { fromPosix, toPosix } from '../../shared/files.js';
import { log, logLine } from '../../shared/progress.js';
import { getDocumentExtractorTestConfig, getEnvConfig } from '../../shared/env.js';
import { buildPostingsPayloadMetadata } from './postings-payload.js';
import { createFileScanner } from './file-scan.js';
import { createTokenizationContext } from './tokenization.js';
import { reuseCachedBundle } from './file-processor/cached-bundle.js';
import { processFileCpu } from './file-processor/cpu.js';
import { loadCachedBundleForFile, writeBundleForFile } from './file-processor/incremental.js';
import { resolvePreReadSkip } from './file-processor/skip.js';
import { createFileTimingTracker } from './file-processor/timings.js';
import { resolveExt } from './file-processor/read.js';
import {
  createPreCpuArtifactState,
  applyCachedResultToArtifacts,
  buildFileInfoFromArtifacts,
  writeArtifactsToFileTextCache
} from './file-processor/pre-cpu-state.js';
import { resolvePreCpuFileContent } from './file-processor/pre-cpu-content.js';
import { getLanguageForFile } from '../language-registry.js';
import {
  EXTRACTION_NORMALIZATION_POLICY,
  sha256Hex,
  normalizeDocumentExtractionPolicy
} from '../extractors/common.js';
import { loadPdfExtractorRuntime } from '../extractors/pdf.js';
import { loadDocxExtractorRuntime } from '../extractors/docx.js';
import {
  isDocumentExt,
  normalizeFallbackLanguageFromExt
} from './file-processor/extraction.js';
import { sha1 } from '../../shared/hash.js';

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
  /**
   * Resolve a nullable policy flag while preserving the hard-coded runtime
   * default when config omits the value.
   *
   * @param {unknown} value
   * @param {boolean} fallback
   * @returns {boolean}
   */
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
  const documentExtractionPolicyCacheKey = [
    documentExtractionPolicy.maxBytesPerFile,
    documentExtractionPolicy.maxPages,
    documentExtractionPolicy.extractTimeoutMs,
    EXTRACTION_NORMALIZATION_POLICY
  ].join('|');
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
      extractor?.target || '',
      documentExtractionPolicyCacheKey
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
  const showLineProgress = getEnvConfig().verbose === true;
  const encodingWarnings = {
    seen: new Set(),
    count: 0,
    limit: 50
  };
  /**
   * Emit one bounded warning per file when decoding falls back from UTF-8.
   *
   * Warnings are rate-limited globally to avoid log storms in mixed-encoding
   * repositories.
   *
   * @param {string} fileKey
   * @param {{encodingFallback?:boolean,encoding?:string,encodingConfidence?:number,file?:string}} info
   * @returns {void}
   */
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
  /**
   * Record skip metadata for diagnostics and later artifact emission.
   *
   * @param {string} filePath
   * @param {string} reason
   * @param {object} [extra]
   * @returns {void}
   */
  const recordSkip = (filePath, reason, extra = {}) => {
    if (!skippedFiles) return;
    skippedFiles.push({ file: filePath, reason, ...extra });
  };
  /**
   * Resolve tokenization dictionary overrides that must be forwarded to worker
   * tokenizers when runtime dict settings diverge from worker defaults.
   *
   * @returns {{segmentation:string,dpMaxTokenLength:number}|null}
   */
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
    /**
     * Fail fast when the per-file abort signal has been cancelled.
     *
     * @returns {void}
     */
    const throwIfAborted = () => {
      if (!signal?.aborted) return;
      const reason = signal.reason;
      if (reason instanceof Error) throw reason;
      const err = new Error('File processing aborted');
      err.code = 'FILE_PROCESS_ABORTED';
      throw err;
    };
    const runIo = ioQueue ? (fn) => ioQueue.add(fn, { signal }) : (fn) => fn();
    const runCpu = cpuQueue && useCpuQueue ? (fn) => cpuQueue.add(fn, { signal }) : (fn) => fn();
    const runEmbedding = embeddingQueue ? (fn) => embeddingQueue.add(fn, { signal }) : (fn) => fn();
    const runProc = procQueue ? (fn) => procQueue.add(fn, { signal }) : (fn) => fn();
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
    /**
     * Update crash telemetry with file-local processing stage context.
     *
     * @param {string} substage
     * @param {object} [extra]
     * @returns {void}
     */
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
    /**
     * Normalize thrown error metadata for crash logs without leaking large
     * stack payloads into the stage tracker.
     *
     * @param {unknown} err
     * @returns {{errorCode:string|null,errorName:string|null,errorMessage:string}}
     */
    const formatCrashErrorMeta = (err) => ({
      errorCode: typeof err?.code === 'string' ? err.code : null,
      errorName: typeof err?.name === 'string' ? err.name : null,
      errorMessage: err?.message || String(err)
    });
    const ext = typeof fileEntry === 'object' && typeof fileEntry.ext === 'string'
      ? fileEntry.ext
      : resolveExt(abs);
    const documentSourceType = documentExtractionEnabled && isDocumentExt(ext)
      ? (ext === '.pdf' ? 'pdf' : 'docx')
      : null;
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
      bypassBinaryMinifiedSkip: Boolean(documentSourceType),
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
    const artifacts = createPreCpuArtifactState({
      fileTextCache,
      relKey,
      fileStat
    });
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
    applyCachedResultToArtifacts({ artifacts, cachedResult });

    const cachedOutcome = reuseCachedBundle({
      abs,
      relKey,
      fileIndex,
      fileStat,
      fileHash: artifacts.fileHash,
      fileHashAlgo: artifacts.fileHashAlgo,
      ext,
      fileCaps,
      maxFileBytes,
      cachedBundle: artifacts.cachedBundle,
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
    let usedDocumentExtractionCacheHit = false;
    let documentExtractionCacheKey = null;
    let documentExtractionIdentity = null;
    if (documentSourceType && supportsDocumentExtractionCache) {
      if (!artifacts.fileBuffer) {
        throwIfAborted();
        updateCrashStage('pre-cpu:extract:cache-read:start', { sourceType: documentSourceType });
        try {
          artifacts.fileBuffer = await runIo(() => fs.readFile(abs));
          updateCrashStage('pre-cpu:extract:cache-read:done', {
            bytes: Buffer.isBuffer(artifacts.fileBuffer) ? artifacts.fileBuffer.length : null,
            sourceType: documentSourceType
          });
        } catch {
          updateCrashStage('pre-cpu:extract:cache-read:error', { sourceType: documentSourceType });
          artifacts.fileBuffer = null;
        }
      }
      if (Buffer.isBuffer(artifacts.fileBuffer)) {
        const sourceBytesHash = sha256Hex(artifacts.fileBuffer);
        documentExtractionIdentity = await resolveDocumentExtractorIdentity(documentSourceType);
        documentExtractionCacheKey = buildDocumentExtractionCacheKey({
          sourceBytesHash,
          extractor: documentExtractionIdentity
        });
        const cachedExtraction = loadCachedDocumentExtraction(documentExtractionCacheKey);
        if (cachedExtraction?.text) {
          usedDocumentExtractionCacheHit = true;
          const warnings = Array.isArray(cachedExtraction.warnings)
            ? cachedExtraction.warnings.slice(0, 32)
            : [];
          if (!warnings.includes('document-extraction-cache-hit')) {
            warnings.push('document-extraction-cache-hit');
          }
          artifacts.text = cachedExtraction.text;
          if (!artifacts.fileHash) {
            artifacts.fileHash = sha1(artifacts.fileBuffer);
            artifacts.fileHashAlgo = 'sha1';
          }
          artifacts.fileEncoding = 'document-extracted';
          artifacts.fileEncodingFallback = null;
          artifacts.fileEncodingConfidence = null;
          artifacts.documentExtraction = {
            sourceType: documentSourceType,
            status: 'ok',
            extractor: cachedExtraction.extractor || documentExtractionIdentity,
            sourceBytesHash,
            sourceBytesHashAlgo: 'sha256',
            counts: cachedExtraction.counts || { pages: 0, paragraphs: 0, totalUnits: 0 },
            units: Array.isArray(cachedExtraction.units) ? cachedExtraction.units : [],
            normalizationPolicy: cachedExtraction.normalizationPolicy || EXTRACTION_NORMALIZATION_POLICY,
            warnings
          };
          updateCrashStage('pre-cpu:extract:cache-hit', {
            sourceType: documentSourceType
          });
        }
      }
    }

    const preCpuContent = usedDocumentExtractionCacheHit
      ? { skip: null }
      : await resolvePreCpuFileContent({
        abs,
        relKey,
        mode,
        ext,
        fileStat,
        fileScanner,
        runIo,
        throwIfAborted,
        updateCrashStage,
        formatCrashErrorMeta,
        warnEncodingFallback,
        documentSourceType,
        documentExtractionPolicy,
        artifacts
      });
    if (preCpuContent?.skip) {
      const { reason, ...extra } = preCpuContent.skip;
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }
    if (
      documentSourceType
      && documentExtractionCacheKey
      && artifacts.documentExtraction?.status === 'ok'
      && typeof artifacts.text === 'string'
      && artifacts.text.length > 0
      && !usedDocumentExtractionCacheHit
    ) {
      const cacheWarnings = Array.isArray(artifacts.documentExtraction.warnings)
        ? artifacts.documentExtraction.warnings
          .filter((item) => item && item !== 'document-extraction-cache-hit')
          .slice(0, 32)
        : [];
      storeCachedDocumentExtraction(documentExtractionCacheKey, {
        sourceType: documentSourceType,
        extractor: artifacts.documentExtraction.extractor || documentExtractionIdentity,
        text: artifacts.text,
        counts: artifacts.documentExtraction.counts || { pages: 0, paragraphs: 0, totalUnits: 0 },
        units: Array.isArray(artifacts.documentExtraction.units) ? artifacts.documentExtraction.units : [],
        normalizationPolicy: artifacts.documentExtraction.normalizationPolicy || EXTRACTION_NORMALIZATION_POLICY,
        warnings: cacheWarnings
      });
    }

    const fileInfo = buildFileInfoFromArtifacts({
      fileStat,
      artifacts
    });
    warnEncodingFallback(relKey, fileInfo);
    writeArtifactsToFileTextCache({
      fileTextCache,
      relKey,
      fileStat,
      artifacts
    });

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
      text: artifacts.text,
      documentExtraction: artifacts.documentExtraction,
      fileStat,
      fileHash: artifacts.fileHash,
      fileHashAlgo: artifacts.fileHashAlgo,
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
      signal,
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
      fileHash: artifacts.fileHash,
      fileChunks,
      fileRelations,
      vfsManifestRows,
      fileEncoding: artifacts.fileEncoding || null,
      fileEncodingFallback: typeof artifacts.fileEncodingFallback === 'boolean'
        ? artifacts.fileEncodingFallback
        : null,
      fileEncodingConfidence: Number.isFinite(artifacts.fileEncodingConfidence)
        ? artifacts.fileEncodingConfidence
        : null
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
