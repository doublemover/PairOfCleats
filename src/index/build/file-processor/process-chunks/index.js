import util from 'node:util';
import { analyzeComplexity, lintChunk } from '../../../analysis.js';
import { getLanguageForFile } from '../../../language-registry.js';
import { getChunkAuthorsFromLines } from '../../../git.js';
import { isJsLike } from '../../../constants.js';
import { createTokenizationBuffers, resolveTokenDictWords, tokenizeChunkText } from '../../tokenization.js';
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
    workerPool,
    workerDictOverride,
    workerState,
    tokenizationStats,
    complexityEnabled,
    lintEnabled,
    complexityCache,
    lintCache,
    log,
    logLine,
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
  updateCrashStage('process-chunks:start', { totalChunks: sc.length, languageId: containerLanguageId });

  const strictIdentity = analysisPolicy?.identity?.strict !== false;
  let chunkLineRanges = [];
  let vfsManifestRows = null;
  try {
    const prepared = await prepareChunkIds({
      chunks: sc,
      text,
      relKey,
      containerExt,
      containerLanguageId,
      lineIndex,
      strict: strictIdentity,
      log
    });
    chunkLineRanges = prepared.chunkLineRanges;
    vfsManifestRows = prepared.vfsManifestRows;
  } catch (err) {
    if (failFile) return failFile('identity', 'chunk-uid', err);
    throw err;
  }
  const commentAssignments = assignCommentsToChunks(commentEntries, sc);
  const commentRangeAssignments = assignCommentsToChunks(commentRanges, sc);
  const chunks = [];
  const tokenBuffers = createTokenizationBuffers();
  const codeTexts = embeddingEnabled ? [] : null;
  const docTexts = embeddingEnabled ? [] : null;
  attachCallDetailsByChunkIndex(callIndex, sc);
  const useWorkerForTokens = tokenMode === 'code'
    && !workerState.tokenWorkerDisabled
    && workerPool
    && workerPool.shouldUseForFile
    ? workerPool.shouldUseForFile(fileStat.size)
    : false;
  let fileComplexity = {};
  let fileLint = [];
  if (isJsLike(ext) && mode === 'code') {
    if (complexityEnabled) {
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
    if (lintEnabled) {
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
  const lineReader = contextWin > 0 ? createLineReader(text, lineIndex) : null;

  const resolvedTypeInferenceEnabled = typeof analysisPolicy?.typeInference?.local?.enabled === 'boolean'
    ? analysisPolicy.typeInference.local.enabled
    : typeInferenceEnabled;
  const resolvedRiskAnalysisEnabled = typeof analysisPolicy?.risk?.enabled === 'boolean'
    ? analysisPolicy.risk.enabled
    : riskAnalysisEnabled;

  for (let ci = 0; ci < sc.length; ++ci) {
    const c = sc[ci];
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
    const effectiveLang = getLanguageForFile(effectiveExt, relKey);
    const effectiveLanguageId = effectiveLang?.id || c.segment?.languageId || containerLanguageId || 'unknown';
    const chunkLanguageId = effectiveLanguageId;
    const dictWordsForChunk = resolveTokenDictWords({
      context: tokenContext,
      mode: chunkMode,
      languageId: chunkLanguageId
    });
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
      chunk: c,
      chunkIndex: ci,
      activeLang,
      activeContext,
      languageOptions,
      fileRelations,
      callIndex,
      relationsEnabled,
      fileStructural,
      chunkLineCount,
      chunkLanguageId,
      resolvedTypeInferenceEnabled,
      resolvedRiskAnalysisEnabled,
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
      totalLines
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
          chunkStart: c.start
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
    if (useWorkerForTokens) {
      try {
        const tokenStart = Date.now();
        updateCrashStage('tokenize-worker', { chunkIndex: ci });
        tokenPayload = await workerPool.runTokenize({
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
    if (!tokenPayload) {
      const tokenStart = Date.now();
      updateCrashStage('tokenize', { chunkIndex: ci });
      tokenPayload = tokenizeChunkText({
        text: tokenText,
        mode: chunkMode,
        ext: effectiveExt,
        context: tokenContext,
        languageId: chunkLanguageId,
        // chargramTokens is intentionally omitted (see note above).
        buffers: tokenBuffers
      });
      const tokenDurationMs = Date.now() - tokenStart;
      addTokenizeDuration(tokenDurationMs);
      addSettingMetric('tokenize', chunkLanguageId, chunkLineCount, tokenDurationMs);
    }

    const {
      tokens,
      seq,
      minhashSig,
      stats,
      identifierTokens,
      keywordTokens,
      operatorTokens,
      literalTokens
    } = tokenPayload;

    if (tokenizationStats) {
      tokenizationStats.chunks += 1;
      tokenizationStats.tokens += tokens.length;
      tokenizationStats.seq += seq.length;
      // Phrase ngrams and chargrams are computed during postings construction (appendChunk).
      // We don't materialize them during tokenization to avoid large transient allocations.
    }

    if (!seq.length) continue;

    const docText = typeof docmeta.doc === 'string' ? docmeta.doc : '';

    const complexity = fileComplexity;
    const lint = fileLint;

    let preContext = [], postContext = [];
    if (contextWin > 0 && lineReader) {
      if (ci > 0) {
        const prev = chunkLineRanges[ci - 1];
        const startLine = Math.max(prev.endLine - contextWin + 1, prev.startLine);
        preContext = lineReader.getLines(startLine, prev.endLine);
      }
      if (ci + 1 < sc.length) {
        const next = chunkLineRanges[ci + 1];
        const endLine = Math.min(next.startLine + contextWin - 1, next.endLine);
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
      tokenMode: chunkMode,
      fileRelations,
      relationsEnabled,
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

  return { chunks, vfsManifestRows };
};
