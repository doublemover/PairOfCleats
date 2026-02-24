import { performance } from 'node:perf_hooks';
import { buildChunkRow, buildTokenFrequency, prepareVectorAnnInsert } from '../../build-helpers.js';
import { ensureVocabIds } from '../../vocab.js';
import {
  isVectorEncodingCompatible,
  packUint32,
  packUint8,
  quantizeVec,
  resolveEncodedVectorBytes,
  resolveVectorEncodingBytes,
  toSqliteRowId
} from '../../vector.js';
import { deleteDocIds, updateTokenStats } from '../delete.js';
import { validateSqliteDatabase } from '../validate.js';

/**
 * Sentinel error used to convert transactional guard failures into
 * non-throwing incremental skip results.
 */
class IncrementalSkipError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Allocate a deterministic doc id for incremental inserts.
 *
 * Priority: reuse existing ids for the file -> deleted-file free list for new
 * files -> overflow free list -> remaining deleted free list -> append new id.
 *
 * @param {object} input
 * @param {number[]} input.reuseIds
 * @param {number} input.reuseIndex
 * @param {boolean} input.isNewFile
 * @param {number[]} input.freeDocIdsDeleted
 * @param {number[]} input.freeDocIdsOverflow
 * @param {number} input.nextDocId
 * @returns {{docId:number,reuseIndex:number,nextDocId:number}}
 */
const allocateIncrementalDocId = ({
  reuseIds,
  reuseIndex,
  isNewFile,
  freeDocIdsDeleted,
  freeDocIdsOverflow,
  nextDocId
}) => {
  if (reuseIndex < reuseIds.length) {
    return {
      docId: reuseIds[reuseIndex],
      reuseIndex: reuseIndex + 1,
      nextDocId
    };
  }
  if (isNewFile && freeDocIdsDeleted.length) {
    return { docId: freeDocIdsDeleted.pop(), reuseIndex, nextDocId };
  }
  if (freeDocIdsOverflow.length) {
    return { docId: freeDocIdsOverflow.pop(), reuseIndex, nextDocId };
  }
  if (freeDocIdsDeleted.length) {
    return { docId: freeDocIdsDeleted.pop(), reuseIndex, nextDocId };
  }
  return {
    docId: nextDocId,
    reuseIndex,
    nextDocId: nextDocId + 1
  };
};

/**
 * Apply incremental delete/insert transactions for sqlite index updates.
 *
 * Transaction invariants:
 * - Deletes and inserts execute inside a single transaction.
 * - Inserts validate vocab growth limits before writing postings.
 * - Post-insert validation runs inside the insert transaction to ensure the
 *   committed state is internally consistent.
 * - Returning `{ ok: false }` means no partial writes escaped both phases.
 *
 * @param {object} input
 * @returns {{ok:true,insertedChunks:number,applyDurationMs:number,validationMs:number,transactionPhases:{deletes:boolean,inserts:boolean},tableRows:Record<string,number>}|{ok:false,skipReason:string,mutated:false}}
 */
export const runIncrementalUpdatePhase = ({
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
  resolveExistingDocIds,
  orderedChanged,
  startDocId,
  recordDenseClamp,
  vocabGrowthLimits
}) => {
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

  const tableRows = {
    chunks: 0,
    chunks_fts: 0,
    doc_lengths: 0,
    token_vocab: 0,
    token_postings: 0,
    phrase_vocab: 0,
    phrase_postings: 0,
    chargram_vocab: 0,
    chargram_postings: 0,
    minhash_signatures: 0,
    dense_vectors: 0,
    dense_meta: 0,
    file_manifest: 0,
    token_stats: 0
  };
  let validationMs = 0;
  let transactionApplied = false;
  let insertedChunks = 0;
  let nextDocId = Number.isFinite(startDocId) ? startDocId : 0;
  // Prefer ids freed by explicit file deletes before overflow ids from changed
  // files so replacements are stable across incremental runs.
  const freeDocIdsDeleted = [];
  const freeDocIdsOverflow = [];

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

  const deleteFileManifest = db.prepare('DELETE FROM file_manifest WHERE mode = ? AND file = ?');
  const phraseUniqueScratch = new Set();
  const chargramUniqueScratch = new Set();

  /**
   * Delete stale rows and apply manifest-only updates before inserts.
   * Any ids released here become available to deterministic doc-id allocation.
   */
  const applyDeletes = () => {
    for (const file of deleted) {
      const normalizedFile = file;
      if (!normalizedFile) continue;
      const docIds = resolveExistingDocIds(normalizedFile);
      deleteDocIds(db, mode, docIds, vectorDeleteTargets);
      if (docIds.length) {
        freeDocIdsDeleted.push(...docIds);
      }
      deleteFileManifest.run(mode, normalizedFile);
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
  };

  /**
   * Insert all changed bundles and dependent vocab/postings rows.
   * Throws IncrementalSkipError when growth guards require full rebuild.
   */
  const applyInserts = () => {
    const tokenVocab = ensureVocabIds(
      db,
      mode,
      'token_vocab',
      'token_id',
      'token',
      tokenValues,
      insertTokenVocab,
      { limits: vocabGrowthLimits.token_vocab }
    );
    if (tokenVocab.skip) {
      throw new IncrementalSkipError(tokenVocab.reason || 'token vocab growth too large');
    }
    tableRows.token_vocab += tokenVocab.inserted || 0;

    const phraseVocab = ensureVocabIds(
      db,
      mode,
      'phrase_vocab',
      'phrase_id',
      'ngram',
      phraseValues,
      insertPhraseVocab,
      { limits: vocabGrowthLimits.phrase_vocab }
    );
    if (phraseVocab.skip) {
      throw new IncrementalSkipError(phraseVocab.reason || 'phrase vocab growth too large');
    }
    tableRows.phrase_vocab += phraseVocab.inserted || 0;

    const chargramVocab = ensureVocabIds(
      db,
      mode,
      'chargram_vocab',
      'gram_id',
      'gram',
      chargramValues,
      insertChargramVocab,
      { limits: vocabGrowthLimits.chargram_vocab }
    );
    if (chargramVocab.skip) {
      throw new IncrementalSkipError(chargramVocab.reason || 'chargram vocab growth too large');
    }
    tableRows.chargram_vocab += chargramVocab.inserted || 0;

    const tokenIdMap = tokenVocab.map;
    const phraseIdMap = phraseVocab.map;
    const chargramIdMap = chargramVocab.map;

    for (const record of orderedChanged) {
      const normalizedFile = record.normalized;
      const reuseIds = resolveExistingDocIds(normalizedFile);
      let reuseIndex = 0;

      const bundleEntry = bundles.get(normalizedFile);
      const bundle = bundleEntry?.bundle;
      let chunkCount = 0;
      const isNewFile = reuseIds.length === 0;
      for (const chunk of bundle?.chunks || []) {
        const allocation = allocateIncrementalDocId({
          reuseIds,
          reuseIndex,
          isNewFile,
          freeDocIdsDeleted,
          freeDocIdsOverflow,
          nextDocId
        });
        const docId = allocation.docId;
        reuseIndex = allocation.reuseIndex;
        nextDocId = allocation.nextDocId;
        const row = buildChunkRow(
          { ...chunk, file: chunk.file || normalizedFile },
          mode,
          docId
        );
        insertChunk.run(row);
        insertFts.run(row);
        tableRows.chunks += 1;
        tableRows.chunks_fts += 1;

        const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
        insertDocLength.run(mode, docId, tokensArray.length);
        tableRows.doc_lengths += 1;
        const freq = buildTokenFrequency(tokensArray);
        for (const [token, tf] of freq.entries()) {
          const tokenId = tokenIdMap.get(token);
          if (tokenId === undefined) continue;
          insertTokenPosting.run(mode, tokenId, docId, tf);
          tableRows.token_postings += 1;
        }

        if (Array.isArray(chunk.ngrams) && chunk.ngrams.length) {
          phraseUniqueScratch.clear();
          for (const ng of chunk.ngrams) {
            if (phraseUniqueScratch.has(ng)) continue;
            phraseUniqueScratch.add(ng);
            const phraseId = phraseIdMap.get(ng);
            if (phraseId === undefined) continue;
            insertPhrasePosting.run(mode, phraseId, docId);
            tableRows.phrase_postings += 1;
          }
        }

        if (Array.isArray(chunk.chargrams) && chunk.chargrams.length) {
          chargramUniqueScratch.clear();
          for (const gram of chunk.chargrams) {
            if (chargramUniqueScratch.has(gram)) continue;
            chargramUniqueScratch.add(gram);
            const gramId = chargramIdMap.get(gram);
            if (gramId === undefined) continue;
            insertChargramPosting.run(mode, gramId, docId);
            tableRows.chargram_postings += 1;
          }
        }

        if (Array.isArray(chunk.minhashSig) && chunk.minhashSig.length) {
          insertMinhash.run(mode, docId, packUint32(chunk.minhashSig));
          tableRows.minhash_signatures += 1;
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
            tableRows.dense_meta += 1;
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
          tableRows.dense_vectors += 1;
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
      tableRows.file_manifest += 1;
    }

    updateTokenStats(db, mode, insertTokenStats);
    tableRows.token_stats += 1;
    const validationStart = performance.now();
    validateSqliteDatabase(db, mode, { validateMode, emitOutput, logger, dbPath: outPath });
    validationMs = performance.now() - validationStart;
  };

  /**
   * Apply incremental delete+insert phases atomically.
   *
   * This intentionally wraps both phases in one transaction so any skip/error
   * rolls back *all* sqlite mutations, preserving the pre-incremental DB.
   */
  const applyAtomicUpdate = db.transaction(() => {
    applyDeletes();
    applyInserts();
  });

  try {
    const applyStart = performance.now();
    applyAtomicUpdate();
    transactionApplied = true;
    const applyDurationMs = performance.now() - applyStart;
    return {
      ok: true,
      insertedChunks,
      applyDurationMs,
      validationMs,
      transactionPhases: {
        deletes: transactionApplied,
        inserts: transactionApplied
      },
      tableRows
    };
  } catch (err) {
    if (err instanceof IncrementalSkipError) {
      return { ok: false, skipReason: err.reason, mutated: false };
    }
    throw err;
  }
};
