import fsSync from 'node:fs';
import path from 'node:path';
import {
  encodeVector,
  ensureVectorTable,
  getVectorExtensionConfig,
  hasVectorTable,
  loadVectorExtension
} from '../vector-extension.js';
import { resolveSqlitePaths } from '../dict-utils.js';
import { dequantizeUint8ToFloat32, packUint8, toVectorId } from '../../src/storage/sqlite/vector.js';

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
  dbPath,
  emitOutput = true
}) => {
  if (userConfig?.sqlite?.use === false) {
    return { skipped: true, reason: 'sqlite disabled' };
  }
  if (!Database) {
    if (emitOutput) {
      console.warn(`[embeddings] better-sqlite3 not available; skipping SQLite update for ${mode}.`);
    }
    return { skipped: true, reason: 'sqlite unavailable' };
  }
  const resolvedDbPath = dbPath || (() => {
    const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
    return mode === 'code' ? sqlitePaths.codePath : sqlitePaths.prosePath;
  })();
  if (!resolvedDbPath || !fsSync.existsSync(resolvedDbPath)) {
    if (emitOutput) {
      console.warn(`[embeddings] SQLite ${mode} index missing; skipping.`);
    }
    return { skipped: true, reason: 'sqlite missing' };
  }

  const db = new Database(resolvedDbPath);
  try {
    if (!hasTable(db, 'dense_vectors') || !hasTable(db, 'dense_meta')) {
      if (emitOutput) {
        console.warn(`[embeddings] SQLite ${mode} index missing dense tables; skipping.`);
      }
      return { skipped: true, reason: 'missing dense tables' };
    }
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
    } catch {}

    const vectorExtension = getVectorExtensionConfig(root, userConfig);
    let vectorAnnReady = false;
    let vectorAnnTable = vectorExtension.table || 'dense_vectors_ann';
    let vectorAnnColumn = vectorExtension.column || 'embedding';
    let insertVectorAnn = null;
    if (vectorExtension.enabled) {
      const loadResult = loadVectorExtension(db, vectorExtension, `embeddings ${mode}`);
      if (loadResult.ok) {
        if (hasVectorTable(db, vectorAnnTable)) {
          vectorAnnReady = true;
        } else {
          const created = ensureVectorTable(db, vectorExtension, dims);
          if (created.ok) {
            vectorAnnReady = true;
            vectorAnnTable = created.tableName;
            vectorAnnColumn = created.column;
          } else if (emitOutput) {
            console.warn(`[embeddings] Failed to create vector table for ${mode}: ${created.reason}`);
          }
        }
        if (vectorAnnReady) {
          insertVectorAnn = db.prepare(
            `INSERT OR REPLACE INTO ${vectorAnnTable} (rowid, ${vectorAnnColumn}) VALUES (?, ?)`
          );
        }
      } else if (emitOutput) {
        console.warn(`[embeddings] Vector extension unavailable for ${mode}: ${loadResult.reason}`);
      }
    }

    const deleteDense = db.prepare('DELETE FROM dense_vectors WHERE mode = ?');
    const deleteMeta = db.prepare('DELETE FROM dense_meta WHERE mode = ?');
    const insertDense = db.prepare(
      'INSERT OR REPLACE INTO dense_vectors (mode, doc_id, vector) VALUES (?, ?, ?)'
    );
    const insertMeta = db.prepare(
      'INSERT OR REPLACE INTO dense_meta (mode, dims, scale, model) VALUES (?, ?, ?, ?)'
    );
    const run = db.transaction(() => {
      deleteDense.run(mode);
      deleteMeta.run(mode);
      if (vectorAnnReady) {
        db.exec(`DELETE FROM ${vectorAnnTable}`);
      }
      insertMeta.run(mode, dims, scale, modelId || null);
      for (let docId = 0; docId < vectors.length; docId += 1) {
        const vec = vectors[docId];
        insertDense.run(mode, docId, packUint8(vec));
        if (vectorAnnReady && insertVectorAnn) {
          const floatVec = dequantizeUint8ToFloat32(vec);
          const encoded = encodeVector(floatVec, vectorExtension);
          if (encoded) insertVectorAnn.run(toVectorId(docId), encoded);
        }
      }
    });
    run();
    if (emitOutput) {
      console.log(`[embeddings] ${mode}: SQLite dense vectors updated (${resolvedDbPath}).`);
    }
    return { skipped: false, count: vectors.length };
  } finally {
    db.close();
  }
};
