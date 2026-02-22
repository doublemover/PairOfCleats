import { performance } from 'node:perf_hooks';
import { buildChunkRow, buildTokenFrequency, prepareVectorAnnInsert } from '../build-helpers.js';
import { CREATE_INDEXES_SQL } from '../schema.js';
import {
  normalizeFilePath
} from '../utils.js';
import {
  createUint8ClampStats,
  dequantizeUint8ToFloat32,
  isVectorEncodingCompatible,
  packUint32,
  packUint8,
  quantizeVec,
  resolveEncodedVectorBytes,
  resolveVectorEncodingBytes,
  toSqliteRowId
} from '../vector.js';
import { resolveQuantizationParams } from '../quantization.js';
import { normalizeManifestFiles } from './manifest.js';
import {
  beginSqliteBuildTransaction,
  closeSqliteBuildDatabase,
  commitSqliteBuildTransaction,
  createBuildExecutionContext,
  createSqliteBuildInsertContext,
  openSqliteBuildDatabase,
  rollbackSqliteBuildTransaction,
  runSqliteBuildPostCommit
} from './core.js';
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
 * @param {'prepared'|'multi-row'|'prepare-per-shard'} [params.statementStrategy]
 * @param {boolean} [params.buildPragmas]
 * @param {boolean} [params.optimize]
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
  statementStrategy,
  buildPragmas,
  optimize,
  stats
}) {
  const log = (message, meta = null) => {
    if (!emitOutput || !message) return;
    if (logger?.log) {
      logger.log(message, meta);
      return;
    }
    console.error(message);
  };
  const warn = (message, meta = null) => {
    if (!emitOutput || !message) return;
    if (logger?.warn) {
      logger.warn(message, meta);
      return;
    }
    if (logger?.log) {
      logger.log(message, meta);
      return;
    }
    console.warn(message);
  };
  if (!incrementalData?.manifest) {
    return { count: 0, denseCount: 0, reason: 'missing incremental manifest' };
  }
  const {
    resolvedBatchSize,
    batchStats,
    resolvedStatementStrategy,
    recordBatch,
    recordTable
  } = createBuildExecutionContext({ batchSize, inputBytes, statementStrategy, stats });
  const manifestFiles = incrementalData.manifest.files || {};
  const manifestLookup = normalizeManifestFiles(manifestFiles);
  // Preserve manifest insertion order so fallback doc-id assignment for bundles
  // without explicit chunk ids matches chunk_meta row ordering.
  const manifestEntries = [...manifestLookup.entries];
  if (!manifestEntries.length) {
    return { count: 0, denseCount: 0, reason: 'incremental manifest empty' };
  }
  if (emitOutput && manifestLookup.conflicts.length) {
    warn(`[sqlite] Manifest path conflicts for ${mode}; using normalized entries.`);
  }
  const totalFiles = manifestEntries.length;
  let processedFiles = 0;
  let lastProgressLog = 0;
  let lastLoggedPercentBucket = -1;
  const progressIntervalMs = 1000;
  const progressPercentStep = 5;
  const envBundleThreads = Number(envConfig.bundleThreads);
  const bundleThreads = Number.isFinite(envBundleThreads) && envBundleThreads > 0
    ? Math.floor(envBundleThreads)
    : Math.max(1, Math.floor(threadLimits.fileConcurrency));
  const bundleLoader = createBundleLoader({ bundleThreads, workerPath });
  const useBundleWorkers = bundleLoader.useWorkers;
  const logBundleProgress = (file, force = false) => {
    if (!emitOutput) return;
    const ratio = totalFiles > 0 ? (processedFiles / totalFiles) : 1;
    const percentValue = Math.max(0, Math.min(100, ratio * 100));
    const percentBucket = Math.floor(percentValue / progressPercentStep);
    const now = Date.now();
    if (!force) {
      if (now - lastProgressLog < progressIntervalMs) return;
      if (percentBucket <= lastLoggedPercentBucket) return;
    }
    lastProgressLog = now;
    lastLoggedPercentBucket = Math.max(lastLoggedPercentBucket, percentBucket);
    const percent = percentValue.toFixed(1);
    const summaryLine = `[sqlite] bundles ${processedFiles}/${totalFiles} (${percent}%)`;
    const fileOnlyLine = file ? `${summaryLine} | ${file}` : summaryLine;
    log(summaryLine, { fileOnlyLine });
  };
  if (emitOutput) {
    log(`[sqlite] Using incremental bundles for ${mode} (${totalFiles} files).`);
    if (useBundleWorkers) {
      log(`[sqlite] Bundle parser workers: ${bundleThreads}.`);
    }
  }

  const useBuildPragmas = buildPragmas !== false;
  const useOptimize = optimize !== false;
  const { db, pragmaState, dbPath, promotePath } = openSqliteBuildDatabase({
    Database,
    outPath,
    batchStats,
    inputBytes,
    useBuildPragmas
  });
  let succeeded = false;
  try {
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
      insertFileManifest,
      insertTokenVocabMany,
      insertTokenPostingMany,
      insertDocLengthMany,
      insertPhraseVocabMany,
      insertPhrasePostingMany,
      insertChargramVocabMany,
      insertChargramPostingMany
    } = createSqliteBuildInsertContext(db, { batchStats, resolvedStatementStrategy });

    beginSqliteBuildTransaction(db, batchStats);

    const tokenIdMap = new Map();
    const phraseIdMap = new Map();
    const chargramIdMap = new Map();
    let nextTokenId = 0;
    let nextPhraseId = 0;
    let nextChargramId = 0;
    let nextDocId = 0;
    const assignedDocIds = new Set();
    let docIdWarnings = 0;
    const maxDocIdWarnings = 5;
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
    const denseClampStats = createUint8ClampStats();
    const recordDenseClamp = (clamped) => denseClampStats.record(clamped);
    const emitDenseClampSummary = () => {
      if (denseClampStats.totalValues <= 0) return;
      warn(
        `[sqlite] Uint8 vector values clamped while building ${mode}: ` +
        `${denseClampStats.totalValues} value(s) across ${denseClampStats.totalVectors} vector(s).`
      );
    };
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

    const tokenVocabBuffer = [];
    const tokenPostingBuffer = [];
    const docLengthBuffer = [];
    const phraseVocabBuffer = [];
    const phrasePostingBuffer = [];
    const chargramVocabBuffer = [];
    const chargramPostingBuffer = [];

    const flushBuffer = (buffer, inserter, fallbackStmt) => {
      if (!buffer.length) return;
      if (inserter) {
        inserter(buffer);
      } else if (fallbackStmt) {
        for (const row of buffer) {
          fallbackStmt.run(...row);
        }
      }
      buffer.length = 0;
    };

    const flushAllBuffers = () => {
      flushBuffer(tokenVocabBuffer, insertTokenVocabMany, insertTokenVocab);
      flushBuffer(tokenPostingBuffer, insertTokenPostingMany, insertTokenPosting);
      flushBuffer(docLengthBuffer, insertDocLengthMany, insertDocLength);
      flushBuffer(phraseVocabBuffer, insertPhraseVocabMany, insertPhraseVocab);
      flushBuffer(phrasePostingBuffer, insertPhrasePostingMany, insertPhrasePosting);
      flushBuffer(chargramVocabBuffer, insertChargramVocabMany, insertChargramVocab);
      flushBuffer(chargramPostingBuffer, insertChargramPostingMany, insertChargramPosting);
    };
    const reserveFallbackDocId = () => {
      while (assignedDocIds.has(nextDocId)) nextDocId += 1;
      const docId = nextDocId;
      assignedDocIds.add(docId);
      nextDocId += 1;
      return docId;
    };
    const resolveChunkDocId = (chunk, fileKey) => {
      const rawDocId = chunk?.id;
      const explicitDocId = Number(rawDocId);
      const hasExplicitDocId = Number.isFinite(explicitDocId)
        && Number.isInteger(explicitDocId)
        && explicitDocId >= 0;
      if (hasExplicitDocId) {
        if (!assignedDocIds.has(explicitDocId)) {
          assignedDocIds.add(explicitDocId);
          return explicitDocId;
        }
        if (docIdWarnings < maxDocIdWarnings) {
          warn(`[sqlite] Duplicate bundle chunk id ${explicitDocId} for ${fileKey}; assigning fallback doc id.`);
          docIdWarnings += 1;
        }
        return reserveFallbackDocId();
      }
      if (rawDocId != null && docIdWarnings < maxDocIdWarnings) {
        warn(`[sqlite] Invalid bundle chunk id for ${fileKey}; assigning fallback doc id.`);
        docIdWarnings += 1;
      }
      return reserveFallbackDocId();
    };
    const insertBundleBatch = db.transaction((chunks, start, end, fileKey, normalizedFile) => {
      const batchStart = performance.now();
      for (let idx = start; idx < end; idx += 1) {
        const chunk = chunks[idx];
        if (!chunk) continue;
        const docId = resolveChunkDocId(chunk, fileKey);

        const row = buildChunkRow({ ...chunk, file: chunk.file || fileKey }, mode, docId);
        insertChunk.run(row);
        insertFts.run(row);
        chunkRows += 1;
        ftsRows += 1;

        const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
        if (insertDocLengthMany) {
          docLengthBuffer.push([mode, docId, tokensArray.length]);
          if (docLengthBuffer.length >= insertDocLengthMany.maxRows) {
            flushBuffer(docLengthBuffer, insertDocLengthMany, insertDocLength);
          }
        } else {
          insertDocLength.run(mode, docId, tokensArray.length);
        }
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
              if (insertTokenVocabMany) {
                tokenVocabBuffer.push([mode, tokenId, token]);
                if (tokenVocabBuffer.length >= insertTokenVocabMany.maxRows) {
                  flushBuffer(tokenVocabBuffer, insertTokenVocabMany, insertTokenVocab);
                }
              } else {
                insertTokenVocab.run(mode, tokenId, token);
              }
              tokenVocabRows += 1;
            }
            if (insertTokenPostingMany) {
              tokenPostingBuffer.push([mode, tokenId, docId, tf]);
              if (tokenPostingBuffer.length >= insertTokenPostingMany.maxRows) {
                flushBuffer(tokenPostingBuffer, insertTokenPostingMany, insertTokenPosting);
              }
            } else {
              insertTokenPosting.run(mode, tokenId, docId, tf);
            }
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
              if (insertPhraseVocabMany) {
                phraseVocabBuffer.push([mode, phraseId, ng]);
                if (phraseVocabBuffer.length >= insertPhraseVocabMany.maxRows) {
                  flushBuffer(phraseVocabBuffer, insertPhraseVocabMany, insertPhraseVocab);
                }
              } else {
                insertPhraseVocab.run(mode, phraseId, ng);
              }
              phraseVocabRows += 1;
            }
            if (insertPhrasePostingMany) {
              phrasePostingBuffer.push([mode, phraseId, docId]);
              if (phrasePostingBuffer.length >= insertPhrasePostingMany.maxRows) {
                flushBuffer(phrasePostingBuffer, insertPhrasePostingMany, insertPhrasePosting);
              }
            } else {
              insertPhrasePosting.run(mode, phraseId, docId);
            }
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
              if (insertChargramVocabMany) {
                chargramVocabBuffer.push([mode, gramId, gram]);
                if (chargramVocabBuffer.length >= insertChargramVocabMany.maxRows) {
                  flushBuffer(chargramVocabBuffer, insertChargramVocabMany, insertChargramVocab);
                }
              } else {
                insertChargramVocab.run(mode, gramId, gram);
              }
              chargramVocabRows += 1;
            }
            if (insertChargramPostingMany) {
              chargramPostingBuffer.push([mode, gramId, docId]);
              if (chargramPostingBuffer.length >= insertChargramPostingMany.maxRows) {
                flushBuffer(chargramPostingBuffer, insertChargramPostingMany, insertChargramPosting);
              }
            } else {
              insertChargramPosting.run(mode, gramId, docId);
            }
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
          insertDense.run(mode, docId, packUint8(denseVector, { onClamp: recordDenseClamp }));
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
      flushAllBuffers();
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
      rollbackSqliteBuildTransaction(db, batchStats);
      emitDenseClampSummary();
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
    commitSqliteBuildTransaction(db, batchStats);
    runSqliteBuildPostCommit({
      db,
      mode,
      validateMode,
      expected: validationStats,
      emitOutput,
      logger,
      dbPath,
      vectorAnnTable: vectorAnnState?.table || vectorExtension.table || 'dense_vectors_ann',
      useOptimize,
      inputBytes,
      batchStats
    });
    succeeded = true;
    emitDenseClampSummary();
    return { count, denseCount: validationStats.dense, embedStats, vectorAnn: vectorAnnState };
  } finally {
    rollbackSqliteBuildTransaction(db, batchStats);
    await closeSqliteBuildDatabase({
      db,
      succeeded,
      pragmaState,
      dbPath,
      promotePath,
      outPath,
      warn: (err) => warn(`[sqlite] WAL checkpoint failed for ${mode}: ${err?.message || err}`)
    });
  }
}

