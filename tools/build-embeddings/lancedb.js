import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { tryImport } from '../../src/shared/optional-deps.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { normalizeEmbeddingVectorInPlace } from '../../src/shared/embedding-utils.js';
import { dequantizeUint8ToFloat32 } from '../../src/storage/sqlite/vector.js';
import { normalizeLanceDbConfig, resolveLanceDbPaths } from '../../src/shared/lancedb.js';
import { readJsonFile } from '../../src/shared/artifact-io.js';
import { getLanceDbEnv, isTestingEnv } from '../../src/shared/env.js';
import { runIsolatedNodeScriptSync } from '../../src/shared/subprocess.js';

let warnedMissing = false;
const CHILD_ENV = 'PAIROFCLEATS_LANCEDB_CHILD';
const PAYLOAD_ENV = 'PAIROFCLEATS_LANCEDB_PAYLOAD';

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

const resolveVectorsFromFile = (vectorsPath) => {
  if (!vectorsPath) return null;
  const data = readJsonFile(vectorsPath);
  if (!data) return null;
  if (Array.isArray(data?.arrays?.vectors)) return data.arrays.vectors;
  if (Array.isArray(data?.vectors)) return data.vectors;
  return null;
};

const shouldIsolateLanceDb = (config, env) => {
  if (env?.child) return false;
  if (config?.isolate === true) return true;
  if (env?.isolate) return true;
  return isTestingEnv();
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
  emitOutput = true,
  label = null,
  logger = console
}) {
  const resolvedConfig = normalizeLanceDbConfig(config);
  if (!resolvedConfig.enabled) return { skipped: true, reason: 'disabled' };
  const lanceEnv = getLanceDbEnv();
  const resolvedVectors = Array.isArray(vectors) && vectors.length
    ? vectors
    : resolveVectorsFromFile(vectorsPath);
  if (!Array.isArray(resolvedVectors) || !resolvedVectors.length) {
    return { skipped: true, reason: 'empty' };
  }
  if (shouldIsolateLanceDb(resolvedConfig, lanceEnv)) {
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
      await fs.rm(dir, { recursive: true, force: true });
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
    count: resolvedVectors.length,
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
    logger.log(`[embeddings] ${targetLabel}: wrote LanceDB table (${resolvedVectors.length} vectors).`);
  }
  return { skipped: false, count: resolvedVectors.length };
}
