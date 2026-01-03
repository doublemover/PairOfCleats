import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeComplexity, lintChunk } from '../analysis.js';
import { smartChunk } from '../chunking.js';
import { buildChunkRelations, buildLanguageContext } from '../language-registry.js';
import { detectRiskSignals } from '../risk.js';
import { inferTypeMetadata } from '../type-inference.js';
import { getHeadline } from '../headline.js';
import { getChunkAuthorsFromLines, getGitMetaForFile } from '../git.js';
import { getFieldWeight } from '../field-weighting.js';
import { isGo, isJsLike, isSpecialCodeFile } from '../constants.js';
import { normalizeVec } from '../embedding.js';
import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { createLruCache, estimateJsonBytes } from '../../shared/cache.js';
import { fileExt, toPosix } from '../../shared/files.js';
import { log } from '../../shared/progress.js';
import { readCachedBundle, writeIncrementalBundle } from './incremental.js';
import { sha1 } from '../../shared/hash.js';
import { createTokenizationContext, tokenizeChunkText } from './tokenization.js';

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
    allImports,
    contextWin,
    incrementalState,
    getChunkEmbedding,
    getChunkEmbeddings,
    typeInferenceEnabled,
    riskAnalysisEnabled,
    seenFiles,
    gitBlameEnabled,
    lintEnabled: lintEnabledRaw,
    complexityEnabled: complexityEnabledRaw,
    cacheConfig,
    cacheReporter,
    queues,
    useCpuQueue = true,
    workerPool = null,
    embeddingBatchSize = 0
  } = options;
  const lintEnabled = lintEnabledRaw !== false;
  const complexityEnabled = complexityEnabledRaw !== false;
  const { astDataflowEnabled, controlFlowEnabled } = languageOptions;
  const ioQueue = queues?.io || null;
  const cpuQueue = queues?.cpu || null;
  const runIo = ioQueue ? (fn) => ioQueue.add(fn) : (fn) => fn();
  const runCpu = cpuQueue && useCpuQueue ? (fn) => cpuQueue.add(fn) : (fn) => fn();
  const tokenContext = createTokenizationContext({
    dictWords,
    dictConfig,
    postingsConfig
  });
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

  const resolveExt = (absPath) => {
    const baseName = path.basename(absPath);
    const rawExt = fileExt(absPath);
    return rawExt || (isSpecialCodeFile(baseName)
      ? (baseName.toLowerCase() === 'dockerfile' ? '.dockerfile' : '.makefile')
      : rawExt);
  };

  const mergeFlowMeta = (docmeta, flowMeta) => {
    if (!flowMeta) return docmeta;
    const output = docmeta && typeof docmeta === 'object' ? docmeta : {};
    if (controlFlowEnabled && flowMeta.controlFlow && output.controlFlow == null) {
      output.controlFlow = flowMeta.controlFlow;
    }
    if (astDataflowEnabled) {
      if (flowMeta.dataflow && output.dataflow == null) output.dataflow = flowMeta.dataflow;
      if (flowMeta.throws && output.throws === undefined) output.throws = flowMeta.throws;
      if (flowMeta.awaits && output.awaits === undefined) output.awaits = flowMeta.awaits;
      if (typeof flowMeta.yields === 'boolean' && output.yields === undefined) output.yields = flowMeta.yields;
      if (typeof flowMeta.returnsValue === 'boolean') {
        const shouldOverride = output.returnsValue === undefined || (output.returnsValue === false && flowMeta.returnsValue);
        if (shouldOverride) {
          output.returnsValue = flowMeta.returnsValue;
        }
      }
    }
    return output;
  };

  const buildExternalDocs = (ext, imports) => {
    const externalDocs = [];
    if (!imports || !imports.length) return externalDocs;
    const isPython = ext === '.py';
    const isNode = isJsLike(ext);
    const isGoLang = isGo(ext);
    for (const mod of imports) {
      if (mod.startsWith('.')) continue;
      if (isPython) {
        const base = mod.split('.')[0];
        if (base) externalDocs.push(`https://pypi.org/project/${base}`);
      } else if (isNode) {
        const encoded = mod
          .split('/')
          .map((segment) => encodeURIComponent(segment).replace(/%40/g, '@'))
          .join('/');
        externalDocs.push(`https://www.npmjs.com/package/${encoded}`);
      } else if (isGoLang) {
        externalDocs.push(`https://pkg.go.dev/${mod}`);
      }
    }
    return externalDocs;
  };

  const buildCallIndex = (relations) => {
    if (!relations) return null;
    const callsByCaller = new Map();
    if (Array.isArray(relations.calls)) {
      for (const entry of relations.calls) {
        if (!entry || entry.length < 2) continue;
        const caller = entry[0];
        if (!caller) continue;
        const list = callsByCaller.get(caller) || [];
        list.push(entry);
        callsByCaller.set(caller, list);
      }
    }
    const callDetailsByCaller = new Map();
    if (Array.isArray(relations.callDetails)) {
      for (const detail of relations.callDetails) {
        const caller = detail?.caller;
        if (!caller) continue;
        const list = callDetailsByCaller.get(caller) || [];
        list.push(detail);
        callDetailsByCaller.set(caller, list);
      }
    }
    return { callsByCaller, callDetailsByCaller };
  };

  const buildFileRelations = (relations) => {
    if (!relations) return null;
    return {
      imports: Array.isArray(relations.imports) ? relations.imports : [],
      exports: Array.isArray(relations.exports) ? relations.exports : [],
      usages: Array.isArray(relations.usages) ? relations.usages : [],
      importLinks: Array.isArray(relations.importLinks) ? relations.importLinks : [],
      functionMeta: relations.functionMeta && typeof relations.functionMeta === 'object'
        ? relations.functionMeta
        : {},
      classMeta: relations.classMeta && typeof relations.classMeta === 'object'
        ? relations.classMeta
        : {}
    };
  };

  const stripFileRelations = (codeRelations) => {
    if (!codeRelations || typeof codeRelations !== 'object') return codeRelations;
    const {
      imports,
      exports,
      usages,
      importLinks,
      functionMeta,
      classMeta,
      ...rest
    } = codeRelations;
    return rest;
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
    const relKey = typeof fileEntry === 'object' && fileEntry.rel
      ? fileEntry.rel
      : toPosix(path.relative(root, abs));
    const rel = typeof fileEntry === 'object' && fileEntry.rel
      ? fileEntry.rel.split('/').join(path.sep)
      : path.relative(root, abs);
    if (seenFiles) seenFiles.add(relKey);
    const ext = resolveExt(abs);
    let fileStat;
    try {
      fileStat = typeof fileEntry === 'object' && fileEntry.stat
        ? fileEntry.stat
        : await runIo(() => fs.stat(abs));
    } catch {
      return null;
    }

    let cachedBundle = null;
    let text = null;
    let fileHash = null;
    const cachedResult = await runIo(() => readCachedBundle({
      enabled: incrementalState.enabled,
      absPath: abs,
      relKey,
      fileStat,
      manifest: incrementalState.manifest,
      bundleDir: incrementalState.bundleDir
    }));
    cachedBundle = cachedResult.cachedBundle;
    text = cachedResult.text;
    fileHash = cachedResult.fileHash;

    if (cachedBundle && Array.isArray(cachedBundle.chunks)) {
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
        return updatedChunk;
      });
      const fileDurationMs = Date.now() - fileStart;
      return {
        abs,
        relKey,
        fileIndex,
        cached: true,
        durationMs: fileDurationMs,
        chunks: updatedChunks,
        manifestEntry,
        fileRelations
      };
    }

    if (!text) {
      try {
        text = await runIo(() => fs.readFile(abs, 'utf8'));
      } catch {
        return null;
      }
    }
    if (!fileHash) fileHash = await runCpu(() => sha1(text));

    const fileChunks = await runCpu(async () => {
      const { lang, context: languageContext } = await buildLanguageContext({
        ext,
        relPath: relKey,
        mode,
        text,
        options: languageOptions
      });
      const lineIndex = buildLineIndex(text);
      const fileLines = text.split('\n');
      const rawRelations = (mode === 'code' && lang && typeof lang.buildRelations === 'function')
        ? lang.buildRelations({
          text,
          relPath: relKey,
          allImports,
          context: languageContext,
          options: languageOptions
        })
        : null;
      const fileRelations = buildFileRelations(rawRelations);
      const callIndex = buildCallIndex(rawRelations);
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
      const sc = smartChunk({
        text,
        ext,
        relPath: relKey,
        mode,
        context: {
          ...languageContext,
          yamlChunking: languageOptions?.yamlChunking,
          javascript: languageOptions?.javascript,
          typescript: languageOptions?.typescript,
          treeSitter: languageOptions?.treeSitter,
          log: languageOptions?.log
        }
      });
      const chunkLineRanges = sc.map((chunk) => {
        const startLine = chunk.meta?.startLine ?? offsetToLine(lineIndex, chunk.start);
        const endOffset = chunk.end > chunk.start ? chunk.end - 1 : chunk.start;
        let endLine = chunk.meta?.endLine ?? offsetToLine(lineIndex, endOffset);
        if (endLine < startLine) endLine = startLine;
        return { startLine, endLine };
      });
      const chunks = [];
      const codeTexts = [];
      const docTexts = [];
      const useWorkerForTokens = workerPool && workerPool.shouldUseForFile
        ? workerPool.shouldUseForFile(fileStat.size)
        : false;

      for (let ci = 0; ci < sc.length; ++ci) {
        const c = sc[ci];
        const ctext = text.slice(c.start, c.end);

        let tokenPayload = null;
        if (useWorkerForTokens) {
          try {
            tokenPayload = await workerPool.runTokenize({
              text: ctext,
              mode,
              ext
            });
          } catch (err) {
            if (!workerTokenizeFailed) {
              log(`Worker tokenization failed; falling back to main thread. ${err?.message || err}`);
              workerTokenizeFailed = true;
            }
          }
        }
        if (!tokenPayload) {
          tokenPayload = tokenizeChunkText({
            text: ctext,
            mode,
            ext,
            context: tokenContext
          });
        }

        const {
          tokens,
          seq,
          ngrams,
          chargrams,
          minhashSig,
          stats
        } = tokenPayload;

        if (!seq.length) continue;

        const weight = getFieldWeight(c, rel);

        let codeRelations = {}, docmeta = {};
        if (mode === 'code') {
          docmeta = lang && typeof lang.extractDocMeta === 'function'
            ? lang.extractDocMeta({
              text,
              chunk: c,
              fileRelations,
              context: languageContext,
              options: languageOptions
            })
            : {};
          if (fileRelations) {
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
            docmeta = mergeFlowMeta(docmeta, flowMeta);
          }
          if (typeInferenceEnabled) {
            const inferredTypes = inferTypeMetadata({
              docmeta,
              chunkText: ctext,
              languageId: lang?.id || null
            });
            if (inferredTypes) {
              docmeta = { ...docmeta, inferredTypes };
            }
          }
          if (riskAnalysisEnabled) {
            const risk = detectRiskSignals({ text: ctext });
            if (risk) {
              docmeta = { ...docmeta, risk };
            }
          }
        }

        let complexity = {}, lint = [];
        if (isJsLike(ext) && mode === 'code') {
          if (complexityEnabled) {
            const cacheKey = fileHash ? `${rel}:${fileHash}` : rel;
            let cachedComplexity = complexityCache.get(cacheKey);
            if (!cachedComplexity) {
              const fullCode = text;
              const compResult = await analyzeComplexity(fullCode, rel);
              complexityCache.set(cacheKey, compResult);
              cachedComplexity = compResult;
            }
            complexity = cachedComplexity || {};
          }

          if (lintEnabled) {
            const cacheKey = fileHash ? `${rel}:${fileHash}` : rel;
            let cachedLint = lintCache.get(cacheKey);
            if (!cachedLint) {
              const fullCode = text;
              const lintResult = await lintChunk(fullCode, rel);
              lintCache.set(cacheKey, lintResult);
              cachedLint = lintResult;
            }
            lint = cachedLint || [];
          }
        }

        const docText = typeof docmeta.doc === 'string' ? docmeta.doc : '';

        const headline = getHeadline(c, tokens);

        let preContext = [], postContext = [];
        const { startLine, endLine } = chunkLineRanges[ci];
        if (contextWin > 0) {
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

        const externalDocs = buildExternalDocs(ext, fileRelations?.imports);

        const chunkPayload = {
          file: relKey,
          ext,
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
          weight,
          ...gitMeta,
          externalDocs
        };

        chunks.push(chunkPayload);
        codeTexts.push(ctext);
        docTexts.push(docText.trim() ? docText : '');
      }

      const embedBatch = async (texts) => {
        if (!texts.length) return [];
        if (typeof getChunkEmbeddings === 'function') {
          return getChunkEmbeddings(texts);
        }
        const out = [];
        for (const text of texts) {
          out.push(await getChunkEmbedding(text));
        }
        return out;
      };

      const runBatched = async (texts) => {
        if (!texts.length) return [];
        const batchSize = Number.isFinite(embeddingBatchSize) ? embeddingBatchSize : 0;
        if (!batchSize || texts.length <= batchSize) {
          return embedBatch(texts);
        }
        const out = [];
        for (let i = 0; i < texts.length; i += batchSize) {
          const slice = texts.slice(i, i + batchSize);
          const batch = await embedBatch(slice);
          out.push(...batch);
        }
        return out;
      };

      let codeVectors = await runBatched(codeTexts);
      if (!Array.isArray(codeVectors) || codeVectors.length !== chunks.length) {
        codeVectors = [];
        for (const text of codeTexts) {
          codeVectors.push(await getChunkEmbedding(text));
        }
      }

      const docVectors = new Array(chunks.length).fill(null);
      const docIndexes = [];
      const docPayloads = [];
      for (let i = 0; i < docTexts.length; i += 1) {
        if (docTexts[i]) {
          docIndexes.push(i);
          docPayloads.push(docTexts[i]);
        }
      }
      if (docPayloads.length) {
        const embeddedDocs = await runBatched(docPayloads);
        for (let i = 0; i < docIndexes.length; i += 1) {
          docVectors[docIndexes[i]] = embeddedDocs[i] || null;
        }
      }

      const dims = Array.isArray(codeVectors[0]) ? codeVectors[0].length : 0;
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        const embedCode = Array.isArray(codeVectors[i]) ? codeVectors[i] : [];
        const embedDoc = Array.isArray(docVectors[i])
          ? docVectors[i]
          : (dims ? Array.from({ length: dims }, () => 0) : []);
        const merged = embedCode.length
          ? embedCode.map((v, idx) => (v + (embedDoc[idx] ?? 0)) / 2)
          : embedDoc;
        chunk.embed_code = embedCode;
        chunk.embed_doc = embedDoc;
        chunk.embedding = normalizeVec(merged);
      }

      return chunks;
    });

    const manifestEntry = await runIo(() => writeIncrementalBundle({
      enabled: incrementalState.enabled,
      bundleDir: incrementalState.bundleDir,
      relKey,
      fileStat,
      fileHash,
      fileChunks,
      fileRelations
    }));

    const fileDurationMs = Date.now() - fileStart;
    return {
      abs,
      relKey,
      fileIndex,
      cached: false,
      durationMs: fileDurationMs,
      chunks: fileChunks,
      fileRelations,
      manifestEntry
    };
  }

  return { processFile };
}
