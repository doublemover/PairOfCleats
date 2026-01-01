import fs from 'node:fs/promises';
import path from 'node:path';
import { getMetricsDir } from '../../../tools/dict-utils.js';
import { log } from '../../shared/progress.js';
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

  const chunkMeta = state.chunks.map((c) => ({
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
  }));

  await fs.writeFile(
    path.join(outDir, '.scannedfiles.json'),
    JSON.stringify(state.scannedFilesTimes, null, 2)
  );
  await fs.writeFile(
    path.join(outDir, '.skippedfiles.json'),
    JSON.stringify(state.skippedFiles, null, 2)
  );
  log('→ Wrote .scannedfiles.json and .skippedfiles.json');

  const resolvedConfig = normalizePostingsConfig(postingsConfig || {});
  log('Writing index files...');
  const writeStart = Date.now();
  const writes = [
    fs.writeFile(
      path.join(outDir, 'dense_vectors_uint8.json'),
      JSON.stringify({ model: modelId, dims: postings.dims, scale: 1.0, vectors: postings.quantizedVectors }) + '\n'
    ),
    fs.writeFile(
      path.join(outDir, 'dense_vectors_doc_uint8.json'),
      JSON.stringify({ model: modelId, dims: postings.dims, scale: 1.0, vectors: postings.quantizedDocVectors }) + '\n'
    ),
    fs.writeFile(
      path.join(outDir, 'dense_vectors_code_uint8.json'),
      JSON.stringify({ model: modelId, dims: postings.dims, scale: 1.0, vectors: postings.quantizedCodeVectors }) + '\n'
    ),
    fs.writeFile(
      path.join(outDir, 'chunk_meta.json'),
      JSON.stringify(chunkMeta) + '\n'
    ),
    fs.writeFile(
      path.join(outDir, 'minhash_signatures.json'),
      JSON.stringify({ signatures: postings.minhashSigs }) + '\n'
    ),
    fs.writeFile(
      path.join(outDir, 'token_postings.json'),
      JSON.stringify({
        vocab: postings.tokenVocab,
        postings: postings.tokenPostingsList,
        docLengths: state.docLengths,
        avgDocLen: postings.avgDocLen,
        totalDocs: state.docLengths.length
      }) + '\n'
    )
  ];
  if (resolvedConfig.enablePhraseNgrams !== false) {
    writes.push(fs.writeFile(
      path.join(outDir, 'phrase_ngrams.json'),
      JSON.stringify({ vocab: postings.phraseVocab, postings: postings.phrasePostings }) + '\n'
    ));
  }
  if (resolvedConfig.enableChargrams !== false) {
    writes.push(fs.writeFile(
      path.join(outDir, 'chargram_postings.json'),
      JSON.stringify({ vocab: postings.chargramVocab, postings: postings.chargramPostings }) + '\n'
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
