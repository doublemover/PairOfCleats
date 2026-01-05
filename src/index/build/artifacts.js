import fs from 'node:fs/promises';
import path from 'node:path';
import { getMetricsDir } from '../../../tools/dict-utils.js';
import { getRepoBranch } from '../git.js';
import { log } from '../../shared/progress.js';
import { writeJsonArrayFile, writeJsonLinesFile, writeJsonObjectFile } from '../../shared/json-stream.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { buildFilterIndex, serializeFilterIndex } from '../../retrieval/filter-index.js';

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
  const indexingConfig = userConfig?.indexing || {};
  const tokenModeRaw = indexingConfig.chunkTokenMode || 'auto';
  const tokenMode = ['auto', 'full', 'sample', 'none'].includes(tokenModeRaw)
    ? tokenModeRaw
    : 'auto';
  const tokenMaxFiles = Number.isFinite(Number(indexingConfig.chunkTokenMaxFiles))
    ? Math.max(0, Number(indexingConfig.chunkTokenMaxFiles))
    : 5000;
  const tokenMaxTotalRaw = Number(indexingConfig.chunkTokenMaxTokens);
  const tokenMaxTotal = Number.isFinite(tokenMaxTotalRaw) && tokenMaxTotalRaw > 0
    ? Math.floor(tokenMaxTotalRaw)
    : 5000000;
  const tokenSampleSize = Number.isFinite(Number(indexingConfig.chunkTokenSampleSize))
    ? Math.max(1, Math.floor(Number(indexingConfig.chunkTokenSampleSize)))
    : 32;
  let resolvedTokenMode = tokenMode === 'auto'
    ? ((fileCounts?.candidates ?? 0) <= tokenMaxFiles ? 'full' : 'sample')
    : tokenMode;
  if (resolvedTokenMode === 'full' && tokenMode === 'auto') {
    let totalTokens = 0;
    for (const chunk of state.chunks) {
      if (Array.isArray(chunk?.tokens)) totalTokens += chunk.tokens.length;
      if (totalTokens > tokenMaxTotal) break;
    }
    if (totalTokens > tokenMaxTotal) {
      resolvedTokenMode = 'sample';
      log(`Chunk token mode auto -> sample (token budget ${totalTokens} > ${tokenMaxTotal}).`);
    }
  }
  const compressionConfig = indexingConfig.artifactCompression || {};
  const compressionMode = compressionConfig.mode === 'gzip' ? 'gzip' : null;
  const compressionEnabled = compressionConfig.enabled === true && compressionMode;
  const compressionKeepRaw = compressionConfig.keepRaw === true;
  const artifactConfig = indexingConfig.artifacts || {};
  const artifactMode = typeof artifactConfig.mode === 'string'
    ? artifactConfig.mode.toLowerCase()
    : 'auto';
  const chunkMetaFormatConfig = typeof artifactConfig.chunkMetaFormat === 'string'
    ? artifactConfig.chunkMetaFormat.toLowerCase()
    : null;
  const chunkMetaJsonlThreshold = Number.isFinite(Number(artifactConfig.chunkMetaJsonlThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.chunkMetaJsonlThreshold)))
    : 200000;
  const chunkMetaShardSize = Number.isFinite(Number(artifactConfig.chunkMetaShardSize))
    ? Math.max(0, Math.floor(Number(artifactConfig.chunkMetaShardSize)))
    : 100000;
  const tokenPostingsFormatConfig = typeof artifactConfig.tokenPostingsFormat === 'string'
    ? artifactConfig.tokenPostingsFormat.toLowerCase()
    : null;
  const tokenPostingsShardSize = Number.isFinite(Number(artifactConfig.tokenPostingsShardSize))
    ? Math.max(1000, Math.floor(Number(artifactConfig.tokenPostingsShardSize)))
    : 50000;
  const tokenPostingsShardThreshold = Number.isFinite(Number(artifactConfig.tokenPostingsShardThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.tokenPostingsShardThreshold)))
    : 200000;
  const compressibleArtifacts = new Set([
    'dense_vectors_uint8',
    'dense_vectors_doc_uint8',
    'dense_vectors_code_uint8',
    'minhash_signatures',
    'token_postings',
    'field_postings',
    'field_tokens',
    'phrase_ngrams',
    'chargram_postings'
  ]);

  const fileMeta = [];
  const fileIdByPath = new Map();
  for (const c of state.chunks) {
    if (!c?.file) continue;
    if (fileIdByPath.has(c.file)) continue;
    const id = fileMeta.length;
    fileIdByPath.set(c.file, id);
    fileMeta.push({
      id,
      file: c.file,
      ext: c.ext,
      externalDocs: c.externalDocs,
      last_modified: c.last_modified,
      last_author: c.last_author,
      churn: c.churn,
      churn_added: c.churn_added,
      churn_deleted: c.churn_deleted,
      churn_commits: c.churn_commits
    });
  }
  const fileExportMap = new Map();
  if (state.fileRelations && state.fileRelations.size) {
    for (const [file, relations] of state.fileRelations.entries()) {
      if (!Array.isArray(relations?.exports) || !relations.exports.length) continue;
      fileExportMap.set(file, new Set(relations.exports));
    }
  }

  function* chunkMetaIterator(chunks, start = 0, end = chunks.length) {
    for (let i = start; i < end; i++) {
      const c = chunks[i];
      const entry = {
        id: c.id,
        fileId: fileIdByPath.get(c.file) ?? null,
        start: c.start,
        end: c.end,
        startLine: c.startLine,
        endLine: c.endLine,
        kind: c.kind,
        name: c.name,
        weight: c.weight,
        headline: c.headline,
        preContext: c.preContext,
        postContext: c.postContext,
        codeRelations: c.codeRelations,
        docmeta: c.docmeta,
        stats: c.stats,
        complexity: c.complexity,
        lint: c.lint,
        chunk_authors: c.chunk_authors
      };
      if (resolvedTokenMode !== 'none') {
        const tokens = Array.isArray(c.tokens) ? c.tokens : [];
        const ngrams = Array.isArray(c.ngrams) ? c.ngrams : null;
        const tokenOut = resolvedTokenMode === 'sample'
          ? tokens.slice(0, tokenSampleSize)
          : tokens;
        const ngramOut = resolvedTokenMode === 'sample' && Array.isArray(ngrams)
          ? ngrams.slice(0, tokenSampleSize)
          : ngrams;
        entry.tokens = tokenOut;
        entry.ngrams = ngramOut;
      }
      yield entry;
    }
  }
  function* repoMapIterator(chunks) {
    for (const c of chunks) {
      if (!c?.name) continue;
      const exportsSet = fileExportMap.get(c.file) || null;
      const exported = exportsSet
        ? exportsSet.has(c.name) || exportsSet.has('*') || (c.name === 'default' && exportsSet.has('default'))
        : false;
      yield {
        file: c.file,
        ext: c.ext,
        name: c.name,
        kind: c.kind,
        signature: c.docmeta?.signature || null,
        startLine: c.startLine,
        endLine: c.endLine,
        exported
      };
    }
  }
  function* fileRelationsIterator(relations) {
    if (!relations || typeof relations.entries !== 'function') return;
    for (const [file, data] of relations.entries()) {
      if (!file || !data) continue;
      yield {
        file,
        relations: data
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
  const filePrefilterConfig = userConfig?.search?.filePrefilter || {};
  const fileChargramN = Number.isFinite(Number(filePrefilterConfig.chargramN))
    ? Math.max(2, Math.floor(Number(filePrefilterConfig.chargramN)))
    : resolvedConfig.chargramMinN;
  const filterIndex = serializeFilterIndex(buildFilterIndex(state.chunks, { fileChargramN }));
  const denseScale = 2 / 255;
  const chunkMetaCount = state.chunks.length;
  const chunkMetaFormat = chunkMetaFormatConfig
    || (artifactMode === 'jsonl' ? 'jsonl' : (artifactMode === 'json' ? 'json' : 'auto'));
  const chunkMetaUseJsonl = chunkMetaFormat === 'jsonl'
    || (chunkMetaFormat === 'auto' && chunkMetaCount >= chunkMetaJsonlThreshold);
  const chunkMetaUseShards = chunkMetaUseJsonl
    && chunkMetaShardSize > 0
    && chunkMetaCount > chunkMetaShardSize;
  const tokenPostingsFormat = tokenPostingsFormatConfig
    || (artifactMode === 'sharded' ? 'sharded' : (artifactMode === 'json' ? 'json' : 'auto'));
  const tokenPostingsUseShards = tokenPostingsFormat === 'sharded'
    || (tokenPostingsFormat === 'auto'
      && postings.tokenVocab.length >= tokenPostingsShardThreshold);
  const removeArtifact = async (targetPath) => {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
    } catch {}
  };
  if (chunkMetaUseJsonl) {
    await removeArtifact(path.join(outDir, 'chunk_meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta.json.gz'));
    if (chunkMetaUseShards) {
      await removeArtifact(path.join(outDir, 'chunk_meta.jsonl'));
    }
  } else {
    await removeArtifact(path.join(outDir, 'chunk_meta.jsonl'));
    await removeArtifact(path.join(outDir, 'chunk_meta.meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
  }
  if (tokenPostingsUseShards) {
    await removeArtifact(path.join(outDir, 'token_postings.json'));
    await removeArtifact(path.join(outDir, 'token_postings.json.gz'));
    await removeArtifact(path.join(outDir, 'token_postings.shards'));
  } else {
    await removeArtifact(path.join(outDir, 'token_postings.meta.json'));
    await removeArtifact(path.join(outDir, 'token_postings.shards'));
  }
  log('Writing index files...');
  const writeStart = Date.now();
  const writes = [];
  const artifactPath = (base, compressed) => path.join(
    outDir,
    compressed ? `${base}.json.gz` : `${base}.json`
  );
  const enqueueJsonObject = (base, payload, { compressible = true } = {}) => {
    if (compressionEnabled && compressible && compressibleArtifacts.has(base)) {
      writes.push(writeJsonObjectFile(
        artifactPath(base, true),
        { ...payload, compression: compressionMode }
      ));
      if (compressionKeepRaw) {
        writes.push(writeJsonObjectFile(artifactPath(base, false), payload));
      }
      return;
    }
    writes.push(writeJsonObjectFile(artifactPath(base, false), payload));
  };
  const enqueueJsonArray = (base, items, { compressible = true } = {}) => {
    if (compressionEnabled && compressible && compressibleArtifacts.has(base)) {
      writes.push(writeJsonArrayFile(
        artifactPath(base, true),
        items,
        { compression: compressionMode }
      ));
      if (compressionKeepRaw) {
        writes.push(writeJsonArrayFile(artifactPath(base, false), items));
      }
      return;
    }
    writes.push(writeJsonArrayFile(artifactPath(base, false), items));
  };

  enqueueJsonObject('dense_vectors_uint8', {
    fields: { model: modelId, dims: postings.dims, scale: denseScale },
    arrays: { vectors: postings.quantizedVectors }
  });
  enqueueJsonArray('file_meta', fileMeta, { compressible: false });
  enqueueJsonObject('dense_vectors_doc_uint8', {
    fields: { model: modelId, dims: postings.dims, scale: denseScale },
    arrays: { vectors: postings.quantizedDocVectors }
  });
  enqueueJsonObject('dense_vectors_code_uint8', {
    fields: { model: modelId, dims: postings.dims, scale: denseScale },
    arrays: { vectors: postings.quantizedCodeVectors }
  });
  if (chunkMetaUseJsonl) {
    if (chunkMetaUseShards) {
      const partsDir = path.join(outDir, 'chunk_meta.parts');
      await fs.mkdir(partsDir, { recursive: true });
      const parts = [];
      let partIndex = 0;
      for (let i = 0; i < state.chunks.length; i += chunkMetaShardSize) {
        const end = Math.min(i + chunkMetaShardSize, state.chunks.length);
        const partName = `chunk_meta.part-${String(partIndex).padStart(5, '0')}.jsonl`;
        const partPath = path.join(partsDir, partName);
        parts.push(path.join('chunk_meta.parts', partName));
        writes.push(writeJsonLinesFile(partPath, chunkMetaIterator(state.chunks, i, end)));
        partIndex += 1;
      }
      writes.push(writeJsonObjectFile(
        path.join(outDir, 'chunk_meta.meta.json'),
        {
          fields: {
            format: 'jsonl',
            shardSize: chunkMetaShardSize,
            totalChunks: chunkMetaCount,
            parts
          }
        }
      ));
    } else {
      writes.push(writeJsonLinesFile(
        path.join(outDir, 'chunk_meta.jsonl'),
        chunkMetaIterator(state.chunks)
      ));
    }
  } else {
    enqueueJsonArray('chunk_meta', chunkMetaIterator(state.chunks), { compressible: false });
  }
  enqueueJsonArray('repo_map', repoMapIterator(state.chunks), { compressible: false });
  if (filterIndex) {
    enqueueJsonObject('filter_index', { fields: filterIndex }, { compressible: false });
  }
  enqueueJsonObject('minhash_signatures', { arrays: { signatures: postings.minhashSigs } });
  if (tokenPostingsUseShards) {
    const shardsDir = path.join(outDir, 'token_postings.shards');
    await fs.mkdir(shardsDir, { recursive: true });
    const parts = [];
    let shardIndex = 0;
    for (let i = 0; i < postings.tokenVocab.length; i += tokenPostingsShardSize) {
      const end = Math.min(i + tokenPostingsShardSize, postings.tokenVocab.length);
      const partName = `token_postings.part-${String(shardIndex).padStart(5, '0')}.json`;
      const partPath = path.join(shardsDir, partName);
      parts.push(path.join('token_postings.shards', partName));
      writes.push(writeJsonObjectFile(partPath, {
        arrays: {
          vocab: postings.tokenVocab.slice(i, end),
          postings: postings.tokenPostingsList.slice(i, end)
        }
      }));
      shardIndex += 1;
    }
    writes.push(writeJsonObjectFile(
      path.join(outDir, 'token_postings.meta.json'),
      {
        fields: {
          avgDocLen: postings.avgDocLen,
          totalDocs: state.docLengths.length,
          format: 'sharded',
          shardSize: tokenPostingsShardSize,
          vocabCount: postings.tokenVocab.length,
          parts
        },
        arrays: {
          docLengths: state.docLengths
        }
      }
    ));
  } else {
    enqueueJsonObject('token_postings', {
      fields: {
        avgDocLen: postings.avgDocLen,
        totalDocs: state.docLengths.length
      },
      arrays: {
        vocab: postings.tokenVocab,
        postings: postings.tokenPostingsList,
        docLengths: state.docLengths
      }
    });
  }
  if (postings.fieldPostings?.fields) {
    enqueueJsonObject('field_postings', postings.fieldPostings);
  }
  if (Array.isArray(state.fieldTokens) && state.fieldTokens.length) {
    enqueueJsonArray('field_tokens', state.fieldTokens);
  }
  if (state.fileRelations && state.fileRelations.size) {
    writes.push(writeJsonArrayFile(
      path.join(outDir, 'file_relations.json'),
      fileRelationsIterator(state.fileRelations)
    ));
  }
  if (resolvedConfig.enablePhraseNgrams !== false) {
    enqueueJsonObject('phrase_ngrams', {
      arrays: { vocab: postings.phraseVocab, postings: postings.phrasePostings }
    });
  }
  if (resolvedConfig.enableChargrams !== false) {
    enqueueJsonObject('chargram_postings', {
      arrays: { vocab: postings.chargramVocab, postings: postings.chargramPostings }
    });
  }
  await Promise.all(writes);
  timing.writeMs = Date.now() - writeStart;
  timing.totalMs = Date.now() - timing.start;
  log(
    `📦  ${mode.padEnd(5)}: ${state.chunks.length.toLocaleString()} chunks, ${postings.tokenVocab.length.toLocaleString()} tokens, dims=${postings.dims}`
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
    git: await getRepoBranch(root),
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
      vocab: postings.tokenVocab.length
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
    artifacts: {
      chunkTokens: {
        mode: resolvedTokenMode,
        sampleSize: tokenSampleSize,
        maxFiles: tokenMaxFiles
      },
      formats: {
        chunkMeta: chunkMetaUseShards ? 'jsonl-sharded' : (chunkMetaUseJsonl ? 'jsonl' : 'json'),
        tokenPostings: tokenPostingsUseShards ? 'sharded' : 'json'
      },
      compression: {
        enabled: Boolean(compressionEnabled),
        mode: compressionMode,
        keepRaw: compressionKeepRaw
      }
    },
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
