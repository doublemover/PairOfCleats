import util from 'node:util';
import { analyzeComplexity, lintChunk } from '../../../analysis.js';
import { getLanguageForFile } from '../../../language-registry.js';
import { getChunkAuthorsFromLines } from '../../../scm/annotate.js';
import { isJsLike } from '../../../constants.js';
import { detectFrameworkProfile } from '../../../framework-profile.js';
import {
  classifyTokenBuckets,
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

export const createFrameworkProfileResolver = ({ relPath, text, detect = detectFrameworkProfile }) => {
  const cache = new Map();
  return ({ ext }) => {
    const key = String(ext || '');
    if (cache.has(key)) return cache.get(key);
    const profile = detect({
      relPath,
      ext,
      text
    }) || null;
    cache.set(key, profile);
    return profile;
  };
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
  updateCrashStage('process-chunks:start', { totalChunks: sc.length, languageId: containerLanguageId });

  const strictIdentity = analysisPolicy?.identity?.strict !== false;
  const chunkUidNamespaceKey = mode === 'extracted-prose' ? 'repo:extracted-prose' : 'repo';
  let chunkLineRanges = [];
  let vfsManifestRows = null;
  try {
    const prepared = await prepareChunkIds({
      chunks: sc,
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
  const commentAssignments = assignCommentsToChunks(commentEntries, sc);
  const commentRangeAssignments = assignCommentsToChunks(commentRanges, sc);
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
  attachCallDetailsByChunkIndex(callIndex, sc);
  const useWorkerForTokens = tokenMode === 'code'
    && !workerState.tokenWorkerDisabled
    && workerPool
    && workerPool.shouldUseForFile
    ? workerPool.shouldUseForFile(fileStat.size)
    : false;
  const runTokenize = useWorkerForTokens && typeof workerPool?.runTokenize === 'function'
    ? (payload) => (runProc ? runProc(() => workerPool.runTokenize(payload)) : workerPool.runTokenize(payload))
    : null;
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

  const resolvedTypeInferenceEnabled = typeof analysisPolicy?.typeInference?.local?.enabled === 'boolean'
    ? analysisPolicy.typeInference.local.enabled
    : typeInferenceEnabled;
  const resolvedRiskAnalysisEnabled = typeof analysisPolicy?.risk?.enabled === 'boolean'
    ? analysisPolicy.risk.enabled
    : riskAnalysisEnabled;
  const resolveFrameworkProfile = createFrameworkProfileResolver({
    relPath: rel,
    text
  });

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
    const fileFrameworkProfile = resolveFrameworkProfile({ ext: effectiveExt });
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
        context: tokenContext,
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
    if (tokenizeEnabled && tokenizationFileStreamEnabled && tokenText === ctext) {
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
    if (tokenizeEnabled && runTokenize && !pretokenized) {
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
    if (tokenizeEnabled && !tokenPayload) {
      const tokenStart = Date.now();
      updateCrashStage('tokenize', { chunkIndex: ci });
      tokenPayload = tokenizeChunkText({
        text: tokenText,
        mode: chunkMode,
        ext: effectiveExt,
        context: tokenContext,
        languageId: chunkLanguageId,
        pretokenized,
        // chargramTokens is intentionally omitted (see note above).
        buffers: tokenBuffers
      });
      const tokenDurationMs = Date.now() - tokenStart;
      addTokenizeDuration(tokenDurationMs);
      addSettingMetric('tokenize', chunkLanguageId, chunkLineCount, tokenDurationMs);
    }
    if (!tokenizeEnabled) {
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

    const tokenClassificationEnabled = tokenizeEnabled
      && tokenContext?.tokenClassification?.enabled === true
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
        context: tokenContext
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

    if (tokenizationStats && tokenizeEnabled) {
      tokenizationStats.chunks += 1;
      tokenizationStats.tokens += tokens.length;
      tokenizationStats.seq += seq.length;
      // Phrase ngrams and chargrams are computed during postings construction (appendChunk).
      // We don't materialize them during tokenization to avoid large transient allocations.
    }

    if (tokenizeEnabled && !seq.length) continue;

    const docText = typeof docmeta.doc === 'string' ? docmeta.doc : '';

    const complexity = fileComplexity;
    const lint = resolveLintForChunk
      ? resolveLintForChunk(startLine, endLine, ci === 0)
      : fileLint;

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
      emitFieldTokens: tokenizeEnabled,
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
