import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizeEmbeddingVectorInPlace } from '../../../src/shared/embedding-utils.js';
import { normalizeHnswConfig } from '../../../src/shared/hnsw.js';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { runIsolatedBackendJobs } from './backend-isolate.js';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';
import { createTempPath, replaceFile } from './atomic.js';
import { copyFileWithDurability } from '../../../src/shared/io/persistence-helpers.js';
import { resolveVectorsSource } from './vector-source.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

const TRACE_ARTIFACT_IO = getEnvConfig().traceArtifactIo === true;

const require = createRequire(import.meta.url);
let hnswLib = null;
let hnswLoadError = null;
let hnswWarned = false;

const loadHnswLib = () => {
  if (hnswLib || hnswLoadError) return { lib: hnswLib, error: hnswLoadError };
  try {
    hnswLib = require('hnswlib-node');
  } catch (err) {
    hnswLoadError = err;
  }
  return { lib: hnswLib, error: hnswLoadError };
};

export const createHnswBuilder = ({ enabled, config, totalChunks, mode, logger }) => {
  const traceLog = (message) => {
    if (!TRACE_ARTIFACT_IO) return;
    if (typeof logger?.log === 'function') {
      logger.log(message);
      return;
    }
    console.log(message);
  };
  const { lib, error } = loadHnswLib();
  const HierarchicalNSW = lib?.default?.HierarchicalNSW || lib?.HierarchicalNSW || null;
  if (enabled && error && !hnswWarned) {
    hnswWarned = true;
    const message = `[embeddings] HNSW disabled; failed to load hnswlib-node (${error?.code || 'load_error'}).`;
    if (logger?.warn) {
      logger.warn(message);
    } else {
      console.warn(message);
    }
  }
  let index = null;
  let added = 0;
  let expected = 0;
  let failed = 0;
  const failedChunks = [];
  const failureMessages = [];

  const isVectorLike = (value) => (
    Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))
  );
  const initHnsw = (vector) => {
    if (!enabled || index || !isVectorLike(vector) || !vector.length) return;
    if (!HierarchicalNSW) return;
    index = new HierarchicalNSW(config.space, vector.length);
    index.initIndex({
      maxElements: totalChunks,
      m: config.m,
      efConstruction: config.efConstruction,
      randomSeed: config.randomSeed,
      allowReplaceDeleted: config.allowReplaceDeleted
    });
  };

  const addVector = (chunkIndex, vector) => {
    if (!enabled || !isVectorLike(vector) || !vector.length) return;
    const data = Array.isArray(vector) ? vector : Array.from(vector);
    initHnsw(data);
    if (!index) return;
    expected += 1;
    try {
      index.addPoint(data, chunkIndex);
      added += 1;
    } catch (err) {
      failed += 1;
      if (failedChunks.length < 25) failedChunks.push(chunkIndex);
      if (failureMessages.length < 3) {
        failureMessages.push(err?.message || String(err));
      }
    }
  };

  const writeIndex = async ({ indexPath, metaPath, modelId, dims, quantization, scale }) => {
    if (!enabled || !index || !expected) return { skipped: true };
    if (expected !== added) {
      const reportPath = metaPath
        ? metaPath.replace(/\.meta\.json$/i, '.failures.json')
        : `${indexPath}.failures.json`;
      const failureReport = {
        version: 1,
        generatedAt: new Date().toISOString(),
        model: modelId || null,
        dims,
        expected,
        added,
        failed,
        failedChunks,
        failures: failureMessages
      };
      try {
        await writeJsonObjectFile(reportPath, { fields: failureReport, atomic: true });
      } catch {}
      throw new Error(`HNSW insert count mismatch (${added} of ${expected}).`);
    }
    const tempHnswPath = createTempPath(indexPath);
    try {
      index.writeIndexSync(path.toNamespacedPath(tempHnswPath));
      const hasTempIndex = fsSync.existsSync(tempHnswPath);
      if (!hasTempIndex) {
        // Some hnswlib builds can race temp visibility on Windows. Fall back
        // to direct write instead of failing the whole backend.
        traceLog(`[embeddings] ${mode}/hnsw: temp index missing after write; falling back to direct write.`);
        index.writeIndexSync(path.toNamespacedPath(indexPath));
      } else {
        if (fsSync.existsSync(indexPath)) {
          const backupPath = `${indexPath}.bak`;
          const backupTempPath = createTempPath(backupPath);
          try {
            await copyFileWithDurability(indexPath, backupTempPath);
            await replaceFile(backupTempPath, backupPath);
          } finally { await fs.rm(backupTempPath, { force: true }); }
        }
        traceLog(`[embeddings] ${mode}/hnsw: moving ${tempHnswPath} -> ${indexPath}`);
        await replaceFile(tempHnswPath, indexPath);
      }
    } catch (err) {
      if (err?.code === 'ERR_TEMP_MISSING') {
        try {
          traceLog(`[embeddings] ${mode}/hnsw: retrying direct write after missing temp.`);
          index.writeIndexSync(path.toNamespacedPath(indexPath));
        } catch (directErr) {
          try {
            traceLog(`[embeddings] ${mode}/hnsw: deleting temp ${tempHnswPath}`);
            await fs.rm(tempHnswPath, { force: true });
          } catch {}
          throw directErr;
        }
      } else {
        try {
          traceLog(`[embeddings] ${mode}/hnsw: deleting temp ${tempHnswPath}`);
          await fs.rm(tempHnswPath, { force: true });
        } catch {}
        throw err;
      }
      try {
        traceLog(`[embeddings] ${mode}/hnsw: deleting temp ${tempHnswPath}`);
        await fs.rm(tempHnswPath, { force: true });
      } catch {}
    }
    const hnswMeta = {
      version: 1,
      generatedAt: new Date().toISOString(),
      model: modelId || null,
      dims,
      count: added,
      expectedCount: expected,
      space: config.space,
      m: config.m,
      efConstruction: config.efConstruction,
      efSearch: config.efSearch,
      scale: Number.isFinite(Number(scale)) ? Number(scale) : undefined,
      minVal: Number.isFinite(Number(quantization?.minVal)) ? Number(quantization.minVal) : undefined,
      maxVal: Number.isFinite(Number(quantization?.maxVal)) ? Number(quantization.maxVal) : undefined,
      levels: Number.isFinite(Number(quantization?.levels)) ? Number(quantization.levels) : undefined
    };
    await writeJsonObjectFile(metaPath, { fields: hnswMeta, atomic: true });
    return { skipped: false, count: added };
  };

  const getStats = () => ({ added, expected, ready: !!index });

  return {
    addVector,
    writeIndex,
    getStats
  };
};

const writeHnswIndexInProcess = async ({
  indexPath,
  metaPath,
  modelId,
  dims,
  quantization,
  scale,
  vectors,
  vectorsPath,
  normalize,
  config,
  logger,
  signal = null
}) => {
  const vectorsSource = Array.isArray(vectors) && vectors.length
    ? { count: vectors.length, vectors, rows: null }
    : resolveVectorsSource(vectorsPath, {
      includeCanonicalBase: true,
      requireManifestDeclaration: true,
      tryCandidateJson: true,
      expectedDims: dims,
      expectedModelId: modelId,
      signal
    });
  if (!vectorsSource || !Number.isFinite(vectorsSource.count) || vectorsSource.count <= 0) {
    return { skipped: true, reason: 'empty' };
  }
  const resolvedConfig = normalizeHnswConfig(config);
  if (!resolvedConfig.enabled) return { skipped: true, reason: 'disabled' };
  const builder = createHnswBuilder({
    enabled: resolvedConfig.enabled,
    config: resolvedConfig,
    totalChunks: vectorsSource.count,
    mode: 'embeddings',
    logger
  });
  if (vectorsSource.rows && typeof vectorsSource.rows[Symbol.asyncIterator] === 'function') {
    let i = 0;
    for await (const entry of vectorsSource.rows) {
      throwIfAborted(signal);
      const vec = (entry && typeof entry === 'object' && !Array.isArray(entry))
        ? (entry.vector ?? entry.values ?? null)
        : entry;
      if (vec && typeof vec.length === 'number' && vec.length) {
        const floatVec = dequantizeUint8ToFloat32(
          vec,
          quantization?.minVal,
          quantization?.maxVal,
          quantization?.levels
        );
        if (floatVec) {
          if (normalize !== false) {
            normalizeEmbeddingVectorInPlace(floatVec);
          }
          builder.addVector(i, floatVec);
        }
      }
      i += 1;
    }
  } else {
    for (let i = 0; i < vectorsSource.vectors.length; i += 1) {
      throwIfAborted(signal);
      const vec = vectorsSource.vectors[i];
      if (!vec || typeof vec.length !== 'number' || !vec.length) continue;
      const floatVec = dequantizeUint8ToFloat32(
        vec,
        quantization?.minVal,
        quantization?.maxVal,
        quantization?.levels
      );
      if (!floatVec) continue;
      if (normalize !== false) {
        normalizeEmbeddingVectorInPlace(floatVec);
      }
      builder.addVector(i, floatVec);
    }
  }
  throwIfAborted(signal);
  return builder.writeIndex({
    indexPath,
    metaPath,
    modelId,
    dims,
    quantization,
    scale
  });
};

export async function writeHnswIndex({
  indexPath,
  metaPath,
  modelId,
  dims,
  quantization,
  scale,
  vectors,
  vectorsPath,
  normalize = true,
  config,
  isolate = false,
  skipIsolate = false,
  logger,
  signal = null
}) {
  const resolvedConfig = normalizeHnswConfig(config);
  if (!resolvedConfig.enabled) return { skipped: true, reason: 'disabled' };
  if (isolate && !skipIsolate) {
    if (!vectorsPath) return { skipped: true, reason: 'missing vectors path for isolate' };
    const batch = await runIsolatedBackendJobs({ backend: 'hnsw', signal,
      jobs: [{ target: 'merged', payload: { indexPath, metaPath, modelId, dims, quantization, scale,
        vectorsPath, normalize, config: resolvedConfig } }] });
    const result = batch.results.merged;
    if (result?.reason === 'isolate failed') throw Object.assign(new Error(result.error.message),
      { code: result.error.code, diagnosticEvidence: result.error.diagnosticEvidence, result });
    return result;
  }
  return writeHnswIndexInProcess({
    indexPath,
    metaPath,
    modelId,
    dims,
    quantization,
    scale,
    vectors,
    vectorsPath,
    normalize,
    config: resolvedConfig,
    logger,
    signal
  });
}
