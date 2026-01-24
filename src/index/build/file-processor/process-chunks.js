import util from 'node:util';
import { analyzeComplexity, lintChunk } from '../../analysis.js';
import { buildChunkRelations } from '../../language-registry.js';
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
    failFile
  } = context;

  const chunkLineRanges = sc.map((chunk) => {
    const startLine = chunk.meta?.startLine ?? offsetToLine(lineIndex, chunk.start);
    const endOffset = chunk.end > chunk.start ? chunk.end - 1 : chunk.start;
    let endLine = chunk.meta?.endLine ?? offsetToLine(lineIndex, endOffset);
    if (endLine < startLine) endLine = startLine;
    return { startLine, endLine };
  });
  const commentAssignments = assignCommentsToChunks(commentEntries, sc);
  const commentRangeAssignments = assignCommentsToChunks(commentRanges, sc);
  const chunks = [];
  const tokenBuffers = createTokenizationBuffers();
  const codeTexts = embeddingEnabled ? [] : null;
  const docTexts = embeddingEnabled ? [] : null;
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

  for (let ci = 0; ci < sc.length; ++ci) {
    const c = sc[ci];
    const ctext = text.slice(c.start, c.end);
    let tokenText = ctext;
    const lineRange = chunkLineRanges[ci] || { startLine: 1, endLine: fileLineCount || 1 };
    const startLine = lineRange.startLine;
    const endLine = lineRange.endLine;
    const chunkLineCount = Math.max(1, endLine - startLine + 1);
    const chunkLanguageId = c.segment?.languageId || fileLanguageId || lang?.id || 'unknown';
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
    if (mode === 'code') {
      const relationStart = Date.now();
      try {
        docmeta = lang && typeof lang.extractDocMeta === 'function'
          ? lang.extractDocMeta({
            text,
            chunk: c,
            fileRelations,
            context: languageContext,
            options: languageOptions
          })
          : {};
      } catch (err) {
        return failFile('parse-error', 'docmeta', err);
      }
      if (relationsEnabled && fileRelations) {
        try {
          codeRelations = buildChunkRelations({
            lang,
            chunk: c,
            fileRelations,
            callIndex
          });
        } catch (err) {
          return failFile('relation-error', 'chunk-relations', err);
        }
      }
      let flowMeta = null;
      if (lang && typeof lang.flow === 'function') {
        try {
          const flowStart = Date.now();
          flowMeta = lang.flow({
            text,
            chunk: c,
            context: languageContext,
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
          return failFile('relation-error', 'flow', err);
        }
      }
      if (flowMeta) {
        docmeta = mergeFlowMeta(docmeta, flowMeta, { astDataflowEnabled, controlFlowEnabled });
      }
      addEnrichDuration(Date.now() - relationStart);
      if (typeInferenceEnabled) {
        const enrichStart = Date.now();
        const inferredTypes = inferTypeMetadata({
          docmeta,
          chunkText: ctext,
          languageId: lang?.id || null
        });
        if (inferredTypes) {
          docmeta = { ...docmeta, inferredTypes };
        }
        const typeDurationMs = Date.now() - enrichStart;
        addEnrichDuration(typeDurationMs);
        addSettingMetric('typeInference', chunkLanguageId, chunkLineCount, typeDurationMs);
      }
      if (riskAnalysisEnabled) {
        const enrichStart = Date.now();
        const risk = detectRiskSignals({
          text: ctext,
          chunk: c,
          config: riskConfig,
          languageId: lang?.id || null
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

          if (mode === 'code') continue;

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
              ext,
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
        if (mode === 'code') {
          if (commentRefs.length) {
            docmeta = { ...docmeta, commentRefs };
          }
        } else if (metaComments.length) {
          docmeta = { ...docmeta, comments: metaComments };
        }
      }
    }
    if (mode === 'code' && normalizedCommentsConfig.includeInCode !== true && assignedRanges.length) {
      tokenText = stripCommentText(ctext, c.start, assignedRanges);
    }

    // Chargrams are built during postings construction (appendChunk), where we can
    // honor postingsConfig.chargramSource without duplicating tokenization work here.
    const fieldChargramTokens = null;

    let tokenPayload = null;
    if (useWorkerForTokens) {
      try {
        const tokenStart = Date.now();
        tokenPayload = await workerPool.runTokenize({
          text: tokenText,
          mode: tokenMode,
          ext,
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
      tokenPayload = tokenizeChunkText({
        text: tokenText,
        mode: tokenMode,
        ext,
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
      ext,
      languageId: fileLanguageId || lang?.id || null,
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
      tokenMode,
      fileRelations,
      relationsEnabled,
      toolInfo,
      gitMeta
    });

    chunks.push(chunkPayload);
    if (embeddingEnabled && codeTexts && docTexts) {
      codeTexts.push(tokenText);
      docTexts.push(docText.trim() ? docText : '');
    }
  }

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
