import { assertSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  encodeVector,
  ensureVectorTable,
  getVectorExtensionConfig,
  hasVectorTable,
  loadVectorExtension,
  resolveVectorIngestEncoding,
  resolveVectorExtensionConfigForMode
} from '../../sqlite/vector-extension.js';
import { resolveSqlitePaths } from '../../shared/dict-utils.js';
import {
  dequantizeUint8ToFloat32,
  packUint8,
  toSqliteRowId
} from '../../../src/storage/sqlite/vector.js';
import { resolveQuantizationParams } from '../../../src/storage/sqlite/quantization.js';
import { applyBuildPragmas } from '../../../src/storage/sqlite/build/pragmas.js';
import { normalizeDenseVectorMeta } from '../../../src/shared/dense-vector-meta.js';
import { resolveDenseVectorBinaryPayloadPath } from '../../../src/shared/dense-vector-binary.js';
import { openDenseVectorBinarySourceSync } from '../../../src/shared/dense-vector-stream.js';
import { readContainedFileSync } from '../../../src/shared/contained-file.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

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

const resolveSqliteDenseArtifactSource = ({ vectorsPath, modelId = null, dims = null, signal = null, metrics = null }) => {
  try {
    if (typeof vectorsPath !== 'string' || !vectorsPath.trim()) throw new Error('Missing vector artifact path.');
    const resolvedBasePath = path.resolve(vectorsPath);
    const metaPath = `${resolvedBasePath}.meta.json`;
    const dir = path.dirname(resolvedBasePath);
    const readMeta = filename => normalizeDenseVectorMeta(JSON.parse(readContainedFileSync(dir, filename,
      { maxBytes: 64 * 1024 * 1024, signal }).toString('utf8')));
    const sourceMeta = readMeta(metaPath);
    const meta = sourceMeta ? { ...sourceMeta, count: sourceMeta.count ?? sourceMeta.totalRecords } : null;
    if (!meta || !Number.isSafeInteger(meta.count) || meta.count < 0
      || !Number.isSafeInteger(meta.dims) || meta.dims <= 0
      || !Number.isSafeInteger(meta.count * meta.dims)
      || (sourceMeta.count != null && sourceMeta.totalRecords != null && sourceMeta.count !== sourceMeta.totalRecords)
      || (dims != null && meta.dims !== dims)
      || (modelId && meta.model !== modelId)) throw new Error('Invalid vector artifact metadata or model identity.');
    const binaryMetaPath = `${resolvedBasePath}.bin.meta.json`;
    if (fsSync.existsSync(binaryMetaPath)) {
      const binaryMeta = readMeta(binaryMetaPath);
      if (!binaryMeta || binaryMeta.count !== meta.count || binaryMeta.dims !== meta.dims
        || binaryMeta.model !== meta.model || JSON.stringify(binaryMeta.validity ?? null) !== JSON.stringify(meta.validity ?? null)
        || (binaryMeta.bytes != null && binaryMeta.bytes !== meta.count * meta.dims)) {
        throw new Error('Binary and sharded vector metadata disagree.');
      }
      for (const key of ['embeddingIdentity', 'embeddingGeneration', 'minVal', 'maxVal', 'levels', 'scale']) {
        if (stableStringify(sourceMeta[key]) !== stableStringify(binaryMeta[key])) throw new Error(`Binary and sharded vector ${key} disagree.`);
      }
      if (binaryMeta.path != null) meta.path = binaryMeta.path;
    }
    const filename = resolveDenseVectorBinaryPayloadPath({ dir, baseName: path.basename(resolvedBasePath), meta });
    if (!filename) throw new Error('Invalid vector artifact binary path.');
    return openDenseVectorBinarySourceSync({ root: dir, filename, meta, signal, metrics });
  } catch (cause) {
    throwIfAborted(signal);
    throw Object.assign(new Error(`SQLite dense input artifact is unreadable: ${vectorsPath || '<missing>'}`, { cause }),
      { code: 'ERR_SQLITE_DENSE_ARTIFACT_INVALID' });
  }
};

export const resolveSqliteDenseVectorRows = ({
  vectors,
  vectorsPath = null,
  modelId = null,
  dims = null
} = {}) => {
  if (Array.isArray(vectors)) return vectors;
  const source = resolveSqliteDenseArtifactSource({ vectorsPath, modelId, dims });
  try { return Array.from(source, row => row.vector); } finally { source.close(); }
};

const resolveSqliteDenseVectorSource = ({ vectors, ...options }) => Array.isArray(vectors)
  ? { count: vectors.length, close: () => {}, *[Symbol.iterator]() {
    for (let docId = 0; docId < vectors.length; docId++) yield { docId, vector: vectors[docId] };
  } } : resolveSqliteDenseArtifactSource(options);

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
  vectorsPath = null,
  sharedDb = false,
  writeBatchSize = 256,
  emitOutput = true,
  warnOnMissing = true,
  logger = console,
  signal = null
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

  // Resolve and validate the replacement before opening a mutable connection,
  // changing schema/pragmas, or touching existing vector authority.
  const work = { oldRowsScanned: 0, newRowsScanned: 0, rowsCompared: 0, baseWrites: 0, baseDeletes: 0,
    annWrites: 0, annDeletes: 0, peakOldVectorBytes: 0 };
  const vectorSource = resolveSqliteDenseVectorSource({ vectors, vectorsPath, modelId, dims, signal, metrics: work });
  let db = null, validCount = 0, primaryFailure = null;
  try {
    db = new Database(resolvedDbPath);
    assertSqliteIndexFormat({ db, repoRoot: root, indexPath: resolvedDbPath, operation: 'embedding-update' });
    if (!hasTable(db, 'dense_vectors') || !hasTable(db, 'dense_meta')) {
      if (emitOutput && warnOnMissing) {
        logger.warn(`[embeddings] SQLite ${mode} index missing dense tables; skipping.`);
      }
      return { skipped: true, reason: 'missing dense tables', vectorAnn: vectorAnnState };
    }
    let pragmaState = null;
    try {
      const estimatedInputBytes = Math.max(1, Math.floor(vectorSource.count * Math.max(1, Number(dims) || 1)));
      pragmaState = applyBuildPragmas(db, { inputBytes: estimatedInputBytes });
      // Embedding updates trade some throughput for safer crash behavior.
      db.pragma('synchronous = NORMAL');
    } catch {}

    const transactionStarted = process.hrtime.bigint();
    db.exec('BEGIN IMMEDIATE');
    ensureDenseMetaSchema(db);
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
            db.exec(`DROP TABLE IF EXISTS ${vectorAnnTable}`);
            const created = ensureVectorTable(db, vectorExtension, dims);
            if (created.ok) {
              vectorAnnReady = true;
              vectorAnnTable = created.tableName;
              vectorAnnColumn = created.column;
            } else {
              throw Object.assign(new Error(`[embeddings] Failed to recreate vector table for ${mode}: ${created.reason}`),
                { code: 'ERR_SQLITE_DENSE_ANN_REBUILD' });
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

    const deleteMeta = db.prepare('DELETE FROM dense_meta WHERE mode = ?');
    const selectDensePage = db.prepare(
      'SELECT doc_id, length(vector) AS vector_bytes FROM dense_vectors WHERE mode = ? AND doc_id > ? ORDER BY doc_id ASC LIMIT ?'
    );
    const selectDenseVector = db.prepare('SELECT vector FROM dense_vectors WHERE mode = ? AND doc_id = ?');
    const insertDense = db.prepare(
      'INSERT OR REPLACE INTO dense_vectors (mode, doc_id, vector) VALUES (?, ?, ?)'
    );
    const insertMeta = db.prepare(
      'INSERT OR REPLACE INTO dense_meta (mode, dims, scale, model, min_val, max_val, levels) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const resolvedQuantization = resolveQuantizationParams(quantization);
    const ingestEncoding = resolveVectorIngestEncoding(vectorExtension, { preferQuantized: true });
    const toComparableBuffer = (value) => {
      if (Buffer.isBuffer(value)) return value;
      if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      }
      return null;
    };
    const upsertVectorAnnRow = (docId, vec) => {
      if (!vectorAnnReady || !insertVectorAnn) return null;
      const vectorInput = ingestEncoding === 'quantized'
        ? vec
        : dequantizeUint8ToFloat32(
          vec,
          resolvedQuantization.minVal,
          resolvedQuantization.maxVal,
          resolvedQuantization.levels
        );
      const encoded = encodeVector(vectorInput, vectorExtension);
      if (encoded) {
        return [toSqliteRowId(docId), encoded];
      }
      return null;
    };
    const run = db.transaction(() => {
      const batchSize = Number.isFinite(Number(writeBatchSize)) && Number(writeBatchSize) > 0
        ? Math.max(16, Math.floor(Number(writeBatchSize)))
        : 256;
      const denseDeleteBatch = [];
      const denseUpsertBatch = [];
      const vectorAnnDeleteBatch = [];
      const vectorAnnUpsertBatch = [];
      const deleteDenseBatchStmtCache = new Map();
      const deleteVectorAnnBatchStmtCache = new Map();
      const runDenseDeleteBatch = (ids) => {
        if (!Array.isArray(ids) || !ids.length) return;
        const placeholders = ids.map(() => '?').join(', ');
        let stmt = deleteDenseBatchStmtCache.get(ids.length);
        if (!stmt) {
          stmt = db.prepare(
            `DELETE FROM dense_vectors WHERE mode = ? AND doc_id IN (${placeholders})`
          );
          deleteDenseBatchStmtCache.set(ids.length, stmt);
        }
        stmt.run(mode, ...ids);
        work.baseDeletes += ids.length;
      };
      const runVectorAnnDeleteBatch = (rowIds) => {
        if (!vectorAnnReady || !Array.isArray(rowIds) || !rowIds.length) return;
        const placeholders = rowIds.map(() => '?').join(', ');
        let stmt = deleteVectorAnnBatchStmtCache.get(rowIds.length);
        if (!stmt) {
          stmt = db.prepare(`DELETE FROM ${vectorAnnTable} WHERE rowid IN (${placeholders})`);
          deleteVectorAnnBatchStmtCache.set(rowIds.length, stmt);
        }
        stmt.run(...rowIds);
        work.annDeletes += rowIds.length;
      };
      const flushBatches = ({ force = false } = {}) => {
        if (
          !force
          && denseDeleteBatch.length < batchSize
          && denseUpsertBatch.length < batchSize
          && vectorAnnDeleteBatch.length < batchSize
          && vectorAnnUpsertBatch.length < batchSize
        ) {
          return;
        }
        while (denseDeleteBatch.length) {
          const ids = denseDeleteBatch.splice(0, batchSize);
          runDenseDeleteBatch(ids);
        }
        while (vectorAnnDeleteBatch.length) {
          const rowIds = vectorAnnDeleteBatch.splice(0, batchSize);
          runVectorAnnDeleteBatch(rowIds);
        }
        while (denseUpsertBatch.length) {
          const rows = denseUpsertBatch.splice(0, batchSize);
          for (const row of rows) {
            insertDense.run(mode, row.docId, row.packed);
            work.baseWrites++;
          }
        }
        while (vectorAnnUpsertBatch.length) {
          const rows = vectorAnnUpsertBatch.splice(0, batchSize);
          for (const row of rows) {
            insertVectorAnn.run(row.rowId, row.encoded);
            work.annWrites++;
          }
        }
      };
      deleteMeta.run(mode);
      insertMeta.run(
        mode,
        dims,
        scale,
        modelId || null,
        resolvedQuantization.minVal,
        resolvedQuantization.maxVal,
        resolvedQuantization.levels
      );

      // Only bounded ID/length pages are retained. Old payloads are fetched one
      // at a time when their width can equal the incoming row. Each next page
      // is selected before processing new ordinals beyond the prior page's
      // final old ID, so our own inserts cannot reappear as old input.
      let oldPage = [], pageIndex = 0, lastOldId = -1, exhausted = false;
      const nextOld = () => {
        throwIfAborted(signal);
        if (pageIndex === oldPage.length && !exhausted) {
          oldPage = selectDensePage.all(mode, lastOldId, 256); pageIndex = 0;
          exhausted = oldPage.length < 256;
          if (oldPage.length) {
            const finalId = Number(oldPage[oldPage.length - 1].doc_id);
            if (!Number.isSafeInteger(finalId) || finalId <= lastOldId) throw new Error('Invalid SQLite dense ordinal ordering.');
            lastOldId = finalId;
          }
        }
        const row = oldPage[pageIndex++] || null;
        if (row) work.oldRowsScanned++;
        return row;
      };
      let current = nextOld();
      for (const { docId, vector: vec } of vectorSource) {
        throwIfAborted(signal); work.newRowsScanned++;
        while (current && Number(current.doc_id) < docId) {
          const staleDocId = Number(current.doc_id);
          denseDeleteBatch.push(staleDocId);
          if (vectorAnnReady) vectorAnnDeleteBatch.push(toSqliteRowId(staleDocId));
          current = nextOld();
          flushBatches();
        }

        const hasExisting = Boolean(current) && Number(current.doc_id) === docId;
        const hasVector = (Array.isArray(vec) || (ArrayBuffer.isView(vec) && !(vec instanceof DataView))) && vec.length > 0;

        if (!hasVector) {
          if (hasExisting) {
            denseDeleteBatch.push(docId);
            if (vectorAnnReady) vectorAnnDeleteBatch.push(toSqliteRowId(docId));
            current = nextOld();
            flushBatches();
          }
          continue;
        }

        validCount++;
        const packed = packUint8(vec);
        const existingPacked = hasExisting && Number(current.vector_bytes) === packed.byteLength
          ? toComparableBuffer(selectDenseVector.get(mode, docId)?.vector) : null;
        if (hasExisting) work.rowsCompared++;
        work.peakOldVectorBytes = Math.max(work.peakOldVectorBytes, existingPacked?.byteLength || 0);
        const unchanged = Boolean(
          existingPacked
          && existingPacked.byteLength === packed.byteLength
          && existingPacked.equals(packed)
        );
        if (hasExisting) {
          current = nextOld();
        }
        // An optional extension may have been unavailable during an earlier
        // base-only update. Equality of base bytes cannot prove ANN parity.
        if (unchanged && !vectorAnnReady) {
          continue;
        }

        if (!unchanged) denseUpsertBatch.push({ docId, packed });
        if (vectorAnnReady) {
          const annRow = upsertVectorAnnRow(docId, vec);
          if (annRow) {
            vectorAnnUpsertBatch.push({
              rowId: annRow[0],
              encoded: annRow[1]
            });
          }
        }
        flushBatches();
      }

      while (current) {
        const staleDocId = Number(current.doc_id);
        denseDeleteBatch.push(staleDocId);
        if (vectorAnnReady) vectorAnnDeleteBatch.push(toSqliteRowId(staleDocId));
        current = nextOld();
        flushBatches();
      }
      flushBatches({ force: true });
    });
    run();
    db.exec('COMMIT');
    work.transactionMs = Number(process.hrtime.bigint() - transactionStarted) / 1e6;
    if (emitOutput) {
      logger.log(`[embeddings] ${mode}: SQLite dense vectors updated (${resolvedDbPath}).`);
    }
    return {
      skipped: false,
      count: vectorSource.count,
      rowCount: vectorSource.count,
      validCount,
      work,
      vectorAnn: vectorAnnState,
      ingestEncoding,
      pragmas: pragmaState?.applied || null
    };
  } catch (error) {
    primaryFailure = error;
    if (db?.inTransaction) {
      try { db.exec('ROLLBACK'); }
      catch (rollbackError) {
        primaryFailure = new AggregateError([error, rollbackError], 'SQLite dense update and rollback failed.', { cause: error });
        throw primaryFailure;
      }
    }
    throw error;
  } finally {
    const closeErrors = [];
    try { db?.close(); } catch (error) { closeErrors.push(error); }
    try { vectorSource.close(); } catch (error) { closeErrors.push(error); }
    if (closeErrors.length) throw new AggregateError(primaryFailure ? [primaryFailure, ...closeErrors] : closeErrors,
      'SQLite dense resource cleanup failed.', { cause: primaryFailure || closeErrors[0] });
  }
};

