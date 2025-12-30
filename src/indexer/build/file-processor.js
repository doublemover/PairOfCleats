import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeComplexity, lintChunk } from '../analysis.js';
import { smartChunk } from '../chunking.js';
import { buildChunkRelations, buildLanguageContext } from '../language-registry.js';
import { detectRiskSignals } from '../risk.js';
import { inferTypeMetadata } from '../type-inference.js';
import { SimpleMinHash } from '../minhash.js';
import { getHeadline } from '../headline.js';
import { getGitMeta } from '../git.js';
import { getFieldWeight } from '../field-weighting.js';
import { isGo, isJsLike, isSpecialCodeFile, STOP, SYN } from '../constants.js';
import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { fileExt, toPosix } from '../../shared/files.js';
import { extractNgrams, splitId, splitWordsWithDict, stem, tri } from '../../shared/tokenize.js';
import { readCachedBundle, writeIncrementalBundle } from './incremental.js';
import { sha1 } from '../../shared/hash.js';

/**
 * Create a file processor with shared caches.
 * @param {object} options
 * @returns {{processFile:(abs:string,fileIndex:number)=>Promise<object|null>}}
 */
export function createFileProcessor(options) {
  const {
    root,
    mode,
    dictWords,
    languageOptions,
    allImports,
    contextWin,
    incrementalState,
    getChunkEmbedding,
    typeInferenceEnabled,
    riskAnalysisEnabled,
    seenFiles,
    gitBlameEnabled
  } = options;
  const { astDataflowEnabled, controlFlowEnabled } = languageOptions;
  const complexityCache = new Map();
  const lintCache = new Map();

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

  const buildExternalDocs = (ext, codeRelations) => {
    const externalDocs = [];
    if (!codeRelations?.imports || !codeRelations.imports.length) return externalDocs;
    const isPython = ext === '.py';
    const isNode = isJsLike(ext);
    const isGoLang = isGo(ext);
    for (const mod of codeRelations.imports) {
      if (mod.startsWith('.')) continue;
      if (isPython) {
        const base = mod.split('.')[0];
        if (base) externalDocs.push(`https://pypi.org/project/${base}`);
      } else if (isNode) {
        externalDocs.push(`https://www.npmjs.com/package/${mod.replace(/^@/, '')}`);
      } else if (isGoLang) {
        externalDocs.push(`https://pkg.go.dev/${mod}`);
      }
    }
    return externalDocs;
  };

  /**
   * Process a file: read, chunk, analyze, and produce chunk payloads.
   * @param {string} abs
   * @param {number} fileIndex
   * @returns {Promise<object|null>}
   */
  async function processFile(abs, fileIndex) {
    const fileStart = Date.now();
    const rel = path.relative(root, abs);
    const relKey = toPosix(rel);
    if (seenFiles) seenFiles.add(relKey);
    const ext = resolveExt(abs);
    let fileStat;
    try {
      fileStat = await fs.stat(abs);
    } catch {
      return null;
    }

    let cachedBundle = null;
    let text = null;
    let fileHash = null;
    const cachedResult = await readCachedBundle({
      enabled: incrementalState.enabled,
      absPath: abs,
      relKey,
      fileStat,
      manifest: incrementalState.manifest,
      bundleDir: incrementalState.bundleDir
    });
    cachedBundle = cachedResult.cachedBundle;
    text = cachedResult.text;
    fileHash = cachedResult.fileHash;

    if (cachedBundle && Array.isArray(cachedBundle.chunks)) {
      const updatedChunks = cachedBundle.chunks.map((cachedChunk) => {
        const updatedChunk = { ...cachedChunk };
        if (updatedChunk.codeRelations?.imports) {
          const importLinks = updatedChunk.codeRelations.imports
            .map((i) => allImports[i])
            .filter((x) => !!x)
            .flat();
          updatedChunk.codeRelations = {
            ...updatedChunk.codeRelations,
            importLinks
          };
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
        manifestEntry: null
      };
    }

    if (!text) {
      try {
        text = await fs.readFile(abs, 'utf8');
      } catch {
        return null;
      }
    }
    if (!fileHash) fileHash = sha1(text);
    text = text.normalize('NFKD');

    const { lang, context: languageContext } = buildLanguageContext({
      ext,
      relPath: relKey,
      mode,
      text,
      options: languageOptions
    });
    const lineIndex = buildLineIndex(text);
    const fileRelations = (mode === 'code' && lang && typeof lang.buildRelations === 'function')
      ? lang.buildRelations({
        text,
        relPath: relKey,
        allImports,
        context: languageContext,
        options: languageOptions
      })
      : null;
    const sc = smartChunk({
      text,
      ext,
      relPath: relKey,
      mode,
      context: languageContext
    });
    const fileChunks = [];

    for (let ci = 0; ci < sc.length; ++ci) {
      const c = sc[ci];
      const ctext = text.slice(c.start, c.end);

      let tokens = splitId(ctext);
      tokens = tokens.map((t) => t.normalize('NFKD'));

      if (!(mode === 'prose' && ext === '.md')) {
        tokens = tokens.flatMap((t) => splitWordsWithDict(t, dictWords));
      }

      if (mode === 'prose') {
        tokens = tokens.filter((w) => !STOP.has(w));
        tokens = tokens.flatMap((w) => [w, stem(w)]);
      }
      const seq = [];
      for (const w of tokens) {
        seq.push(w);
        if (SYN[w]) seq.push(SYN[w]);
      }
      if (!seq.length) continue;

      const ngrams = extractNgrams(seq, 2, 4);
      const charSet = new Set();
      seq.forEach((w) => {
        for (let n = 3; n <= 5; ++n) tri(w, n).forEach((g) => charSet.add(g));
      });
      const chargrams = Array.from(charSet);

      const meta = {
        ...c.meta,
        ext,
        path: relKey,
        kind: c.kind,
        name: c.name,
        file: relKey,
        weight: getFieldWeight(c, rel)
      };

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
          codeRelations = buildChunkRelations({ lang, chunk: c, fileRelations });
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
        if (!complexityCache.has(rel)) {
          const fullCode = text;
          const compResult = await analyzeComplexity(fullCode, rel);
          complexityCache.set(rel, compResult);
        }
        complexity = complexityCache.get(rel);

        if (!lintCache.has(rel)) {
          const fullCode = text;
          const lintResult = await lintChunk(fullCode, rel);
          lintCache.set(rel, lintResult);
        }
        lint = lintCache.get(rel);
      }

      const freq = {};
      tokens.forEach((t) => {
        freq[t] = (freq[t] || 0) + 1;
      });
      const unique = Object.keys(freq).length;
      const counts = Object.values(freq);
      const sum = counts.reduce((a, b) => a + b, 0);
      const entropy = -counts.reduce((e, c) => e + (c / sum) * Math.log2(c / sum), 0);
      const stats = { unique, entropy, sum };

      const embed_doc = await getChunkEmbedding(docmeta.doc || '');
      const embed_code = await getChunkEmbedding(ctext);
      const embedding = embed_doc.map((v, i) => v + embed_code[i]);

      const mh = new SimpleMinHash();
      tokens.forEach((t) => mh.update(t));
      const minhashSig = mh.hashValues;

      const headline = getHeadline(c, tokens);

      let preContext = [], postContext = [];
      if (ci > 0) preContext = text.slice(sc[ci - 1].start, sc[ci - 1].end).split('\n').slice(-contextWin);
      if (ci + 1 < sc.length) postContext = text.slice(sc[ci + 1].start, sc[ci + 1].end).split('\n').slice(0, contextWin);

      const gitMeta = await getGitMeta(abs, c.start, c.end, { blame: gitBlameEnabled });

      const externalDocs = buildExternalDocs(ext, codeRelations);

      const startLine = c.meta?.startLine || offsetToLine(lineIndex, c.start);
      const endLine = c.meta?.endLine || offsetToLine(lineIndex, c.end);

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
        meta,
        codeRelations,
        docmeta,
        stats,
        complexity,
        lint,
        headline,
        preContext,
        postContext,
        embedding,
        embed_doc,
        embed_code,
        minhashSig,
        weight: meta.weight,
        ...gitMeta,
        externalDocs
      };

      fileChunks.push(chunkPayload);
    }

    const manifestEntry = await writeIncrementalBundle({
      enabled: incrementalState.enabled,
      bundleDir: incrementalState.bundleDir,
      relKey,
      fileStat,
      fileHash,
      fileChunks
    });

    const fileDurationMs = Date.now() - fileStart;
    return {
      abs,
      relKey,
      fileIndex,
      cached: false,
      durationMs: fileDurationMs,
      chunks: fileChunks,
      manifestEntry
    };
  }

  return { processFile };
}
