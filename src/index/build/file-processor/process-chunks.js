import util from 'node:util';
import { analyzeComplexity, lintChunk } from '../../analysis.js';
import { buildChunkRelations, getLanguageForFile } from '../../language-registry.js';
import { detectRiskSignals } from '../../risk.js';
import { inferTypeMetadata } from '../../type-inference.js';
import { getChunkAuthorsFromLines } from '../../git.js';
import { isJsLike } from '../../constants.js';
import { offsetToLine } from '../../../shared/lines.js';
import { buildTokenSequence, createTokenizationBuffers, tokenizeChunkText } from '../tokenization.js';
import { assignCommentsToChunks, getStructuralMatchesForChunk } from './chunk.js';
import { buildChunkPayload } from './assemble.js';
import { attachEmbeddings } from './embeddings.js';
import { formatError, mergeFlowMeta } from './meta.js';
import { truncateByBytes } from './read.js';
import { createLineReader, stripCommentText } from './utils.js';
import { resolveSegmentTokenMode } from '../../segments/config.js';

const assignSpanIndexes = (chunks) => {
  if (!Array.isArray(chunks) || chunks.length < 2) return;
  const groups = new Map();
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const key = [
      chunk.segment?.segmentId || '',
      chunk.start ?? '',
      chunk.end ?? ''
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ chunk, index: i });
  }
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => {
      const kindCmp = String(a.chunk.kind || '').localeCompare(String(b.chunk.kind || ''));
      if (kindCmp) return kindCmp;
      const nameCmp = String(a.chunk.name || '').localeCompare(String(b.chunk.name || ''));
      if (nameCmp) return nameCmp;
      return a.index - b.index;
    });
    for (let i = 0; i < group.length; i += 1) {
      group[i].chunk.spanIndex = i + 1;
    }
  }
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

  const chunkLineRanges = sc.map((chunk) => {
    const startLine = chunk.meta?.startLine ?? offsetToLine(lineIndex, chunk.start);
    const endOffset = chunk.end > chunk.start ? chunk.end - 1 : chunk.start;
    let endLine = chunk.meta?.endLine ?? offsetToLine(lineIndex, endOffset);
    if (endLine < startLine) endLine = startLine;
    return { startLine, endLine };
  });
  assignSpanIndexes(sc);
  const commentAssignments = assignCommentsToChunks(commentEntries, sc);
  const commentRangeAssignments = assignCommentsToChunks(commentRanges, sc);
  const chunks = [];
  const tokenBuffers = createTokenizationBuffers();
  const codeTexts = embeddingEnabled ? [] : null;
  const docTexts = embeddingEnabled ? [] : null;
  if (callIndex?.callDetailsWithRange?.length) {
    const callDetailsByChunkIndex = new Map();
    const chunkRanges = sc
      .map((chunk, index) => ({
        index,
        start: Number.isFinite(chunk?.start) ? chunk.start : null,
        end: Number.isFinite(chunk?.end) ? chunk.end : null,
        span: Number.isFinite(chunk?.start) && Number.isFinite(chunk?.end)
          ? Math.max(0, chunk.end - chunk.start)
          : null
      }))
      .filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end));
    for (const detail of callIndex.callDetailsWithRange) {
      if (!Number.isFinite(detail?.start) || !Number.isFinite(detail?.end)) continue;
      let best = null;
      for (const chunk of chunkRanges) {
        if (detail.start < chunk.start || detail.end > chunk.end) continue;
        if (!best || chunk.span < best.span) best = chunk;
      }
      if (!best) continue;
      const list = callDetailsByChunkIndex.get(best.index) || [];
      list.push(detail);
      callDetailsByChunkIndex.set(best.index, list);
    }
    callIndex.callDetailsByChunkIndex = callDetailsByChunkIndex;
  }
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

    let codeRelations = {}, docmeta = {};
    if (chunkMode === 'code') {
      const relationStart = Date.now();
      try {
        updateCrashStage('docmeta', { chunkIndex: ci, languageId: effectiveLanguageId || null });
        docmeta = activeLang && typeof activeLang.extractDocMeta === 'function'
          ? activeLang.extractDocMeta({
            text,
            chunk: c,
            fileRelations,
            context: activeContext,
            options: languageOptions
          })
          : {};
      } catch (err) {
        return failFile('parse-error', 'docmeta', err, diagnostics);
      }
      if (relationsEnabled && fileRelations) {
        try {
          updateCrashStage('relations', { chunkIndex: ci });
          codeRelations = buildChunkRelations({
            lang: activeLang,
            chunk: c,
            fileRelations,
            callIndex,
            chunkIndex: ci
          });
        } catch (err) {
          return failFile('relation-error', 'chunk-relations', err, diagnostics);
        }
      }
      let flowMeta = null;
      if (activeLang && typeof activeLang.flow === 'function') {
        try {
          updateCrashStage('flow', { chunkIndex: ci });
          const flowStart = Date.now();
          flowMeta = activeLang.flow({
            text,
            chunk: c,
            context: activeContext,
            options: languageOptions
          });
          const flowDurationMs = Date.now() - flowStart;
          if (flowDurationMs > 0) {
            const flowTargets = [];
            if (astDataflowEnabled) flowTargets.push('astDataflow');
            if (controlFlowEnabled) flowTargets.push('controlFlow');
            const flowShareMs = flowTargets.length
              ? flowDurationMs / flowTargets.length
              : 0;
            for (const flowTarget of flowTargets) {
              addSettingMetric(flowTarget, chunkLanguageId, chunkLineCount, flowShareMs);
            }
          }
        } catch (err) {
          return failFile('relation-error', 'flow', err, diagnostics);
        }
      }
      if (flowMeta) {
        docmeta = mergeFlowMeta(docmeta, flowMeta, { astDataflowEnabled, controlFlowEnabled });
      }
      addEnrichDuration(Date.now() - relationStart);
      if (resolvedTypeInferenceEnabled) {
        const enrichStart = Date.now();
        updateCrashStage('type-inference', { chunkIndex: ci });
        const inferredTypes = inferTypeMetadata({
          docmeta,
          chunkText: ctext,
          languageId: effectiveLanguageId || null
        });
        if (inferredTypes) {
          docmeta = { ...docmeta, inferredTypes };
        }
        const typeDurationMs = Date.now() - enrichStart;
        addEnrichDuration(typeDurationMs);
        addSettingMetric('typeInference', chunkLanguageId, chunkLineCount, typeDurationMs);
      }
      if (resolvedRiskAnalysisEnabled) {
        const enrichStart = Date.now();
        updateCrashStage('risk-analysis', { chunkIndex: ci });
        const risk = detectRiskSignals({
          text: ctext,
          chunk: c,
          config: riskConfig,
          languageId: effectiveLanguageId || null
        });
        if (risk) {
          docmeta = { ...docmeta, risk };
        }
        const riskDurationMs = Date.now() - enrichStart;
        addEnrichDuration(riskDurationMs);
        addSettingMetric('riskAnalysis', chunkLanguageId, chunkLineCount, riskDurationMs);
      }
    }

    if (fileStructural) {
      const structural = getStructuralMatchesForChunk(
        fileStructural,
        startLine,
        endLine,
        totalLines
      );
      if (structural) {
        docmeta = { ...docmeta, structural };
      }
    }

    let assignedRanges = [];
    let commentFieldTokens = [];
    if (commentAssignments.size || commentRangeAssignments.size) {
      const assigned = commentAssignments.get(ci) || [];
      assignedRanges = commentRangeAssignments.get(ci) || [];
      if (assigned.length) {
        const chunkStart = c.start;
        const sorted = assigned.slice().sort((a, b) => (
          Math.abs(a.start - chunkStart) - Math.abs(b.start - chunkStart)
        ));
        const maxPerChunk = normalizedCommentsConfig.maxPerChunk;
        const maxBytes = normalizedCommentsConfig.maxBytesPerChunk;
        let totalBytes = 0;
        const metaComments = [];
        const commentRefs = [];
        for (const comment of sorted) {
          if (maxPerChunk && commentRefs.length >= maxPerChunk) break;
          const ref = {
            type: comment.type,
            style: comment.style,
            languageId: comment.languageId || null,
            start: comment.start,
            end: comment.end,
            startLine: comment.startLine,
            endLine: comment.endLine
          };
          commentRefs.push(ref);
          if (chunkMode === 'code') continue;

          const remaining = maxBytes ? Math.max(0, maxBytes - totalBytes) : 0;
          if (maxBytes && remaining <= 0) break;
          const clipped = maxBytes ? truncateByBytes(comment.text, remaining) : {
            text: comment.text,
            truncated: false,
            bytes: Buffer.byteLength(comment.text, 'utf8')
          };
          if (!clipped.text) continue;
          totalBytes += clipped.bytes;
          const includeInTokens = comment.type === 'inline'
            || comment.type === 'block'
            || (comment.type === 'license' && normalizedCommentsConfig.includeLicense);
          if (includeInTokens) {
            const tokens = buildTokenSequence({
              text: clipped.text,
              mode: 'prose',
              ext: effectiveExt,
              dictWords: tokenDictWords,
              dictConfig
            }).tokens;
            if (tokens.length) {
              for (const token of tokens) commentFieldTokens.push(token);
            }
          }
          metaComments.push({
            ...ref,
            text: clipped.text,
            truncated: clipped.truncated || false,
            indexed: includeInTokens,
            anchorChunkId: null
          });
        }
        if (chunkMode === 'code') {
          if (commentRefs.length) {
            docmeta = { ...docmeta, commentRefs };
          }
        } else if (metaComments.length) {
          docmeta = { ...docmeta, comments: metaComments };
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
      stats
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
      dictWords: tokenDictWords,
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
    getChunkEmbedding,
    getChunkEmbeddings,
    runEmbedding,
    embeddingBatchSize,
    fileLanguageId,
    languageOptions
  });
  addEmbeddingDuration(embeddingResult.embeddingMs);

  return { chunks };
};
