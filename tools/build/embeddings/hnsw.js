import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadJsonArrayArtifactRows, loadPiecesManifest, readJsonFile } from '../../../src/shared/artifact-io.js';
import { normalizeEmbeddingVectorInPlace } from '../../../src/shared/embedding-utils.js';
import { normalizeHnswConfig } from '../../../src/shared/hnsw.js';
import { getEnvConfig } from '../../../src/shared/env.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { runIsolatedNodeScriptSync } from '../../../src/shared/subprocess.js';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';
import { createTempPath, replaceFile } from './atomic.js';

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

const toCanonicalArtifactBase = (base) => {
  if (!base || typeof base !== 'string') return '';
  if (base.endsWith('_uint8')) return base.slice(0, -('_uint8'.length));
  if (base.endsWith('_f32')) return base.slice(0, -('_f32'.length));
  if (base.endsWith('_float32')) return base.slice(0, -('_float32'.length));
  if (base.endsWith('_fp32')) return base.slice(0, -('_fp32'.length));
  return base;
};

const resolveArtifactBaseCandidates = (base) => {
  const candidates = [];
  const add = (value) => {
    if (!value || candidates.includes(value)) return;
    candidates.push(value);
  };
  add(base);
  add(toCanonicalArtifactBase(base));
  return candidates;
};

const resolveVectorsSource = (vectorsPath) => {
  if (!vectorsPath) return null;
  const dir = path.dirname(vectorsPath);
  const base = path.basename(vectorsPath, path.extname(vectorsPath));
  const ext = path.extname(vectorsPath) || '.json';
  const baseCandidates = resolveArtifactBaseCandidates(base);
  let manifest = null;
  try {
    manifest = loadPiecesManifest(dir, {
      maxBytes: Number.POSITIVE_INFINITY,
      strict: false
    });
  } catch {
    manifest = null;
  }
  const manifestNames = new Set(
    Array.isArray(manifest?.pieces)
      ? manifest.pieces
        .map((piece) => (piece && typeof piece.name === 'string' ? piece.name : null))
        .filter(Boolean)
      : []
  );
  for (const artifactBase of baseCandidates) {
    const metaPath = path.join(dir, `${artifactBase}.meta.json`);
    const hasShardedMeta = fsSync.existsSync(metaPath) || fsSync.existsSync(`${metaPath}.bak`);
    if (!hasShardedMeta) continue;
    try {
      const meta = readJsonFile(metaPath, { maxBytes: Number.POSITIVE_INFINITY });
      const count = Number.isFinite(Number(meta?.totalRecords))
        ? Math.max(0, Math.floor(Number(meta.totalRecords)))
        : 0;
      if (manifest && manifestNames.size && !manifestNames.has(artifactBase)) {
        continue;
      }
      return {
        count,
        vectors: null,
        rows: loadJsonArrayArtifactRows(dir, artifactBase, {
          maxBytes: Number.POSITIVE_INFINITY,
          manifest,
          strict: false,
          materialize: true
        })
      };
    } catch {}
  }
  for (const artifactBase of baseCandidates) {
    const candidatePath = path.join(dir, `${artifactBase}${ext}`);
    try {
      const data = readJsonFile(candidatePath, { maxBytes: Number.POSITIVE_INFINITY });
      const vectors = Array.isArray(data?.arrays?.vectors)
        ? data.arrays.vectors
        : (Array.isArray(data?.vectors) ? data.vectors : null);
      if (!Array.isArray(vectors) || !vectors.length) continue;
      return { count: vectors.length, vectors, rows: null };
    } catch {}
  }
  try {
    const data = readJsonFile(vectorsPath, { maxBytes: Number.POSITIVE_INFINITY });
    const vectors = Array.isArray(data?.arrays?.vectors)
      ? data.arrays.vectors
      : (Array.isArray(data?.vectors) ? data.vectors : null);
    if (!Array.isArray(vectors) || !vectors.length) return null;
    return { count: vectors.length, vectors, rows: null };
  } catch {}
  return null;
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
      index.writeIndexSync(tempHnswPath);
      const hasTempIndex = fsSync.existsSync(tempHnswPath);
      if (!hasTempIndex) {
        // Some hnswlib builds can race temp visibility on Windows. Fall back
        // to direct write instead of failing the whole backend.
        traceLog(`[embeddings] ${mode}/hnsw: temp index missing after write; falling back to direct write.`);
        index.writeIndexSync(indexPath);
      } else {
        try {
          traceLog(`[embeddings] ${mode}/hnsw: deleting backup ${indexPath}.bak`);
          await fs.rm(`${indexPath}.bak`, { force: true });
        } catch {}
        traceLog(`[embeddings] ${mode}/hnsw: moving ${tempHnswPath} -> ${indexPath}`);
        await replaceFile(tempHnswPath, indexPath, { keepBackup: true });
      }
    } catch (err) {
      if (err?.code === 'ERR_TEMP_MISSING') {
        try {
          traceLog(`[embeddings] ${mode}/hnsw: retrying direct write after missing temp.`);
          index.writeIndexSync(indexPath);
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
  logger
}) => {
  const vectorsSource = Array.isArray(vectors) && vectors.length
    ? { count: vectors.length, vectors, rows: null }
    : resolveVectorsSource(vectorsPath);
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
  logger
}) {
  const resolvedConfig = normalizeHnswConfig(config);
  if (!resolvedConfig.enabled) return { skipped: true, reason: 'disabled' };
  if (isolate && !skipIsolate) {
    if (!vectorsPath) {
      return { skipped: true, reason: 'missing vectors path for isolate' };
    }
    const moduleUrl = new URL('./hnsw.js', import.meta.url).href;
    const payload = {
      indexPath,
      metaPath,
      modelId,
      dims,
      quantization,
      scale,
      vectorsPath,
      normalize,
      config: resolvedConfig,
      isolate: false,
      skipIsolate: true
    };
    const script = `
      const payload = ${JSON.stringify(payload)};
      const run = async () => {
        const mod = await import(${JSON.stringify(moduleUrl)});
        const result = await mod.writeHnswIndex(payload);
        process.stdout.write(JSON.stringify(result || {}));
      };
      run().catch((err) => {
        console.error(err && err.message ? err.message : String(err));
        process.exit(2);
      });
    `;
    const result = runIsolatedNodeScriptSync({
      script,
      env: process.env,
      maxOutputBytes: 1024 * 1024,
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false,
      name: 'hnsw'
    });
    if (result.exitCode !== 0) {
      const detail = typeof result.stderr === 'string' ? result.stderr.trim() : '';
      throw new Error(`HNSW isolate failed${detail ? `: ${detail}` : ''}`);
    }
    const stdoutText = typeof result.stdout === 'string' ? result.stdout.trim() : '';
    let parsed = null;
    if (stdoutText) {
      const lines = stdoutText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          parsed = JSON.parse(lines[i]);
          break;
        } catch {}
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('HNSW isolate returned invalid JSON output.');
    }
    if (parsed.skipped !== true && !Number.isFinite(Number(parsed.count))) {
      throw new Error('HNSW isolate returned incomplete result payload.');
    }
    return parsed;
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
    logger
  });
}
