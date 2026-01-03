import fs from 'node:fs/promises';
import path from 'node:path';
import { getMetricsDir } from '../../../tools/dict-utils.js';
import { log } from '../../shared/progress.js';
import { writeJsonArrayFile, writeJsonObjectFile } from '../../shared/json-stream.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';

/**
 * Write index artifacts and metrics.
 * @param {object} input
 */
export async function writeIndexArtifacts(input) {
  const {
    outDir,
    mode,
    state,
    postings,
    postingsConfig,
    modelId,
    useStubEmbeddings,
    dictSummary,
    timing,
    root,
    userConfig,
    incrementalEnabled,
    fileCounts
  } = input;

  function* chunkMetaIterator(chunks) {
    for (const c of chunks) {
      yield {
        id: c.id,
        file: c.file,
        start: c.start,
        end: c.end,
        startLine: c.startLine,
        endLine: c.endLine,
        ext: c.ext,
        kind: c.kind,
        name: c.name,
        weight: c.weight,
        headline: c.headline,
        preContext: c.preContext,
        postContext: c.postContext,
        tokens: c.tokens,
        ngrams: c.ngrams,
        codeRelations: c.codeRelations,
        docmeta: c.docmeta,
        stats: c.stats,
        complexity: c.complexity,
        lint: c.lint,
        externalDocs: c.externalDocs,
        last_modified: c.last_modified,
        last_author: c.last_author,
        churn: c.churn,
        chunk_authors: c.chunk_authors
      };
    }
  }

  const fileListConfig = userConfig?.indexing || {};
  const debugFileLists = fileListConfig.debugFileLists === true;
  const sampleSize = Number.isFinite(Number(fileListConfig.fileListSampleSize))
    ? Math.max(0, Math.floor(Number(fileListConfig.fileListSampleSize)))
    : 50;
  const sampleList = (list) => {
    if (!Array.isArray(list) || sampleSize <= 0) return [];
    if (list.length <= sampleSize) return list.slice();
    return list.slice(0, sampleSize);
  };
  const fileListSummary = {
    generatedAt: new Date().toISOString(),
    scanned: {
      count: state.scannedFilesTimes.length,
      sample: sampleList(state.scannedFilesTimes)
    },
    skipped: {
      count: state.skippedFiles.length,
      sample: sampleList(state.skippedFiles)
    }
  };
  await fs.writeFile(
    path.join(outDir, '.filelists.json'),
    JSON.stringify(fileListSummary, null, 2)
  );
  if (debugFileLists) {
    await fs.writeFile(
      path.join(outDir, '.scannedfiles.json'),
      JSON.stringify(state.scannedFilesTimes, null, 2)
    );
    await fs.writeFile(
      path.join(outDir, '.skippedfiles.json'),
      JSON.stringify(state.skippedFiles, null, 2)
    );
    log('→ Wrote .filelists.json, .scannedfiles.json, and .skippedfiles.json');
  } else {
    log('→ Wrote .filelists.json (samples only).');
  }

  const resolvedConfig = normalizePostingsConfig(postingsConfig || {});
  log('Writing index files...');
  const writeStart = Date.now();
  const writes = [
    writeJsonObjectFile(
      path.join(outDir, 'dense_vectors_uint8.json'),
      {
        fields: { model: modelId, dims: postings.dims, scale: 1.0 },
        arrays: { vectors: postings.quantizedVectors }
      }
    ),
    writeJsonObjectFile(
      path.join(outDir, 'dense_vectors_doc_uint8.json'),
      {
        fields: { model: modelId, dims: postings.dims, scale: 1.0 },
        arrays: { vectors: postings.quantizedDocVectors }
      }
    ),
    writeJsonObjectFile(
      path.join(outDir, 'dense_vectors_code_uint8.json'),
      {
        fields: { model: modelId, dims: postings.dims, scale: 1.0 },
        arrays: { vectors: postings.quantizedCodeVectors }
      }
    ),
    writeJsonArrayFile(
      path.join(outDir, 'chunk_meta.json'),
      chunkMetaIterator(state.chunks)
    ),
    writeJsonObjectFile(
      path.join(outDir, 'minhash_signatures.json'),
      { arrays: { signatures: postings.minhashSigs } }
    ),
    writeJsonObjectFile(
      path.join(outDir, 'token_postings.json'),
      {
        fields: {
          avgDocLen: postings.avgDocLen,
          totalDocs: state.docLengths.length
        },
        arrays: {
          vocab: postings.tokenVocab,
          postings: postings.tokenPostingsList,
          docLengths: state.docLengths
        }
      }
    )
  ];
  if (resolvedConfig.enablePhraseNgrams !== false) {
    writes.push(writeJsonObjectFile(
      path.join(outDir, 'phrase_ngrams.json'),
      { arrays: { vocab: postings.phraseVocab, postings: postings.phrasePostings } }
    ));
  }
  if (resolvedConfig.enableChargrams !== false) {
    writes.push(writeJsonObjectFile(
      path.join(outDir, 'chargram_postings.json'),
      { arrays: { vocab: postings.chargramVocab, postings: postings.chargramPostings } }
    ));
  }
  await Promise.all(writes);
  timing.writeMs = Date.now() - writeStart;
  timing.totalMs = Date.now() - timing.start;
  log(
    `📦  ${mode.padEnd(5)}: ${state.chunks.length.toLocaleString()} chunks, ${postings.trimmedVocab.length.toLocaleString()} tokens, dims=${postings.dims}`
  );

  const cacheHits = state.scannedFilesTimes.filter((entry) => entry.cached).length;
  const cacheMisses = state.scannedFilesTimes.length - cacheHits;
  const skippedByReason = state.skippedFiles.reduce((acc, entry) => {
    const reason = entry && typeof entry === 'object' && entry.reason
      ? String(entry.reason)
      : 'unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const metrics = {
    generatedAt: new Date().toISOString(),
    repoRoot: path.resolve(root),
    mode,
    indexDir: path.resolve(outDir),
    incremental: incrementalEnabled,
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
      hitRate: state.scannedFilesTimes.length ? cacheHits / state.scannedFilesTimes.length : 0
    },
    files: {
      scanned: state.scannedFiles.length,
      skipped: state.skippedFiles.length,
      candidates: fileCounts.candidates,
      skippedByReason
    },
    chunks: {
      total: state.chunks.length,
      avgTokens: state.chunks.length ? state.totalTokens / state.chunks.length : 0
    },
    tokens: {
      total: state.totalTokens,
      vocab: postings.trimmedVocab.length
    },
    bm25: {
      k1: postings.k1,
      b: postings.b,
      avgChunkLen: postings.avgChunkLen,
      totalDocs: postings.totalDocs
    },
    embeddings: {
      dims: postings.dims,
      stub: useStubEmbeddings,
      model: modelId
    },
    dictionaries: dictSummary,
    timings: timing
  };
  try {
    const metricsDir = getMetricsDir(root, userConfig);
    await fs.mkdir(metricsDir, { recursive: true });
    await fs.writeFile(
      path.join(metricsDir, `index-${mode}.json`),
      JSON.stringify(metrics, null, 2)
    );
  } catch {}
}
