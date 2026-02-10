import fsSync from 'node:fs';
import path from 'node:path';
import {
  encodeVector,
  ensureVectorTable,
  getVectorExtensionConfig,
  hasVectorTable,
  loadVectorExtension,
  resolveVectorExtensionConfigForMode
} from '../../sqlite/vector-extension.js';
import { resolveSqlitePaths } from '../../shared/dict-utils.js';
import {
  dequantizeUint8ToFloat32,
  packUint8,
  toSqliteRowId
} from '../../../src/storage/sqlite/vector.js';
import { resolveQuantizationParams } from '../../../src/storage/sqlite/quantization.js';

const hasTable = (db, table) => {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(table);
    return !!row;
  } catch {
    return false;
  }
};

const ensureDenseMetaSchema = (db) => {
  const rows = db.prepare('PRAGMA table_info(dense_meta)').all();
  const columns = new Set(rows.map((row) => row.name));
  const addColumn = (name, type) => {
    if (columns.has(name)) return;
    db.exec(`ALTER TABLE dense_meta ADD COLUMN ${name} ${type}`);
    columns.add(name);
  };
  addColumn('min_val', 'REAL');
  addColumn('max_val', 'REAL');
  addColumn('levels', 'INTEGER');
};

const resolveVectorTableDims = (db, table, column) => {
  if (!db || !table || !column) return null;
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    const col = rows.find((row) => row.name === column);
    const type = col?.type || '';
    const match = String(type).match(/\[(\d+)\]/);
    if (match) return Number(match[1]);
  } catch {}
  try {
    const row = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(table);
    const sql = row?.sql || '';
    const match = String(sql).match(/\[(\d+)\]/);
    if (match) return Number(match[1]);
  } catch {}
  return null;
};

export const updateSqliteDense = ({
  Database,
  root,
  userConfig,
  indexRoot,
  mode,
  vectors,
  dims,
  scale,
  modelId,
  quantization,
  dbPath,
  sharedDb = false,
  emitOutput = true,
  warnOnMissing = true,
  logger = console
}) => {
  const vectorExtensionBase = getVectorExtensionConfig(root, userConfig);
  const vectorExtension = resolveVectorExtensionConfigForMode(
    vectorExtensionBase,
    mode,
    { sharedDb }
  );
  const vectorAnnState = {
    enabled: vectorExtension.enabled === true,
    available: false,
    table: vectorExtension.table || 'dense_vectors_ann',
    column: vectorExtension.column || 'embedding',
    idColumn: 'rowid'
  };
  if (userConfig?.sqlite?.use === false) {
    return { skipped: true, reason: 'sqlite disabled', vectorAnn: vectorAnnState };
  }
  if (!Database) {
    if (emitOutput) {
      logger.warn(`[embeddings] better-sqlite3 not available; skipping SQLite update for ${mode}.`);
    }
    return { skipped: true, reason: 'sqlite unavailable', vectorAnn: vectorAnnState };
  }
  const resolvedDbPath = dbPath || (() => {
    const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
    return mode === 'code' ? sqlitePaths.codePath : sqlitePaths.prosePath;
  })();
  if (!resolvedDbPath || !fsSync.existsSync(resolvedDbPath)) {
    if (emitOutput && warnOnMissing) {
      logger.warn(`[embeddings] SQLite ${mode} index missing; skipping.`);
    }
    return { skipped: true, reason: 'sqlite missing', vectorAnn: vectorAnnState };
  }

  const db = new Database(resolvedDbPath);
  try {
    if (!hasTable(db, 'dense_vectors') || !hasTable(db, 'dense_meta')) {
      if (emitOutput && warnOnMissing) {
        logger.warn(`[embeddings] SQLite ${mode} index missing dense tables; skipping.`);
      }
      return { skipped: true, reason: 'missing dense tables', vectorAnn: vectorAnnState };
    }
    ensureDenseMetaSchema(db);
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
    } catch {}

    let vectorAnnReady = false;
    let vectorAnnTable = vectorExtension.table || 'dense_vectors_ann';
    let vectorAnnColumn = vectorExtension.column || 'embedding';
    let insertVectorAnn = null;
    if (vectorExtension.enabled) {
      const loadResult = loadVectorExtension(db, vectorExtension, `embeddings ${mode}`);
      if (loadResult.ok) {
        if (hasVectorTable(db, vectorAnnTable)) {
          const existingDims = resolveVectorTableDims(db, vectorAnnTable, vectorAnnColumn);
          if (Number.isFinite(existingDims) && existingDims !== dims) {
            try {
              db.exec(`DROP TABLE IF EXISTS ${vectorAnnTable}`);
            } catch {}
            const created = ensureVectorTable(db, vectorExtension, dims);
            if (created.ok) {
              vectorAnnReady = true;
              vectorAnnTable = created.tableName;
              vectorAnnColumn = created.column;
            } else if (emitOutput) {
              logger.warn(`[embeddings] Failed to recreate vector table for ${mode}: ${created.reason}`);
            }
          } else {
            vectorAnnReady = true;
          }
        } else {
          const created = ensureVectorTable(db, vectorExtension, dims);
          if (created.ok) {
            vectorAnnReady = true;
            vectorAnnTable = created.tableName;
            vectorAnnColumn = created.column;
          } else if (emitOutput) {
            logger.warn(`[embeddings] Failed to create vector table for ${mode}: ${created.reason}`);
          }
        }
        if (vectorAnnReady) {
          insertVectorAnn = db.prepare(
            `INSERT OR REPLACE INTO ${vectorAnnTable} (rowid, ${vectorAnnColumn}) VALUES (?, ?)`
          );
        }
      } else if (emitOutput) {
        logger.warn(`[embeddings] Vector extension unavailable for ${mode}: ${loadResult.reason}`);
      }
    }
    if (vectorAnnReady) {
      vectorAnnState.available = true;
      vectorAnnState.table = vectorAnnTable;
      vectorAnnState.column = vectorAnnColumn;
    }

    const deleteDense = db.prepare('DELETE FROM dense_vectors WHERE mode = ?');
    const deleteMeta = db.prepare('DELETE FROM dense_meta WHERE mode = ?');
    const insertDense = db.prepare(
      'INSERT OR REPLACE INTO dense_vectors (mode, doc_id, vector) VALUES (?, ?, ?)'
    );
    const insertMeta = db.prepare(
      'INSERT OR REPLACE INTO dense_meta (mode, dims, scale, model, min_val, max_val, levels) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const resolvedQuantization = resolveQuantizationParams(quantization);
    const batchSize = Math.max(1, Math.min(5000, Math.floor((vectors.length || 0) / 8) || 1000));
    const run = db.transaction(() => {
      deleteDense.run(mode);
      deleteMeta.run(mode);
      if (vectorAnnReady) {
        db.exec(`DELETE FROM ${vectorAnnTable}`);
      }
      insertMeta.run(
        mode,
        dims,
        scale,
        modelId || null,
        resolvedQuantization.minVal,
        resolvedQuantization.maxVal,
        resolvedQuantization.levels
      );
      for (let batchStart = 0; batchStart < vectors.length; batchStart += batchSize) {
        const batchEnd = Math.min(vectors.length, batchStart + batchSize);
        for (let docId = batchStart; docId < batchEnd; docId += 1) {
          const vec = vectors[docId];
          insertDense.run(mode, docId, packUint8(vec));
          if (vectorAnnReady && insertVectorAnn) {
            const floatVec = dequantizeUint8ToFloat32(
              vec,
              resolvedQuantization.minVal,
              resolvedQuantization.maxVal,
              resolvedQuantization.levels
            );
            const encoded = encodeVector(floatVec, vectorExtension);
            if (encoded) insertVectorAnn.run(toSqliteRowId(docId), encoded);
          }
        }
      }
    });
    run();
    if (emitOutput) {
      logger.log(`[embeddings] ${mode}: SQLite dense vectors updated (${resolvedDbPath}).`);
    }
    return { skipped: false, count: vectors.length, vectorAnn: vectorAnnState };
  } finally {
    db.close();
  }
};

