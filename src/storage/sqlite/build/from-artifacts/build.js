import { prepareVectorAnnTable } from '../../build-helpers.js';
import { CREATE_INDEXES_SQL } from '../../schema.js';
import { createUint8ClampStats } from '../../vector.js';
import { resolveQuantizationParams } from '../../quantization.js';
import { normalizeManifestFiles } from '../manifest.js';
import {
  beginSqliteBuildTransaction,
  closeSqliteBuildDatabase,
  commitSqliteBuildTransaction,
  createBuildExecutionContext,
  createSqliteBuildInsertContext,
  openSqliteBuildDatabase,
  rollbackSqliteBuildTransaction,
  runSqliteBuildPostCommit
} from '../core.js';
import { loadOptionalFileMetaRows } from './sources.js';
import { createChunkIngestor } from './chunk-ingest.js';
import { createTokenIngestor } from './token-ingest.js';
import { createVectorIngestor } from './vector-ingest.js';

const ARTIFACT_BUILD_PRAGMA_MIN_BYTES = 128 * 1024 * 1024;

/**
 * Build a sqlite database from artifact files.
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.Database
 * @param {string} [params.outPath]
 * @param {string} [params.outputPath]
 * @param {object} [params.index]
 * @param {string} [params.indexDir]
 * @param {object} [params.pieces]
 * @param {'code'|'prose'|'extracted-prose'|'records'} params.mode
 * @param {object} [params.manifestFiles]
 * @param {boolean} params.emitOutput
 * @param {string} params.validateMode
 * @param {object} params.vectorConfig
 * @param {object} params.modelConfig
 * @param {object} [params.logger]
 * @param {number} [params.inputBytes]
 * @param {number} [params.batchSize]
 * @param {'prepared'|'multi-row'|'prepare-per-shard'} [params.statementStrategy]
 * @param {boolean} [params.buildPragmas]
 * @param {boolean} [params.optimize]
 * @param {object} [params.stats]
 * @returns {Promise<number>}
 */
export async function buildDatabaseFromArtifacts({
  Database,
  outPath,
  outputPath,
  index,
  indexDir,
  pieces,
  mode,
  manifestFiles,
  emitOutput,
  validateMode,
  vectorConfig,
  modelConfig,
  logger,
  inputBytes,
  batchSize,
  statementStrategy,
  buildPragmas,
  optimize,
  stats
}) {
  const resolvedOutPath = typeof outputPath === 'string' ? outputPath : outPath;
  if (!resolvedOutPath || typeof resolvedOutPath !== 'string') {
    throw new Error('[sqlite] buildDatabaseFromArtifacts: outputPath must be a string.');
  }
  const resolvedIndexDir = typeof indexDir === 'string'
    ? indexDir
    : (typeof pieces?.dir === 'string'
      ? pieces.dir
      : (typeof indexDir?.indexDir === 'string'
        ? indexDir.indexDir
        : (typeof indexDir?.dir === 'string' ? indexDir.dir : null)));
  if (!resolvedIndexDir) {
    throw new Error('[sqlite] buildDatabaseFromArtifacts: indexDir must be a string.');
  }
  indexDir = resolvedIndexDir;
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
  const {
    resolvedBatchSize,
    batchStats,
    resolvedStatementStrategy,
    recordBatch,
    recordTable
  } = createBuildExecutionContext({ batchSize, inputBytes, statementStrategy, stats });
  if (!index && !indexDir) return 0;
  const manifestLookup = normalizeManifestFiles(manifestFiles || {});
  if (emitOutput && manifestLookup.conflicts.length) {
    warn(`[sqlite] Manifest path conflicts for ${mode}; using normalized entries.`);
  }
  const manifestByNormalized = manifestLookup.map;
  const validationStats = { chunks: 0, dense: 0, minhash: 0 };
  const chunkMetaStats = batchStats
    ? (batchStats.chunkMeta || (batchStats.chunkMeta = {
      passes: 0,
      rows: 0,
      streamedRows: 0,
      tokenTextMaterialized: 0,
      tokenTextSkipped: 0,
      sourceRows: {
        json: 0,
        columnar: 0,
        jsonl: 0,
        array: 0
      },
      sourceFiles: {
        json: 0,
        columnar: 0,
        jsonl: 0
      }
    }))
    : null;
  const bumpChunkMetaCounter = (key, delta = 1) => {
    if (!chunkMetaStats || !key || !Number.isFinite(delta)) return;
    chunkMetaStats[key] = (Number(chunkMetaStats[key]) || 0) + delta;
  };
  const bumpChunkMetaBucket = (bucketKey, key, delta = 1) => {
    if (!chunkMetaStats || !bucketKey || !key || !Number.isFinite(delta)) return;
    const bucket = chunkMetaStats[bucketKey] && typeof chunkMetaStats[bucketKey] === 'object'
      ? chunkMetaStats[bucketKey]
      : (chunkMetaStats[bucketKey] = {});
    bucket[key] = (Number(bucket[key]) || 0) + delta;
  };
  const vectorExtension = vectorConfig?.extension || {};
  const encodeVector = vectorConfig?.encodeVector;
  const quantization = resolveQuantizationParams(vectorConfig?.quantization);
  const denseClampStats = createUint8ClampStats();
  const recordDenseClamp = (clamped) => denseClampStats.record(clamped);

  const resolvedInputBytes = Number(inputBytes);
  const hasInputBytes = Number.isFinite(resolvedInputBytes) && resolvedInputBytes > 0;
  const defaultOptimize = hasInputBytes
    ? resolvedInputBytes >= ARTIFACT_BUILD_PRAGMA_MIN_BYTES
    : true;
  const useBuildPragmas = typeof buildPragmas === 'boolean' ? buildPragmas : defaultOptimize;
  const useOptimize = typeof optimize === 'boolean' ? optimize : defaultOptimize;
  const { db, pragmaState, dbPath, promotePath } = openSqliteBuildDatabase({
    Database,
    outPath: resolvedOutPath,
    batchStats,
    inputBytes,
    useBuildPragmas
  });

  let count = 0;
  let succeeded = false;
  try {
    const vectorAnn = prepareVectorAnnTable({ db, indexData: index, mode, vectorConfig });
    const {
      insertClause,
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
      insertFileManifest,
      insertTokenVocabMany,
      insertTokenPostingMany,
      insertDocLengthMany,
      insertPhraseVocabMany,
      insertPhrasePostingMany,
      insertChargramVocabMany,
      insertChargramPostingMany
    } = createSqliteBuildInsertContext(db, { batchStats, resolvedStatementStrategy });
    db.exec(`
      DROP TABLE IF EXISTS file_meta_stage;
      DROP TABLE IF EXISTS chunks_stage;
      CREATE TEMP TABLE file_meta_stage (
        id INTEGER PRIMARY KEY,
        file TEXT,
        ext TEXT,
        size INTEGER,
        hash TEXT,
        hashAlgo TEXT,
        encoding TEXT,
        encodingFallback INTEGER,
        encodingConfidence REAL,
        externalDocs TEXT,
        last_modified TEXT,
        last_author TEXT,
        churn REAL,
        churn_added INTEGER,
        churn_deleted INTEGER,
        churn_commits INTEGER
      );
      CREATE TEMP TABLE chunks_stage (
        id INTEGER,
        chunk_id TEXT,
        mode TEXT,
        file_id INTEGER,
        file TEXT,
        start INTEGER,
        end INTEGER,
        startLine INTEGER,
        endLine INTEGER,
        ext TEXT,
        kind TEXT,
        name TEXT,
        metaV2_json TEXT,
        signature TEXT,
        headline TEXT,
        doc TEXT,
        preContext TEXT,
        postContext TEXT,
        weight REAL,
        tokens TEXT,
        tokensText TEXT,
        ngrams TEXT,
        codeRelations TEXT,
        docmeta TEXT,
        stats TEXT,
        complexity TEXT,
        lint TEXT,
        externalDocs TEXT,
        last_modified TEXT,
        last_author TEXT,
        churn REAL,
        churn_added INTEGER,
        churn_deleted INTEGER,
        churn_commits INTEGER,
        chunk_authors TEXT
      );
      CREATE INDEX idx_chunks_stage_file_id ON chunks_stage (file_id);
    `);
    const insertFileMetaStage = db.prepare(`
      INSERT OR REPLACE INTO file_meta_stage (
        id,
        file,
        ext,
        size,
        hash,
        hashAlgo,
        encoding,
        encodingFallback,
        encodingConfidence,
        externalDocs,
        last_modified,
        last_author,
        churn,
        churn_added,
        churn_deleted,
        churn_commits
      ) VALUES (
        @id,
        @file,
        @ext,
        @size,
        @hash,
        @hashAlgo,
        @encoding,
        @encodingFallback,
        @encodingConfidence,
        @externalDocs,
        @last_modified,
        @last_author,
        @churn,
        @churn_added,
        @churn_deleted,
        @churn_commits
      );
    `);
    const insertChunkStage = db.prepare(`
      INSERT OR REPLACE INTO chunks_stage (
        id,
        chunk_id,
        mode,
        file_id,
        file,
        start,
        end,
        startLine,
        endLine,
        ext,
        kind,
        name,
        metaV2_json,
        signature,
        headline,
        doc,
        preContext,
        postContext,
        weight,
        tokens,
        tokensText,
        ngrams,
        codeRelations,
        docmeta,
        stats,
        complexity,
        lint,
        externalDocs,
        last_modified,
        last_author,
        churn,
        churn_added,
        churn_deleted,
        churn_commits,
        chunk_authors
      ) VALUES (
        @id,
        @chunk_id,
        @mode,
        @file_id,
        @file,
        @start,
        @end,
        @startLine,
        @endLine,
        @ext,
        @kind,
        @name,
        @metaV2_json,
        @signature,
        @headline,
        @doc,
        @preContext,
        @postContext,
        @weight,
        @tokens,
        @tokensText,
        @ngrams,
        @codeRelations,
        @docmeta,
        @stats,
        @complexity,
        @lint,
        @externalDocs,
        @last_modified,
        @last_author,
        @churn,
        @churn_added,
        @churn_deleted,
        @churn_commits,
        @chunk_authors
      );
    `);

    const chunkIngestor = createChunkIngestor({
      db,
      resolvedBatchSize,
      recordBatch,
      recordTable,
      bumpChunkMetaCounter,
      bumpChunkMetaBucket,
      insertFileMetaStage,
      insertChunkStage,
      insertFileManifest,
      manifestByNormalized
    });

    const tokenIngestor = createTokenIngestor({
      db,
      insertClause,
      resolvedStatementStrategy,
      resolvedBatchSize,
      recordBatch,
      recordTable,
      warn,
      insertTokenVocab,
      insertTokenPosting,
      insertDocLength,
      insertTokenStats,
      insertTokenVocabMany,
      insertTokenPostingMany,
      insertDocLengthMany
    });

    const vectorIngestor = createVectorIngestor({
      db,
      resolvedBatchSize,
      recordBatch,
      recordTable,
      warn,
      validationStats,
      vectorAnn,
      vectorExtension,
      encodeVector,
      quantization,
      modelConfig,
      insertMinhash,
      insertDense,
      insertDenseMeta,
      recordDenseClamp
    });

    async function ingestIndex(indexData, targetMode, modeIndexDir) {
      if (!indexData && !modeIndexDir) return 0;
      const fileMetaSource = indexData?.fileMeta
        ?? (modeIndexDir ? loadOptionalFileMetaRows(modeIndexDir) : null);
      await chunkIngestor.ingestFileMetaRows(fileMetaSource);
      let chunkCount = 0;
      let chunkMetaLoaded = false;
      if (modeIndexDir) {
        const result = await chunkIngestor.ingestChunkMetaPieces(
          targetMode,
          modeIndexDir,
          indexData?.chunkMetaSources
        );
        chunkCount = result.count;
        chunkMetaLoaded = result.count > 0;
      }
      if (!chunkMetaLoaded && Array.isArray(indexData?.chunkMeta)) {
        const ingestor = chunkIngestor.createChunkMetaStageIngestor({ targetMode, sourceKind: 'array' });
        for (let i = 0; i < indexData.chunkMeta.length; i += 1) {
          const chunk = indexData.chunkMeta[i];
          ingestor.handleChunk(chunk, i);
        }
        chunkCount = ingestor.finish();
      }
      chunkIngestor.finalizeChunkIngest(targetMode, chunkCount);

      let tokenIngested = false;
      if (indexData?.tokenPostings) {
        tokenIngestor.ingestTokenIndex(indexData.tokenPostings, targetMode);
        tokenIngested = true;
      }
      if (!tokenIngested && modeIndexDir) {
        tokenIngested = tokenIngestor.ingestTokenIndexFromPieces(
          targetMode,
          modeIndexDir,
          indexData?.tokenPostingsSources || null
        );
      }
      if (!tokenIngested && chunkCount > 0) {
        warn(`[sqlite] token_postings missing; rebuilding tokens for ${targetMode}.`);
        if (Array.isArray(indexData?.chunkMeta) && indexData.chunkMeta.length) {
          tokenIngestor.ingestTokenIndexFromChunks(indexData.chunkMeta, targetMode);
        } else if (!tokenIngestor.ingestTokenIndexFromStoredChunks(targetMode)) {
          warn(`[sqlite] chunk_meta unavailable for token rebuild (${targetMode}).`);
        }
      }

      tokenIngestor.ingestPostingIndex(
        indexData?.phraseNgrams,
        targetMode,
        insertPhraseVocab,
        insertPhrasePosting,
        {
          vocabTable: 'phrase_vocab',
          postingTable: 'phrase_postings',
          insertVocabMany: insertPhraseVocabMany,
          insertPostingMany: insertPhrasePostingMany
        }
      );
      tokenIngestor.ingestPostingIndex(
        indexData?.chargrams,
        targetMode,
        insertChargramVocab,
        insertChargramPosting,
        {
          vocabTable: 'chargram_vocab',
          postingTable: 'chargram_postings',
          insertVocabMany: insertChargramVocabMany,
          insertPostingMany: insertChargramPostingMany
        }
      );
      await vectorIngestor.ingestMinhash(indexData?.minhash, targetMode);
      await vectorIngestor.ingestDense(indexData?.denseVec, targetMode);
      chunkIngestor.ingestFileManifestFromChunks(targetMode);
      db.exec('DELETE FROM file_meta_stage;');

      if (indexData && typeof indexData === 'object') {
        indexData.chunkMeta = null;
        indexData.fileMeta = null;
        indexData.tokenPostings = null;
        indexData.phraseNgrams = null;
        indexData.chargrams = null;
        indexData.minhash = null;
        indexData.denseVec = null;
      }

      return chunkCount;
    }

    beginSqliteBuildTransaction(db, batchStats);
    try {
      count = await ingestIndex(index, mode, indexDir);
      validationStats.chunks = count;
      db.exec(CREATE_INDEXES_SQL);
      commitSqliteBuildTransaction(db, batchStats);
    } catch (err) {
      rollbackSqliteBuildTransaction(db, batchStats);
      throw err;
    }
    runSqliteBuildPostCommit({
      db,
      mode,
      validateMode,
      expected: validationStats,
      emitOutput,
      logger,
      dbPath,
      vectorAnnTable: vectorAnn?.tableName || vectorExtension.table || 'dense_vectors_ann',
      useOptimize,
      inputBytes,
      batchStats
    });
    succeeded = true;
  } finally {
    if (denseClampStats.totalValues > 0) {
      warn(
        `[sqlite] Uint8 vector values clamped while building ${mode}: ` +
        `${denseClampStats.totalValues} value(s) across ${denseClampStats.totalVectors} vector(s).`
      );
    }
    await closeSqliteBuildDatabase({
      db,
      succeeded,
      pragmaState,
      dbPath,
      promotePath,
      outPath: resolvedOutPath,
      warn: (err) => warn(`[sqlite] WAL checkpoint failed for ${mode}: ${err?.message || err}`)
    });
  }
  return count;
}
