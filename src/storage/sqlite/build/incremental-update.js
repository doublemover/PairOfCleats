import fsSync from 'node:fs';
import path from 'node:path';
import { readBundleFile } from '../../../shared/bundle-io.js';
import { buildChunkRow, buildTokenFrequency } from '../build-helpers.js';
import { REQUIRED_TABLES, SCHEMA_VERSION } from '../schema.js';
import { hasRequiredTables, normalizeFilePath } from '../utils.js';
import { packUint32, packUint8, quantizeVec, toVectorId } from '../vector.js';
import { deleteDocIds, updateTokenStats } from './delete.js';
import { diffFileManifests, getFileManifest, normalizeManifestFiles } from './manifest.js';
import { createInsertStatements } from './statements.js';
import { getSchemaVersion, validateSqliteDatabase } from './validate.js';
import { ensureVocabIds } from './vocab.js';

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

export async function incrementalUpdateDatabase({
  Database,
  outPath,
  mode,
  incrementalData,
  modelConfig,
  vectorConfig,
  emitOutput,
  validateMode,
  expectedDense
}) {
  if (!incrementalData?.manifest) {
    return { used: false, reason: 'missing incremental manifest' };
  }
  if (!fsSync.existsSync(outPath)) {
    return { used: false, reason: 'sqlite db missing' };
  }

  const expectedModel = expectedDense?.model || modelConfig.id || null;
  const expectedDims = Number.isFinite(expectedDense?.dims) ? expectedDense.dims : null;

  const db = new Database(outPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  } catch {}

  const schemaVersion = getSchemaVersion(db);
  if (schemaVersion !== SCHEMA_VERSION) {
    db.close();
    return {
      used: false,
      reason: `schema mismatch (db=${schemaVersion ?? 'unknown'}, expected=${SCHEMA_VERSION})`
    };
  }

  if (!hasRequiredTables(db, REQUIRED_TABLES)) {
    db.close();
    return { used: false, reason: 'schema missing' };
  }

  const manifestFiles = incrementalData.manifest.files || {};
  const manifestLookup = normalizeManifestFiles(manifestFiles);
  if (!manifestLookup.entries.length) {
    db.close();
    return { used: false, reason: 'incremental manifest empty' };
  }
  if (manifestLookup.conflicts.length) {
    db.close();
    return { used: false, reason: 'manifest path conflicts' };
  }

  const dbFiles = getFileManifest(db, mode);
  if (!dbFiles.size) {
    const chunkRow = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?')
      .get(mode) || {};
    if (Number.isFinite(chunkRow.total) && chunkRow.total > 0) {
      db.close();
      return { used: false, reason: 'file manifest empty' };
    }
  }

  const { changed, deleted } = diffFileManifests(manifestLookup.entries, dbFiles);
  const totalFiles = manifestLookup.entries.length;
  if (totalFiles) {
    const changeRatio = (changed.length + deleted.length) / totalFiles;
    if (changeRatio > MAX_INCREMENTAL_CHANGE_RATIO) {
      db.close();
      return {
        used: false,
        reason: `change ratio ${changeRatio.toFixed(2)} exceeds ${MAX_INCREMENTAL_CHANGE_RATIO}`
      };
    }
  }
  if (!changed.length && !deleted.length) {
    db.close();
    return { used: true, changedFiles: 0, deletedFiles: 0, insertedChunks: 0 };
  }

  const dbDenseMeta = db.prepare(
    'SELECT dims, scale, model FROM dense_meta WHERE mode = ?'
  ).get(mode);
  const dbDims = Number.isFinite(dbDenseMeta?.dims) ? dbDenseMeta.dims : null;
  const dbModel = dbDenseMeta?.model || null;
  if ((expectedModel || expectedDims !== null) && !dbDenseMeta) {
    db.close();
    return { used: false, reason: 'dense metadata missing' };
  }
  if (expectedModel) {
    if (!dbModel) {
      db.close();
      return { used: false, reason: 'dense metadata model missing' };
    }
    if (dbModel !== expectedModel) {
      db.close();
      return { used: false, reason: `model mismatch (db=${dbModel}, expected=${expectedModel})` };
    }
  }
  if (expectedDims !== null) {
    if (dbDims === null) {
      db.close();
      return { used: false, reason: 'dense metadata dims missing' };
    }
    if (dbDims !== expectedDims) {
      db.close();
      return { used: false, reason: `dense dims mismatch (db=${dbDims}, expected=${expectedDims})` };
    }
  }

  const bundles = new Map();
  for (const record of changed) {
    const fileKey = record.file;
    const normalizedFile = record.normalized;
    const entry = record.entry;
    const bundleName = entry?.bundle;
    if (!bundleName) {
      db.close();
      return { used: false, reason: `missing bundle for ${fileKey}` };
    }
    const bundlePath = path.join(incrementalData.bundleDir, bundleName);
    if (!fsSync.existsSync(bundlePath)) {
      db.close();
      return { used: false, reason: `bundle missing for ${fileKey}` };
    }
    const result = await readBundleFile(bundlePath);
    if (!result.ok) {
      db.close();
      return { used: false, reason: `invalid bundle for ${fileKey}` };
    }
    bundles.set(normalizedFile, { bundle: result.bundle, entry, fileKey, normalizedFile });
  }

  const tokenValues = [];
  const phraseValues = [];
  const chargramValues = [];
  const incomingDimsSet = new Set();
  for (const bundleEntry of bundles.values()) {
    const bundle = bundleEntry.bundle;
    for (const chunk of bundle.chunks || []) {
      const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
      if (tokensArray.length) tokenValues.push(...tokensArray);
      if (Array.isArray(chunk.ngrams)) phraseValues.push(...chunk.ngrams);
      if (Array.isArray(chunk.chargrams)) chargramValues.push(...chunk.chargrams);
      if (Array.isArray(chunk.embedding) && chunk.embedding.length) {
        incomingDimsSet.add(chunk.embedding.length);
      }
    }
  }
  if (incomingDimsSet.size > 1) {
    db.close();
    return { used: false, reason: 'embedding dims mismatch across bundles' };
  }
  const incomingDims = incomingDimsSet.size ? [...incomingDimsSet][0] : null;
  if (incomingDims !== null && dbDims !== null && incomingDims !== dbDims) {
    db.close();
    return { used: false, reason: `embedding dims mismatch (db=${dbDims}, incoming=${incomingDims})` };
  }
  if (incomingDims !== null && expectedDims !== null && incomingDims !== expectedDims) {
    db.close();
    return { used: false, reason: `embedding dims mismatch (expected=${expectedDims}, incoming=${incomingDims})` };
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
  const fileRows = db.prepare('SELECT id, file FROM chunks WHERE mode = ? ORDER BY id')
    .all(mode);
  for (const row of fileRows) {
    const normalized = normalizeFilePath(row.file);
    const entry = existingIdsByFile.get(normalized) || { file: normalized, ids: [] };
    entry.ids.push(row.id);
    existingIdsByFile.set(normalized, entry);
  }

  const maxRow = db.prepare('SELECT MAX(id) AS maxId FROM chunks WHERE mode = ?')
    .get(mode);
  let nextDocId = Number.isFinite(maxRow?.maxId) ? maxRow.maxId + 1 : 0;
  const freeDocIds = [];
  let insertedChunks = 0;

  const vectorExtension = vectorConfig?.extension || {};
  const vectorAnnEnabled = vectorConfig?.enabled === true;
  const encodeVector = vectorConfig?.encodeVector;
  let denseMetaSet = false;
  let denseDims = null;
  let denseWarned = false;
  let vectorAnnLoaded = false;
  let vectorAnnReady = false;
  let vectorAnnTable = vectorExtension.table || 'dense_vectors_ann';
  let vectorAnnColumn = vectorExtension.column || 'embedding';
  let insertVectorAnn = null;
  if (vectorAnnEnabled) {
    const loadResult = vectorConfig.loadVectorExtension(db, vectorExtension, `sqlite ${mode}`);
    if (loadResult.ok) {
      vectorAnnLoaded = true;
      if (vectorConfig.hasVectorTable(db, vectorAnnTable)) {
        vectorAnnReady = true;
        insertVectorAnn = db.prepare(
          `INSERT OR REPLACE INTO ${vectorAnnTable} (rowid, ${vectorAnnColumn}) VALUES (?, ?)`
        );
      }
    } else if (emitOutput) {
      console.warn(`[sqlite] Vector extension unavailable for ${mode}: ${loadResult.reason}`);
    }
  }

  const vectorDeleteTargets = vectorAnnLoaded && vectorAnnReady
    ? [{ table: vectorAnnTable, column: 'rowid', withMode: false, transform: toVectorId }]
    : [];

  const applyChanges = db.transaction(() => {
    const tokenVocab = ensureVocabIds(
      db,
      mode,
      'token_vocab',
      'token_id',
      'token',
      tokenValues,
      insertTokenVocab,
      { limits: VOCAB_GROWTH_LIMITS.token_vocab }
    );
    if (tokenVocab.skip) {
      throw new IncrementalSkipError(tokenVocab.reason || 'token vocab growth too large');
    }

    const phraseVocab = ensureVocabIds(
      db,
      mode,
      'phrase_vocab',
      'phrase_id',
      'ngram',
      phraseValues,
      insertPhraseVocab,
      { limits: VOCAB_GROWTH_LIMITS.phrase_vocab }
    );
    if (phraseVocab.skip) {
      throw new IncrementalSkipError(phraseVocab.reason || 'phrase vocab growth too large');
    }

    const chargramVocab = ensureVocabIds(
      db,
      mode,
      'chargram_vocab',
      'gram_id',
      'gram',
      chargramValues,
      insertChargramVocab,
      { limits: VOCAB_GROWTH_LIMITS.chargram_vocab }
    );
    if (chargramVocab.skip) {
      throw new IncrementalSkipError(chargramVocab.reason || 'chargram vocab growth too large');
    }

    const tokenIdMap = tokenVocab.map;
    const phraseIdMap = phraseVocab.map;
    const chargramIdMap = chargramVocab.map;

    for (const file of deleted) {
      const normalizedFile = normalizeFilePath(file);
      const entry = existingIdsByFile.get(normalizedFile);
      const docIds = entry?.ids || [];
      deleteDocIds(db, mode, docIds, vectorDeleteTargets);
      db.prepare('DELETE FROM file_manifest WHERE mode = ? AND file = ?')
        .run(mode, normalizedFile);
    }

    for (const record of changed) {
      const normalizedFile = record.normalized;
      const entry = existingIdsByFile.get(normalizedFile);
      const reuseIds = entry?.ids || [];
      const docIds = reuseIds;
      let reuseIndex = 0;
      deleteDocIds(db, mode, docIds, vectorDeleteTargets);

      const bundleEntry = bundles.get(normalizedFile);
      const bundle = bundleEntry?.bundle;
      let chunkCount = 0;
      for (const chunk of bundle?.chunks || []) {
        let docId;
        if (reuseIndex < reuseIds.length) {
          docId = reuseIds[reuseIndex];
          reuseIndex += 1;
        } else if (freeDocIds.length) {
          docId = freeDocIds.pop();
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

        const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
        insertDocLength.run(mode, docId, tokensArray.length);
        const freq = buildTokenFrequency(tokensArray);
        for (const [token, tf] of freq.entries()) {
          const tokenId = tokenIdMap.get(token);
          if (tokenId === undefined) continue;
          insertTokenPosting.run(mode, tokenId, docId, tf);
        }

        if (Array.isArray(chunk.ngrams)) {
          const unique = new Set(chunk.ngrams);
          for (const ng of unique) {
            const phraseId = phraseIdMap.get(ng);
            if (phraseId === undefined) continue;
            insertPhrasePosting.run(mode, phraseId, docId);
          }
        }

        if (Array.isArray(chunk.chargrams)) {
          const unique = new Set(chunk.chargrams);
          for (const gram of unique) {
            const gramId = chargramIdMap.get(gram);
            if (gramId === undefined) continue;
            insertChargramPosting.run(mode, gramId, docId);
          }
        }

        if (Array.isArray(chunk.minhashSig) && chunk.minhashSig.length) {
          insertMinhash.run(mode, docId, packUint32(chunk.minhashSig));
        }

        if (Array.isArray(chunk.embedding) && chunk.embedding.length) {
          const dims = chunk.embedding.length;
          if (!denseMetaSet) {
            insertDenseMeta.run(mode, dims, 1.0, modelConfig.id || null);
            denseMetaSet = true;
            denseDims = dims;
          } else if (denseDims !== null && dims !== denseDims && !denseWarned) {
            console.warn(`Dense vector dims mismatch for ${mode}: expected ${denseDims}, got ${dims}`);
            denseWarned = true;
          }
          insertDense.run(mode, docId, packUint8(quantizeVec(chunk.embedding)));
          if (vectorAnnLoaded) {
            if (!vectorAnnReady) {
              const created = vectorConfig.ensureVectorTable(db, vectorExtension, dims);
              if (created.ok) {
                vectorAnnReady = true;
                vectorAnnTable = created.tableName;
                vectorAnnColumn = created.column;
                insertVectorAnn = db.prepare(
                  `INSERT OR REPLACE INTO ${vectorAnnTable} (rowid, ${vectorAnnColumn}) VALUES (?, ?)`
                );
              }
            }
            if (vectorAnnReady && insertVectorAnn && encodeVector) {
              const encoded = encodeVector(chunk.embedding, vectorExtension);
              if (encoded) insertVectorAnn.run(toVectorId(docId), encoded);
            }
          }
        }

        chunkCount += 1;
        insertedChunks += 1;
      }
      if (reuseIndex < reuseIds.length) {
        freeDocIds.push(...reuseIds.slice(reuseIndex));
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
    }

    updateTokenStats(db, mode, insertTokenStats);
    validateSqliteDatabase(db, mode, { validateMode, emitOutput });
  });

  try {
    applyChanges();
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      if (emitOutput) {
        console.warn(`[sqlite] WAL checkpoint failed for ${mode}: ${err?.message || err}`);
      }
    }
  } catch (err) {
    db.close();
    if (err instanceof IncrementalSkipError) {
      return { used: false, reason: err.reason };
    }
    throw err;
  }
  db.close();
  return {
    used: true,
    changedFiles: changed.length,
    deletedFiles: deleted.length,
    insertedChunks
  };
}
