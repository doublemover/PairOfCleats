import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getEffectiveConfigHash, getMetricsDir, getToolVersion } from '../../../tools/dict-utils.js';
import { getRepoProvenance } from '../git.js';
import { log } from '../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io.js';
import { writeJsonArrayFile, writeJsonLinesFile, writeJsonObjectFile } from '../../shared/json-stream.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import { sha1File } from '../../shared/hash.js';
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
    fileCounts,
    perfProfile,
    indexState
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
      const count = Number.isFinite(chunk?.tokenCount)
        ? chunk.tokenCount
        : (Array.isArray(chunk?.tokens) ? chunk.tokens.length : 0);
      totalTokens += count;
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
  let chunkMetaShardSize = Number.isFinite(Number(artifactConfig.chunkMetaShardSize))
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
        segment: c.segment || null,
        codeRelations: c.codeRelations,
        docmeta: c.docmeta,
        metaV2: c.metaV2,
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
  const filePrefilterConfig = userConfig?.search?.filePrefilter || {};
  const fileChargramN = Number.isFinite(Number(filePrefilterConfig.chargramN))
    ? Math.max(2, Math.floor(Number(filePrefilterConfig.chargramN)))
    : resolvedConfig.chargramMinN;
  const filterIndex = serializeFilterIndex(buildFilterIndex(state.chunks, { fileChargramN }));
  const denseScale = 2 / 255;
  const maxJsonBytes = MAX_JSON_BYTES;
  const maxJsonBytesSoft = maxJsonBytes * 0.9;
  const shardTargetBytes = maxJsonBytes * 0.75;
  const chunkMetaCount = state.chunks.length;
  const chunkMetaFormat = chunkMetaFormatConfig
    || (artifactMode === 'jsonl' ? 'jsonl' : (artifactMode === 'json' ? 'json' : 'auto'));
  let chunkMetaUseJsonl = chunkMetaFormat === 'jsonl'
    || (chunkMetaFormat === 'auto' && chunkMetaCount >= chunkMetaJsonlThreshold);
  let chunkMetaUseShards = chunkMetaUseJsonl
    && chunkMetaShardSize > 0
    && chunkMetaCount > chunkMetaShardSize;
  if (chunkMetaCount > 0) {
    const sampleSize = Math.min(chunkMetaCount, 200);
    let sampledBytes = 0;
    let sampled = 0;
    for (const entry of chunkMetaIterator(state.chunks, 0, sampleSize)) {
      sampledBytes += Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1;
      sampled += 1;
    }
    if (sampled) {
      const avgBytes = sampledBytes / sampled;
      const estimatedBytes = avgBytes * chunkMetaCount;
      if (estimatedBytes > maxJsonBytesSoft) {
        chunkMetaUseJsonl = true;
        const targetShardSize = Math.max(1, Math.floor(shardTargetBytes / avgBytes));
        if (chunkMetaShardSize > 0) {
          chunkMetaShardSize = Math.min(chunkMetaShardSize, targetShardSize);
        } else {
          chunkMetaShardSize = targetShardSize;
        }
        chunkMetaUseShards = chunkMetaCount > chunkMetaShardSize;
        const chunkMetaMode = chunkMetaUseShards ? 'jsonl-sharded' : 'jsonl';
        log(
          `Chunk metadata estimate ~${formatBytes(estimatedBytes)}; ` +
          `using ${chunkMetaMode} to stay under ${formatBytes(maxJsonBytes)}.`
        );
      }
    }
  }
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
  if (chunkMetaUseJsonl) {
    if (chunkMetaUseShards) {
      const partsDir = path.join(outDir, 'chunk_meta.parts');
      await fs.mkdir(partsDir, { recursive: true });
      const parts = [];
      let partIndex = 0;
      for (let i = 0; i < state.chunks.length; i += chunkMetaShardSize) {
        const end = Math.min(i + chunkMetaShardSize, state.chunks.length);
        const partCount = end - i;
        const partName = `chunk_meta.part-${String(partIndex).padStart(5, '0')}.jsonl`;
        const partPath = path.join(partsDir, partName);
        parts.push(path.join('chunk_meta.parts', partName));
        enqueueWrite(
          formatArtifactLabel(partPath),
          () => writeJsonLinesFile(
            partPath,
            chunkMetaIterator(state.chunks, i, end),
            { atomic: true }
          )
        );
        addPieceFile({
          type: 'chunks',
          name: 'chunk_meta',
          format: 'jsonl',
          count: partCount
        }, partPath);
        partIndex += 1;
      }
      const metaPath = path.join(outDir, 'chunk_meta.meta.json');
      enqueueWrite(
        formatArtifactLabel(metaPath),
        () => writeJsonObjectFile(metaPath, {
          fields: {
            format: 'jsonl',
            shardSize: chunkMetaShardSize,
            totalChunks: chunkMetaCount,
            parts
          },
          atomic: true
        })
      );
      addPieceFile({ type: 'chunks', name: 'chunk_meta_meta', format: 'json' }, metaPath);
    } else {
      const jsonlPath = path.join(outDir, 'chunk_meta.jsonl');
      enqueueWrite(
        formatArtifactLabel(jsonlPath),
        () => writeJsonLinesFile(jsonlPath, chunkMetaIterator(state.chunks), { atomic: true })
      );
      addPieceFile({
        type: 'chunks',
        name: 'chunk_meta',
        format: 'jsonl',
        count: chunkMetaCount
      }, jsonlPath);
    }
  } else {
    enqueueJsonArray('chunk_meta', chunkMetaIterator(state.chunks), {
      compressible: false,
      piece: { type: 'chunks', name: 'chunk_meta', count: chunkMetaCount }
    });
  }
  enqueueJsonArray('repo_map', repoMapIterator(state.chunks), {
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
  if (Array.isArray(state.fieldTokens) && state.fieldTokens.length) {
    enqueueJsonArray('field_tokens', state.fieldTokens, {
      piece: { type: 'postings', name: 'field_tokens', count: state.fieldTokens.length }
    });
  }
  if (state.fileRelations && state.fileRelations.size) {
    const relationsPath = path.join(outDir, 'file_relations.json');
    enqueueWrite(
      formatArtifactLabel(relationsPath),
      () => writeJsonArrayFile(
        relationsPath,
        fileRelationsIterator(state.fileRelations),
        { atomic: true }
      )
    );
    addPieceFile({
      type: 'relations',
      name: 'file_relations',
      format: 'json',
      count: state.fileRelations.size
    }, relationsPath);
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

  if (pieceEntries.length) {
    const piecesDir = path.join(outDir, 'pieces');
    await fs.mkdir(piecesDir, { recursive: true });
    const manifestPath = path.join(piecesDir, 'manifest.json');
    const normalizedEntries = await runWithConcurrency(
      pieceEntries,
      Math.min(4, pieceEntries.length),
      async (entry) => {
        const absPath = path.join(outDir, entry.path.split('/').join(path.sep));
        let bytes = null;
        let checksum = null;
        try {
          const stat = await fs.stat(absPath);
          bytes = stat.size;
          checksum = await sha1File(absPath);
        } catch {}
        return {
          ...entry,
          bytes,
          checksum: checksum ? `sha1:${checksum}` : null
        };
      }
    );
    await writeJsonObjectFile(manifestPath, {
      fields: {
        version: 2,
        generatedAt: new Date().toISOString(),
        mode,
        stage: indexState?.stage || null,
        pieces: normalizedEntries
      },
      atomic: true
    });
    log(`→ Wrote pieces manifest (${normalizedEntries.length} entries).`);
  }

  const cacheHits = state.scannedFilesTimes.filter((entry) => entry.cached).length;
  const cacheMisses = state.scannedFilesTimes.length - cacheHits;
  const skippedByReason = state.skippedFiles.reduce((acc, entry) => {
    const reason = entry && typeof entry === 'object' && entry.reason
      ? String(entry.reason)
      : 'unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const toolVersion = getToolVersion();
  const effectiveConfigHash = getEffectiveConfigHash(root, userConfig);
  const repoProvenance = await getRepoProvenance(root);
  const metrics = {
    generatedAt: new Date().toISOString(),
    tool: {
      version: toolVersion,
      node: process.version,
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch()
      },
      configHash: effectiveConfigHash
    },
    repo: {
      provenance: repoProvenance
    },
    repoRoot: path.resolve(root),
    mode,
    indexDir: path.resolve(outDir),
    incremental: incrementalEnabled,
    git: { branch: repoProvenance.branch, isRepo: repoProvenance.isRepo },
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
      model: modelId,
      enabled: denseVectorsEnabled
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
    await writeJsonObjectFile(
      path.join(metricsDir, `index-${mode}.json`),
      { fields: metrics, atomic: true }
    );
    if (perfProfile) {
      await writeJsonObjectFile(
        path.join(metricsDir, `perf-profile-${mode}.json`),
        { fields: perfProfile, atomic: true }
      );
    }
  } catch {}
}
