import fsSync from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { readBundleFile } from '../../../shared/bundle-io.js';
import { buildChunkRow, buildTokenFrequency, prepareVectorAnnInsert } from '../build-helpers.js';
import { REQUIRED_TABLES, SCHEMA_VERSION } from '../schema.js';
import {
  chunkArray,
  hasRequiredTables,
  normalizeFilePath,
  removeSqliteSidecars,
  resolveSqliteBatchSize,
  bumpSqliteBatchStat
} from '../utils.js';
import {
  createUint8ClampStats,
  packUint32,
  packUint8,
  isVectorEncodingCompatible,
  quantizeVec,
  resolveEncodedVectorBytes,
  resolveVectorEncodingBytes,
  toSqliteRowId
} from '../vector.js';
import { resolveQuantizationParams } from '../quantization.js';
import { deleteDocIds, updateTokenStats } from './delete.js';
import { applyBuildPragmas, restoreBuildPragmas } from './pragmas.js';
import {
  diffFileManifests,
  getFileManifest,
  normalizeManifestFiles,
  validateIncrementalManifest
} from './manifest.js';
import { createInsertStatements } from './statements.js';
import { getSchemaVersion, validateSqliteDatabase } from './validate.js';
import { ensureVocabIds } from '../vocab.js';

const MAX_INCREMENTAL_CHANGE_RATIO = 0.35;
const VOCAB_GROWTH_LIMITS = {
  token_vocab: { ratio: 0.4, absolute: 200000 },
  phrase_vocab: { ratio: 0.5, absolute: 150000 },
  chargram_vocab: { ratio: 1.0, absolute: 250000 }
};

class IncrementalSkipError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const resolveExpectedDenseCount = (denseVec) => {
  if (!denseVec || typeof denseVec !== 'object') return 0;
  const fields = denseVec.fields && typeof denseVec.fields === 'object' ? denseVec.fields : null;
  const fromCount = Number(denseVec.count ?? fields?.count);
  if (Number.isFinite(fromCount) && fromCount > 0) return Math.floor(fromCount);
  const fromTotalRecords = Number(denseVec.totalRecords ?? fields?.totalRecords);
  if (Number.isFinite(fromTotalRecords) && fromTotalRecords > 0) return Math.floor(fromTotalRecords);
  const vectors = denseVec.vectors ?? denseVec.arrays?.vectors;
  if (Array.isArray(vectors) && vectors.length > 0) return vectors.length;
  return 0;
};

/**
 * Apply an incremental update to a sqlite index using bundle deltas.
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.Database
 * @param {string} params.outPath
 * @param {'code'|'prose'|'extracted-prose'|'records'} params.mode
 * @param {object} params.incrementalData
 * @param {object} params.modelConfig
 * @param {object} params.vectorConfig
 * @param {boolean} params.emitOutput
 * @param {string} params.validateMode
 * @param {object} [params.expectedDense]
 * @param {object} [params.logger]
 * @param {number} [params.inputBytes]
 * @param {number} [params.batchSize]
 * @param {boolean} [params.buildPragmas]
 * @param {object} [params.stats]
 * @returns {Promise<{used:boolean,reason?:string,insertedChunks?:number}>}
 */
export async function incrementalUpdateDatabase({
  Database,
  outPath,
  mode,
  incrementalData,
  modelConfig,
  vectorConfig,
  emitOutput,
  validateMode,
  expectedDense,
  logger,
  inputBytes,
  batchSize,
  buildPragmas,
  stats
}) {
  const warn = (message) => {
    if (!emitOutput || !message) return;
    if (logger?.warn) {
      logger.warn(message);
      return;
    }
    if (logger?.log) {
      logger.log(message);
      return;
    }
    console.warn(message);
  };
  const resolvedBatchSize = resolveSqliteBatchSize({ batchSize, inputBytes });
  const denseClampStats = createUint8ClampStats();
  const recordDenseClamp = (clamped) => denseClampStats.record(clamped);
  const batchStats = stats && typeof stats === 'object' ? stats : null;
  const recordBatch = (key) => bumpSqliteBatchStat(batchStats, key);
  if (batchStats) {
    batchStats.batchSize = resolvedBatchSize;
  }
  const tableStats = batchStats
    ? (batchStats.tables || (batchStats.tables = {}))
    : null;
  const recordTable = (name, rows, durationMs) => {
    if (!tableStats || !name) return;
    const entry = tableStats[name] || { rows: 0, durationMs: 0, rowsPerSec: null };
    entry.rows += rows;
    entry.durationMs += durationMs;
    entry.rowsPerSec = entry.durationMs > 0
      ? Math.round((entry.rows / entry.durationMs) * 1000)
      : null;
    tableStats[name] = entry;
  };
  if (!incrementalData?.manifest) {
    return { used: false, reason: 'missing incremental manifest' };
  }
  if (!fsSync.existsSync(outPath)) {
    return { used: false, reason: 'sqlite db missing' };
  }

  const expectedDenseCount = resolveExpectedDenseCount(expectedDense);
  const expectedDenseRequired = expectedDenseCount > 0;
  const expectedModel = expectedDenseRequired ? (expectedDense?.model || modelConfig.id || null) : null;
  const expectedDims = expectedDenseRequired && Number.isFinite(expectedDense?.dims) ? expectedDense.dims : null;

  const useBuildPragmas = buildPragmas !== false;
  const db = new Database(outPath);
  const pragmaState = useBuildPragmas ? applyBuildPragmas(db, { inputBytes, stats: batchStats }) : null;
  let dbClosed = false;
  const finalize = async () => {
    if (dbClosed) return;
    dbClosed = true;
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {}
    if (pragmaState) {
      try {
        restoreBuildPragmas(db, pragmaState);
      } catch {}
    }
    try {
      db.close();
    } catch {}
    try {
      await removeSqliteSidecars(outPath);
    } catch {}
  };
  const schemaVersion = getSchemaVersion(db);
  if (schemaVersion !== SCHEMA_VERSION) {
    await finalize();
    return {
      used: false,
      reason: `schema mismatch (db=${schemaVersion ?? 'unknown'}, expected=${SCHEMA_VERSION})`
    };
  }

  if (!hasRequiredTables(db, REQUIRED_TABLES)) {
    await finalize();
    return { used: false, reason: 'schema missing' };
  }

  const manifestValidation = validateIncrementalManifest(incrementalData.manifest);
  if (!manifestValidation.ok) {
    await finalize();
    return { used: false, reason: `invalid manifest (${manifestValidation.errors.join('; ')})` };
  }

  const manifestFiles = incrementalData.manifest.files || {};
  const manifestLookup = normalizeManifestFiles(manifestFiles);
  if (!manifestLookup.entries.length) {
    await finalize();
    return { used: false, reason: 'incremental manifest empty' };
  }
  if (manifestLookup.conflicts.length) {
    await finalize();
    return { used: false, reason: 'manifest path conflicts' };
  }

  const dbFiles = getFileManifest(db, mode);
  if (!dbFiles.size) {
    const chunkRow = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?')
      .get(mode) || {};
    if (Number.isFinite(chunkRow.total) && chunkRow.total > 0) {
      await finalize();
      return { used: false, reason: 'file manifest empty' };
    }
  }

  const { changed, deleted, manifestUpdates } = diffFileManifests(manifestLookup.entries, dbFiles);
  const totalFiles = manifestLookup.entries.length;
  const changeSummary = {
    totalFiles,
    changedFiles: changed.length,
    deletedFiles: deleted.length,
    manifestUpdates: manifestUpdates.length
  };
  if (totalFiles) {
    const changeRatio = (changed.length + deleted.length) / totalFiles;
    if (changeRatio > MAX_INCREMENTAL_CHANGE_RATIO) {
      await finalize();
      return {
        used: false,
        reason: `change ratio ${changeRatio.toFixed(2)} (changed=${changed.length}, deleted=${deleted.length}, total=${totalFiles}) exceeds ${MAX_INCREMENTAL_CHANGE_RATIO}`,
        ...changeSummary
      };
    }
  }
  if (!changed.length && !deleted.length && !manifestUpdates.length) {
    await finalize();
    return { used: true, insertedChunks: 0, ...changeSummary };
  }

  const dbDenseMeta = db.prepare(
    'SELECT dims, scale, model, min_val, max_val, levels FROM dense_meta WHERE mode = ?'
  ).get(mode);
  const dbDims = Number.isFinite(dbDenseMeta?.dims) ? dbDenseMeta.dims : null;
  const dbModel = dbDenseMeta?.model || null;
  const configQuantization = resolveQuantizationParams(vectorConfig?.quantization);
  const dbQuantization = dbDenseMeta
    ? resolveQuantizationParams({
      minVal: dbDenseMeta?.min_val,
      maxVal: dbDenseMeta?.max_val,
      levels: dbDenseMeta?.levels
    })
    : configQuantization;
  const quantization = dbDenseMeta ? dbQuantization : configQuantization;
  if (expectedDenseRequired && !dbDenseMeta) {
    if (emitOutput) {
      warn(`[sqlite] ${mode} incremental update: dense metadata missing; rebuilding dense_meta from incremental vectors.`);
    }
  }
  if (expectedModel) {
    if (dbDenseMeta && !dbModel) {
      await finalize();
      return { used: false, reason: 'dense metadata model missing', ...changeSummary };
    }
    if (dbDenseMeta && dbModel !== expectedModel) {
      await finalize();
      return {
        used: false,
        reason: `model mismatch (db=${dbModel}, expected=${expectedModel})`,
        ...changeSummary
      };
    }
  }
  if (expectedDims !== null) {
    if (dbDenseMeta && dbDims === null) {
      await finalize();
      return { used: false, reason: 'dense metadata dims missing', ...changeSummary };
    }
    if (dbDenseMeta && dbDims !== expectedDims) {
      await finalize();
      return {
        used: false,
        reason: `dense dims mismatch (db=${dbDims}, expected=${expectedDims})`,
        ...changeSummary
      };
    }
  }

  const bundles = new Map();
  for (const record of changed) {
    const fileKey = record.file;
    const normalizedFile = record.normalized;
    const entry = record.entry;
    const bundleName = entry?.bundle;
    if (!bundleName) {
      await finalize();
      return { used: false, reason: `missing bundle for ${fileKey}`, ...changeSummary };
    }
    const bundlePath = path.join(incrementalData.bundleDir, bundleName);
    if (!fsSync.existsSync(bundlePath)) {
      await finalize();
      return { used: false, reason: `bundle missing for ${fileKey}`, ...changeSummary };
    }
    const result = await readBundleFile(bundlePath);
    if (!result.ok) {
      await finalize();
      return { used: false, reason: `invalid bundle for ${fileKey}`, ...changeSummary };
    }
    bundles.set(normalizedFile, { bundle: result.bundle, entry, fileKey, normalizedFile });
  }

  const tokenValues = new Set();
  const phraseValues = new Set();
  const chargramValues = new Set();
  const incomingDimsSet = new Set();
  for (const bundleEntry of bundles.values()) {
    const bundle = bundleEntry.bundle;
    for (const chunk of bundle.chunks || []) {
      const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
      if (tokensArray.length) {
        for (const token of tokensArray) tokenValues.add(token);
      }
      if (Array.isArray(chunk.ngrams)) {
        for (const ngram of chunk.ngrams) phraseValues.add(ngram);
      }
      if (Array.isArray(chunk.chargrams)) {
        for (const gram of chunk.chargrams) chargramValues.add(gram);
      }
      if (Array.isArray(chunk.embedding) && chunk.embedding.length) {
        incomingDimsSet.add(chunk.embedding.length);
      }
    }
  }
  if (incomingDimsSet.size > 1) {
    await finalize();
    return { used: false, reason: 'embedding dims mismatch across bundles', ...changeSummary };
  }
  const incomingDims = incomingDimsSet.size ? [...incomingDimsSet][0] : null;
  if (incomingDims !== null && dbDims !== null && incomingDims !== dbDims) {
    await finalize();
    return {
      used: false,
      reason: `embedding dims mismatch (db=${dbDims}, incoming=${incomingDims})`,
      ...changeSummary
    };
  }
  if (incomingDims !== null && expectedDims !== null && incomingDims !== expectedDims) {
    await finalize();
    return {
      used: false,
      reason: `embedding dims mismatch (expected=${expectedDims}, incoming=${incomingDims})`,
      ...changeSummary
    };
  }

  const updateFileManifest = db.prepare(
    'UPDATE file_manifest SET hash = ?, mtimeMs = ?, size = ? WHERE mode = ? AND file = ?'
  );
  if (!changed.length && !deleted.length) {
    const updateTx = db.transaction(() => {
      for (const record of manifestUpdates) {
        const normalizedFile = record.normalized;
        const entry = record.entry || {};
        updateFileManifest.run(
          entry?.hash || null,
          Number.isFinite(entry?.mtimeMs) ? entry.mtimeMs : null,
          Number.isFinite(entry?.size) ? entry.size : null,
          mode,
          normalizedFile
        );
      }
    });
    updateTx();
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      if (emitOutput) {
        warn(`[sqlite] WAL checkpoint failed for ${mode}: ${err?.message || err}`);
      }
    }
    await finalize();
    return { used: true, insertedChunks: 0, ...changeSummary };
  }

  const statements = createInsertStatements(db);
  const {
    insertChunk,
    insertFts,
    insertTokenVocab,
    insertTokenPosting,
    insertDocLength,
    insertTokenStats,
    insertPhraseVocab,
    insertPhrasePosting,
    insertChargramVocab,
    insertChargramPosting,
    insertMinhash,
    insertDense,
    insertDenseMeta,
    insertFileManifest
  } = statements;

  const existingIdsByFile = new Map();
  const normalizedFileExpr = process.platform === 'win32'
    ? "lower(replace(file, char(92), '/'))"
    : 'file';
  const toFileKey = (value) => {
    const normalized = normalizeFilePath(value);
    if (!normalized) return null;
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const readDocIdsForFile = db.prepare(
    'SELECT id, file FROM chunks WHERE mode = ? AND file = ? ORDER BY id'
  );
  const readDocIdsForFileCaseFold = process.platform === 'win32'
    ? db.prepare(`SELECT id, file FROM chunks WHERE mode = ? AND ${normalizedFileExpr} = ? ORDER BY id`)
    : null;
  const recordExistingDocRows = (rows = []) => {
    for (const row of rows) {
      const fileKey = toFileKey(row?.file);
      if (!fileKey) continue;
      const entry = existingIdsByFile.get(fileKey) || { file: normalizeFilePath(row.file), ids: [] };
      entry.ids.push(row.id);
      existingIdsByFile.set(fileKey, entry);
    }
  };
  const resolveExistingDocIds = (filePath) => {
    const fileKey = toFileKey(filePath);
    if (!fileKey) return [];
    const cached = existingIdsByFile.get(fileKey);
    if (cached) return cached.ids || [];
    const exactRows = readDocIdsForFile.all(mode, normalizeFilePath(filePath));
    if (exactRows.length) {
      recordExistingDocRows(exactRows);
      return existingIdsByFile.get(fileKey)?.ids || [];
    }
    if (readDocIdsForFileCaseFold) {
      const foldedRows = readDocIdsForFileCaseFold.all(mode, fileKey);
      if (foldedRows.length) {
        recordExistingDocRows(foldedRows);
        const resolved = existingIdsByFile.get(fileKey);
        if (resolved?.ids?.length) return resolved.ids;
      }
    }
    existingIdsByFile.set(fileKey, { file: normalizeFilePath(filePath), ids: [] });
    return [];
  };
  const targetFiles = new Set();
  for (const record of changed) {
    const key = toFileKey(record?.normalized);
    if (key) targetFiles.add(key);
  }
  for (const file of deleted) {
    const key = toFileKey(file);
    if (key) targetFiles.add(key);
  }
  const targetList = Array.from(targetFiles).filter(Boolean);
  const fileQueryBatch = Math.max(1, resolvedBatchSize);
  if (targetList.length) {
    for (const batch of chunkArray(targetList, fileQueryBatch)) {
      const rows = process.platform === 'win32'
        ? (() => {
          const placeholders = batch.map(() => '?').join(',');
          const stmt = db.prepare(
            `SELECT id, file FROM chunks WHERE mode = ? AND ${normalizedFileExpr} IN (${placeholders}) ORDER BY id`
          );
          return stmt.all(mode, ...batch);
        })()
        : (() => {
          const placeholders = batch.map(() => '?').join(',');
          const stmt = db.prepare(
            `SELECT id, file FROM chunks WHERE mode = ? AND file IN (${placeholders}) ORDER BY id`
          );
          return stmt.all(mode, ...batch);
        })();
      recordBatch('existingChunkBatches');
      if (batchStats) {
        batchStats.existingChunkRows = (batchStats.existingChunkRows || 0) + rows.length;
      }
      recordExistingDocRows(rows);
    }
  }

  const maxRow = db.prepare('SELECT MAX(id) AS maxId FROM chunks WHERE mode = ?')
    .get(mode);
  let nextDocId = Number.isFinite(maxRow?.maxId) ? maxRow.maxId + 1 : 0;
  // Prefer ids freed by explicit file deletes before overflow ids from changed
  // files so replacements are stable across incremental runs.
  const freeDocIdsDeleted = [];
  const freeDocIdsOverflow = [];
  let insertedChunks = 0;

  const vectorExtension = vectorConfig?.extension || {};
  const vectorAnnEnabled = vectorConfig?.enabled === true;
  const encodeVector = vectorConfig?.encodeVector;
  let denseMetaSet = false;
  let denseDims = null;
  let vectorAnnWarned = false;
  let vectorAnnInsertWarned = false;
  let vectorAnn = null;
  if (vectorAnnEnabled) {
    vectorAnn = prepareVectorAnnInsert({ db, mode, vectorConfig });
    if (vectorAnn.loaded === false && vectorAnn.reason && emitOutput) {
      warn(`[sqlite] Vector extension unavailable for ${mode}: ${vectorAnn.reason}`);
      vectorAnnWarned = true;
    }
  }

  const vectorDeleteTargets = vectorAnn?.ready
    ? [{ table: vectorAnn.tableName, column: 'rowid', withMode: false, transform: toSqliteRowId }]
    : [];
  if (vectorAnn?.ready && vectorDeleteTargets.length && vectorDeleteTargets[0].column !== 'rowid') {
    throw new Error('[sqlite] Vector delete targets must use rowid');
  }

  let chunkRows = 0;
  let ftsRows = 0;
  let docLengthRows = 0;
  let tokenVocabRows = 0;
  let tokenPostingRows = 0;
  let phraseVocabRows = 0;
  let phrasePostingRows = 0;
  let chargramVocabRows = 0;
  let chargramPostingRows = 0;
  let minhashRows = 0;
  let denseRows = 0;
  let denseMetaRows = 0;
  let fileManifestRows = 0;
  let tokenStatsRows = 0;
  let validationMs = 0;
  let deleteApplied = false;
  let insertApplied = false;

  const applyDeletes = db.transaction(() => {
    for (const file of deleted) {
      const normalizedFile = normalizeFilePath(file);
      if (!normalizedFile) continue;
      const docIds = resolveExistingDocIds(normalizedFile);
      deleteDocIds(db, mode, docIds, vectorDeleteTargets);
      if (docIds.length) {
        freeDocIdsDeleted.push(...docIds);
      }
      db.prepare('DELETE FROM file_manifest WHERE mode = ? AND file = ?')
        .run(mode, normalizedFile);
    }

    for (const record of changed) {
      const normalizedFile = record?.normalized;
      if (!normalizedFile) continue;
      const docIds = resolveExistingDocIds(normalizedFile);
      deleteDocIds(db, mode, docIds, vectorDeleteTargets);
    }

    for (const record of manifestUpdates) {
      const normalizedFile = record.normalized;
      const entry = record.entry || {};
      updateFileManifest.run(
        entry?.hash || null,
        Number.isFinite(entry?.mtimeMs) ? entry.mtimeMs : null,
        Number.isFinite(entry?.size) ? entry.size : null,
        mode,
        normalizedFile
      );
    }
  });

  const applyInserts = db.transaction(() => {
    const tokenVocab = ensureVocabIds(
      db,
      mode,
      'token_vocab',
      'token_id',
      'token',
      Array.from(tokenValues),
      insertTokenVocab,
      { limits: VOCAB_GROWTH_LIMITS.token_vocab }
    );
    if (tokenVocab.skip) {
      throw new IncrementalSkipError(tokenVocab.reason || 'token vocab growth too large');
    }
    tokenVocabRows += tokenVocab.inserted || 0;

    const phraseVocab = ensureVocabIds(
      db,
      mode,
      'phrase_vocab',
      'phrase_id',
      'ngram',
      Array.from(phraseValues),
      insertPhraseVocab,
      { limits: VOCAB_GROWTH_LIMITS.phrase_vocab }
    );
    if (phraseVocab.skip) {
      throw new IncrementalSkipError(phraseVocab.reason || 'phrase vocab growth too large');
    }
    phraseVocabRows += phraseVocab.inserted || 0;

    const chargramVocab = ensureVocabIds(
      db,
      mode,
      'chargram_vocab',
      'gram_id',
      'gram',
      Array.from(chargramValues),
      insertChargramVocab,
      { limits: VOCAB_GROWTH_LIMITS.chargram_vocab }
    );
    if (chargramVocab.skip) {
      throw new IncrementalSkipError(chargramVocab.reason || 'chargram vocab growth too large');
    }
    chargramVocabRows += chargramVocab.inserted || 0;

    const tokenIdMap = tokenVocab.map;
    const phraseIdMap = phraseVocab.map;
    const chargramIdMap = chargramVocab.map;

    const orderedChanged = [...changed].sort((a, b) => {
      const aIds = existingIdsByFile.get(a?.normalized || '')?.ids || [];
      const bIds = existingIdsByFile.get(b?.normalized || '')?.ids || [];
      const aIsNew = aIds.length === 0;
      const bIsNew = bIds.length === 0;
      if (aIsNew === bIsNew) return 0;
      return aIsNew ? -1 : 1;
    });

    for (const record of orderedChanged) {
      const normalizedFile = record.normalized;
      const reuseIds = resolveExistingDocIds(normalizedFile);
      let reuseIndex = 0;

      const bundleEntry = bundles.get(normalizedFile);
      const bundle = bundleEntry?.bundle;
      let chunkCount = 0;
      const isNewFile = reuseIds.length === 0;
      for (const chunk of bundle?.chunks || []) {
        let docId;
        if (reuseIndex < reuseIds.length) {
          docId = reuseIds[reuseIndex];
          reuseIndex += 1;
        } else if (isNewFile && freeDocIdsDeleted.length) {
          docId = freeDocIdsDeleted.pop();
        } else if (freeDocIdsOverflow.length) {
          docId = freeDocIdsOverflow.pop();
        } else if (freeDocIdsDeleted.length) {
          docId = freeDocIdsDeleted.pop();
        } else {
          docId = nextDocId;
          nextDocId += 1;
        }
        const row = buildChunkRow(
          { ...chunk, file: chunk.file || normalizedFile },
          mode,
          docId
        );
        insertChunk.run(row);
        insertFts.run(row);
        chunkRows += 1;
        ftsRows += 1;

        const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
        insertDocLength.run(mode, docId, tokensArray.length);
        docLengthRows += 1;
        const freq = buildTokenFrequency(tokensArray);
        for (const [token, tf] of freq.entries()) {
          const tokenId = tokenIdMap.get(token);
          if (tokenId === undefined) continue;
          insertTokenPosting.run(mode, tokenId, docId, tf);
          tokenPostingRows += 1;
        }

        if (Array.isArray(chunk.ngrams)) {
          const unique = new Set(chunk.ngrams);
          for (const ng of unique) {
            const phraseId = phraseIdMap.get(ng);
            if (phraseId === undefined) continue;
            insertPhrasePosting.run(mode, phraseId, docId);
            phrasePostingRows += 1;
          }
        }

        if (Array.isArray(chunk.chargrams)) {
          const unique = new Set(chunk.chargrams);
          for (const gram of unique) {
            const gramId = chargramIdMap.get(gram);
            if (gramId === undefined) continue;
            insertChargramPosting.run(mode, gramId, docId);
            chargramPostingRows += 1;
          }
        }

        if (Array.isArray(chunk.minhashSig) && chunk.minhashSig.length) {
          insertMinhash.run(mode, docId, packUint32(chunk.minhashSig));
          minhashRows += 1;
        }

        if (Array.isArray(chunk.embedding) && chunk.embedding.length) {
          const dims = chunk.embedding.length;
          if (!denseMetaSet) {
            insertDenseMeta.run(
              mode,
              dims,
              1.0,
              modelConfig.id || null,
              quantization.minVal,
              quantization.maxVal,
              quantization.levels
            );
            denseMetaSet = true;
            denseDims = dims;
            denseMetaRows += 1;
          } else if (denseDims !== null && dims !== denseDims) {
            throw new Error(`Dense vector dims mismatch for ${mode}: expected ${denseDims}, got ${dims}`);
          }
          insertDense.run(
            mode,
            docId,
            packUint8(
              quantizeVec(chunk.embedding, quantization.minVal, quantization.maxVal, quantization.levels),
              { onClamp: recordDenseClamp }
            )
          );
          denseRows += 1;
          if (vectorAnn?.loaded) {
            if (!vectorAnn.ready) {
              const created = prepareVectorAnnInsert({ db, mode, vectorConfig, dims });
              if (created.ready) {
                vectorAnn = created;
              } else if (created.reason && !vectorAnnWarned && emitOutput) {
                warn(`[sqlite] Failed to prepare vector table for ${mode}: ${created.reason}`);
                vectorAnnWarned = true;
              }
            }
            if (vectorAnn.ready && vectorAnn.insert && encodeVector) {
              const encoded = encodeVector(chunk.embedding, vectorExtension);
              if (encoded) {
                const compatible = isVectorEncodingCompatible({
                  encoded,
                  dims,
                  encoding: vectorExtension.encoding
                });
                if (!compatible) {
                  if (!vectorAnnInsertWarned && emitOutput) {
                    const expectedBytes = resolveVectorEncodingBytes(dims, vectorExtension.encoding);
                    const actualBytes = resolveEncodedVectorBytes(encoded);
                    warn(
                      `[sqlite] Vector extension insert skipped for ${mode}: ` +
                      `encoded length ${actualBytes ?? 'unknown'} != expected ${expectedBytes ?? 'unknown'} ` +
                      `(dims=${dims}, encoding=${vectorExtension.encoding || 'float32'}).`
                    );
                    vectorAnnInsertWarned = true;
                  }
                } else {
                  vectorAnn.insert.run(toSqliteRowId(docId), encoded);
                }
              }
            }
          }
        }

        chunkCount += 1;
        insertedChunks += 1;
      }
      if (reuseIndex < reuseIds.length) {
        freeDocIdsOverflow.push(...reuseIds.slice(reuseIndex));
      }

      const manifestEntry = record.entry || bundleEntry?.entry || {};
      insertFileManifest.run(
        mode,
        normalizedFile,
        manifestEntry?.hash || null,
        Number.isFinite(manifestEntry?.mtimeMs) ? manifestEntry.mtimeMs : null,
        Number.isFinite(manifestEntry?.size) ? manifestEntry.size : null,
        chunkCount
      );
      fileManifestRows += 1;
    }

    updateTokenStats(db, mode, insertTokenStats);
    tokenStatsRows += 1;
    const validationStart = performance.now();
    validateSqliteDatabase(db, mode, { validateMode, emitOutput, logger, dbPath: outPath });
    validationMs = performance.now() - validationStart;
  });

  try {
    applyDeletes();
    deleteApplied = true;
    const applyStart = performance.now();
    applyInserts();
    insertApplied = true;
    const applyDurationMs = performance.now() - applyStart;
    recordTable('chunks', chunkRows, applyDurationMs);
    recordTable('chunks_fts', ftsRows, applyDurationMs);
    recordTable('doc_lengths', docLengthRows, applyDurationMs);
    recordTable('token_vocab', tokenVocabRows, applyDurationMs);
    recordTable('token_postings', tokenPostingRows, applyDurationMs);
    recordTable('phrase_vocab', phraseVocabRows, applyDurationMs);
    recordTable('phrase_postings', phrasePostingRows, applyDurationMs);
    recordTable('chargram_vocab', chargramVocabRows, applyDurationMs);
    recordTable('chargram_postings', chargramPostingRows, applyDurationMs);
    recordTable('minhash_signatures', minhashRows, applyDurationMs);
    recordTable('dense_vectors', denseRows, applyDurationMs);
    recordTable('dense_meta', denseMetaRows, 0);
    recordTable('file_manifest', fileManifestRows, applyDurationMs);
    recordTable('token_stats', tokenStatsRows, 0);
    if (denseClampStats.totalValues > 0 && emitOutput) {
      warn(
        `[sqlite] Uint8 vector values clamped while updating ${mode}: ` +
        `${denseClampStats.totalValues} value(s) across ${denseClampStats.totalVectors} vector(s).`
      );
    }
    if (batchStats) {
      batchStats.validationMs = validationMs;
      batchStats.transactionPhases = {
        deletes: deleteApplied,
        inserts: insertApplied
      };
    }
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      if (emitOutput) {
        warn(`[sqlite] WAL checkpoint failed for ${mode}: ${err?.message || err}`);
      }
    }
  } catch (err) {
    await finalize();
    if (err instanceof IncrementalSkipError) {
      return { used: false, reason: err.reason, ...changeSummary };
    }
    throw err;
  }
  await finalize();
  return {
    used: true,
    insertedChunks,
    ...changeSummary
  };
}

