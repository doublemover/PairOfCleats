import { analyzeComplexity, lintChunk } from '../../../analysis.js';
import { getChunkAuthorsFromLines } from '../../../scm/annotate.js';
import { isJsLike } from '../../../constants.js';
import {
  detectBoilerplateCommentBlocks,
  resolveChunkBoilerplateMatch
} from '../../../boilerplate.js';
import {
  createTokenizationBuffers
} from '../../tokenization.js';
import { assignCommentsToChunks } from '../chunk.js';
import { buildChunkPayload } from '../assemble.js';
import { attachEmbeddings } from '../embeddings.js';
import { createLineReader, stripCommentText } from '../utils.js';
import { resolveSegmentTokenMode } from '../../../segments/config.js';
import { attachCallDetailsByChunkIndex } from './dedupe.js';
import { shouldDetectBoilerplateBlocks } from './boilerplate.js';
import { buildChunkEnrichment, createFrameworkProfileResolver } from './enrichment.js';
import {
  coalesceHeavyChunks,
  normalizeHeavyFilePolicy,
  shouldApplySwiftHotPathCoalescing,
  shouldDownshiftForHeavyPath
} from './heavy-policy.js';
import { prepareChunkIds } from './ids.js';
import { collectChunkComments } from './limits.js';
import { shouldSkipPhrasePostingsForChunk } from '../../state.js';
import { createLintChunkResolver } from './token-flow/lint-resolver.js';
import { normalizeChunkDocmeta } from './token-flow/normalization.js';
import { resolveParserFallbackProfile } from './token-flow/parser-profile.js';
import { createTokenFlowCaches } from './token-flow/cache.js';
import { createChunkTokenizer } from './token-flow/chunk-tokenizer.js';

export { canUseLineTokenStreamSlice } from './token-flow/parser-profile.js';

/**
 * Process raw structural chunks into final chunk payload rows for one file.
 *
 * This stage coordinates enrichment, tokenization, optional worker offload,
 * boilerplate weighting, and embeddings.
 *
 * @param {object} context
 * @returns {Promise<{chunks:Array<object>,fileRelations:any}|object>}
 */
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
    chunkingDiagnostics,
    failFile,
    buildStage,
    fileIndex = null
  } = context;

  const containerExt = ext;
  const containerLanguageId = fileLanguageId || lang?.id || null;
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
    crashLogger.updateFile(entry);
    if (typeof crashLogger.traceFileStage === 'function') {
      crashLogger.traceFileStage(entry);
    }
  };
  const sourceChunks = Array.isArray(sc) ? sc : [];
  const processChunksStartedAt = Date.now();
  updateCrashStage('process-chunks:start', { totalChunks: sourceChunks.length, languageId: containerLanguageId });
  const canEmitPerfEvent = perfEventLogger && typeof perfEventLogger.emit === 'function';
  const fileBytes = fileStat?.size ?? Buffer.byteLength(text || '', 'utf8');
  const fileSize = fileStat?.size;
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
  const parserFallbackProfile = resolveParserFallbackProfile({
    mode,
    heavyFileDownshift,
    heavyFileSkipTokenization,
    chunkingDiagnostics
  });
  const parserMode = parserFallbackProfile.mode;
  const parserIsAstFull = parserMode === 'ast-full';
  const parserIsChunkOnly = parserMode === 'chunk-only';
  updateCrashStage('parser-profile', {
    parserMode,
    parserReasonCode: parserFallbackProfile.reasonCode,
    parserReason: parserFallbackProfile.reason,
    heavyFileDownshift,
    heavyFileSkipTokenization,
    totalChunks: chunksForProcessing.length
  });

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
  const segmentRelationsCache = new Map();
  const codeTexts = embeddingEnabled ? [] : null;
  const docTexts = embeddingEnabled ? [] : null;
  const wantsFieldTokens = postingsConfig?.fielded !== false
    || postingsConfig?.chargramSource === 'fields'
    || postingsConfig?.phraseSource === 'fields';
  const tokenizationFileStreamEnabled = languageOptions?.tokenization?.fileStream === true;
  const tokenFlowCaches = createTokenFlowCaches({
    tokenContext,
    fileBytes,
    heavyFileDownshift,
    tokenizationFileStreamEnabled,
    text,
    dictConfig,
    lineIndex,
    relKey
  });
  const { fileTokenContext } = tokenFlowCaches;
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
  const runTokenize = useWorkerForTokens && typeof workerPool?.tokenizeChunk === 'function'
    ? (payload) => (runProc ? runProc(() => workerPool.tokenizeChunk(payload)) : workerPool.tokenizeChunk(payload))
    : null;
  let fileComplexity = {};
  let fileLint = [];
  if (isJsLike(ext) && mode === 'code') {
    const effectiveComplexityEnabled = complexityEnabled && !heavyFileDownshift && parserIsAstFull;
    const effectiveLintEnabled = lintEnabled && !heavyFileDownshift && parserIsAstFull;
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
  const resolveLintForChunk = fileLint.length ? createLintChunkResolver(fileLint) : null;

  const baseTypeInferenceEnabled = typeof analysisPolicy?.typeInference?.local?.enabled === 'boolean'
    ? analysisPolicy.typeInference.local.enabled
    : typeInferenceEnabled;
  const baseRiskAnalysisEnabled = typeof analysisPolicy?.risk?.enabled === 'boolean'
    ? analysisPolicy.risk.enabled
    : riskAnalysisEnabled;
  const effectiveTypeInferenceEnabled = parserIsAstFull ? baseTypeInferenceEnabled : false;
  const effectiveRiskAnalysisEnabled = parserIsAstFull ? baseRiskAnalysisEnabled : false;
  const effectiveRelationsEnabled = parserIsChunkOnly
    ? false
    : (heavyFileDownshift ? false : relationsEnabled);
  const effectiveTokenizeEnabled = tokenizeEnabled
    && !heavyFileSkipTokenization
    && !(mode === 'code' && parserIsChunkOnly);
  const resolveFrameworkProfile = createFrameworkProfileResolver({
    relPath: rel,
    ext: containerExt,
    text
  });
  const fileFrameworkProfile = resolveFrameworkProfile();
  const chunkCount = chunksForProcessing.length;
  const hasCommentAssignments = commentAssignments.size > 0 || commentRangeAssignments.size > 0;
  const relKeyLower = typeof relKey === 'string' ? relKey.toLowerCase() : null;
  const fileBoilerplateBlocks = shouldDetectBoilerplateBlocks({
    mode,
    text,
    chunkCount,
    relPath: rel
  })
    ? await detectBoilerplateCommentBlocks({ text })
    : [];
  const hasFileBoilerplateBlocks = fileBoilerplateBlocks.length > 0;
  const tokenizeChunkForFile = createChunkTokenizer({
    effectiveTokenizeEnabled,
    runTokenize,
    workerState,
    log,
    crashLogger,
    relKey,
    fileSize,
    fileLanguageId,
    lang,
    workerDictOverride,
    parserMode,
    parserReasonCode: parserFallbackProfile.reasonCode,
    addTokenizeDuration,
    addSettingMetric,
    updateCrashStage,
    dictConfig,
    fileTokenContext,
    tokenBuffers
  });

  for (let ci = 0; ci < chunkCount; ++ci) {
    const c = chunksForProcessing[ci];
    const ctext = text.slice(c.start, c.end);
    let tokenText = ctext;
    const lineRange = chunkLineRanges[ci] || { startLine: 1, endLine: fileLineCount || 1 };
    const startLine = lineRange.startLine;
    const endLine = lineRange.endLine;
    const chunkLineCount = Math.max(1, endLine - startLine + 1);
    const segmentTokenMode = c.segment ? resolveSegmentTokenMode(c.segment) : tokenMode;
    const chunkMode = segmentTokenMode || tokenMode;
    const effectiveExt = c.segment?.ext || containerExt;
    const effectiveLang = tokenFlowCaches.resolveEffectiveLanguage(effectiveExt);
    const effectiveLanguageId = effectiveLang?.id || c.segment?.languageId || containerLanguageId || 'unknown';
    const chunkLanguageId = effectiveLanguageId;
    updateCrashStage('chunk', {
      chunkIndex: ci,
      chunkId: c?.chunkId || null,
      start: c?.start ?? null,
      end: c?.end ?? null,
      chunkMode,
      chunkLanguageId: chunkLanguageId || null,
      parserMode,
      parserReasonCode: parserFallbackProfile.reasonCode,
      parserReason: parserFallbackProfile.reason,
      effectiveExt: effectiveExt || null,
      segmentLanguageId: c.segment?.languageId || null,
      segmentExt: c.segment?.ext || null
    });
    const dictWordsForChunk = tokenFlowCaches.resolveDictWordsForChunk(chunkMode, chunkLanguageId);
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
      parserMode,
      parserReasonCode: parserFallbackProfile.reasonCode,
      parserReason: parserFallbackProfile.reason,
      failFile,
      diagnostics,
      startLine,
      endLine,
      totalLines,
      fileFrameworkProfile,
      segmentRelationsCache
    });
    if (enrichment?.skip) {
      return enrichment.skip;
    }
    let { codeRelations, docmeta } = enrichment;
    docmeta = normalizeChunkDocmeta({
      docmeta,
      chunkMode,
      chunkLanguageId,
      languageOptions,
      effectiveExt,
      containerExt,
      parserMode,
      parserReasonCode: parserFallbackProfile.reasonCode,
      parserReason: parserFallbackProfile.reason
    });

    let assignedRanges = [];
    let commentFieldTokens = [];
    if (hasCommentAssignments) {
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

    const pretokenized = tokenFlowCaches.resolvePretokenizedChunk({
      effectiveTokenizeEnabled,
      tokenText,
      chunkText: ctext,
      chunkStart: c.start,
      chunkEnd: c.end,
      startLine,
      endLine,
      chunkMode,
      chunkLanguageId,
      effectiveExt,
      dictWordsForChunk
    });
    const tokenPayload = await tokenizeChunkForFile({
      chunkIndex: ci,
      chunkMode,
      chunkLanguageId,
      tokenText,
      effectiveExt,
      pretokenized,
      chunkLineCount,
      dictWordsForChunk
    });

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

    let boilerplateCoverage = 0;
    if (hasFileBoilerplateBlocks) {
      const boilerplateMatch = resolveChunkBoilerplateMatch({
        blocks: fileBoilerplateBlocks,
        start: c.start,
        end: c.end
      });
      boilerplateCoverage = Number(boilerplateMatch?.coverage || 0);
      if (boilerplateMatch) {
        docmeta = {
          ...docmeta,
          boilerplateRef: boilerplateMatch.ref,
          boilerplateTags: boilerplateMatch.tags,
          boilerplatePosition: boilerplateMatch.position,
          boilerplateCoverage: Number(boilerplateCoverage.toFixed(4)),
          boilerplateLines: {
            start: boilerplateMatch.startLine,
            end: boilerplateMatch.endLine
          }
        };
      }
    }
    const boilerplateWeightMultiplier = boilerplateCoverage >= 0.85
      ? 0.12
      : (boilerplateCoverage >= 0.6 ? 0.35 : 1);

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
        const resolvedPreContext = lineReader.getLines(startLine, prev.endLine);
        preContext = Array.isArray(resolvedPreContext) ? resolvedPreContext : [];
      }
      if (ci + 1 < chunkCount) {
        const next = chunkLineRanges[ci + 1];
        const endLine = Math.min(next.startLine + effectiveContextWin - 1, next.endLine);
        const resolvedPostContext = lineReader.getLines(next.startLine, endLine);
        postContext = Array.isArray(resolvedPostContext) ? resolvedPostContext : [];
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
      fileSize,
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
      analysisPolicy,
      weightMultiplier: boilerplateWeightMultiplier
    });
    chunkPayload.skipPhrasePostings = shouldSkipPhrasePostingsForChunk(
      chunkPayload,
      relKeyLower
    );

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
      parserMode,
      parserReasonCode: parserFallbackProfile.reasonCode,
      parserReason: parserFallbackProfile.reason,
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
