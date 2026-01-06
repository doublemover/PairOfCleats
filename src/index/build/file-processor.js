import fs from 'node:fs/promises';
import util from 'node:util';
import path from 'node:path';
import { analyzeComplexity, lintChunk } from '../analysis.js';
import { chunkSegments, detectFrontmatter, discoverSegments, normalizeSegmentsConfig } from '../segments.js';
import { extractComments, normalizeCommentConfig } from '../comments.js';
import { buildChunkRelations, buildLanguageContext } from '../language-registry.js';
import { detectRiskSignals } from '../risk.js';
import { buildMetaV2 } from '../metadata-v2.js';
import { inferTypeMetadata } from '../type-inference.js';
import { getHeadline } from '../headline.js';
import { getChunkAuthorsFromLines, getGitMetaForFile } from '../git.js';
import { getFieldWeight } from '../field-weighting.js';
import { isJsLike } from '../constants.js';
import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { createLruCache, estimateJsonBytes } from '../../shared/cache.js';
import { toPosix } from '../../shared/files.js';
import { log, logLine } from '../../shared/progress.js';
import { getEnvConfig } from '../../shared/env.js';
import { readTextFileWithHash } from '../../shared/encoding.js';
import { createFileScanner, detectBinary, isMinifiedName, readFileSample } from './file-scan.js';
import { sha1 } from '../../shared/hash.js';
import { buildTokenSequence, createTokenizationBuffers, createTokenizationContext, tokenizeChunkText } from './tokenization.js';
import { applyStructuralMatchesToChunks, assignCommentsToChunks, getStructuralMatchesForChunk } from './file-processor/chunk.js';
import { attachEmbeddings } from './file-processor/embeddings.js';
import { loadCachedBundleForFile, writeBundleForFile } from './file-processor/incremental.js';
import { buildExternalDocs, formatError, mergeFlowMeta } from './file-processor/meta.js';
import { buildCallIndex, buildFileRelations, stripFileRelations } from './file-processor/relations.js';
import { resolveExt, resolveFileCaps, truncateByBytes } from './file-processor/read.js';

/**
 * Create a file processor with shared caches.
 * @param {object} options
 * @returns {{processFile:(abs:string,fileIndex:number)=>Promise<object|null>}}
 */
export function createFileProcessor(options) {
  const {
    root,
    mode,
    dictConfig,
    dictWords,
    languageOptions,
    postingsConfig,
    segmentsConfig,
    commentsConfig,
    allImports,
    contextWin,
    incrementalState,
    getChunkEmbedding,
    getChunkEmbeddings,
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
    fileScan = null,
    skippedFiles = null,
    embeddingEnabled = true,
    toolInfo = null,
    tokenizationStats = null
  } = options;
  const lintEnabled = lintEnabledRaw !== false;
  const complexityEnabled = complexityEnabledRaw !== false;
  const relationsEnabled = relationsEnabledRaw !== false;
  const { astDataflowEnabled, controlFlowEnabled } = languageOptions;
  const ioQueue = queues?.io || null;
  const cpuQueue = queues?.cpu || null;
  const embeddingQueue = queues?.embedding || null;
  const runIo = ioQueue ? (fn) => ioQueue.add(fn) : (fn) => fn();
  const runCpu = cpuQueue && useCpuQueue ? (fn) => cpuQueue.add(fn) : (fn) => fn();
  const runEmbedding = embeddingQueue ? (fn) => embeddingQueue.add(fn) : (fn) => fn();
  const showLineProgress = getEnvConfig().progressLines === true;
  const tokenContext = createTokenizationContext({
    dictWords,
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
  let tokenWorkerDisabled = false;
  let workerTokenizeFailed = false;
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



  /**
   * Process a file: read, chunk, analyze, and produce chunk payloads.
   * @param {string} abs
   * @param {number} fileIndex
   * @returns {Promise<object|null>}
   */
  async function processFile(fileEntry, fileIndex) {
    const abs = typeof fileEntry === 'string' ? fileEntry : fileEntry.abs;      
    const fileStart = Date.now();
    const fileTimings = {
      parseMs: 0,
      tokenizeMs: 0,
      enrichMs: 0,
      embeddingMs: 0
    };
    const relKey = typeof fileEntry === 'object' && fileEntry.rel
      ? fileEntry.rel
      : toPosix(path.relative(root, abs));
    const rel = typeof fileEntry === 'object' && fileEntry.rel
      ? fileEntry.rel.split('/').join(path.sep)
      : path.relative(root, abs);
    const fileStructural = structuralMatches?.get(relKey) || null;
    if (seenFiles) seenFiles.add(relKey);
    const ext = resolveExt(abs);
    let fileLanguageId = null;
    let fileLineCount = 0;
    let fileStat;
    try {
      fileStat = typeof fileEntry === 'object' && fileEntry.stat
        ? fileEntry.stat
        : await runIo(() => fs.stat(abs));
    } catch {
      return null;
    }
    const capsByExt = resolveFileCaps(fileCaps, ext);
    if (capsByExt.maxBytes && fileStat.size > capsByExt.maxBytes) {
      recordSkip(abs, 'oversize', { bytes: fileStat.size, maxBytes: capsByExt.maxBytes });
      return null;
    }
    const scanState = typeof fileEntry === 'object' ? fileEntry.scan : null;
    if (scanState?.skip) {
      const { reason, ...extra } = scanState.skip;
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }
    const baseName = path.basename(abs);
    if (isMinifiedName(baseName)) {
      recordSkip(abs, 'minified', { method: 'name' });
      return null;
    }
    const knownLines = Number(fileEntry?.lines);
    if (capsByExt.maxLines && Number.isFinite(knownLines) && knownLines > capsByExt.maxLines) {
      recordSkip(abs, 'oversize', { lines: knownLines, maxLines: capsByExt.maxLines });
      return null;
    }
    if (!scanState?.checkedBinary || !scanState?.checkedMinified) {
      const scanResult = await runIo(() => fileScanner.scanFile({
        absPath: abs,
        stat: fileStat,
        ext,
        readSample: readFileSample
      }));
      if (scanResult?.skip) {
        const { reason, ...extra } = scanResult.skip;
        recordSkip(abs, reason || 'oversize', extra);
        return null;
      }
    }

    let cachedBundle = null;
    let text = null;
    let fileHash = null;
    let fileBuffer = null;
    const cachedResult = await loadCachedBundleForFile({
      runIo,
      incrementalState,
      absPath: abs,
      relKey,
      fileStat
    });
    cachedBundle = cachedResult.cachedBundle;
    fileHash = cachedResult.fileHash;
    fileBuffer = cachedResult.buffer;

    if (cachedBundle && Array.isArray(cachedBundle.chunks)) {
      const cachedCaps = resolveFileCaps(fileCaps, ext);
      if (cachedCaps.maxLines) {
        const maxLine = cachedBundle.chunks.reduce((max, chunk) => {
          const endLine = Number(chunk?.endLine) || 0;
          return endLine > max ? endLine : max;
        }, 0);
        if (maxLine > cachedCaps.maxLines) {
          recordSkip(abs, 'oversize', { lines: maxLine, maxLines: cachedCaps.maxLines });
          return null;
        }
      }
      const cachedEntry = incrementalState.manifest?.files?.[relKey] || null;
      const manifestEntry = cachedEntry ? {
        hash: fileHash || cachedEntry.hash || null,
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        bundle: cachedEntry.bundle || `${sha1(relKey)}.json`
      } : null;
      let fileRelations = cachedBundle.fileRelations || null;
      if (!fileRelations) {
        const sample = cachedBundle.chunks.find((chunk) => chunk?.codeRelations);
        if (sample?.codeRelations) {
          fileRelations = buildFileRelations(sample.codeRelations);
        }
      }
      if (fileRelations?.imports) {
        const importLinks = fileRelations.imports
          .map((i) => allImports[i])
          .filter((x) => !!x)
          .flat();
        fileRelations = { ...fileRelations, importLinks };
      }
      const updatedChunks = cachedBundle.chunks.map((cachedChunk) => {
        const updatedChunk = { ...cachedChunk };
        if (updatedChunk.codeRelations) {
          updatedChunk.codeRelations = stripFileRelations(updatedChunk.codeRelations);
        }
        if (!updatedChunk.metaV2?.chunkId) {
          updatedChunk.metaV2 = buildMetaV2({
            chunk: updatedChunk,
            docmeta: updatedChunk.docmeta,
            toolInfo
          });
        }
        return updatedChunk;
      });
      applyStructuralMatchesToChunks(updatedChunks, fileStructural);
      const fileDurationMs = Date.now() - fileStart;
      const cachedLanguage = updatedChunks.find((chunk) => chunk?.lang)?.lang
        || null;
      const cachedLines = updatedChunks.reduce((max, chunk) => {
        const endLine = Number(chunk?.endLine) || 0;
        return endLine > max ? endLine : max;
      }, 0);
      return {
        abs,
        relKey,
        fileIndex,
        cached: true,
        durationMs: fileDurationMs,
        chunks: updatedChunks,
        manifestEntry,
        fileRelations,
        fileMetrics: {
          languageId: fileLanguageId || cachedLanguage || null,
          bytes: fileStat.size,
          lines: cachedLines || (Number.isFinite(knownLines) ? knownLines : 0),
          durationMs: fileDurationMs,
          parseMs: 0,
          tokenizeMs: 0,
          enrichMs: 0,
          embeddingMs: 0,
          cached: true
        }
      };
    }

    if (!fileBuffer) {
      try {
        fileBuffer = await runIo(() => fs.readFile(abs));
      } catch (err) {
        recordSkip(abs, 'read-failure', {
          code: err?.code || null,
          message: err?.message || String(err)
        });
        return null;
      }
    }
    if (fileBuffer && fileBuffer.length) {
      const binarySkip = await detectBinary({
        absPath: abs,
        buffer: fileBuffer,
        maxNonTextRatio: fileScanner.binary?.maxNonTextRatio ?? 0.3
      });
      if (binarySkip) {
        const { reason, ...extra } = binarySkip;
        recordSkip(abs, reason || 'binary', extra);
        return null;
      }
    }
    if (!text || !fileHash) {
      const decoded = await readTextFileWithHash(abs, { buffer: fileBuffer });
      if (!text) text = decoded.text;
      if (!fileHash) fileHash = decoded.hash;
    }

    const { chunks: fileChunks, fileRelations, skip } = await runCpu(async () => {
      const languageContextOptions = languageOptions && typeof languageOptions === 'object'
        ? { ...languageOptions, relationsEnabled }
        : { relationsEnabled };
      const { lang, context: languageContext } = await buildLanguageContext({
        ext,
        relPath: relKey,
        mode,
        text,
        options: languageContextOptions
      });
      fileLanguageId = lang?.id || null;
      const tokenMode = mode === 'extracted-prose' ? 'prose' : mode;
      const lineIndex = buildLineIndex(text);
      const totalLines = lineIndex.length || 1;
      fileLineCount = totalLines;
      const fileLines = contextWin > 0 ? text.split('\n') : null;
      const capsByLanguage = resolveFileCaps(fileCaps, ext, lang?.id);
      if (capsByLanguage.maxLines && totalLines > capsByLanguage.maxLines) {
        return {
          chunks: [],
          fileRelations: null,
          skip: { reason: 'oversize', lines: totalLines, maxLines: capsByLanguage.maxLines }
        };
      }
      let lastLineLogged = 0;
      let lastLineLogMs = 0;
      const rawRelations = (mode === 'code' && relationsEnabled && lang && typeof lang.buildRelations === 'function')
        ? lang.buildRelations({
          text,
          relPath: relKey,
          allImports,
          context: languageContext,
          options: languageOptions
        })
        : null;
      const fileRelations = relationsEnabled ? buildFileRelations(rawRelations) : null;
      const callIndex = relationsEnabled ? buildCallIndex(rawRelations) : null;
      const gitMeta = await runIo(() => getGitMetaForFile(relKey, {
        blame: gitBlameEnabled,
        baseDir: root
      }));
      const lineAuthors = Array.isArray(gitMeta?.lineAuthors)
        ? gitMeta.lineAuthors
        : null;
      const fileGitMeta = gitMeta && typeof gitMeta === 'object'
        ? Object.fromEntries(Object.entries(gitMeta).filter(([key]) => key !== 'lineAuthors'))
        : {};
      const commentsEnabled = (mode === 'code' || mode === 'extracted-prose')
        && normalizedCommentsConfig.extract !== 'off';
      const parseStart = Date.now();
      const commentData = commentsEnabled
        ? extractComments({
          text,
          ext,
          languageId: lang?.id || null,
          lineIndex,
          config: normalizedCommentsConfig
        })
        : { comments: [], configSegments: [] };
      const commentEntries = [];
      const commentSegments = [];
      if (commentsEnabled && Array.isArray(commentData.comments)) {
        for (const comment of commentData.comments) {
          const commentTokens = buildTokenSequence({
            text: comment.text,
            mode: 'prose',
            ext,
            dictWords,
            dictConfig
          }).tokens;
          if (commentTokens.length < normalizedCommentsConfig.minTokens) continue;
          const entry = { ...comment, tokens: commentTokens };
          commentEntries.push(entry);
          if (comment.type !== 'license' || normalizedCommentsConfig.includeLicense) {
            commentSegments.push({
              type: 'comment',
              languageId: lang?.id || null,
              start: comment.start,
              end: comment.end,
              parentSegmentId: null,
              embeddingContext: 'prose',
              meta: {
                commentType: comment.type,
                commentStyle: comment.style
              }
            });
          }
        }
      }
      const extraSegments = [];
      if (commentSegments.length) extraSegments.push(...commentSegments);
      if (Array.isArray(commentData.configSegments) && commentData.configSegments.length) {
        extraSegments.push(...commentData.configSegments);
      }
      if (mode === 'extracted-prose' && (ext === '.md' || ext === '.mdx')) {
        const frontmatter = detectFrontmatter(text);
        if (frontmatter) {
          extraSegments.push({
            type: 'prose',
            languageId: 'markdown',
            start: frontmatter.start,
            end: frontmatter.end,
            parentSegmentId: null,
            embeddingContext: 'prose',
            meta: { frontmatter: true }
          });
        }
      }
      const resolvedSegmentsConfig = mode === 'extracted-prose'
        ? { ...normalizedSegmentsConfig, onlyExtras: true }
        : normalizedSegmentsConfig;
      const segments = discoverSegments({
        text,
        ext,
        relPath: relKey,
        mode,
        languageId: lang?.id || null,
        context: languageContext,
        segmentsConfig: resolvedSegmentsConfig,
        extraSegments
      });
      const sc = chunkSegments({
        text,
        ext,
        relPath: relKey,
        mode,
        segments,
        lineIndex,
        context: {
          ...languageContext,
          yamlChunking: languageOptions?.yamlChunking,
          chunking: languageOptions?.chunking,
          javascript: languageOptions?.javascript,
          typescript: languageOptions?.typescript,
          treeSitter: languageOptions?.treeSitter,
          log: languageOptions?.log
        }
      });
      fileTimings.parseMs += Date.now() - parseStart;
      const chunkLineRanges = sc.map((chunk) => {
        const startLine = chunk.meta?.startLine ?? offsetToLine(lineIndex, chunk.start);
        const endOffset = chunk.end > chunk.start ? chunk.end - 1 : chunk.start;
        let endLine = chunk.meta?.endLine ?? offsetToLine(lineIndex, endOffset);
        if (endLine < startLine) endLine = startLine;
        return { startLine, endLine };
      });
      const commentAssignments = assignCommentsToChunks(commentEntries, sc);
      const chunks = [];
      const tokenBuffers = createTokenizationBuffers();
      const codeTexts = embeddingEnabled ? [] : null;
      const docTexts = embeddingEnabled ? [] : null;
      const useWorkerForTokens = tokenMode === 'code'
        && !tokenWorkerDisabled
        && workerPool
        && workerPool.shouldUseForFile
        ? workerPool.shouldUseForFile(fileStat.size)
        : false;

      for (let ci = 0; ci < sc.length; ++ci) {
        const c = sc[ci];
        const ctext = text.slice(c.start, c.end);
        if (showLineProgress) {
          const currentLine = chunkLineRanges[ci]?.endLine ?? totalLines;
          const now = Date.now();
          const shouldLog = currentLine >= totalLines
            || currentLine - lastLineLogged >= 200
            || now - lastLineLogMs >= 1000;
          if (shouldLog && currentLine > lastLineLogged) {
            lastLineLogged = currentLine;
            lastLineLogMs = now;
            logLine(`Line ${currentLine}/${totalLines}`);
          }
        }

        let codeRelations = {}, docmeta = {};
        if (mode === 'code') {
          const relationStart = Date.now();
          docmeta = lang && typeof lang.extractDocMeta === 'function'
            ? lang.extractDocMeta({
              text,
              chunk: c,
              fileRelations,
              context: languageContext,
              options: languageOptions
            })
            : {};
          if (relationsEnabled && fileRelations) {
            codeRelations = buildChunkRelations({
              lang,
              chunk: c,
              fileRelations,
              callIndex
            });
          }
          const flowMeta = lang && typeof lang.flow === 'function'
            ? lang.flow({
              text,
              chunk: c,
              context: languageContext,
              options: languageOptions
            })
            : null;
          if (flowMeta) {
          docmeta = mergeFlowMeta(docmeta, flowMeta, { astDataflowEnabled, controlFlowEnabled });
          }
          fileTimings.parseMs += Date.now() - relationStart;
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
            fileTimings.enrichMs += Date.now() - enrichStart;
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
            fileTimings.enrichMs += Date.now() - enrichStart;
          }
        }

        const { startLine, endLine } = chunkLineRanges[ci];
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

        let commentFieldTokens = [];
        if (commentAssignments.size) {
          const assigned = commentAssignments.get(ci) || [];
          if (assigned.length) {
            const chunkStart = c.start;
            const sorted = assigned.slice().sort((a, b) => (
              Math.abs(a.start - chunkStart) - Math.abs(b.start - chunkStart)
            ));
            const maxPerChunk = normalizedCommentsConfig.maxPerChunk;
            const maxBytes = normalizedCommentsConfig.maxBytesPerChunk;
            let totalBytes = 0;
            const metaComments = [];
            for (const comment of sorted) {
              if (maxPerChunk && metaComments.length >= maxPerChunk) break;
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
                  dictWords,
                  dictConfig
                }).tokens;
                if (tokens.length) commentFieldTokens = commentFieldTokens.concat(tokens);
              }
              metaComments.push({
                type: comment.type,
                style: comment.style,
                languageId: comment.languageId || null,
                start: comment.start,
                end: comment.end,
                startLine: comment.startLine,
                endLine: comment.endLine,
                text: clipped.text,
                truncated: clipped.truncated || false,
                indexed: includeInTokens,
                anchorChunkId: null
              });
            }
            if (metaComments.length) {
              docmeta = { ...docmeta, comments: metaComments };
            }
          }
        }

        let fieldChargramTokens = null;
        if (tokenContext.chargramSource === 'fields') {
          const fieldText = [c.name, docmeta?.doc].filter(Boolean).join(' ');
          if (fieldText) {
            const fieldSeq = buildTokenSequence({
              text: fieldText,
              mode: tokenMode,
              ext,
              dictWords,
              dictConfig
            }).seq;
            if (fieldSeq.length) fieldChargramTokens = fieldSeq;
          }
        }

        let tokenPayload = null;
        if (useWorkerForTokens) {
          try {
            const tokenStart = Date.now();
            tokenPayload = await workerPool.runTokenize({
              text: ctext,
              mode: tokenMode,
              ext,
              file: relKey,
              size: fileStat.size,
              chargramTokens: fieldChargramTokens,
              ...(workerDictOverride ? { dictConfig: workerDictOverride } : {})
            });
            fileTimings.tokenizeMs += Date.now() - tokenStart;
          } catch (err) {
            if (!workerTokenizeFailed) {
              const message = formatError(err);
              const detail = err?.stack || err?.cause || null;
              log(`Worker tokenization failed; falling back to main thread. ${message}`);
              if (detail) log(`Worker tokenization detail: ${detail}`);
              workerTokenizeFailed = true;
            }
            tokenWorkerDisabled = true;
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
            text: ctext,
            mode: tokenMode,
            ext,
            context: tokenContext,
            chargramTokens: fieldChargramTokens,
            buffers: tokenBuffers
          });
          fileTimings.tokenizeMs += Date.now() - tokenStart;
        }

        const {
          tokens,
          seq,
          ngrams,
          chargrams,
          minhashSig,
          stats
        } = tokenPayload;

        if (tokenizationStats) {
          tokenizationStats.chunks += 1;
          tokenizationStats.tokens += tokens.length;
          tokenizationStats.seq += seq.length;
          tokenizationStats.ngrams += Array.isArray(ngrams) ? ngrams.length : 0;
          tokenizationStats.chargrams += Array.isArray(chargrams) ? chargrams.length : 0;
        }

        if (!seq.length) continue;

        const weight = getFieldWeight(c, rel);

        const docText = typeof docmeta.doc === 'string' ? docmeta.doc : '';
        const fieldedEnabled = postingsConfig?.fielded !== false;
        const fieldTokens = fieldedEnabled ? {
          name: c.name ? buildTokenSequence({ text: c.name, mode: tokenMode, ext, dictWords, dictConfig }).tokens : [],
          signature: docmeta?.signature
            ? buildTokenSequence({ text: docmeta.signature, mode: tokenMode, ext, dictWords, dictConfig }).tokens
            : [],
          doc: docText
            ? buildTokenSequence({ text: docText, mode: tokenMode, ext, dictWords, dictConfig }).tokens
            : [],
          comment: commentFieldTokens,
          body: tokens
        } : null;

        let complexity = {}, lint = [];
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
              fileTimings.enrichMs += Date.now() - enrichStart;
            }
            complexity = cachedComplexity || {};
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
              fileTimings.enrichMs += Date.now() - enrichStart;
            }
            lint = cachedLint || [];
          }
        }

        const headline = getHeadline(c, tokens);

        let preContext = [], postContext = [];
        if (contextWin > 0 && fileLines) {
          if (ci > 0) {
            const prev = chunkLineRanges[ci - 1];
            const startIdx = Math.max(0, prev.startLine - 1);
            const endIdx = Math.min(fileLines.length, prev.endLine);
            preContext = fileLines.slice(startIdx, endIdx).slice(-contextWin);
          }
          if (ci + 1 < sc.length) {
            const next = chunkLineRanges[ci + 1];
            const startIdx = Math.max(0, next.startLine - 1);
            const endIdx = Math.min(fileLines.length, next.endLine);
            postContext = fileLines.slice(startIdx, endIdx).slice(0, contextWin);
          }
        }
        const chunkAuthors = lineAuthors
          ? getChunkAuthorsFromLines(lineAuthors, startLine, endLine)
          : [];
        const gitMeta = {
          ...fileGitMeta,
          ...(chunkAuthors.length ? { chunk_authors: chunkAuthors } : {})
        };

        const externalDocs = relationsEnabled
          ? buildExternalDocs(ext, fileRelations?.imports)
          : [];

        const chunkPayload = {
          file: relKey,
          ext,
          lang: fileLanguageId || lang?.id || null,
          segment: c.segment || null,
          start: c.start,
          end: c.end,
          startLine,
          endLine,
          kind: c.kind,
          name: c.name,
          tokens,
          seq,
          ngrams,
          chargrams,
          codeRelations,
          docmeta,
          stats,
          complexity,
          lint,
          headline,
          preContext,
          postContext,
          embedding: [],
          embed_doc: [],
          embed_code: [],
          minhashSig,
          ...(fieldTokens ? { fieldTokens } : {}),
          weight,
          ...gitMeta,
          externalDocs
        };
        chunkPayload.metaV2 = buildMetaV2({
          chunk: chunkPayload,
          docmeta,
          toolInfo
        });

        chunks.push(chunkPayload);
        if (embeddingEnabled && codeTexts && docTexts) {
          codeTexts.push(ctext);
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
      fileTimings.embeddingMs += embeddingResult.embeddingMs;

      return { chunks, fileRelations, skip: null };
    });
    if (skip) {
      const { reason, ...extra } = skip;
      recordSkip(abs, reason || 'oversize', extra);
      return null;
    }

    const manifestEntry = await writeBundleForFile({
      runIo,
      incrementalState,
      relKey,
      fileStat,
      fileHash,
      fileChunks,
      fileRelations
    });

    const fileDurationMs = Date.now() - fileStart;
    const fileMetrics = {
      languageId: fileLanguageId || null,
      bytes: fileStat.size,
      lines: fileLineCount,
      durationMs: fileDurationMs,
      parseMs: fileTimings.parseMs,
      tokenizeMs: fileTimings.tokenizeMs,
      enrichMs: fileTimings.enrichMs,
      embeddingMs: fileTimings.embeddingMs,
      cached: false
    };
    return {
      abs,
      relKey,
      fileIndex,
      cached: false,
      durationMs: fileDurationMs,
      chunks: fileChunks,
      fileRelations,
      manifestEntry,
      fileMetrics
    };
  }

  return { processFile };
}
