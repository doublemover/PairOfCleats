import fsSync from 'node:fs';
import { REQUIRED_TABLES, SCHEMA_VERSION } from '../schema.js';
import {
  hasRequiredTables,
  removeSqliteSidecars,
  resolveSqliteBatchSize,
  bumpSqliteBatchStat
} from '../utils.js';
import { createUint8ClampStats } from '../vector.js';
import { resolveQuantizationParams } from '../quantization.js';
import { applyBuildPragmas, restoreBuildPragmas } from './pragmas.js';
import { createInsertStatements } from './statements.js';
import { getSchemaVersion } from './validate.js';
import { resolveIncrementalChangePlan, loadBundlesAndCollectState } from './incremental-update/planner.js';
import { createIncrementalDocIdResolver } from './incremental-update/doc-id-resolver.js';
import { runIncrementalUpdatePhase } from './incremental-update/update-phase.js';

const MAX_INCREMENTAL_CHANGE_RATIO = 0.35;
const MAX_INCREMENTAL_CHANGE_RATIO_BY_MODE = {
  prose: 0.75,
  'extracted-prose': 0.97
};
const MAX_INCREMENTAL_CHANGE_RATIO_GRACE_BY_MODE = {
  'extracted-prose': 0.995
};
const MAX_INCREMENTAL_CHANGE_GRACE_DELETED_RATIO = 0.02;
const MAX_INCREMENTAL_CHANGE_GRACE_DELETED_RATIO_BY_MODE = {
  'extracted-prose': 0.01
};
const VOCAB_GROWTH_LIMITS = {
  token_vocab: { ratio: 0.4, absolute: 200000 },
  phrase_vocab: { ratio: 0.5, absolute: 150000 },
  chargram_vocab: { ratio: 1.0, absolute: 250000 }
};

/**
 * Resolve how many dense vectors a payload expects, supporting both current
 * and legacy dense metadata shapes.
 *
 * @param {object|null} denseVec
 * @returns {number}
 */
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
 * Decide whether the manifest delta is small enough to safely apply
 * incrementally for the given mode.
 *
 * @param {{mode:string,totalFiles:number,changedCount:number,deletedCount:number}} input
 * @returns {{ok:boolean,changeRatio:number,maxChangeRatio:number}}
 */
const evaluateIncrementalChangeGuard = ({ mode, totalFiles, changedCount, deletedCount }) => {
  const maxChangeRatio = Number.isFinite(MAX_INCREMENTAL_CHANGE_RATIO_BY_MODE[mode])
    ? MAX_INCREMENTAL_CHANGE_RATIO_BY_MODE[mode]
    : MAX_INCREMENTAL_CHANGE_RATIO;
  const maxGraceRatio = Number.isFinite(MAX_INCREMENTAL_CHANGE_RATIO_GRACE_BY_MODE[mode])
    ? MAX_INCREMENTAL_CHANGE_RATIO_GRACE_BY_MODE[mode]
    : null;
  const maxGraceDeletedRatio = Number.isFinite(MAX_INCREMENTAL_CHANGE_GRACE_DELETED_RATIO_BY_MODE[mode])
    ? MAX_INCREMENTAL_CHANGE_GRACE_DELETED_RATIO_BY_MODE[mode]
    : MAX_INCREMENTAL_CHANGE_GRACE_DELETED_RATIO;
  if (!totalFiles) {
    return { ok: true, changeRatio: 0, maxChangeRatio };
  }
  const changeRatio = (changedCount + deletedCount) / totalFiles;
  const deletedRatio = deletedCount / totalFiles;
  const withinGrace = maxGraceRatio != null
    && changeRatio <= maxGraceRatio
    && deletedRatio <= maxGraceDeletedRatio;
  return {
    ok: changeRatio <= maxChangeRatio || withinGrace,
    changeRatio,
    maxChangeRatio: withinGrace ? maxGraceRatio : maxChangeRatio
  };
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

  const changePlan = resolveIncrementalChangePlan({
    db,
    mode,
    manifest: incrementalData.manifest,
    evaluateChangeGuard: evaluateIncrementalChangeGuard
  });
  if (!changePlan.ok) {
    await finalize();
    return {
      used: false,
      reason: changePlan.reason,
      ...(changePlan.changeSummary || {})
    };
  }
  const {
    changed,
    deleted,
    manifestUpdates,
    changeSummary
  } = changePlan;
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

  const bundlePlan = await loadBundlesAndCollectState({
    changed,
    bundleDir: incrementalData.bundleDir
  });
  if (!bundlePlan.ok) {
    await finalize();
    return { used: false, reason: bundlePlan.reason, ...changeSummary };
  }
  const {
    bundles,
    tokenValues,
    phraseValues,
    chargramValues,
    incomingDims
  } = bundlePlan;
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

  const statements = createInsertStatements(db);
  const docIdResolver = createIncrementalDocIdResolver({
    db,
    mode,
    changed,
    deleted,
    batchSize: resolvedBatchSize,
    onBatch: (rows) => {
      recordBatch('existingChunkBatches');
      if (batchStats) {
        batchStats.existingChunkRows = (batchStats.existingChunkRows || 0) + rows;
      }
    }
  });
  const orderedChanged = docIdResolver.orderChangedRecords(changed);
  const maxRow = db.prepare('SELECT MAX(id) AS maxId FROM chunks WHERE mode = ?')
    .get(mode);
  const startDocId = Number.isFinite(maxRow?.maxId) ? maxRow.maxId + 1 : 0;

  let insertedChunks = 0;
  try {
    const updateResult = runIncrementalUpdatePhase({
      db,
      outPath,
      mode,
      changed,
      deleted,
      manifestUpdates,
      bundles,
      tokenValues,
      phraseValues,
      chargramValues,
      modelConfig,
      vectorConfig,
      quantization,
      validateMode,
      emitOutput,
      logger,
      warn,
      updateFileManifest,
      statements,
      resolveExistingDocIds: docIdResolver.resolveExistingDocIds,
      orderedChanged,
      startDocId,
      recordDenseClamp,
      vocabGrowthLimits: VOCAB_GROWTH_LIMITS
    });
    if (!updateResult.ok) {
      await finalize();
      return { used: false, reason: updateResult.skipReason, ...changeSummary };
    }
    insertedChunks = updateResult.insertedChunks;
    const rows = updateResult.tableRows;
    const applyDurationMs = updateResult.applyDurationMs;
    recordTable('chunks', rows.chunks, applyDurationMs);
    recordTable('chunks_fts', rows.chunks_fts, applyDurationMs);
    recordTable('doc_lengths', rows.doc_lengths, applyDurationMs);
    recordTable('token_vocab', rows.token_vocab, applyDurationMs);
    recordTable('token_postings', rows.token_postings, applyDurationMs);
    recordTable('phrase_vocab', rows.phrase_vocab, applyDurationMs);
    recordTable('phrase_postings', rows.phrase_postings, applyDurationMs);
    recordTable('chargram_vocab', rows.chargram_vocab, applyDurationMs);
    recordTable('chargram_postings', rows.chargram_postings, applyDurationMs);
    recordTable('minhash_signatures', rows.minhash_signatures, applyDurationMs);
    recordTable('dense_vectors', rows.dense_vectors, applyDurationMs);
    recordTable('dense_meta', rows.dense_meta, 0);
    recordTable('file_manifest', rows.file_manifest, applyDurationMs);
    recordTable('token_stats', rows.token_stats, 0);
    if (denseClampStats.totalValues > 0 && emitOutput) {
      warn(
        `[sqlite] Uint8 vector values clamped while updating ${mode}: ` +
        `${denseClampStats.totalValues} value(s) across ${denseClampStats.totalVectors} vector(s).`
      );
    }
    if (batchStats) {
      batchStats.validationMs = updateResult.validationMs;
      batchStats.transactionPhases = updateResult.transactionPhases;
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
    throw err;
  }
  await finalize();
  return {
    used: true,
    insertedChunks,
    ...changeSummary
  };
}
