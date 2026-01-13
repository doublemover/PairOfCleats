import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io.js';
import { writeJsonArrayFile, writeJsonObjectFile } from '../../shared/json-stream.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { resolveCompressionConfig } from './artifacts/compression.js';
import { writePiecesManifest } from './artifacts/checksums.js';
import { buildFileMeta } from './artifacts/file-meta.js';
import { buildSerializedFilterIndex } from './artifacts/filter-index.js';
import { writeIndexMetrics } from './artifacts/metrics.js';
import { resolveTokenMode } from './artifacts/token-mode.js';
import { enqueueFileRelationsArtifacts } from './artifacts/writers/file-relations.js';
import { createRepoMapIterator } from './artifacts/writers/repo-map.js';
import {
  createChunkMetaIterator,
  enqueueChunkMetaArtifacts,
  resolveChunkMetaPlan
} from './artifacts/writers/chunk-meta.js';

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
    fileCounts,
    perfProfile,
    indexState,
    graphRelations
  } = input;
  const indexingConfig = userConfig?.indexing || {};
  const {
    resolvedTokenMode,
    tokenMaxFiles,
    tokenSampleSize
  } = resolveTokenMode({ indexingConfig, state, fileCounts });
  const {
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressibleArtifacts
  } = resolveCompressionConfig(indexingConfig);
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
  let tokenPostingsShardSize = Number.isFinite(Number(artifactConfig.tokenPostingsShardSize))
    ? Math.max(1000, Math.floor(Number(artifactConfig.tokenPostingsShardSize)))
    : 50000;
  const tokenPostingsShardThreshold = Number.isFinite(Number(artifactConfig.tokenPostingsShardThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.tokenPostingsShardThreshold)))
    : 200000;
  const formatBytes = (bytes) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0B';
    if (value < 1024) return `${Math.round(value)}B`;
    const kb = value / 1024;
    if (kb < 1024) return `${kb.toFixed(1)}KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)}MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(1)}GB`;
  };

  const { fileMeta, fileIdByPath } = buildFileMeta(state);
  const repoMapIterator = createRepoMapIterator({
    chunks: state.chunks,
    fileRelations: state.fileRelations
  });

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
  const fileListPath = path.join(outDir, '.filelists.json');
  await writeJsonObjectFile(fileListPath, { fields: fileListSummary, atomic: true });
  if (debugFileLists) {
    await writeJsonArrayFile(
      path.join(outDir, '.scannedfiles.json'),
      state.scannedFilesTimes,
      { atomic: true }
    );
    await writeJsonArrayFile(
      path.join(outDir, '.skippedfiles.json'),
      state.skippedFiles,
      { atomic: true }
    );
    log('→ Wrote .filelists.json, .scannedfiles.json, and .skippedfiles.json');
  } else {
    log('→ Wrote .filelists.json (samples only).');
  }

  const resolvedConfig = normalizePostingsConfig(postingsConfig || {});
  const filterIndex = buildSerializedFilterIndex({
    chunks: state.chunks,
    resolvedConfig,
    userConfig
  });
  const denseScale = 2 / 255;
  const maxJsonBytes = MAX_JSON_BYTES;
  const maxJsonBytesSoft = maxJsonBytes * 0.9;
  const shardTargetBytes = maxJsonBytes * 0.75;
  const chunkMetaIterator = createChunkMetaIterator({
    chunks: state.chunks,
    fileIdByPath,
    resolvedTokenMode,
    tokenSampleSize
  });
  const chunkMetaPlan = resolveChunkMetaPlan({
    chunks: state.chunks,
    chunkMetaIterator,
    artifactMode,
    chunkMetaFormatConfig,
    chunkMetaJsonlThreshold,
    chunkMetaShardSize,
    maxJsonBytes
  });
  const tokenPostingsFormat = tokenPostingsFormatConfig
    || (artifactMode === 'sharded' ? 'sharded' : (artifactMode === 'json' ? 'json' : 'auto'));
  let tokenPostingsUseShards = tokenPostingsFormat === 'sharded'
    || (tokenPostingsFormat === 'auto'
      && postings.tokenVocab.length >= tokenPostingsShardThreshold);
  const estimatePostingsBytes = (vocab, postingsList, sampleLimit = 200) => {
    const total = Array.isArray(vocab) ? vocab.length : 0;
    if (!total) return null;
    const sampleSize = Math.min(total, sampleLimit);
    let sampledBytes = 0;
    for (let i = 0; i < sampleSize; i += 1) {
      const token = vocab[i];
      const posting = postingsList?.[i] || [];
      sampledBytes += Buffer.byteLength(JSON.stringify(token), 'utf8') + 1;
      sampledBytes += Buffer.byteLength(JSON.stringify(posting), 'utf8') + 1;
    }
    if (!sampledBytes) return null;
    const avgBytes = sampledBytes / sampleSize;
    return { avgBytes, estimatedBytes: avgBytes * total };
  };
  const tokenPostingsEstimate = estimatePostingsBytes(
    postings.tokenVocab,
    postings.tokenPostingsList
  );
  if (tokenPostingsEstimate) {
    if (tokenPostingsEstimate.estimatedBytes > maxJsonBytesSoft) {
      tokenPostingsUseShards = true;
      const targetShardSize = Math.max(1, Math.floor(shardTargetBytes / tokenPostingsEstimate.avgBytes));
      tokenPostingsShardSize = Math.min(tokenPostingsShardSize, targetShardSize);
      log(
        `Token postings estimate ~${formatBytes(tokenPostingsEstimate.estimatedBytes)}; ` +
        `using sharded output to stay under ${formatBytes(maxJsonBytes)}.`
      );
    } else if (tokenPostingsUseShards) {
      const targetShardSize = Math.max(1, Math.floor(shardTargetBytes / tokenPostingsEstimate.avgBytes));
      tokenPostingsShardSize = Math.min(tokenPostingsShardSize, targetShardSize);
    }
  }
  const removeArtifact = async (targetPath) => {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
    } catch {}
  };
  if (tokenPostingsUseShards) {
    await removeArtifact(path.join(outDir, 'token_postings.json'));
    await removeArtifact(path.join(outDir, 'token_postings.json.gz'));
    await removeArtifact(path.join(outDir, 'token_postings.shards'));
  } else {
    await removeArtifact(path.join(outDir, 'token_postings.meta.json'));
    await removeArtifact(path.join(outDir, 'token_postings.shards'));
  }
  const writeStart = Date.now();
  const writes = [];
  let totalWrites = 0;
  let completedWrites = 0;
  let lastWriteLog = 0;
  let lastWriteLabel = '';
  const writeLogIntervalMs = 1000;
  const formatArtifactLabel = (filePath) => path.relative(outDir, filePath).split(path.sep).join('/');
  const pieceEntries = [];
  const addPieceFile = (entry, filePath) => {
    pieceEntries.push({ ...entry, path: formatArtifactLabel(filePath) });
  };
  addPieceFile({ type: 'stats', name: 'filelists', format: 'json' }, path.join(outDir, '.filelists.json'));
  const logWriteProgress = (label) => {
    completedWrites += 1;
    if (label) lastWriteLabel = label;
    const now = Date.now();
    if (completedWrites === totalWrites || completedWrites === 1 || (now - lastWriteLog) >= writeLogIntervalMs) {
      lastWriteLog = now;
      const percent = totalWrites > 0
        ? (completedWrites / totalWrites * 100).toFixed(1)
        : '100.0';
      const suffix = lastWriteLabel ? ` | ${lastWriteLabel}` : '';
      log(`Writing index files ${completedWrites}/${totalWrites} (${percent}%)${suffix}`);
    }
  };
  const enqueueWrite = (label, job) => {
    writes.push({ label, job });
  };
  if (indexState && typeof indexState === 'object') {
    const indexStatePath = path.join(outDir, 'index_state.json');
    enqueueWrite(
      formatArtifactLabel(indexStatePath),
      () => writeJsonObjectFile(indexStatePath, { fields: indexState, atomic: true })
    );
    addPieceFile({ type: 'stats', name: 'index_state', format: 'json' }, indexStatePath);
  }
  const artifactPath = (base, compressed) => path.join(
    outDir,
    compressed ? `${base}.json.gz` : `${base}.json`
  );
  const enqueueJsonObject = (base, payload, { compressible = true, piece = null } = {}) => {
    if (compressionEnabled && compressible && compressibleArtifacts.has(base)) {
      const gzPath = artifactPath(base, true);
      enqueueWrite(
        formatArtifactLabel(gzPath),
        () => writeJsonObjectFile(gzPath, {
          ...payload,
          compression: compressionMode,
          atomic: true
        })
      );
      if (piece) {
        addPieceFile({ ...piece, format: 'json', compression: compressionMode }, gzPath);
      }
      if (compressionKeepRaw) {
        const rawPath = artifactPath(base, false);
        enqueueWrite(
          formatArtifactLabel(rawPath),
          () => writeJsonObjectFile(rawPath, { ...payload, atomic: true })
        );
        if (piece) {
          addPieceFile({ ...piece, format: 'json' }, rawPath);
        }
      }
      return;
    }
    const rawPath = artifactPath(base, false);
    enqueueWrite(
      formatArtifactLabel(rawPath),
      () => writeJsonObjectFile(rawPath, { ...payload, atomic: true })
    );
    if (piece) {
      addPieceFile({ ...piece, format: 'json' }, rawPath);
    }
  };
  const enqueueJsonArray = (base, items, { compressible = true, piece = null } = {}) => {
    if (compressionEnabled && compressible && compressibleArtifacts.has(base)) {
      const gzPath = artifactPath(base, true);
      enqueueWrite(
        formatArtifactLabel(gzPath),
        () => writeJsonArrayFile(gzPath, items, {
          compression: compressionMode,
          atomic: true
        })
      );
      if (piece) {
        addPieceFile({ ...piece, format: 'json', compression: compressionMode }, gzPath);
      }
      if (compressionKeepRaw) {
        const rawPath = artifactPath(base, false);
        enqueueWrite(
          formatArtifactLabel(rawPath),
          () => writeJsonArrayFile(rawPath, items, { atomic: true })
        );
        if (piece) {
          addPieceFile({ ...piece, format: 'json' }, rawPath);
        }
      }
      return;
    }
    const rawPath = artifactPath(base, false);
    enqueueWrite(
      formatArtifactLabel(rawPath),
      () => writeJsonArrayFile(rawPath, items, { atomic: true })
    );
    if (piece) {
      addPieceFile({ ...piece, format: 'json' }, rawPath);
    }
  };

  const denseVectorsEnabled = postings.dims > 0 && postings.quantizedVectors.length;
  if (!denseVectorsEnabled) {
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.json'));
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.json.gz'));
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.json'));
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.json.gz'));
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.json'));
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.json.gz'));
  }
  if (denseVectorsEnabled) {
    enqueueJsonObject('dense_vectors_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors',
        count: postings.quantizedVectors.length,
        dims: postings.dims
      }
    });
  }
  enqueueJsonArray('file_meta', fileMeta, {
    compressible: false,
    piece: { type: 'chunks', name: 'file_meta', count: fileMeta.length }
  });
  if (denseVectorsEnabled) {
    enqueueJsonObject('dense_vectors_doc_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedDocVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors_doc',
        count: postings.quantizedDocVectors.length,
        dims: postings.dims
      }
    });
    enqueueJsonObject('dense_vectors_code_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedCodeVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors_code',
        count: postings.quantizedCodeVectors.length,
        dims: postings.dims
      }
    });
  }
  await enqueueChunkMetaArtifacts({
    state,
    outDir,
    chunkMetaIterator,
    chunkMetaPlan,
    maxJsonBytes,
    enqueueJsonArray,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  enqueueJsonArray('repo_map', repoMapIterator(), {
    compressible: false,
    piece: { type: 'chunks', name: 'repo_map' }
  });
  if (filterIndex) {
    enqueueJsonObject('filter_index', { fields: filterIndex }, {
      compressible: false,
      piece: { type: 'chunks', name: 'filter_index' }
    });
  }
  enqueueJsonObject('minhash_signatures', { arrays: { signatures: postings.minhashSigs } }, {
    piece: {
      type: 'postings',
      name: 'minhash_signatures',
      count: postings.minhashSigs.length
    }
  });
  if (tokenPostingsUseShards) {
    const shardsDir = path.join(outDir, 'token_postings.shards');
    await fs.mkdir(shardsDir, { recursive: true });
    const parts = [];
    let shardIndex = 0;
    for (let i = 0; i < postings.tokenVocab.length; i += tokenPostingsShardSize) {
      const end = Math.min(i + tokenPostingsShardSize, postings.tokenVocab.length);
      const partCount = end - i;
      const partName = `token_postings.part-${String(shardIndex).padStart(5, '0')}.json`;
      const partPath = path.join(shardsDir, partName);
      parts.push(path.join('token_postings.shards', partName));
      enqueueWrite(
        formatArtifactLabel(partPath),
        () => writeJsonObjectFile(partPath, {
          arrays: {
            vocab: postings.tokenVocab.slice(i, end),
            postings: postings.tokenPostingsList.slice(i, end)
          },
          atomic: true
        })
      );
      addPieceFile({
        type: 'postings',
        name: 'token_postings',
        format: 'json',
        count: partCount
      }, partPath);
      shardIndex += 1;
    }
    const metaPath = path.join(outDir, 'token_postings.meta.json');
    enqueueWrite(
      formatArtifactLabel(metaPath),
      () => writeJsonObjectFile(metaPath, {
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
        },
        atomic: true
      })
    );
    addPieceFile({ type: 'postings', name: 'token_postings_meta', format: 'json' }, metaPath);
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
    }, {
      piece: { type: 'postings', name: 'token_postings', count: postings.tokenVocab.length }
    });
  }
  if (postings.fieldPostings?.fields) {
    enqueueJsonObject('field_postings', postings.fieldPostings, {
      piece: { type: 'postings', name: 'field_postings' }
    });
  }
  if (resolvedConfig.fielded !== false && Array.isArray(state.fieldTokens)) {
    enqueueJsonArray('field_tokens', state.fieldTokens, {
      piece: { type: 'postings', name: 'field_tokens', count: state.fieldTokens.length }
    });
  }
  enqueueFileRelationsArtifacts({
    state,
    outDir,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  if (graphRelations && typeof graphRelations === 'object') {
    enqueueJsonObject('graph_relations', { fields: graphRelations }, {
      compressible: false,
      piece: { type: 'relations', name: 'graph_relations' }
    });
  }
  if (resolvedConfig.enablePhraseNgrams !== false) {
    enqueueJsonObject('phrase_ngrams', {
      arrays: { vocab: postings.phraseVocab, postings: postings.phrasePostings }
    }, {
      piece: { type: 'postings', name: 'phrase_ngrams', count: postings.phraseVocab.length }
    });
  }
  if (resolvedConfig.enableChargrams !== false) {
    enqueueJsonObject('chargram_postings', {
      arrays: { vocab: postings.chargramVocab, postings: postings.chargramPostings }
    }, {
      piece: { type: 'postings', name: 'chargram_postings', count: postings.chargramVocab.length }
    });
  }
  totalWrites = writes.length;
  if (totalWrites) {
    const artifactLabel = totalWrites === 1 ? 'artifact' : 'artifacts';
    log(`Writing index files (${totalWrites} ${artifactLabel})...`);
    const writeConcurrency = Math.max(1, Math.min(4, totalWrites));
    await runWithConcurrency(
      writes,
      writeConcurrency,
      async ({ label, job }) => {
        try {
          await job();
        } finally {
          logWriteProgress(label);
        }
      },
      { collectResults: false }
    );
  } else {
    log('Writing index files (0 artifacts)...');
  }
  timing.writeMs = Date.now() - writeStart;
  timing.totalMs = Date.now() - timing.start;
  log(
    `📦  ${mode.padEnd(5)}: ${state.chunks.length.toLocaleString()} chunks, ${postings.tokenVocab.length.toLocaleString()} tokens, dims=${postings.dims}`
  );

  await writePiecesManifest({
    pieceEntries,
    outDir,
    mode,
    indexState
  });
  await writeIndexMetrics({
    root,
    userConfig,
    mode,
    outDir,
    state,
    postings,
    dictSummary,
    useStubEmbeddings,
    modelId,
    denseVectorsEnabled,
    incrementalEnabled,
    fileCounts,
    timing,
    perfProfile,
    indexState,
    resolvedTokenMode,
    tokenSampleSize,
    tokenMaxFiles,
    chunkMetaUseJsonl: chunkMetaPlan.chunkMetaUseJsonl,
    chunkMetaUseShards: chunkMetaPlan.chunkMetaUseShards,
    tokenPostingsUseShards,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw
  });
}
