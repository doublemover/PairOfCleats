import fsSync from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import {
  buildChunkRow,
  buildTokenFrequency,
  prepareVectorAnnTable
} from '../build-helpers.js';
import { resolveChunkId } from '../../../index/chunk-id.js';
import { CREATE_INDEXES_SQL, CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../schema.js';
import {
  normalizeFilePath,
  readJson,
  loadOptional,
  removeSqliteSidecars,
  resolveSqliteBatchSize,
  bumpSqliteBatchStat
} from '../utils.js';
import {
  packUint32,
  packUint8,
  dequantizeUint8ToFloat32,
  isVectorEncodingCompatible,
  resolveQuantizationParams,
  resolveEncodedVectorBytes,
  resolveVectorEncodingBytes,
  toSqliteRowId
} from '../vector.js';
import { applyBuildPragmas, optimizeBuildDatabase, restoreBuildPragmas } from './pragmas.js';
import { normalizeManifestFiles } from './manifest.js';
import { validateSqliteDatabase } from './validate.js';
import { createInsertStatements } from './statements.js';
import {
  MAX_JSON_BYTES,
  readJsonLinesEach,
  resolveJsonlRequiredKeys
} from '../../../shared/artifact-io.js';

const listShardFiles = (dir, prefix, extensions) => {
  if (!dir || typeof dir !== 'string' || !fsSync.existsSync(dir)) return [];
  const allowed = Array.isArray(extensions) && extensions.length
    ? extensions
    : ['.json', '.jsonl'];
  return fsSync
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && allowed.some((ext) => name.endsWith(ext)))
    .sort()
    .map((name) => path.join(dir, name));
};

const normalizeMetaParts = (parts) => (
  Array.isArray(parts)
    ? parts
      .map((part) => {
        if (typeof part === 'string') return part;
        return typeof part?.path === 'string' ? part.path : null;
      })
      .filter(Boolean)
    : []
);

const resolveChunkMetaSources = (dir) => {
  if (!dir || typeof dir !== 'string') {
    dir = typeof dir?.dir === 'string' ? dir.dir : null;
  }
  if (!dir) return null;
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const partsDir = path.join(dir, 'chunk_meta.parts');
  if (fsSync.existsSync(metaPath) || fsSync.existsSync(partsDir)) {
    let parts = [];
    if (fsSync.existsSync(metaPath)) {
      try {
        const metaRaw = readJson(metaPath);
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        const entries = normalizeMetaParts(meta?.parts);
        if (entries.length) {
          parts = entries.map((name) => path.join(dir, name));
        }
      } catch {}
    }
    if (!parts.length) {
      parts = listShardFiles(partsDir, 'chunk_meta.part-', ['.jsonl', '.jsonl.gz', '.jsonl.zst']);
    }
    return parts.length ? { format: 'jsonl', paths: parts } : null;
  }
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const jsonlCandidates = [jsonlPath, `${jsonlPath}.gz`, `${jsonlPath}.zst`];
  const jsonlResolved = jsonlCandidates.find((candidate) => fsSync.existsSync(candidate));
  if (jsonlResolved) {
    return { format: 'jsonl', paths: [jsonlResolved] };
  }
  const jsonPath = path.join(dir, 'chunk_meta.json');
  if (fsSync.existsSync(jsonPath)) {
    return { format: 'json', paths: [jsonPath] };
  }
  return null;
};

const resolveTokenPostingsSources = (dir) => {
  if (!dir || typeof dir !== 'string') {
    dir = typeof dir?.dir === 'string' ? dir.dir : null;
  }
  if (!dir) return null;
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const shardsDir = path.join(dir, 'token_postings.shards');
  if (!fsSync.existsSync(metaPath) && !fsSync.existsSync(shardsDir)) return null;
  let parts = [];
  if (fsSync.existsSync(metaPath)) {
    try {
      const metaRaw = readJson(metaPath);
      const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
      const entries = normalizeMetaParts(meta?.parts);
      if (entries.length) {
        parts = entries.map((name) => path.join(dir, name));
      }
    } catch {}
  }
  if (!parts.length) {
    parts = listShardFiles(shardsDir, 'token_postings.part-', ['.json', '.json.gz', '.json.zst']);
  }
  return parts.length ? { metaPath, parts } : null;
};

const CHUNK_META_REQUIRED_KEYS = resolveJsonlRequiredKeys('chunk_meta');

const readJsonLinesFile = async (
  filePath,
  onEntry,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => readJsonLinesEach(filePath, onEntry, { maxBytes, requiredKeys });

export const loadIndexPieces = (dirOrOptions, modelId) => {
  if (dirOrOptions && typeof dirOrOptions === 'object' && !Array.isArray(dirOrOptions)) {
    const { indexDir, modes, modelId: modelIdOverride } = dirOrOptions;
    const baseDir = typeof indexDir === 'string' ? indexDir : null;
    const modeList = Array.isArray(modes) ? modes.filter((mode) => typeof mode === 'string') : [];
    const resolvedModelId = modelIdOverride ?? modelId;
    if (baseDir && modeList.length) {
      const piecesByMode = {};
      for (const mode of modeList) {
        const suffix = `${path.sep}index-${mode}`;
        const modeDir = baseDir.endsWith(suffix) ? baseDir : path.join(baseDir, `index-${mode}`);
        const pieces = loadIndexPieces(modeDir, resolvedModelId);
        if (pieces) piecesByMode[mode] = pieces;
      }
      return piecesByMode;
    }
    dirOrOptions = baseDir;
    modelId = resolvedModelId;
  }
  const dir = dirOrOptions;
  if (!dir || typeof dir !== 'string') return null;
  const sources = resolveChunkMetaSources(dir);
  if (!sources) return null;
  const denseVec = loadOptional(dir, 'dense_vectors_uint8.json');
  if (denseVec && !denseVec.model) denseVec.model = modelId || null;
  return {
    chunkMeta: null,
    dir,
    fileMeta: loadOptional(dir, 'file_meta.json'),
    denseVec,
    phraseNgrams: loadOptional(dir, 'phrase_ngrams.json'),
    chargrams: loadOptional(dir, 'chargram_postings.json'),
    minhash: loadOptional(dir, 'minhash_signatures.json'),
    tokenPostings: null
  };
};

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
  if (!index && !indexDir) return 0;
  const manifestLookup = normalizeManifestFiles(manifestFiles || {});
  if (emitOutput && manifestLookup.conflicts.length) {
    warn(`[sqlite] Manifest path conflicts for ${mode}; using normalized entries.`);
  }
  const manifestByNormalized = manifestLookup.map;
  const validationStats = { chunks: 0, dense: 0, minhash: 0 };
  const vectorExtension = vectorConfig?.extension || {};
  const encodeVector = vectorConfig?.encodeVector;
  const quantization = resolveQuantizationParams(vectorConfig?.quantization);
  let vectorAnnInsertWarned = false;

  const db = new Database(resolvedOutPath);
  const useBuildPragmas = buildPragmas !== false;
  const useOptimize = optimize !== false;
  const pragmaState = useBuildPragmas ? applyBuildPragmas(db, { inputBytes, stats: batchStats }) : null;

  let count = 0;
  let succeeded = false;
  try {
    db.exec(CREATE_TABLES_BASE_SQL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    const vectorAnn = prepareVectorAnnTable({ db, indexData: index, mode, vectorConfig });

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

    function ingestTokenIndex(tokenIndex, targetMode) {
      if (!tokenIndex?.vocab || !tokenIndex?.postings) return;
      const vocab = tokenIndex.vocab;
      const postings = tokenIndex.postings;
      const docLengths = Array.isArray(tokenIndex.docLengths) ? tokenIndex.docLengths : [];
      const avgDocLen = typeof tokenIndex.avgDocLen === 'number' ? tokenIndex.avgDocLen : null;
      const totalDocs = typeof tokenIndex.totalDocs === 'number' ? tokenIndex.totalDocs : docLengths.length;

      const vocabStart = performance.now();
      const insertVocabTx = db.transaction((start, end) => {
        for (let i = start; i < end; i += 1) {
          insertTokenVocab.run(targetMode, i, vocab[i]);
        }
      });
      for (let start = 0; start < vocab.length; start += resolvedBatchSize) {
        insertVocabTx(start, Math.min(start + resolvedBatchSize, vocab.length));
        recordBatch('tokenVocabBatches');
      }
      recordTable('token_vocab', vocab.length, performance.now() - vocabStart);

      const postingStart = performance.now();
      let postingRows = 0;
      const insertPostingsTx = db.transaction((start, end) => {
        for (let tokenId = start; tokenId < end; tokenId += 1) {
          const posting = postings[tokenId] || [];
          for (const entry of posting) {
            if (!entry) continue;
            const docId = entry[0];
            const tf = entry[1];
            insertTokenPosting.run(targetMode, tokenId, docId, tf);
            postingRows += 1;
          }
        }
      });
      for (let start = 0; start < postings.length; start += resolvedBatchSize) {
        insertPostingsTx(start, Math.min(start + resolvedBatchSize, postings.length));
        recordBatch('tokenPostingBatches');
      }
      recordTable('token_postings', postingRows, performance.now() - postingStart);

      const lengthsStart = performance.now();
      const insertLengthsTx = db.transaction((start, end) => {
        for (let docId = start; docId < end; docId += 1) {
          insertDocLength.run(targetMode, docId, docLengths[docId]);
        }
      });
      for (let start = 0; start < docLengths.length; start += resolvedBatchSize) {
        insertLengthsTx(start, Math.min(start + resolvedBatchSize, docLengths.length));
        recordBatch('docLengthBatches');
      }
      recordTable('doc_lengths', docLengths.length, performance.now() - lengthsStart);

      insertTokenStats.run(targetMode, avgDocLen, totalDocs);
      recordTable('token_stats', 1, 0);
    }

    function ingestTokenIndexFromPieces(targetMode, indexDir) {
      const directPath = path.join(indexDir, 'token_postings.json');
      const directPathGz = `${directPath}.gz`;
      const directPathZst = `${directPath}.zst`;
      const sources = resolveTokenPostingsSources(indexDir);
      if (!sources && !fsSync.existsSync(directPath) && !fsSync.existsSync(directPathGz)
        && !fsSync.existsSync(directPathZst)) {
        return false;
      }
      if (!sources) {
        const tokenIndex = readJson(directPath);
        ingestTokenIndex(tokenIndex, targetMode);
        return true;
      }
      const meta = fsSync.existsSync(sources.metaPath) ? readJson(sources.metaPath) : {};
      const docLengths = Array.isArray(meta?.docLengths)
        ? meta.docLengths
        : (Array.isArray(meta?.arrays?.docLengths) ? meta.arrays.docLengths : []);
      const totalDocs = Number.isFinite(meta?.totalDocs) ? meta.totalDocs : docLengths.length;
      const avgDocLen = Number.isFinite(meta?.avgDocLen)
        ? meta.avgDocLen
        : (Number.isFinite(meta?.fields?.avgDocLen) ? meta.fields.avgDocLen : (
          docLengths.length
            ? docLengths.reduce((sum, len) => sum + (Number.isFinite(len) ? len : 0), 0) / docLengths.length
            : 0
        ));
      const lengthsStart = performance.now();
      const insertLengthsTx = db.transaction((start, end) => {
        for (let docId = start; docId < end; docId += 1) {
          insertDocLength.run(targetMode, docId, docLengths[docId]);
        }
      });
      for (let start = 0; start < docLengths.length; start += resolvedBatchSize) {
        insertLengthsTx(start, Math.min(start + resolvedBatchSize, docLengths.length));
        recordBatch('docLengthBatches');
      }
      recordTable('doc_lengths', docLengths.length, performance.now() - lengthsStart);
      insertTokenStats.run(targetMode, avgDocLen, totalDocs);
      recordTable('token_stats', 1, 0);
      let tokenId = 0;
      let vocabRows = 0;
      let postingRows = 0;
      const vocabStart = performance.now();
      const postingStart = performance.now();
      for (const shardPath of sources.parts) {
        const shard = readJson(shardPath);
        const vocab = Array.isArray(shard?.vocab)
          ? shard.vocab
          : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
        const postings = Array.isArray(shard?.postings)
          ? shard.postings
          : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
        const insertVocabTx = db.transaction((start, end) => {
          for (let i = start; i < end; i += 1) {
            insertTokenVocab.run(targetMode, tokenId + i, vocab[i]);
          }
        });
        for (let start = 0; start < vocab.length; start += resolvedBatchSize) {
          insertVocabTx(start, Math.min(start + resolvedBatchSize, vocab.length));
          recordBatch('tokenVocabBatches');
        }
        vocabRows += vocab.length;
        const insertPostingsTx = db.transaction((start, end) => {
          for (let i = start; i < end; i += 1) {
            const posting = postings[i] || [];
            const postingTokenId = tokenId + i;
            for (const entry of posting) {
              if (!entry) continue;
              insertTokenPosting.run(targetMode, postingTokenId, entry[0], entry[1]);
              postingRows += 1;
            }
          }
        });
        for (let start = 0; start < postings.length; start += resolvedBatchSize) {
          insertPostingsTx(start, Math.min(start + resolvedBatchSize, postings.length));
          recordBatch('tokenPostingBatches');
        }
        tokenId += vocab.length;
      }
      recordTable('token_vocab', vocabRows, performance.now() - vocabStart);
      recordTable('token_postings', postingRows, performance.now() - postingStart);
      return true;
    }

    function ingestTokenIndexFromChunks(chunks, targetMode) {
      if (!Array.isArray(chunks) || !chunks.length) return;
      const tokenIdMap = new Map();
      let nextTokenId = 0;
      let totalDocs = 0;
      let totalLen = 0;
      let docLengthRows = 0;
      let tokenVocabRows = 0;
      let tokenPostingRows = 0;
      const lengthsStart = performance.now();
      const vocabStart = performance.now();
      const postingStart = performance.now();
      const insertTx = db.transaction((batch) => {
        for (const entry of batch) {
          if (!entry) continue;
          const chunk = entry.chunk;
          if (!chunk) continue;
          const docId = Number.isFinite(chunk.id) ? chunk.id : entry.index;
          const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
          const docLen = tokensArray.length;
          totalDocs += 1;
          totalLen += docLen;
          insertDocLength.run(targetMode, docId, docLen);
          docLengthRows += 1;
          if (!docLen) continue;
          const freq = buildTokenFrequency(tokensArray);
          for (const [token, tf] of freq.entries()) {
            let tokenId = tokenIdMap.get(token);
            if (tokenId === undefined) {
              tokenId = nextTokenId;
              nextTokenId += 1;
              tokenIdMap.set(token, tokenId);
              insertTokenVocab.run(targetMode, tokenId, token);
              tokenVocabRows += 1;
            }
            insertTokenPosting.run(targetMode, tokenId, docId, tf);
            tokenPostingRows += 1;
          }
        }
      });
      const batch = [];
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        if (!chunk) continue;
        batch.push({ chunk, index: i });
        if (batch.length >= resolvedBatchSize) {
          insertTx(batch);
          batch.length = 0;
          recordBatch('tokenPostingBatches');
          recordBatch('tokenVocabBatches');
          recordBatch('docLengthBatches');
        }
      }
      if (batch.length) {
        insertTx(batch);
        recordBatch('tokenPostingBatches');
        recordBatch('tokenVocabBatches');
        recordBatch('docLengthBatches');
      }
      insertTokenStats.run(targetMode, totalDocs ? totalLen / totalDocs : 0, totalDocs);
      recordTable('doc_lengths', docLengthRows, performance.now() - lengthsStart);
      recordTable('token_vocab', tokenVocabRows, performance.now() - vocabStart);
      recordTable('token_postings', tokenPostingRows, performance.now() - postingStart);
      recordTable('token_stats', 1, 0);
    }

    function ingestPostingIndex(
      indexData,
      targetMode,
      insertVocabStmt,
      insertPostingStmt,
      { vocabTable, postingTable } = {}
    ) {
      if (!indexData?.vocab || !indexData?.postings) return;
      const vocab = indexData.vocab;
      const postings = indexData.postings;

      const vocabStart = performance.now();
      const insertVocabTx = db.transaction((start, end) => {
        for (let i = start; i < end; i += 1) {
          insertVocabStmt.run(targetMode, i, vocab[i]);
        }
      });
      for (let start = 0; start < vocab.length; start += resolvedBatchSize) {
        insertVocabTx(start, Math.min(start + resolvedBatchSize, vocab.length));
        recordBatch('postingVocabBatches');
      }
      recordTable(vocabTable || 'posting_vocab', vocab.length, performance.now() - vocabStart);

      const postingStart = performance.now();
      let postingRows = 0;
      const insertPostingsTx = db.transaction((start, end) => {
        for (let tokenId = start; tokenId < end; tokenId += 1) {
          const posting = postings[tokenId] || [];
          for (const docId of posting) {
            insertPostingStmt.run(targetMode, tokenId, docId);
            postingRows += 1;
          }
        }
      });
      for (let start = 0; start < postings.length; start += resolvedBatchSize) {
        insertPostingsTx(start, Math.min(start + resolvedBatchSize, postings.length));
        recordBatch('postingBatches');
      }
      recordTable(postingTable || 'posting_rows', postingRows, performance.now() - postingStart);
    }

    function ingestMinhash(minhash, targetMode) {
      if (!minhash?.signatures || !minhash.signatures.length) return;
      const start = performance.now();
      let minhashRows = 0;
      const insertTx = db.transaction((start, end) => {
        for (let docId = start; docId < end; docId += 1) {
          const sig = minhash.signatures[docId];
          if (!sig) continue;
          insertMinhash.run(targetMode, docId, packUint32(sig));
          validationStats.minhash += 1;
          minhashRows += 1;
        }
      });
      for (let start = 0; start < minhash.signatures.length; start += resolvedBatchSize) {
        insertTx(start, Math.min(start + resolvedBatchSize, minhash.signatures.length));
        recordBatch('minhashBatches');
      }
      recordTable('minhash_signatures', minhashRows, performance.now() - start);
    }

    function ingestDense(dense, targetMode) {
      if (!dense?.vectors || !dense.vectors.length) return;
      const denseDims = Number.isFinite(dense?.dims)
        ? Number(dense.dims)
        : (dense.vectors.find((vec) => vec && vec.length)?.length || 0);
      insertDenseMeta.run(
        targetMode,
        denseDims || null,
        typeof dense.scale === 'number' ? dense.scale : 1.0,
        dense.model || modelConfig.id || null,
        quantization.minVal,
        quantization.maxVal,
        quantization.levels
      );
      recordTable('dense_meta', 1, 0);
      const start = performance.now();
      let denseRows = 0;
      const insertTx = db.transaction((start, end) => {
        for (let docId = start; docId < end; docId += 1) {
          const vec = dense.vectors[docId];
          if (!vec) continue;
          insertDense.run(targetMode, docId, packUint8(vec));
          validationStats.dense += 1;
          denseRows += 1;
          if (vectorAnn?.insert && encodeVector) {
            const floatVec = dequantizeUint8ToFloat32(
              vec,
              quantization.minVal,
              quantization.maxVal,
              quantization.levels
            );
            const encoded = encodeVector(floatVec, vectorExtension);
            if (encoded) {
              const compatible = isVectorEncodingCompatible({
                encoded,
                dims: denseDims,
                encoding: vectorExtension.encoding
              });
              if (!compatible) {
                if (!vectorAnnInsertWarned) {
                  const expectedBytes = resolveVectorEncodingBytes(denseDims, vectorExtension.encoding);
                  const actualBytes = resolveEncodedVectorBytes(encoded);
                  warn(
                    `[sqlite] Vector extension insert skipped for ${targetMode}: ` +
                    `encoded length ${actualBytes ?? 'unknown'} != expected ${expectedBytes ?? 'unknown'} ` +
                    `(dims=${denseDims}, encoding=${vectorExtension.encoding || 'float32'}).`
                  );
                  vectorAnnInsertWarned = true;
                }
              } else {
                vectorAnn.insert.run(toSqliteRowId(docId), encoded);
              }
            }
          }
        }
      });
      for (let start = 0; start < dense.vectors.length; start += resolvedBatchSize) {
        insertTx(start, Math.min(start + resolvedBatchSize, dense.vectors.length));
        recordBatch('denseBatches');
      }
      recordTable('dense_vectors', denseRows, performance.now() - start);
      dense.vectors = null;
    }

    const buildChunkRowWithMeta = (chunk, targetMode, fileMetaById) => {
      const fileMeta = Number.isFinite(chunk.fileId)
        ? fileMetaById.get(chunk.fileId)
        : null;
      const resolvedFile = normalizeFilePath(chunk.file || fileMeta?.file);
      const resolvedExt = chunk.ext || fileMeta?.ext || null;
      const resolvedExternalDocs = chunk.externalDocs || fileMeta?.externalDocs || null;
      const resolvedLastModified = chunk.last_modified || fileMeta?.last_modified || null;
      const resolvedLastAuthor = chunk.last_author || fileMeta?.last_author || null;
      const resolvedChurn = typeof chunk.churn === 'number'
        ? chunk.churn
        : (typeof fileMeta?.churn === 'number' ? fileMeta.churn : null);
      const resolvedChurnAdded = typeof chunk.churn_added === 'number'
        ? chunk.churn_added
        : (typeof fileMeta?.churn_added === 'number' ? fileMeta.churn_added : null);
      const resolvedChurnDeleted = typeof chunk.churn_deleted === 'number'
        ? chunk.churn_deleted
        : (typeof fileMeta?.churn_deleted === 'number' ? fileMeta.churn_deleted : null);
      const resolvedChurnCommits = typeof chunk.churn_commits === 'number'
        ? chunk.churn_commits
        : (typeof fileMeta?.churn_commits === 'number' ? fileMeta.churn_commits : null);
      const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
      const tokensText = tokensArray.join(' ');
      const signatureText = typeof chunk.docmeta?.signature === 'string'
        ? chunk.docmeta.signature
        : (typeof chunk.signature === 'string' ? chunk.signature : null);
      const docText = typeof chunk.docmeta?.doc === 'string' ? chunk.docmeta.doc : null;
      const stableChunkId = resolveChunkId(chunk);
      return {
        id: Number.isFinite(chunk.id) ? chunk.id : null,
        chunk_id: stableChunkId,
        mode: targetMode,
        file: resolvedFile,
        start: chunk.start,
        end: chunk.end,
        startLine: chunk.startLine || null,
        endLine: chunk.endLine || null,
        ext: resolvedExt,
        kind: chunk.kind || null,
        name: chunk.name || null,
        metaV2_json: chunk.metaV2 ? JSON.stringify(chunk.metaV2) : null,
        signature: signatureText,
        headline: chunk.headline || null,
        doc: docText,
        preContext: chunk.preContext ? JSON.stringify(chunk.preContext) : null,
        postContext: chunk.postContext ? JSON.stringify(chunk.postContext) : null,
        weight: typeof chunk.weight === 'number' ? chunk.weight : 1,
        tokens: tokensArray.length ? JSON.stringify(tokensArray) : null,
        tokensText,
        ngrams: chunk.ngrams ? JSON.stringify(chunk.ngrams) : null,
        codeRelations: chunk.codeRelations ? JSON.stringify(chunk.codeRelations) : null,
        docmeta: chunk.docmeta ? JSON.stringify(chunk.docmeta) : null,
        stats: chunk.stats ? JSON.stringify(chunk.stats) : null,
        complexity: chunk.complexity ? JSON.stringify(chunk.complexity) : null,
        lint: chunk.lint ? JSON.stringify(chunk.lint) : null,
        externalDocs: resolvedExternalDocs ? JSON.stringify(resolvedExternalDocs) : null,
        last_modified: resolvedLastModified,
        last_author: resolvedLastAuthor,
        churn: resolvedChurn,
        churn_added: resolvedChurnAdded,
        churn_deleted: resolvedChurnDeleted,
        churn_commits: resolvedChurnCommits,
        chunk_authors: (() => {
          const authors = Array.isArray(chunk.chunk_authors)
            ? chunk.chunk_authors
            : (Array.isArray(chunk.chunkAuthors) ? chunk.chunkAuthors : null);
          return authors ? JSON.stringify(authors) : null;
        })()
      };
    };

    const ingestChunkMetaPieces = async (targetMode, indexDir, fileMetaById) => {
      const sources = resolveChunkMetaSources(indexDir);
      if (!sources) return { count: 0, fileCounts: new Map() };
      const fileCounts = new Map();
      const rows = [];
      const start = performance.now();
      const insert = db.transaction((batch) => {
        for (const row of batch) {
          insertChunk.run(row);
          insertFts.run(row);
        }
      });
      const flush = () => {
        if (!rows.length) return;
        insert(rows);
        rows.length = 0;
        recordBatch('chunkMetaBatches');
      };
      let chunkCount = 0;
      const handleChunk = (chunk) => {
        if (!chunk) return;
        if (!Number.isFinite(chunk.id)) {
          chunk.id = chunkCount;
        }
        const row = buildChunkRowWithMeta(chunk, targetMode, fileMetaById);
        if (row.file) {
          fileCounts.set(row.file, (fileCounts.get(row.file) || 0) + 1);
        }
        rows.push(row);
        chunkCount += 1;
        if (rows.length >= resolvedBatchSize) flush();
      };
      if (sources.format === 'json') {
        const data = readJson(sources.paths[0]);
        if (Array.isArray(data)) {
          for (const chunk of data) handleChunk(chunk);
        }
      } else {
        for (const chunkPath of sources.paths) {
          await readJsonLinesFile(chunkPath, handleChunk, { requiredKeys: CHUNK_META_REQUIRED_KEYS });
        }
      }
      flush();
      const durationMs = performance.now() - start;
      recordTable('chunks', chunkCount, durationMs);
      recordTable('chunks_fts', chunkCount, durationMs);
      return { count: chunkCount, fileCounts };
    };

    async function ingestIndex(indexData, targetMode, indexDir) {
      if (!indexData && !indexDir) return 0;
      const fileMetaById = new Map();
      const fileMetaRaw = Array.isArray(indexData?.fileMeta)
        ? indexData.fileMeta
        : (indexDir ? loadOptional(indexDir, 'file_meta.json') : null);
      if (Array.isArray(fileMetaRaw)) {
        for (const entry of fileMetaRaw) {
          if (!entry || !Number.isFinite(entry.id)) continue;
          fileMetaById.set(entry.id, entry);
        }
      }
      let chunkCount = 0;
      let fileCounts = new Map();
      let chunkMetaLoaded = false;
      if (indexDir) {
        const result = await ingestChunkMetaPieces(targetMode, indexDir, fileMetaById);
        chunkCount = result.count;
        fileCounts = result.fileCounts;
        chunkMetaLoaded = result.count > 0;
      }
      if (!chunkMetaLoaded && Array.isArray(indexData?.chunkMeta)) {
        const start = performance.now();
        const insert = db.transaction((rows) => {
          for (const row of rows) {
            insertChunk.run(row);
            insertFts.run(row);
          }
        });
        const rows = [];
        const flush = () => {
          if (!rows.length) return;
          insert(rows);
          rows.length = 0;
          recordBatch('chunkMetaBatches');
        };
        for (let i = 0; i < indexData.chunkMeta.length; i += 1) {
          const chunk = indexData.chunkMeta[i];
          if (!chunk) continue;
          if (!Number.isFinite(chunk.id)) {
            chunk.id = i;
          }
          const row = buildChunkRowWithMeta(chunk, targetMode, fileMetaById);
          rows.push(row);
          if (row.file) {
            fileCounts.set(row.file, (fileCounts.get(row.file) || 0) + 1);
          }
          chunkCount += 1;
          if (rows.length >= resolvedBatchSize) flush();
        }
        flush();
        const durationMs = performance.now() - start;
        recordTable('chunks', chunkCount, durationMs);
        recordTable('chunks_fts', chunkCount, durationMs);
      }

      let tokenIngested = false;
      if (indexData?.tokenPostings) {
        ingestTokenIndex(indexData.tokenPostings, targetMode);
        tokenIngested = true;
      }
      if (!tokenIngested && indexDir) {
        tokenIngested = ingestTokenIndexFromPieces(targetMode, indexDir);
      }
      if (!tokenIngested) {
        warn(`[sqlite] token_postings missing; rebuilding tokens for ${targetMode}.`);
        if (Array.isArray(indexData?.chunkMeta)) {
          ingestTokenIndexFromChunks(indexData.chunkMeta, targetMode);
        } else {
          warn(`[sqlite] chunk_meta unavailable for token rebuild (${targetMode}).`);
        }
      }

      ingestPostingIndex(
        indexData?.phraseNgrams,
        targetMode,
        insertPhraseVocab,
        insertPhrasePosting,
        { vocabTable: 'phrase_vocab', postingTable: 'phrase_postings' }
      );
      ingestPostingIndex(
        indexData?.chargrams,
        targetMode,
        insertChargramVocab,
        insertChargramPosting,
        { vocabTable: 'chargram_vocab', postingTable: 'chargram_postings' }
      );
      ingestMinhash(indexData?.minhash, targetMode);
      ingestDense(indexData?.denseVec, targetMode);
      ingestFileManifest(fileCounts, targetMode);

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

    function ingestFileManifest(fileCounts, targetMode) {
      if (!fileCounts || !fileCounts.size) return;
      const start = performance.now();
      const insertTx = db.transaction((batch) => {
        for (const [file, count] of batch) {
          const normalizedFile = normalizeFilePath(file);
          const entry = manifestByNormalized.get(normalizedFile)?.entry || null;
          insertFileManifest.run(
            targetMode,
            normalizedFile,
            entry?.hash || null,
            Number.isFinite(entry?.mtimeMs) ? entry.mtimeMs : null,
            Number.isFinite(entry?.size) ? entry.size : null,
            count
          );
        }
      });
      const batch = [];
      for (const entry of fileCounts.entries()) {
        batch.push(entry);
        if (batch.length >= resolvedBatchSize) {
          insertTx(batch);
          batch.length = 0;
          recordBatch('fileManifestBatches');
        }
      }
      if (batch.length) {
        insertTx(batch);
        recordBatch('fileManifestBatches');
      }
      recordTable('file_manifest', fileCounts.size, performance.now() - start);
    }

    count = await ingestIndex(index, mode, indexDir);
    validationStats.chunks = count;
    db.exec(CREATE_INDEXES_SQL);
    if (useOptimize) {
      optimizeBuildDatabase(db, { inputBytes, stats: batchStats });
    }
    const validationStart = performance.now();
    validateSqliteDatabase(db, mode, {
      validateMode,
      expected: validationStats,
      emitOutput,
      logger,
      dbPath: resolvedOutPath
    });
    if (batchStats) {
      batchStats.validationMs = performance.now() - validationStart;
    }
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {}
    succeeded = true;
  } finally {
    if (succeeded) {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (err) {
        warn(`[sqlite] WAL checkpoint failed for ${mode}: ${err?.message || err}`);
      }
    }
    if (pragmaState) {
      restoreBuildPragmas(db, pragmaState);
    }
    db.close();
    if (!succeeded) {
      try {
        fsSync.rmSync(resolvedOutPath, { force: true });
      } catch {}
      await removeSqliteSidecars(resolvedOutPath);
    }
  }
  return count;
}

