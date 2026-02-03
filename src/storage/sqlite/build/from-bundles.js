import fsSync from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildChunkRow, buildTokenFrequency, prepareVectorAnnInsert } from '../build-helpers.js';
import { CREATE_INDEXES_SQL, CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../schema.js';
import {
  normalizeFilePath,
  removeSqliteSidecars,
  resolveSqliteBatchSize,
  bumpSqliteBatchStat
} from '../utils.js';
import {
  dequantizeUint8ToFloat32,
  isVectorEncodingCompatible,
  packUint32,
  packUint8,
  quantizeVec,
  resolveEncodedVectorBytes,
  resolveQuantizationParams,
  resolveVectorEncodingBytes,
  toSqliteRowId
} from '../vector.js';
import { applyBuildPragmas, optimizeBuildDatabase, restoreBuildPragmas } from './pragmas.js';
import { normalizeManifestFiles } from './manifest.js';
import { validateSqliteDatabase } from './validate.js';
import { createInsertStatements } from './statements.js';
import { createBundleLoader } from './bundle-loader.js';

/**
 * Build a sqlite database from incremental bundle files.
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.Database
 * @param {string} params.outPath
 * @param {'code'|'prose'|'extracted-prose'|'records'} params.mode
 * @param {object} params.incrementalData
 * @param {object} params.envConfig
 * @param {{fileConcurrency:number}} params.threadLimits
 * @param {boolean} params.emitOutput
 * @param {string} params.validateMode
 * @param {object} params.vectorConfig
 * @param {object} params.modelConfig
 * @param {string} [params.workerPath]
 * @param {object} [params.logger]
 * @param {number} [params.inputBytes]
 * @param {number} [params.batchSize]
 * @param {object} [params.stats]
 * @returns {Promise<{count:number,denseCount:number,reason?:string,embedStats?:object,vectorAnn?:object}>}
 */
export async function buildDatabaseFromBundles({
  Database,
  outPath,
  mode,
  incrementalData,
  envConfig,
  threadLimits,
  emitOutput,
  validateMode,
  vectorConfig,
  modelConfig,
  workerPath,
  logger,
  inputBytes,
  batchSize,
  stats
}) {
  const log = (message) => {
    if (!emitOutput || !message) return;
    if (logger?.log) {
      logger.log(message);
      return;
    }
    console.error(message);
  };
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
  if (!incrementalData?.manifest) {
    return { count: 0, denseCount: 0, reason: 'missing incremental manifest' };
  }
  const resolvedBatchSize = resolveSqliteBatchSize({ batchSize, inputBytes });
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
  const manifestFiles = incrementalData.manifest.files || {};
  const manifestLookup = normalizeManifestFiles(manifestFiles);
  const manifestEntries = manifestLookup.entries;
  if (!manifestEntries.length) {
    return { count: 0, denseCount: 0, reason: 'incremental manifest empty' };
  }
  if (emitOutput && manifestLookup.conflicts.length) {
    warn(`[sqlite] Manifest path conflicts for ${mode}; using normalized entries.`);
  }
  const totalFiles = manifestEntries.length;
  let processedFiles = 0;
  let lastProgressLog = 0;
  const progressIntervalMs = 1000;
  const envBundleThreads = Number(envConfig.bundleThreads);
  const bundleThreads = Number.isFinite(envBundleThreads) && envBundleThreads > 0
    ? Math.floor(envBundleThreads)
    : Math.max(1, Math.floor(threadLimits.fileConcurrency));
  const bundleLoader = createBundleLoader({ bundleThreads, workerPath });
  const useBundleWorkers = bundleLoader.useWorkers;
  const logBundleProgress = (file, force = false) => {
    if (!emitOutput) return;
    const now = Date.now();
    if (!force && now - lastProgressLog < progressIntervalMs) return;
    lastProgressLog = now;
    const percent = ((processedFiles / totalFiles) * 100).toFixed(1);
    const suffix = file ? ` | ${file}` : '';
    log(`[sqlite] bundles ${processedFiles}/${totalFiles} (${percent}%)${suffix}`);
  };
  if (emitOutput) {
    log(`[sqlite] Using incremental bundles for ${mode} (${totalFiles} files).`);
    if (useBundleWorkers) {
      log(`[sqlite] Bundle parser workers: ${bundleThreads}.`);
    }
  }

  const db = new Database(outPath);
  const pragmaState = applyBuildPragmas(db, { inputBytes, stats: batchStats });
  db.exec(CREATE_TABLES_BASE_SQL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  let succeeded = false;
  try {
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

    const tokenIdMap = new Map();
    const phraseIdMap = new Map();
    const chargramIdMap = new Map();
    let nextTokenId = 0;
    let nextPhraseId = 0;
    let nextChargramId = 0;
    let nextDocId = 0;
    let totalDocs = 0;
    let totalLen = 0;
    const validationStats = { chunks: 0, dense: 0, minhash: 0 };

    const fileCounts = new Map();
    const fileEmbeddingCounts = new Map();
    for (const record of manifestEntries) {
      fileCounts.set(record.normalized, 0);
      fileEmbeddingCounts.set(record.normalized, 0);
    }

    const vectorExtension = vectorConfig?.extension || {};
    const vectorAnnEnabled = vectorConfig?.enabled === true;
    const encodeVector = vectorConfig?.encodeVector;
    const quantization = resolveQuantizationParams(vectorConfig?.quantization);
    let denseMetaSet = false;
    let denseDims = null;
    let vectorAnnWarned = false;
    let vectorAnnInsertWarned = false;
    let vectorAnn = null;
    const vectorAnnState = {
      enabled: vectorAnnEnabled,
      loaded: false,
      ready: false,
      reason: null,
      table: vectorExtension.table || 'dense_vectors_ann',
      column: vectorExtension.column || 'embedding'
    };
    const ensureVectorAnn = (dims) => {
      if (!vectorAnnEnabled) return;
      const prepared = prepareVectorAnnInsert({ db, mode, vectorConfig, dims });
      vectorAnn = prepared;
      vectorAnnState.loaded = prepared.loaded === true;
      vectorAnnState.ready = prepared.ready === true;
      if (prepared.tableName) vectorAnnState.table = prepared.tableName;
      if (prepared.column) vectorAnnState.column = prepared.column;
      if (prepared.reason) vectorAnnState.reason = prepared.reason;
      if (prepared.loaded === false && prepared.reason && !vectorAnnWarned) {
        warn(`[sqlite] Vector extension unavailable for ${mode}: ${prepared.reason}`);
        vectorAnnWarned = true;
      } else if (prepared.loaded && !prepared.ready && prepared.reason && !vectorAnnWarned) {
        warn(`[sqlite] Failed to prepare vector table for ${mode}: ${prepared.reason}`);
        vectorAnnWarned = true;
      }
    };

    let denseFloatChunks = 0;
    let denseU8Chunks = 0;
    let insertBatchMs = 0;
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
    const insertBundleBatch = db.transaction((chunks, start, end, fileKey, normalizedFile) => {
      const batchStart = performance.now();
      for (let idx = start; idx < end; idx += 1) {
        const chunk = chunks[idx];
        if (!chunk) continue;
        const docId = nextDocId;
        nextDocId += 1;

        const row = buildChunkRow({ ...chunk, file: chunk.file || fileKey }, mode, docId);
        insertChunk.run(row);
        insertFts.run(row);
        chunkRows += 1;
        ftsRows += 1;

        const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
        insertDocLength.run(mode, docId, tokensArray.length);
        docLengthRows += 1;
        totalDocs += 1;
        totalLen += tokensArray.length;

        if (tokensArray.length) {
          const freq = buildTokenFrequency(tokensArray);
          for (const [token, tf] of freq.entries()) {
            let tokenId = tokenIdMap.get(token);
            if (tokenId === undefined) {
              tokenId = nextTokenId;
              nextTokenId += 1;
              tokenIdMap.set(token, tokenId);
              insertTokenVocab.run(mode, tokenId, token);
              tokenVocabRows += 1;
            }
            insertTokenPosting.run(mode, tokenId, docId, tf);
            tokenPostingRows += 1;
          }
        }

        if (Array.isArray(chunk.ngrams)) {
          const unique = new Set(chunk.ngrams);
          for (const ng of unique) {
            let phraseId = phraseIdMap.get(ng);
            if (phraseId === undefined) {
              phraseId = nextPhraseId;
              nextPhraseId += 1;
              phraseIdMap.set(ng, phraseId);
              insertPhraseVocab.run(mode, phraseId, ng);
              phraseVocabRows += 1;
            }
            insertPhrasePosting.run(mode, phraseId, docId);
            phrasePostingRows += 1;
          }
        }

        if (Array.isArray(chunk.chargrams)) {
          const unique = new Set(chunk.chargrams);
          for (const gram of unique) {
            let gramId = chargramIdMap.get(gram);
            if (gramId === undefined) {
              gramId = nextChargramId;
              nextChargramId += 1;
              chargramIdMap.set(gram, gramId);
              insertChargramVocab.run(mode, gramId, gram);
              chargramVocabRows += 1;
            }
            insertChargramPosting.run(mode, gramId, docId);
            chargramPostingRows += 1;
          }
        }

        if (Array.isArray(chunk.minhashSig) && chunk.minhashSig.length) {
          insertMinhash.run(mode, docId, packUint32(chunk.minhashSig));
          validationStats.minhash += 1;
          minhashRows += 1;
        }

        const hasFloatEmbedding = Array.isArray(chunk.embedding) && chunk.embedding.length;
        const u8Embedding = chunk?.embedding_u8;
        const u8Length = u8Embedding && typeof u8Embedding.length === 'number' ? u8Embedding.length : 0;
        const hasU8Embedding = u8Length > 0;
        if (hasFloatEmbedding || hasU8Embedding) {
          const dims = hasFloatEmbedding ? chunk.embedding.length : u8Length;
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
          const denseVector = hasFloatEmbedding
            ? quantizeVec(
              chunk.embedding,
              quantization.minVal,
              quantization.maxVal,
              quantization.levels
            )
            : u8Embedding;
          insertDense.run(mode, docId, packUint8(denseVector));
          validationStats.dense += 1;
          denseRows += 1;
          if (hasFloatEmbedding) denseFloatChunks += 1;
          if (hasU8Embedding) denseU8Chunks += 1;
          if (normalizedFile) {
            fileEmbeddingCounts.set(normalizedFile, (fileEmbeddingCounts.get(normalizedFile) || 0) + 1);
          }
          if (vectorAnnEnabled) {
            if (!vectorAnn || !vectorAnn.ready) {
              ensureVectorAnn(dims);
            }
            if (vectorAnn?.ready && vectorAnn.insert && encodeVector) {
              const floatVec = hasFloatEmbedding
                ? chunk.embedding
                : dequantizeUint8ToFloat32(
                  u8Embedding,
                  quantization.minVal,
                  quantization.maxVal,
                  quantization.levels
                );
              const encoded = floatVec ? encodeVector(floatVec, vectorExtension) : null;
              if (encoded) {
                const compatible = isVectorEncodingCompatible({
                  encoded,
                  dims,
                  encoding: vectorExtension.encoding
                });
                if (!compatible) {
                  if (!vectorAnnInsertWarned) {
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
      }
      insertBatchMs += performance.now() - batchStart;
    });

    const insertBundle = (bundle, fileKey) => {
      const chunks = Array.isArray(bundle?.chunks) ? bundle.chunks : null;
      if (!chunks) {
        warn(`[sqlite] Bundle missing chunks for ${fileKey}; skipping.`);
        return;
      }
      const normalizedFile = normalizeFilePath(fileKey);
      let chunkCount = 0;
      for (let start = 0; start < chunks.length; start += resolvedBatchSize) {
        const end = Math.min(start + resolvedBatchSize, chunks.length);
        insertBundleBatch(chunks, start, end, fileKey, normalizedFile);
        chunkCount += end - start;
        recordBatch('bundleChunkBatches');
      }

      fileCounts.set(normalizedFile, (fileCounts.get(normalizedFile) || 0) + chunkCount);
    };

    let count = 0;
    let bundleFailure = null;
    const maxInFlightBundles = useBundleWorkers
      ? Math.max(1, Math.min(totalFiles, Math.max(1, bundleThreads), 32))
      : 1;
    const batchSize = maxInFlightBundles;
    try {
      for (let i = 0; i < manifestEntries.length; i += batchSize) {
        const batch = manifestEntries.slice(i, i + batchSize);
        const tasks = batch.map((record) => bundleLoader.loadBundle({
          bundleDir: incrementalData.bundleDir,
          entry: record.entry,
          file: record.file
        }));
        const results = await Promise.all(tasks);
        const failure = results.find((result) => !result.ok);
        if (failure) {
          bundleFailure = `${failure.reason} for ${failure.file}`;
          break;
        }
        for (const result of results) {
          try {
            insertBundle(result.bundle, result.file);
          } catch (err) {
            bundleFailure = err?.message || 'bundle insert failed';
            break;
          }
          const chunkCount = Array.isArray(result.bundle?.chunks) ? result.bundle.chunks.length : 0;
          count += chunkCount;
          processedFiles += 1;
          logBundleProgress(result.file, processedFiles === totalFiles);
        }
        if (bundleFailure) break;
      }
    } finally {
      await bundleLoader.close();
    }

    validationStats.chunks = count;
    const embedStats = {
      totalChunks: validationStats.chunks,
      denseChunks: validationStats.dense,
      denseFloatChunks,
      denseU8Chunks,
      filesTotal: fileEmbeddingCounts.size,
      filesWithEmbeddings: 0,
      filesMissingEmbeddings: 0,
      sampleMissingFiles: []
    };
    for (const [file, embedCount] of fileEmbeddingCounts.entries()) {
      if (embedCount > 0) {
        embedStats.filesWithEmbeddings += 1;
      } else {
        embedStats.filesMissingEmbeddings += 1;
        if (embedStats.sampleMissingFiles.length < 3) embedStats.sampleMissingFiles.push(file);
      }
    }
    if (vectorAnnState.enabled && !vectorAnnState.loaded && !vectorAnnState.reason && embedStats.denseChunks === 0) {
      vectorAnnState.reason = 'no embeddings observed';
    }

    if (bundleFailure) {
      if (emitOutput) {
        warn(`[sqlite] Bundle build failed for ${mode}: ${bundleFailure}.`);
      }
      return { count: 0, denseCount: 0, reason: bundleFailure, embedStats, vectorAnn: vectorAnnState };
    }
    insertTokenStats.run(mode, totalDocs ? totalLen / totalDocs : 0, totalDocs);
    recordTable('token_stats', 1, 0);

    const insertManifestTx = db.transaction(() => {
      for (const [file, chunkCount] of fileCounts.entries()) {
        const normalizedFile = normalizeFilePath(file);
        const entry = manifestLookup.map.get(normalizedFile)?.entry || null;
        insertFileManifest.run(
          mode,
          normalizedFile,
          entry?.hash || null,
          Number.isFinite(entry?.mtimeMs) ? entry.mtimeMs : null,
          Number.isFinite(entry?.size) ? entry.size : null,
          chunkCount
        );
      }
    });
    const manifestStart = performance.now();
    insertManifestTx();
    recordTable('file_manifest', fileCounts.size, performance.now() - manifestStart);

    recordTable('chunks', chunkRows, insertBatchMs);
    recordTable('chunks_fts', ftsRows, insertBatchMs);
    recordTable('doc_lengths', docLengthRows, insertBatchMs);
    recordTable('token_vocab', tokenVocabRows, insertBatchMs);
    recordTable('token_postings', tokenPostingRows, insertBatchMs);
    recordTable('phrase_vocab', phraseVocabRows, insertBatchMs);
    recordTable('phrase_postings', phrasePostingRows, insertBatchMs);
    recordTable('chargram_vocab', chargramVocabRows, insertBatchMs);
    recordTable('chargram_postings', chargramPostingRows, insertBatchMs);
    recordTable('minhash_signatures', minhashRows, insertBatchMs);
    recordTable('dense_vectors', denseRows, insertBatchMs);
    recordTable('dense_meta', denseMetaRows, 0);

    db.exec(CREATE_INDEXES_SQL);
    optimizeBuildDatabase(db, { inputBytes, stats: batchStats });
    const validationStart = performance.now();
    validateSqliteDatabase(db, mode, {
      validateMode,
      expected: validationStats,
      emitOutput,
      logger,
      dbPath: outPath
    });
    if (batchStats) {
      batchStats.validationMs = performance.now() - validationStart;
    }
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {}
    succeeded = true;
    return { count, denseCount: validationStats.dense, embedStats, vectorAnn: vectorAnnState };
  } finally {
    if (succeeded) {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (err) {
        warn(`[sqlite] WAL checkpoint failed for ${mode}: ${err?.message || err}`);
      }
    }
    restoreBuildPragmas(db, pragmaState);
    db.close();
    if (!succeeded) {
      try {
        fsSync.rmSync(outPath, { force: true });
      } catch {}
      await removeSqliteSidecars(outPath);
    }
  }
}

