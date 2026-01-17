import fsSync from 'node:fs';
import path from 'node:path';
import { buildChunkRow, buildTokenFrequency } from '../build-helpers.js';
import { CREATE_INDEXES_SQL, CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../schema.js';
import { normalizeFilePath, removeSqliteSidecars } from '../utils.js';
import { dequantizeUint8ToFloat32, packUint32, packUint8, quantizeVec, toVectorId } from '../vector.js';
import { applyBuildPragmas, restoreBuildPragmas } from './pragmas.js';
import { normalizeManifestFiles } from './manifest.js';
import { validateSqliteDatabase } from './validate.js';
import { createInsertStatements } from './statements.js';
import { createBundleLoader } from './bundle-loader.js';

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
  workerPath
}) {
  if (!incrementalData?.manifest) {
    return { count: 0, denseCount: 0, reason: 'missing incremental manifest' };
  }
  const manifestFiles = incrementalData.manifest.files || {};
  const manifestLookup = normalizeManifestFiles(manifestFiles);
  const manifestEntries = manifestLookup.entries;
  if (!manifestEntries.length) {
    return { count: 0, denseCount: 0, reason: 'incremental manifest empty' };
  }
  if (emitOutput && manifestLookup.conflicts.length) {
    console.warn(`[sqlite] Manifest path conflicts for ${mode}; using normalized entries.`);
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
    console.log(`[sqlite] bundles ${processedFiles}/${totalFiles} (${percent}%)${suffix}`);
  };
  if (emitOutput) {
    console.log(`[sqlite] Using incremental bundles for ${mode} (${totalFiles} files).`);
    if (useBundleWorkers) {
      console.log(`[sqlite] Bundle parser workers: ${bundleThreads}.`);
    }
  }

  const db = new Database(outPath);
  applyBuildPragmas(db);
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
    for (const record of manifestEntries) {
      fileCounts.set(record.normalized, 0);
    }

    const vectorExtension = vectorConfig?.extension || {};
    const vectorAnnEnabled = vectorConfig?.enabled === true;
    const encodeVector = vectorConfig?.encodeVector;
    let denseMetaSet = false;
    let denseDims = null;
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
      } else {
        console.warn(`[sqlite] Vector extension unavailable for ${mode}: ${loadResult.reason}`);
      }
    }

    const insertBundle = db.transaction((bundle, fileKey) => {
      const normalizedFile = normalizeFilePath(fileKey);
      let chunkCount = 0;
      for (const chunk of bundle.chunks || []) {
        const docId = nextDocId;
        nextDocId += 1;

        const row = buildChunkRow({ ...chunk, file: chunk.file || fileKey }, mode, docId);
        insertChunk.run(row);
        insertFts.run(row);

        const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
        insertDocLength.run(mode, docId, tokensArray.length);
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
            }
            insertTokenPosting.run(mode, tokenId, docId, tf);
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
            }
            insertPhrasePosting.run(mode, phraseId, docId);
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
            }
            insertChargramPosting.run(mode, gramId, docId);
          }
        }

        if (Array.isArray(chunk.minhashSig) && chunk.minhashSig.length) {
          insertMinhash.run(mode, docId, packUint32(chunk.minhashSig));
          validationStats.minhash += 1;
        }

        const hasFloatEmbedding = Array.isArray(chunk.embedding) && chunk.embedding.length;
        const u8Embedding = chunk?.embedding_u8;
        const u8Length = u8Embedding && typeof u8Embedding.length === 'number' ? u8Embedding.length : 0;
        const hasU8Embedding = u8Length > 0;
        if (hasFloatEmbedding || hasU8Embedding) {
          const dims = hasFloatEmbedding ? chunk.embedding.length : u8Length;
          if (!denseMetaSet) {
            insertDenseMeta.run(mode, dims, 1.0, modelConfig.id || null);
            denseMetaSet = true;
            denseDims = dims;
          } else if (denseDims !== null && dims !== denseDims) {
            throw new Error(`Dense vector dims mismatch for ${mode}: expected ${denseDims}, got ${dims}`);
          }
          const denseVector = hasFloatEmbedding ? quantizeVec(chunk.embedding) : u8Embedding;
          insertDense.run(mode, docId, packUint8(denseVector));
          validationStats.dense += 1;
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
              const floatVec = hasFloatEmbedding
                ? chunk.embedding
                : dequantizeUint8ToFloat32(u8Embedding);
              const encoded = floatVec ? encodeVector(floatVec, vectorExtension) : null;
              if (encoded) insertVectorAnn.run(toVectorId(docId), encoded);
            }
          }
        }

        chunkCount += 1;
      }

      fileCounts.set(normalizedFile, (fileCounts.get(normalizedFile) || 0) + chunkCount);
    });

    let count = 0;
    let bundleFailure = null;
    const batchSize = useBundleWorkers
      ? Math.max(1, Math.min(totalFiles, Math.max(1, bundleThreads * 2)))
      : 1;
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
          count += result.bundle.chunks.length;
          processedFiles += 1;
          logBundleProgress(result.file, processedFiles === totalFiles);
        }
        if (bundleFailure) break;
      }
    } finally {
      await bundleLoader.close();
    }

    if (bundleFailure) {
      if (emitOutput) {
        console.warn(`[sqlite] Bundle build failed for ${mode}: ${bundleFailure}.`);
      }
      return { count: 0, denseCount: 0, reason: bundleFailure };
    }

    validationStats.chunks = count;
    insertTokenStats.run(mode, totalDocs ? totalLen / totalDocs : 0, totalDocs);

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
    insertManifestTx();

    db.exec(CREATE_INDEXES_SQL);
    validateSqliteDatabase(db, mode, {
      validateMode,
      expected: validationStats,
      emitOutput
    });
    succeeded = true;
    return { count, denseCount: validationStats.dense };
  } finally {
    restoreBuildPragmas(db);
    db.close();
    if (!succeeded) {
      try {
        fsSync.rmSync(outPath, { force: true });
      } catch {}
      await removeSqliteSidecars(outPath);
    }
  }
}
