import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { tryImport } from '../../../src/shared/optional-deps.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { normalizeEmbeddingVectorInPlace } from '../../../src/shared/embedding-utils.js';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';
import { normalizeLanceDbConfig, resolveLanceDbPaths } from '../../../src/shared/lancedb.js';
import { loadJsonArrayArtifactRows, readJsonFile } from '../../../src/shared/artifact-io.js';
import { getEnvConfig, getLanceDbEnv } from '../../../src/shared/env.js';
import { runIsolatedNodeScriptSync } from '../../../src/shared/subprocess.js';

let warnedMissing = false;
const CHILD_ENV = 'PAIROFCLEATS_LANCEDB_CHILD';
const PAYLOAD_ENV = 'PAIROFCLEATS_LANCEDB_PAYLOAD';
const TRACE_ARTIFACT_IO = getEnvConfig().traceArtifactIo === true;

const loadLanceDb = async (logger) => {
  const result = await tryImport('@lancedb/lancedb');
  if (!result.ok) {
    if (!warnedMissing) {
      warnedMissing = true;
      logger.warn('[embeddings] LanceDB unavailable; skipping LanceDB build.');
    }
    return null;
  }
  return result.mod?.default || result.mod;
};

const resolveVectorsSource = (vectorsPath) => {
  if (!vectorsPath) return null;
  const dir = path.dirname(vectorsPath);
  const base = path.basename(vectorsPath, path.extname(vectorsPath));
  const metaPath = path.join(dir, `${base}.meta.json`);
  const hasShardedMeta = fsSync.existsSync(metaPath) || fsSync.existsSync(`${metaPath}.bak`);
  if (hasShardedMeta) {
    try {
      const meta = readJsonFile(metaPath, { maxBytes: Number.POSITIVE_INFINITY });
      const count = Number.isFinite(Number(meta?.totalRecords))
        ? Math.max(0, Math.floor(Number(meta.totalRecords)))
        : 0;
      return {
        count,
        vectors: null,
        rows: loadJsonArrayArtifactRows(dir, base, {
          maxBytes: Number.POSITIVE_INFINITY,
          strict: false,
          materialize: true
        })
      };
    } catch {}
  }
  const data = readJsonFile(vectorsPath);
  if (!data) return null;
  const vectors = Array.isArray(data?.arrays?.vectors)
    ? data.arrays.vectors
    : (Array.isArray(data?.vectors) ? data.vectors : null);
  if (!Array.isArray(vectors) || !vectors.length) return null;
  return { count: vectors.length, vectors, rows: null };
};

const shouldIsolateLanceDb = (config, env) => {
  if (env?.child) return false;
  if (config?.isolate === false) return false;
  if (config?.isolate === true) return true;
  if (env?.isolate) return true;
  return false;
};

const createTable = async (db, tableName, rows) => {
  if (!db || typeof db.createTable !== 'function') return null;
  return db.createTable(tableName, rows, { mode: 'overwrite' });
};

const addRows = async (table, rows) => {
  if (!table) return;
  if (typeof table.add === 'function') {
    await table.add(rows);
    return;
  }
  if (typeof table.insert === 'function') {
    await table.insert(rows);
    return;
  }
  if (typeof table.append === 'function') {
    await table.append(rows);
  }
};

const buildBatch = (vectors, start, end, idColumn, embeddingColumn, quantization, normalize) => {
  const rows = [];
  for (let i = start; i < end; i += 1) {
    const vec = vectors[i];
    if (!vec || typeof vec.length !== 'number') continue;
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
    rows.push({
      [idColumn]: i,
      [embeddingColumn]: Array.from(floatVec)
    });
  }
  return rows;
};

/**
 * Write a LanceDB index for a vector variant.
 * @param {object} params
 * @param {string} params.indexDir
 * @param {'merged'|'doc'|'code'} params.variant
 * @param {Array<ArrayLike<number>>} [params.vectors]
 * @param {string} [params.vectorsPath]
 * @param {number} params.dims
 * @param {string} params.modelId
 * @param {object} params.quantization
 * @param {number} params.scale
 * @param {boolean} params.normalize
 * @param {object} params.config
 * @param {boolean} [params.skipIsolate]
 * @param {boolean} [params.emitOutput]
 * @param {string|null} [params.label]
 * @param {object} [params.logger]
 * @returns {Promise<{skipped:boolean,reason?:string,count?:number}>}
 */
export async function writeLanceDbIndex({
  indexDir,
  variant,
  vectors,
  vectorsPath = null,
  dims,
  modelId,
  quantization,
  scale,
  normalize,
  config,
  skipIsolate = false,
  emitOutput = true,
  label = null,
  logger = console
}) {
  const resolvedConfig = normalizeLanceDbConfig(config);
  if (!resolvedConfig.enabled) return { skipped: true, reason: 'disabled' };
  const lanceEnv = getLanceDbEnv();
  const vectorsSource = Array.isArray(vectors) && vectors.length
    ? { count: vectors.length, vectors, rows: null }
    : resolveVectorsSource(vectorsPath);
  if (TRACE_ARTIFACT_IO && vectorsPath) {
    const exists = fsSync.existsSync(vectorsPath)
      || fsSync.existsSync(`${vectorsPath}.gz`)
      || fsSync.existsSync(`${vectorsPath}.zst`)
      || fsSync.existsSync(`${vectorsPath}.bak`);
    logger.log(`[embeddings] ${label || variant}: vectors source path=${vectorsPath} exists=${exists}`);
  }
  if (!vectorsSource || !Number.isFinite(vectorsSource.count) || vectorsSource.count <= 0) {
    return { skipped: true, reason: 'empty' };
  }
  if (!skipIsolate && shouldIsolateLanceDb(resolvedConfig, lanceEnv)) {
    if (!vectorsPath) {
      return { skipped: true, reason: 'missing vectors path for isolate' };
    }
    const moduleUrl = new URL('./lancedb.js', import.meta.url).href;
    const payload = {
      indexDir,
      variant,
      vectorsPath,
      dims,
      modelId,
      quantization,
      scale,
      normalize,
      config: resolvedConfig,
      emitOutput: false,
      label
    };
    const script = `
      const payload = JSON.parse(process.env.${PAYLOAD_ENV} || '{}');
      const moduleUrl = payload.moduleUrl;
      const run = async () => {
        const mod = await import(moduleUrl);
        const result = await mod.writeLanceDbIndex(payload);
        process.stdout.write(JSON.stringify(result || {}));
      };
      run().catch((err) => {
        console.error(err && err.message ? err.message : String(err));
        process.exit(2);
      });
    `;
    payload.moduleUrl = moduleUrl;
    const result = runIsolatedNodeScriptSync({
      script,
      env: {
        ...process.env,
        [CHILD_ENV]: '1',
        [PAYLOAD_ENV]: JSON.stringify(payload)
      },
      maxOutputBytes: 1024 * 1024,
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false,
      name: 'lancedb'
    });
    if (result.exitCode !== 0) {
      const detail = typeof result.stderr === 'string' ? result.stderr.trim() : '';
      if (emitOutput && detail) {
        logger.warn(`[embeddings] ${label || variant}: LanceDB isolate failed: ${detail}`);
      }
      return { skipped: true, reason: 'isolate failed' };
    }
    let parsed = {};
    try {
      parsed = typeof result.stdout === 'string' ? JSON.parse(result.stdout) : {};
    } catch {}
    if (emitOutput && parsed && parsed.count) {
      const targetLabel = label || variant;
      logger.log(`[embeddings] ${targetLabel}: wrote LanceDB table (${parsed.count} vectors).`);
    }
    return parsed || { skipped: false };
  }

  const lancedb = await loadLanceDb(logger);
  if (!lancedb) return { skipped: true, reason: 'missing dependency' };

  const paths = resolveLanceDbPaths(indexDir);
  const target = paths[variant];
  if (!target) return { skipped: true, reason: 'unknown variant' };
  const dir = target.dir;
  const metaPath = target.metaPath;

  try {
    if (fsSync.existsSync(dir)) {
      if (TRACE_ARTIFACT_IO) {
        logger.log(`[embeddings] ${label || variant}: deleting existing LanceDB dir ${dir}`);
      }
      await fs.rm(dir, { recursive: true, force: true });
      if (TRACE_ARTIFACT_IO) {
        logger.log(`[embeddings] ${label || variant}: deleted LanceDB dir ${dir}`);
      }
    }
  } catch {}

  const connect = lancedb.connect || lancedb.default?.connect;
  if (typeof connect !== 'function') {
    return { skipped: true, reason: 'invalid module' };
  }

  const db = await connect(dir);
  const tableName = resolvedConfig.table;
  const idColumn = resolvedConfig.idColumn;
  const embeddingColumn = resolvedConfig.embeddingColumn;
  const batchSize = Math.max(1, Math.floor(resolvedConfig.batchSize || 1024));

  let table = null;
  try {
    if (vectorsSource.rows && typeof vectorsSource.rows[Symbol.asyncIterator] === 'function') {
      let docId = 0;
      let firstBatch = [];
      let batch = [];
      for await (const entry of vectorsSource.rows) {
        const vec = (entry && typeof entry === 'object' && !Array.isArray(entry))
          ? (entry.vector ?? entry.values ?? null)
          : entry;
        if (vec && typeof vec.length === 'number') {
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
            batch.push({
              [idColumn]: docId,
              [embeddingColumn]: Array.from(floatVec)
            });
          }
        }
        docId += 1;
        if (batch.length >= batchSize) {
          if (!table) {
            firstBatch = batch;
            table = await createTable(db, tableName, firstBatch);
            if (!table && typeof db.openTable === 'function') {
              table = await db.openTable(tableName);
              if (firstBatch.length) await addRows(table, firstBatch);
            }
          } else if (batch.length) {
            await addRows(table, batch);
          }
          batch = [];
        }
      }
      if (!table) {
        firstBatch = batch;
        table = await createTable(db, tableName, firstBatch);
        if (!table && typeof db.openTable === 'function') {
          table = await db.openTable(tableName);
          if (firstBatch.length) await addRows(table, firstBatch);
        }
      } else if (batch.length) {
        await addRows(table, batch);
      }
    } else {
      const resolvedVectors = vectorsSource.vectors;
      const firstBatch = buildBatch(
        resolvedVectors,
        0,
        Math.min(batchSize, resolvedVectors.length),
        idColumn,
        embeddingColumn,
        quantization,
        normalize
      );
      table = await createTable(db, tableName, firstBatch);
      if (!table && typeof db.openTable === 'function') {
        table = await db.openTable(tableName);
        if (firstBatch.length) await addRows(table, firstBatch);
      }
      for (let start = batchSize; start < resolvedVectors.length; start += batchSize) {
        const rows = buildBatch(
          resolvedVectors,
          start,
          Math.min(start + batchSize, resolvedVectors.length),
          idColumn,
          embeddingColumn,
          quantization,
          normalize
        );
        if (rows.length) {
          await addRows(table, rows);
        }
      }
    }
  } finally {
    if (db?.close) {
      await db.close();
    }
  }

  const meta = {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: modelId || null,
    dims: Number.isFinite(Number(dims)) ? Number(dims) : null,
    count: vectorsSource.count,
    metric: resolvedConfig.metric,
    table: tableName,
    embeddingColumn,
    idColumn,
    scale: Number.isFinite(Number(scale)) ? Number(scale) : undefined,
    minVal: Number.isFinite(Number(quantization?.minVal)) ? Number(quantization.minVal) : undefined,
    maxVal: Number.isFinite(Number(quantization?.maxVal)) ? Number(quantization.maxVal) : undefined,
    levels: Number.isFinite(Number(quantization?.levels)) ? Number(quantization.levels) : undefined
  };
  await writeJsonObjectFile(metaPath, { fields: meta, atomic: true });

  if (emitOutput) {
    const targetLabel = label || variant;
    logger.log(`[embeddings] ${targetLabel}: wrote LanceDB table (${vectorsSource.count} vectors).`);
  }
  return { skipped: false, count: vectorsSource.count };
}
