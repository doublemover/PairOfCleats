import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { tryImport } from '../../src/shared/optional-deps.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { dequantizeUint8ToFloat32 } from '../../src/storage/sqlite/vector.js';
import { normalizeLanceDbConfig, resolveLanceDbPaths } from '../../src/shared/lancedb.js';

let warnedMissing = false;

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

const buildBatch = (vectors, start, end, idColumn, embeddingColumn) => {
  const rows = [];
  for (let i = start; i < end; i += 1) {
    const vec = vectors[i];
    if (!vec || typeof vec.length !== 'number') continue;
    const floatVec = dequantizeUint8ToFloat32(vec);
    if (!floatVec) continue;
    rows.push({
      [idColumn]: i,
      [embeddingColumn]: floatVec
    });
  }
  return rows;
};

export async function writeLanceDbIndex({
  indexDir,
  variant,
  vectors,
  dims,
  modelId,
  config,
  emitOutput = true,
  label = null,
  logger = console
}) {
  const resolvedConfig = normalizeLanceDbConfig(config);
  if (!resolvedConfig.enabled) return { skipped: true, reason: 'disabled' };
  if (!Array.isArray(vectors) || !vectors.length) {
    return { skipped: true, reason: 'empty' };
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
    const firstBatch = buildBatch(vectors, 0, Math.min(batchSize, vectors.length), idColumn, embeddingColumn);
    table = await createTable(db, tableName, firstBatch);
    if (!table && typeof db.openTable === 'function') {
      table = await db.openTable(tableName);
      if (firstBatch.length) await addRows(table, firstBatch);
    }
    for (let start = batchSize; start < vectors.length; start += batchSize) {
      const rows = buildBatch(
        vectors,
        start,
        Math.min(start + batchSize, vectors.length),
        idColumn,
        embeddingColumn
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
    count: vectors.length,
    metric: resolvedConfig.metric,
    table: tableName,
    embeddingColumn,
    idColumn
  };
  await writeJsonObjectFile(metaPath, { fields: meta, atomic: true });

  if (emitOutput) {
    const targetLabel = label || variant;
    logger.log(`[embeddings] ${targetLabel}: wrote LanceDB table (${vectors.length} vectors).`);
  }
  return { skipped: false, count: vectors.length };
}
