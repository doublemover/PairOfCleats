import fs from 'node:fs/promises';
import path from 'node:path';
import { log, logLine, showProgress } from '../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io.js';
import {
  writeJsonArrayFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../shared/json-stream.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { ensureDiskSpace } from '../../shared/disk-space.js';
import { resolveCompressionConfig } from './artifacts/compression.js';
import { writePiecesManifest } from './artifacts/checksums.js';
import { buildFileMeta } from './artifacts/file-meta.js';
import { buildSerializedFilterIndex } from './artifacts/filter-index.js';
import { writeIndexMetrics } from './artifacts/metrics.js';
import { resolveTokenMode } from './artifacts/token-mode.js';
import { createArtifactWriter } from './artifacts/writer.js';
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
  const documentExtractionEnabled = indexingConfig.documentExtraction?.enabled === true;
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
  const resolveShardCompression = (base) => (
    compressionEnabled && !compressionKeepRaw && compressibleArtifacts.has(base)
      ? compressionMode
      : null
  );
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
  const graphRelationGraphs = ['callGraph', 'usageGraph', 'importGraph'];
  const createGraphRelationsIterator = (relations) => function* graphRelationsIterator() {
    if (!relations || typeof relations !== 'object') return;
    for (const graphName of graphRelationGraphs) {
      const graph = relations[graphName];
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
      for (const node of nodes) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
        yield { graph: graphName, node };
      }
    }
  };
  const measureGraphRelations = (relations) => {
    if (!relations || typeof relations !== 'object') return null;
    const graphs = {};
    const graphSizes = {};
    let totalJsonlBytes = 0;
    let totalEntries = 0;
    for (const graphName of graphRelationGraphs) {
      const graph = relations[graphName] || {};
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
      const nodeCount = Number.isFinite(graph.nodeCount) ? graph.nodeCount : nodes.length;
      const edgeCount = Number.isFinite(graph.edgeCount)
        ? graph.edgeCount
        : nodes.reduce((sum, node) => sum + (Array.isArray(node?.out) ? node.out.length : 0), 0);
      graphs[graphName] = { nodeCount, edgeCount };
      let nodesBytes = 0;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const nodeJson = JSON.stringify(node);
        nodesBytes += Buffer.byteLength(nodeJson, 'utf8') + (i > 0 ? 1 : 0);
        const line = JSON.stringify({ graph: graphName, node });
        const lineBytes = Buffer.byteLength(line, 'utf8');
        if (maxJsonBytes && (lineBytes + 1) > maxJsonBytes) {
          throw new Error(`graph_relations entry exceeds max JSON size (${lineBytes} bytes).`);
        }
        totalJsonlBytes += lineBytes + 1;
        totalEntries += 1;
      }
      const baseGraphBytes = Buffer.byteLength(
        JSON.stringify({ nodeCount, edgeCount, nodes: [] }),
        'utf8'
      );
      graphSizes[graphName] = baseGraphBytes + nodesBytes;
    }
    const version = Number.isFinite(relations.version) ? relations.version : 1;
    const generatedAt = typeof relations.generatedAt === 'string'
      ? relations.generatedAt
      : new Date().toISOString();
    const basePayload = {
      version,
      generatedAt,
      callGraph: {},
      usageGraph: {},
      importGraph: {}
    };
    if (relations.caps !== undefined) basePayload.caps = relations.caps;
    const baseBytes = Buffer.byteLength(JSON.stringify(basePayload), 'utf8');
    const totalJsonBytes = baseBytes
      + graphSizes.callGraph - 2
      + graphSizes.usageGraph - 2
      + graphSizes.importGraph - 2;
    return { totalJsonBytes, totalJsonlBytes, totalEntries, graphs, version, generatedAt };
  };

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
    userConfig,
    root
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
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes: tokenPostingsEstimate?.estimatedBytes,
    label: `${mode} token_postings`
  });
  const removeArtifact = async (targetPath) => {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
    } catch {}
  };
  const removeCompressedArtifact = async (base) => {
    await removeArtifact(path.join(outDir, `${base}.json.gz`));
    await removeArtifact(path.join(outDir, `${base}.json.zst`));
  };
  if (tokenPostingsUseShards) {
    await removeArtifact(path.join(outDir, 'token_postings.json'));
    await removeCompressedArtifact('token_postings');
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
  const writeProgressMeta = { stage: 'write', mode, taskId: `write:${mode}:artifacts` };
  const formatArtifactLabel = (filePath) => path.relative(outDir, filePath).split(path.sep).join('/');
  const pieceEntries = [];
  const addPieceFile = (entry, filePath) => {
    pieceEntries.push({ ...entry, path: formatArtifactLabel(filePath) });
  };
  addPieceFile({ type: 'stats', name: 'filelists', format: 'json' }, path.join(outDir, '.filelists.json'));
  const logWriteProgress = (label) => {
    completedWrites += 1;
    if (label) lastWriteLabel = label;
    showProgress('Artifacts', completedWrites, totalWrites, {
      ...writeProgressMeta,
      message: label || null
    });
    const now = Date.now();
    if (completedWrites === totalWrites || completedWrites === 1 || (now - lastWriteLog) >= writeLogIntervalMs) {
      lastWriteLog = now;
      const percent = totalWrites > 0
        ? (completedWrites / totalWrites * 100).toFixed(1)
        : '100.0';
      const suffix = lastWriteLabel ? ` | ${lastWriteLabel}` : '';
      logLine(`Writing index files ${completedWrites}/${totalWrites} (${percent}%)${suffix}`, { kind: 'status' });
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
  const { enqueueJsonObject, enqueueJsonArray } = createArtifactWriter({
    outDir,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressibleArtifacts
  });

  const denseVectorsEnabled = postings.dims > 0 && postings.quantizedVectors.length;
  if (!denseVectorsEnabled) {
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.json'));
    await removeCompressedArtifact('dense_vectors_uint8');
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.json'));
    await removeCompressedArtifact('dense_vectors_doc_uint8');
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.json'));
    await removeCompressedArtifact('dense_vectors_code_uint8');
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
  const chunkMetaCompression = resolveShardCompression('chunk_meta');
  await enqueueChunkMetaArtifacts({
    state,
    outDir,
    mode,
    chunkMetaIterator,
    chunkMetaPlan,
    maxJsonBytes,
    compression: chunkMetaCompression,
    enqueueJsonArray,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  const repoMapMeasurement = (() => {
    let totalEntries = 0;
    let totalBytes = 2;
    let totalJsonlBytes = 0;
    for (const entry of repoMapIterator()) {
      const line = JSON.stringify(entry);
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (maxJsonBytes && (lineBytes + 1) > maxJsonBytes) {
        throw new Error(`repo_map entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalBytes += lineBytes + (totalEntries > 0 ? 1 : 0);
      totalJsonlBytes += lineBytes + 1;
      totalEntries += 1;
    }
    return { totalEntries, totalBytes, totalJsonlBytes };
  })();
  const useRepoMapJsonl = repoMapMeasurement.totalEntries
    && maxJsonBytes
    && repoMapMeasurement.totalBytes > maxJsonBytes;
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes: useRepoMapJsonl ? repoMapMeasurement.totalJsonlBytes : repoMapMeasurement.totalBytes,
    label: `${mode} repo_map`
  });
  const repoMapCompression = resolveShardCompression('repo_map');
  const resolveJsonExtension = (value) => {
    if (value === 'gzip') return 'json.gz';
    if (value === 'zstd') return 'json.zst';
    return 'json';
  };
  const repoMapPath = path.join(outDir, `repo_map.${resolveJsonExtension(repoMapCompression)}`);
  const repoMapMetaPath = path.join(outDir, 'repo_map.meta.json');
  const repoMapPartsDir = path.join(outDir, 'repo_map.parts');
  const removeRepoMapJsonl = async () => {
    await removeArtifact(path.join(outDir, 'repo_map.jsonl'));
    await removeArtifact(path.join(outDir, 'repo_map.jsonl.gz'));
    await removeArtifact(path.join(outDir, 'repo_map.jsonl.zst'));
  };
  const removeRepoMapJson = async () => {
    await removeArtifact(path.join(outDir, 'repo_map.json'));
    await removeArtifact(path.join(outDir, 'repo_map.json.gz'));
    await removeArtifact(path.join(outDir, 'repo_map.json.zst'));
  };

  if (!useRepoMapJsonl) {
    enqueueWrite(
      formatArtifactLabel(repoMapPath),
      async () => {
        await removeRepoMapJsonl();
        await removeRepoMapJson();
        await removeArtifact(repoMapMetaPath);
        await removeArtifact(repoMapPartsDir);
        await writeJsonArrayFile(repoMapPath, repoMapIterator(), {
          atomic: true,
          compression: repoMapCompression
        });
      }
    );
    addPieceFile({
      type: 'chunks',
      name: 'repo_map',
      format: 'json',
      compression: repoMapCompression || null
    }, repoMapPath);
  } else {
    log(`repo_map ~${Math.round(repoMapMeasurement.totalJsonlBytes / 1024)}KB; writing JSONL shards.`);
    enqueueWrite(
      formatArtifactLabel(repoMapMetaPath),
      async () => {
        await removeRepoMapJson();
        await removeRepoMapJsonl();
        const result = await writeJsonLinesSharded({
          dir: outDir,
          partsDirName: 'repo_map.parts',
          partPrefix: 'repo_map.part-',
          items: repoMapIterator(),
          maxBytes: maxJsonBytes,
          atomic: true,
          compression: repoMapCompression
        });
        const shardSize = result.counts.length
          ? Math.max(...result.counts)
          : null;
        await writeJsonObjectFile(repoMapMetaPath, {
          fields: {
            format: 'jsonl',
            shardSize,
            totalEntries: result.total,
            parts: result.parts,
            compression: repoMapCompression || null
          },
          atomic: true
        });
        for (let i = 0; i < result.parts.length; i += 1) {
          const relPath = result.parts[i];
          const absPath = path.join(outDir, relPath.split('/').join(path.sep));
          addPieceFile({
            type: 'chunks',
            name: 'repo_map',
            format: 'jsonl',
            count: result.counts[i] || 0,
            compression: repoMapCompression || null
          }, absPath);
        }
        addPieceFile({ type: 'chunks', name: 'repo_map_meta', format: 'json' }, repoMapMetaPath);
      }
    );
  }
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
    const parts = [];
    const shardPlan = [];
    let shardIndex = 0;
    const tokenPostingsCompression = resolveShardCompression('token_postings');
    const resolveJsonExtension = (value) => {
      if (value === 'gzip') return 'json.gz';
      if (value === 'zstd') return 'json.zst';
      return 'json';
    };
    const tokenPostingsExtension = resolveJsonExtension(tokenPostingsCompression);
    for (let i = 0; i < postings.tokenVocab.length; i += tokenPostingsShardSize) {
      const end = Math.min(i + tokenPostingsShardSize, postings.tokenVocab.length);
      const partCount = end - i;
      const partName = `token_postings.part-${String(shardIndex).padStart(5, '0')}.${tokenPostingsExtension}`;
      parts.push(path.posix.join('token_postings.shards', partName));
      shardPlan.push({ start: i, end, partCount, partName });
      addPieceFile({
        type: 'postings',
        name: 'token_postings',
        format: 'json',
        count: partCount,
        compression: tokenPostingsCompression || null
      }, path.join(shardsDir, partName));
      shardIndex += 1;
    }
    const metaPath = path.join(outDir, 'token_postings.meta.json');
    addPieceFile({ type: 'postings', name: 'token_postings_meta', format: 'json' }, metaPath);
    enqueueWrite(
      formatArtifactLabel(shardsDir),
      async () => {
        const tempDir = `${shardsDir}.tmp-${Date.now()}`;
        const backupDir = `${shardsDir}.bak`;
        await fs.rm(tempDir, { recursive: true, force: true });
        await fs.mkdir(tempDir, { recursive: true });
        for (const part of shardPlan) {
          const partPath = path.join(tempDir, part.partName);
          await writeJsonObjectFile(partPath, {
            arrays: {
              vocab: postings.tokenVocab.slice(part.start, part.end),
              postings: postings.tokenPostingsList.slice(part.start, part.end)
            },
            compression: tokenPostingsCompression,
            atomic: true
          });
        }
        await fs.rm(backupDir, { recursive: true, force: true });
        try {
          await fs.stat(shardsDir);
          await fs.rename(shardsDir, backupDir);
        } catch {}
        await fs.rename(tempDir, shardsDir);
        await fs.rm(backupDir, { recursive: true, force: true });
        await writeJsonObjectFile(metaPath, {
          fields: {
            avgDocLen: postings.avgDocLen,
            totalDocs: state.docLengths.length,
            format: 'sharded',
            shardSize: tokenPostingsShardSize,
            vocabCount: postings.tokenVocab.length,
            parts,
            compression: tokenPostingsCompression || null
          },
          arrays: {
            docLengths: state.docLengths
          },
          atomic: true
        });
      }
    );
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
  const fileRelationsCompression = resolveShardCompression('file_relations');
  enqueueFileRelationsArtifacts({
    state,
    outDir,
    maxJsonBytes,
    log,
    compression: fileRelationsCompression,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  if (graphRelations && typeof graphRelations === 'object') {
    const graphMeasurement = measureGraphRelations(graphRelations);
    if (graphMeasurement) {
      const graphPath = path.join(outDir, 'graph_relations.json');
      const graphJsonlPath = path.join(outDir, 'graph_relations.jsonl');
      const graphMetaPath = path.join(outDir, 'graph_relations.meta.json');
      const graphPartsDir = path.join(outDir, 'graph_relations.parts');
      const useGraphJsonl = maxJsonBytes && graphMeasurement.totalJsonBytes > maxJsonBytes;
      if (!useGraphJsonl) {
        enqueueWrite(
          formatArtifactLabel(graphPath),
          async () => {
            await removeArtifact(graphJsonlPath);
            await removeArtifact(graphMetaPath);
            await removeArtifact(graphPartsDir);
            await writeJsonObjectFile(graphPath, { fields: graphRelations, atomic: true });
          }
        );
        addPieceFile({ type: 'relations', name: 'graph_relations', format: 'json' }, graphPath);
      } else {
        log(
          `graph_relations ~${Math.round(graphMeasurement.totalJsonlBytes / 1024)}KB; ` +
          'writing JSONL shards.'
        );
        enqueueWrite(
          formatArtifactLabel(graphMetaPath),
          async () => {
            await removeArtifact(graphPath);
            await removeArtifact(graphJsonlPath);
            const result = await writeJsonLinesSharded({
              dir: outDir,
              partsDirName: 'graph_relations.parts',
              partPrefix: 'graph_relations.part-',
              items: createGraphRelationsIterator(graphRelations)(),
              maxBytes: maxJsonBytes,
              atomic: true
            });
            const shardSize = result.counts.length
              ? Math.max(...result.counts)
              : null;
            await writeJsonObjectFile(graphMetaPath, {
              fields: {
                format: 'jsonl',
                version: graphMeasurement.version,
                generatedAt: graphMeasurement.generatedAt,
                graphs: graphMeasurement.graphs,
                caps: graphRelations.caps ?? null,
                shardSize,
                totalEntries: result.total,
                parts: result.parts
              },
              atomic: true
            });
            for (let i = 0; i < result.parts.length; i += 1) {
              const relPath = result.parts[i];
              const absPath = path.join(outDir, relPath.split('/').join(path.sep));
              addPieceFile({
                type: 'relations',
                name: 'graph_relations',
                format: 'jsonl',
                count: result.counts[i] || 0
              }, absPath);
            }
            addPieceFile({ type: 'relations', name: 'graph_relations_meta', format: 'json' }, graphMetaPath);
          }
        );
      }
    }
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
    logLine(`Writing index files (${totalWrites} ${artifactLabel})...`, { kind: 'status' });
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
    logLine('', { kind: 'status' });
  } else {
    logLine('Writing index files (0 artifacts)...', { kind: 'status' });
    logLine('', { kind: 'status' });
  }
  timing.writeMs = Date.now() - writeStart;
  timing.totalMs = Date.now() - timing.start;
  log(
    `📦  ${mode.padEnd(5)}: ${state.chunks.length.toLocaleString()} chunks, ${postings.tokenVocab.length.toLocaleString()} tokens, dims=${postings.dims}`
  );

  pieceEntries.sort((a, b) => {
    const pathA = String(a?.path || '');
    const pathB = String(b?.path || '');
    if (pathA !== pathB) return pathA.localeCompare(pathB);
    const typeA = String(a?.type || '');
    const typeB = String(b?.type || '');
    if (typeA !== typeB) return typeA.localeCompare(typeB);
    const nameA = String(a?.name || '');
    const nameB = String(b?.name || '');
    return nameA.localeCompare(nameB);
  });
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
    compressionKeepRaw,
    documentExtractionEnabled
  });
}
