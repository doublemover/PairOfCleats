import fsSync from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import {
  buildChunkRow,
  buildTokenFrequency,
  prepareVectorAnnTable
} from '../build-helpers.js';
import { resolveChunkId } from '../../../index/chunk-id.js';
import { CREATE_INDEXES_SQL } from '../schema.js';
import {
  normalizeFilePath,
  readJson,
  loadOptionalFileMetaRows,
  loadSqliteIndexOptionalArtifacts
} from '../utils.js';
import {
  createUint8ClampStats,
  packUint32,
  packUint8,
  dequantizeUint8ToFloat32,
  isVectorEncodingCompatible,
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
import {
  MAX_JSON_BYTES,
  readJsonLinesEach,
  resolveArtifactPresence,
  resolveJsonlRequiredKeys
} from '../../../shared/artifact-io.js';

const ARTIFACT_BUILD_PRAGMA_MIN_BYTES = 128 * 1024 * 1024;

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

const inflateColumnarRows = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const arrays = payload.arrays && typeof payload.arrays === 'object' ? payload.arrays : null;
  if (!arrays) return null;
  const columns = Array.isArray(payload.columns) ? payload.columns : Object.keys(arrays);
  if (!columns.length) return [];
  const tables = payload.tables && typeof payload.tables === 'object' ? payload.tables : null;
  const length = Number.isFinite(payload.length)
    ? payload.length
    : (Array.isArray(arrays[columns[0]]) ? arrays[columns[0]].length : 0);
  const rows = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const row = {};
    for (const column of columns) {
      const values = arrays[column];
      const value = Array.isArray(values) ? (values[i] ?? null) : null;
      const table = tables && Array.isArray(tables[column]) ? tables[column] : null;
      row[column] = table && Number.isInteger(value) ? (table[value] ?? null) : value;
    }
    rows[i] = row;
  }
  return rows;
};

const resolveChunkMetaSources = (dir) => {
  if (!dir || typeof dir !== 'string') {
    dir = typeof dir?.dir === 'string' ? dir.dir : null;
  }
  if (!dir) return null;
  const presence = resolveArtifactPresence(dir, 'chunk_meta', {
    maxBytes: MAX_JSON_BYTES,
    strict: false
  });
  if (presence?.missingMeta && presence?.metaPath) {
    throw new Error(`[sqlite] chunk_meta meta missing: ${presence.metaPath}`);
  }
  if (Array.isArray(presence?.missingPaths) && presence.missingPaths.length) {
    throw new Error(`[sqlite] chunk_meta parts missing: ${presence.missingPaths.join(', ')}`);
  }
  if (Array.isArray(presence?.paths) && presence.paths.length) {
    return {
      format: presence.format === 'json' || presence.format === 'columnar' ? presence.format : 'jsonl',
      paths: presence.paths
    };
  }
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const partsDir = path.join(dir, 'chunk_meta.parts');
  if (fsSync.existsSync(metaPath) || fsSync.existsSync(partsDir)) {
    let parts = [];
    if (fsSync.existsSync(metaPath)) {
      const metaRaw = readJson(metaPath);
      const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
      const entries = normalizeMetaParts(meta?.parts);
      if (entries.length) {
        const missing = [];
        parts = entries.map((name) => {
          const candidate = path.join(dir, name);
          if (!fsSync.existsSync(candidate)) missing.push(name);
          return candidate;
        });
        if (missing.length) {
          throw new Error(`[sqlite] chunk_meta parts missing: ${missing.join(', ')}`);
        }
      }
    }
    if (!parts.length) {
      parts = listShardFiles(partsDir, 'chunk_meta.part-', ['.jsonl', '.jsonl.gz', '.jsonl.zst']);
    }
    if (parts.length) {
      return { format: 'jsonl', paths: parts };
    }
  }
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const jsonlCandidates = [jsonlPath, `${jsonlPath}.gz`, `${jsonlPath}.zst`];
  const jsonlResolved = jsonlCandidates.find((candidate) => fsSync.existsSync(candidate));
  if (jsonlResolved) {
    return { format: 'jsonl', paths: [jsonlResolved] };
  }
  const jsonPath = path.join(dir, 'chunk_meta.json');
  const jsonCandidates = [jsonPath, `${jsonPath}.gz`, `${jsonPath}.zst`];
  const jsonResolved = jsonCandidates.find((candidate) => fsSync.existsSync(candidate));
  if (jsonResolved) {
    return { format: 'json', paths: [jsonResolved] };
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

const normalizeTfPostingRows = (posting) => {
  if (!Array.isArray(posting) || posting.length <= 1) return Array.isArray(posting) ? posting : [];
  let previousDocId = -1;
  let alreadySortedUnique = true;
  for (const entry of posting) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const docIdRaw = Number(entry[0]);
    if (!Number.isFinite(docIdRaw)) continue;
    const docId = Math.max(0, Math.floor(docIdRaw));
    if (docId <= previousDocId) {
      alreadySortedUnique = false;
      break;
    }
    previousDocId = docId;
  }
  if (alreadySortedUnique) return posting;
  const merged = new Map();
  for (const entry of posting) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const docIdRaw = Number(entry[0]);
    const tfRaw = Number(entry[1]);
    if (!Number.isFinite(docIdRaw) || !Number.isFinite(tfRaw)) continue;
    const docId = Math.max(0, Math.floor(docIdRaw));
    const tf = Math.max(0, Math.floor(tfRaw));
    if (!tf) continue;
    merged.set(docId, (merged.get(docId) || 0) + tf);
  }
  if (!merged.size) return [];
  return Array.from(merged.entries()).sort((a, b) => a[0] - b[0]);
};

const CHUNK_META_REQUIRED_KEYS = resolveJsonlRequiredKeys('chunk_meta');

const readJsonLinesFile = async (
  filePath,
  onEntry,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => readJsonLinesEach(filePath, onEntry, { maxBytes, requiredKeys });

/**
 * Load artifact pieces required for sqlite builds.
 * @param {string|{indexDir?:string,modes?:string[],modelId?:string}} dirOrOptions
 * @param {string} [modelId]
 * @returns {object|null}
 */
export const loadIndexPieces = async (dirOrOptions, modelId) => {
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
        const pieces = await loadIndexPieces(modeDir, resolvedModelId);
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
  const optional = loadSqliteIndexOptionalArtifacts(dir, { modelId });
  return {
    chunkMeta: null,
    dir,
    fileMeta: optional.fileMeta,
    denseVec: optional.denseVec,
    phraseNgrams: optional.phraseNgrams,
    chargrams: optional.chargrams,
    minhash: optional.minhash,
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
  let vectorAnnInsertWarned = false;
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

    function ingestTokenIndex(tokenIndex, targetMode) {
      if (!tokenIndex?.vocab || !tokenIndex?.postings) return;
      const vocab = tokenIndex.vocab;
      const postings = tokenIndex.postings;
      const docLengths = Array.isArray(tokenIndex.docLengths) ? tokenIndex.docLengths : [];
      const avgDocLen = typeof tokenIndex.avgDocLen === 'number' ? tokenIndex.avgDocLen : null;
      const totalDocs = typeof tokenIndex.totalDocs === 'number' ? tokenIndex.totalDocs : docLengths.length;

      const vocabStart = performance.now();
      if (insertTokenVocabMany) {
        const rows = [];
        for (let tokenId = 0; tokenId < vocab.length; tokenId += 1) {
          rows.push([targetMode, tokenId, vocab[tokenId]]);
          if (rows.length >= insertTokenVocabMany.maxRows) {
            insertTokenVocabMany(rows);
            rows.length = 0;
            recordBatch('tokenVocabBatches');
          }
        }
        if (rows.length) {
          insertTokenVocabMany(rows);
          recordBatch('tokenVocabBatches');
        }
      } else {
        for (let start = 0; start < vocab.length; start += resolvedBatchSize) {
          const end = Math.min(start + resolvedBatchSize, vocab.length);
          for (let tokenId = start; tokenId < end; tokenId += 1) {
            insertTokenVocab.run(targetMode, tokenId, vocab[tokenId]);
          }
          recordBatch('tokenVocabBatches');
        }
      }
      recordTable('token_vocab', vocab.length, performance.now() - vocabStart);

      const postingStart = performance.now();
      let postingRows = 0;
      if (insertTokenPostingMany) {
        const rows = [];
        for (let tokenId = 0; tokenId < postings.length; tokenId += 1) {
          const posting = normalizeTfPostingRows(postings[tokenId]);
          for (const entry of posting) {
            if (!entry) continue;
            rows.push([targetMode, tokenId, entry[0], entry[1]]);
            postingRows += 1;
            if (rows.length >= insertTokenPostingMany.maxRows) {
              insertTokenPostingMany(rows);
              rows.length = 0;
              recordBatch('tokenPostingBatches');
            }
          }
        }
        if (rows.length) {
          insertTokenPostingMany(rows);
          recordBatch('tokenPostingBatches');
        }
      } else {
        for (let start = 0; start < postings.length; start += resolvedBatchSize) {
          const end = Math.min(start + resolvedBatchSize, postings.length);
          for (let tokenId = start; tokenId < end; tokenId += 1) {
            const posting = normalizeTfPostingRows(postings[tokenId]);
            for (const entry of posting) {
              if (!entry) continue;
              insertTokenPosting.run(targetMode, tokenId, entry[0], entry[1]);
              postingRows += 1;
            }
          }
          recordBatch('tokenPostingBatches');
        }
      }
      recordTable('token_postings', postingRows, performance.now() - postingStart);

      const lengthsStart = performance.now();
      if (insertDocLengthMany) {
        const rows = [];
        for (let docId = 0; docId < docLengths.length; docId += 1) {
          rows.push([targetMode, docId, docLengths[docId]]);
          if (rows.length >= insertDocLengthMany.maxRows) {
            insertDocLengthMany(rows);
            rows.length = 0;
            recordBatch('docLengthBatches');
          }
        }
        if (rows.length) {
          insertDocLengthMany(rows);
          recordBatch('docLengthBatches');
        }
      } else {
        for (let start = 0; start < docLengths.length; start += resolvedBatchSize) {
          const end = Math.min(start + resolvedBatchSize, docLengths.length);
          for (let docId = start; docId < end; docId += 1) {
            insertDocLength.run(targetMode, docId, docLengths[docId]);
          }
          recordBatch('docLengthBatches');
        }
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
      if (insertDocLengthMany) {
        const rows = [];
        for (let docId = 0; docId < docLengths.length; docId += 1) {
          rows.push([targetMode, docId, docLengths[docId]]);
          if (rows.length >= insertDocLengthMany.maxRows) {
            insertDocLengthMany(rows);
            rows.length = 0;
            recordBatch('docLengthBatches');
          }
        }
        if (rows.length) {
          insertDocLengthMany(rows);
          recordBatch('docLengthBatches');
        }
      } else {
        for (let start = 0; start < docLengths.length; start += resolvedBatchSize) {
          const end = Math.min(start + resolvedBatchSize, docLengths.length);
          for (let docId = start; docId < end; docId += 1) {
            insertDocLength.run(targetMode, docId, docLengths[docId]);
          }
          recordBatch('docLengthBatches');
        }
      }
      recordTable('doc_lengths', docLengths.length, performance.now() - lengthsStart);
      insertTokenStats.run(targetMode, avgDocLen, totalDocs);
      recordTable('token_stats', 1, 0);
      let tokenId = 0;
      let vocabRows = 0;
      let postingRows = 0;
      const tokenPostingsConflictClause = insertClause === 'INSERT'
        ? ' ON CONFLICT(mode, token_id, doc_id) DO UPDATE SET tf = token_postings.tf + excluded.tf'
        : '';
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
        const postingCount = Math.min(postings.length, vocab.length);
        if (postings.length > vocab.length) {
          warn(
            `[sqlite] token_postings shard has extra posting buckets (${postings.length} > ${vocab.length}); truncating extras.`
          );
        }
        const insertTokenVocabStmt = resolvedStatementStrategy === 'prepare-per-shard'
          ? db.prepare(`${insertClause} INTO token_vocab (mode, token_id, token) VALUES (?, ?, ?)`)
          : insertTokenVocab;
        const insertTokenPostingStmt = resolvedStatementStrategy === 'prepare-per-shard'
          ? db.prepare(`${insertClause} INTO token_postings (mode, token_id, doc_id, tf) VALUES (?, ?, ?, ?)${tokenPostingsConflictClause}`)
          : insertTokenPosting;
        if (insertTokenVocabMany) {
          const rows = [];
          for (let i = 0; i < vocab.length; i += 1) {
            rows.push([targetMode, tokenId + i, vocab[i]]);
            if (rows.length >= insertTokenVocabMany.maxRows) {
              insertTokenVocabMany(rows);
              rows.length = 0;
              recordBatch('tokenVocabBatches');
            }
          }
          if (rows.length) {
            insertTokenVocabMany(rows);
            recordBatch('tokenVocabBatches');
          }
        } else {
          for (let start = 0; start < vocab.length; start += resolvedBatchSize) {
            const end = Math.min(start + resolvedBatchSize, vocab.length);
            for (let i = start; i < end; i += 1) {
              insertTokenVocabStmt.run(targetMode, tokenId + i, vocab[i]);
            }
            recordBatch('tokenVocabBatches');
          }
        }
        vocabRows += vocab.length;
        if (insertTokenPostingMany) {
          const rows = [];
          for (let i = 0; i < postingCount; i += 1) {
            const posting = normalizeTfPostingRows(postings[i]);
            const postingTokenId = tokenId + i;
            for (const entry of posting) {
              if (!entry) continue;
              rows.push([targetMode, postingTokenId, entry[0], entry[1]]);
              postingRows += 1;
              if (rows.length >= insertTokenPostingMany.maxRows) {
                insertTokenPostingMany(rows);
                rows.length = 0;
                recordBatch('tokenPostingBatches');
              }
            }
          }
          if (rows.length) {
            insertTokenPostingMany(rows);
            recordBatch('tokenPostingBatches');
          }
        } else {
          for (let start = 0; start < postingCount; start += resolvedBatchSize) {
            const end = Math.min(start + resolvedBatchSize, postingCount);
            for (let i = start; i < end; i += 1) {
              const posting = normalizeTfPostingRows(postings[i]);
              const postingTokenId = tokenId + i;
              for (const entry of posting) {
                if (!entry) continue;
                insertTokenPostingStmt.run(targetMode, postingTokenId, entry[0], entry[1]);
                postingRows += 1;
              }
            }
            recordBatch('tokenPostingBatches');
          }
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
        const postingsByDoc = new Map();
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
            let docPostings = postingsByDoc.get(docId);
            if (!docPostings) {
              docPostings = new Map();
              postingsByDoc.set(docId, docPostings);
            }
            docPostings.set(tokenId, (docPostings.get(tokenId) || 0) + tf);
          }
        }
        for (const [docId, docPostings] of postingsByDoc.entries()) {
          for (const [tokenId, tf] of docPostings.entries()) {
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

    function ingestTokenIndexFromStoredChunks(targetMode) {
      const selectChunks = db.prepare(
        'SELECT id, tokens FROM chunks WHERE mode = ? ORDER BY id'
      );
      const tokenIdMap = new Map();
      let nextTokenId = 0;
      let totalDocs = 0;
      let totalLen = 0;
      let docLengthRows = 0;
      let tokenVocabRows = 0;
      let tokenPostingRows = 0;
      let sawRows = false;
      const lengthsStart = performance.now();
      const vocabStart = performance.now();
      const postingStart = performance.now();
      const parseTokens = (raw) => {
        if (typeof raw !== 'string' || !raw) return [];
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };
      const insertTx = db.transaction((batch) => {
        const postingsByDoc = new Map();
        for (const entry of batch) {
          if (!entry) continue;
          const docId = Number.isFinite(entry.id) ? entry.id : null;
          if (!Number.isFinite(docId)) continue;
          sawRows = true;
          const tokensArray = parseTokens(entry.tokens);
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
            let docPostings = postingsByDoc.get(docId);
            if (!docPostings) {
              docPostings = new Map();
              postingsByDoc.set(docId, docPostings);
            }
            docPostings.set(tokenId, (docPostings.get(tokenId) || 0) + tf);
          }
        }
        for (const [docId, docPostings] of postingsByDoc.entries()) {
          for (const [tokenId, tf] of docPostings.entries()) {
            insertTokenPosting.run(targetMode, tokenId, docId, tf);
            tokenPostingRows += 1;
          }
        }
      });
      const batch = [];
      for (const row of selectChunks.iterate(targetMode)) {
        batch.push(row);
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
      if (!sawRows) return false;
      insertTokenStats.run(targetMode, totalDocs ? totalLen / totalDocs : 0, totalDocs);
      recordTable('doc_lengths', docLengthRows, performance.now() - lengthsStart);
      recordTable('token_vocab', tokenVocabRows, performance.now() - vocabStart);
      recordTable('token_postings', tokenPostingRows, performance.now() - postingStart);
      recordTable('token_stats', 1, 0);
      return true;
    }

    function ingestPostingIndex(
      indexData,
      targetMode,
      insertVocabStmt,
      insertPostingStmt,
      {
        vocabTable,
        postingTable,
        insertVocabMany = null,
        insertPostingMany = null
      } = {}
    ) {
      if (!indexData?.vocab || !indexData?.postings) return;
      const vocab = indexData.vocab;
      const postings = indexData.postings;

      const vocabStart = performance.now();
      if (insertVocabMany) {
        const rows = [];
        for (let tokenId = 0; tokenId < vocab.length; tokenId += 1) {
          rows.push([targetMode, tokenId, vocab[tokenId]]);
          if (rows.length >= insertVocabMany.maxRows) {
            insertVocabMany(rows);
            rows.length = 0;
            recordBatch('postingVocabBatches');
          }
        }
        if (rows.length) {
          insertVocabMany(rows);
          recordBatch('postingVocabBatches');
        }
      } else {
        for (let start = 0; start < vocab.length; start += resolvedBatchSize) {
          const end = Math.min(start + resolvedBatchSize, vocab.length);
          for (let tokenId = start; tokenId < end; tokenId += 1) {
            insertVocabStmt.run(targetMode, tokenId, vocab[tokenId]);
          }
          recordBatch('postingVocabBatches');
        }
      }
      recordTable(vocabTable || 'posting_vocab', vocab.length, performance.now() - vocabStart);

      const postingStart = performance.now();
      let postingRows = 0;
      if (insertPostingMany) {
        const rows = [];
        for (let tokenId = 0; tokenId < postings.length; tokenId += 1) {
          const posting = postings[tokenId] || [];
          for (const docId of posting) {
            rows.push([targetMode, tokenId, docId]);
            postingRows += 1;
            if (rows.length >= insertPostingMany.maxRows) {
              insertPostingMany(rows);
              rows.length = 0;
              recordBatch('postingBatches');
            }
          }
        }
        if (rows.length) {
          insertPostingMany(rows);
          recordBatch('postingBatches');
        }
      } else {
        for (let start = 0; start < postings.length; start += resolvedBatchSize) {
          const end = Math.min(start + resolvedBatchSize, postings.length);
          for (let tokenId = start; tokenId < end; tokenId += 1) {
            const posting = postings[tokenId] || [];
            for (const docId of posting) {
              insertPostingStmt.run(targetMode, tokenId, docId);
              postingRows += 1;
            }
          }
          recordBatch('postingBatches');
        }
      }
      recordTable(postingTable || 'posting_rows', postingRows, performance.now() - postingStart);
    }

    const ingestMinhash = async (minhashSource, targetMode) => {
      if (!minhashSource) return;
      const start = performance.now();
      const rows = [];
      let minhashRows = 0;
      const insertTx = db.transaction((batch) => {
        for (const entry of batch) {
          if (!entry) continue;
          insertMinhash.run(targetMode, entry.docId, packUint32(entry.sig));
          validationStats.minhash += 1;
          minhashRows += 1;
        }
      });
      const flush = () => {
        if (!rows.length) return;
        insertTx(rows);
        rows.length = 0;
        recordBatch('minhashBatches');
      };
      const handleEntry = (docId, sig) => {
        if (!Number.isFinite(docId) || !sig) return;
        rows.push({ docId, sig });
        if (rows.length >= resolvedBatchSize) flush();
      };
      if (Array.isArray(minhashSource?.signatures)) {
        const signatures = minhashSource.signatures;
        for (let docId = 0; docId < signatures.length; docId += 1) {
          handleEntry(docId, signatures[docId]);
        }
      } else if (typeof minhashSource?.[Symbol.asyncIterator] === 'function') {
        for await (const entry of minhashSource) {
          if (entry && typeof entry === 'object') {
            handleEntry(entry.docId ?? entry.id, entry.sig ?? entry.signature);
          } else {
            handleEntry(entry?.docId, entry?.sig);
          }
        }
      }
      flush();
      recordTable('minhash_signatures', minhashRows, performance.now() - start);
    };

    async function ingestDense(dense, targetMode) {
      if (dense?.fields || dense?.arrays) {
        const fields = dense.fields && typeof dense.fields === 'object' ? dense.fields : null;
        const arrays = dense.arrays && typeof dense.arrays === 'object' ? dense.arrays : null;
        dense = {
          ...dense,
          ...(fields || {}),
          vectors: dense.vectors ?? arrays?.vectors
        };
      }
      const hasDenseArray = Array.isArray(dense?.vectors) && dense.vectors.length > 0;
      const hasDenseBuffer = !!(
        dense?.buffer
        && ArrayBuffer.isView(dense.buffer)
        && dense.buffer.BYTES_PER_ELEMENT === 1
      );
      const hasDenseRows = typeof dense?.rows?.[Symbol.asyncIterator] === 'function';
      if (!hasDenseArray && !hasDenseRows && !hasDenseBuffer) return;
      let denseDims = Number.isFinite(dense?.dims)
        ? Number(dense.dims)
        : (hasDenseArray ? (dense.vectors.find((vec) => vec && vec.length)?.length || 0) : 0);
      const denseScale = typeof dense?.scale === 'number' ? dense.scale : 1.0;
      let denseMetaWritten = false;
      const ensureDenseMeta = (sampleVec = null) => {
        if (denseMetaWritten) return;
        if ((!denseDims || denseDims <= 0) && sampleVec && typeof sampleVec.length === 'number') {
          denseDims = sampleVec.length || 0;
        }
        insertDenseMeta.run(
          targetMode,
          denseDims || null,
          denseScale,
          dense?.model || modelConfig.id || null,
          quantization.minVal,
          quantization.maxVal,
          quantization.levels
        );
        denseMetaWritten = true;
        recordTable('dense_meta', 1, 0);
      };
      if (denseDims > 0) {
        ensureDenseMeta();
      }
      const start = performance.now();
      let denseRows = 0;
      const denseBatch = [];
      const flushDenseBatch = db.transaction((batch) => {
        for (const item of batch) {
          const docId = item?.docId;
          const vec = item?.vec;
          if (!Number.isFinite(docId) || !vec) continue;
          ensureDenseMeta(vec);
          insertDense.run(targetMode, docId, packUint8(vec, { onClamp: recordDenseClamp }));
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
      const flush = () => {
        if (!denseBatch.length) return;
        flushDenseBatch(denseBatch);
        denseBatch.length = 0;
        recordBatch('denseBatches');
      };
      if (hasDenseArray) {
        for (let docId = 0; docId < dense.vectors.length; docId += 1) {
          const vec = dense.vectors[docId];
          if (!vec) continue;
          denseBatch.push({ docId, vec });
          if (denseBatch.length >= resolvedBatchSize) flush();
        }
      } else if (hasDenseBuffer) {
        const rowWidth = Number.isFinite(denseDims) && denseDims > 0 ? Math.floor(denseDims) : 0;
        const buffer = dense.buffer;
        const count = Number.isFinite(Number(dense?.count))
          ? Math.max(0, Math.floor(Number(dense.count)))
          : (rowWidth > 0 ? Math.floor(buffer.length / rowWidth) : 0);
        if (rowWidth > 0 && count > 0) {
          for (let docId = 0; docId < count; docId += 1) {
            const start = docId * rowWidth;
            const end = start + rowWidth;
            if (end > buffer.length) break;
            denseBatch.push({ docId, vec: buffer.subarray(start, end) });
            if (denseBatch.length >= resolvedBatchSize) flush();
          }
        }
      } else if (hasDenseRows) {
        let docId = 0;
        for await (const entry of dense.rows) {
          const vec = (entry && typeof entry === 'object' && !Array.isArray(entry))
            ? (entry.vector ?? entry.values ?? null)
            : entry;
          if (vec) {
            denseBatch.push({ docId, vec });
            if (denseBatch.length >= resolvedBatchSize) flush();
          }
          docId += 1;
        }
      }
      flush();
      if (!denseMetaWritten && hasDenseArray) {
        ensureDenseMeta();
      }
      recordTable('dense_vectors', denseRows, performance.now() - start);
      dense.vectors = null;
      dense.buffer = null;
    }

    const ingestFileMetaRows = async (fileMetaSource) => {
      if (!fileMetaSource) return 0;
      const start = performance.now();
      const rows = [];
      let batchBytes = 0;
      const maxBatchBytes = resolvedBatchSize * 4096;
      let count = 0;
      const insertTx = db.transaction((batch) => {
        for (const row of batch) {
          insertFileMetaStage.run(row);
        }
      });
      const flush = () => {
        if (!rows.length) return;
        insertTx(rows);
        rows.length = 0;
        batchBytes = 0;
        recordBatch('fileMetaBatches');
      };
      const estimateRowBytes = (row) => {
        if (!row) return 0;
        let bytes = 128;
        if (row.file) bytes += row.file.length;
        if (row.ext) bytes += row.ext.length;
        if (row.hash) bytes += row.hash.length;
        if (row.hashAlgo) bytes += row.hashAlgo.length;
        return bytes;
      };
      const handleRow = (entry) => {
        if (!entry || !Number.isFinite(entry.id)) return;
        const normalizedFile = normalizeFilePath(entry.file);
        const row = {
          id: entry.id,
          file: normalizedFile,
          ext: entry.ext || null,
          size: Number.isFinite(entry.size) ? entry.size : null,
          hash: entry.hash || null,
          hashAlgo: entry.hashAlgo || entry.hash_algo || null,
          encoding: entry.encoding || null,
          encodingFallback: typeof entry.encodingFallback === 'boolean'
            ? (entry.encodingFallback ? 1 : 0)
            : null,
          encodingConfidence: Number.isFinite(entry.encodingConfidence)
            ? entry.encodingConfidence
            : null,
          externalDocs: entry.externalDocs ? JSON.stringify(entry.externalDocs) : null,
          last_modified: entry.last_modified || null,
          last_author: entry.last_author || null,
          churn: typeof entry.churn === 'number' ? entry.churn : null,
          churn_added: typeof entry.churn_added === 'number' ? entry.churn_added : null,
          churn_deleted: typeof entry.churn_deleted === 'number' ? entry.churn_deleted : null,
          churn_commits: typeof entry.churn_commits === 'number' ? entry.churn_commits : null
        };
        rows.push(row);
        batchBytes += estimateRowBytes(row);
        count += 1;
        if (rows.length >= resolvedBatchSize || batchBytes >= maxBatchBytes) flush();
      };
      if (Array.isArray(fileMetaSource)) {
        for (const entry of fileMetaSource) {
          handleRow(entry);
        }
      } else if (typeof fileMetaSource?.[Symbol.asyncIterator] === 'function') {
        for await (const entry of fileMetaSource) {
          handleRow(entry);
        }
      }
      flush();
      recordTable('file_meta_stage', count, performance.now() - start);
      return count;
    };

    const buildChunkRowBase = (chunk, targetMode) => {
      const resolvedFile = normalizeFilePath(chunk.file || null);
      const resolvedExt = chunk.ext || null;
      const resolvedExternalDocs = chunk.externalDocs || null;
      const resolvedLastModified = chunk.last_modified || null;
      const resolvedLastAuthor = chunk.last_author || null;
      const resolvedChurn = typeof chunk.churn === 'number' ? chunk.churn : null;
      const resolvedChurnAdded = typeof chunk.churn_added === 'number' ? chunk.churn_added : null;
      const resolvedChurnDeleted = typeof chunk.churn_deleted === 'number' ? chunk.churn_deleted : null;
      const resolvedChurnCommits = typeof chunk.churn_commits === 'number' ? chunk.churn_commits : null;
      const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
      const hasTokens = tokensArray.length > 0;
      const tokensText = hasTokens ? tokensArray.join(' ') : null;
      if (hasTokens) {
        bumpChunkMetaCounter('tokenTextMaterialized', 1);
      } else {
        bumpChunkMetaCounter('tokenTextSkipped', 1);
      }
      const signatureText = typeof chunk.docmeta?.signature === 'string'
        ? chunk.docmeta.signature
        : (typeof chunk.signature === 'string' ? chunk.signature : null);
      const docText = typeof chunk.docmeta?.doc === 'string' ? chunk.docmeta.doc : null;
      const stableChunkId = resolveChunkId(chunk);
      return {
        id: Number.isFinite(chunk.id) ? chunk.id : null,
        chunk_id: stableChunkId,
        mode: targetMode,
        file_id: Number.isFinite(chunk.fileId) ? chunk.fileId : null,
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

    const createChunkMetaStageIngestor = ({ targetMode, sourceKind }) => {
      const rows = [];
      const start = performance.now();
      const insert = db.transaction((batch) => {
        for (const row of batch) {
          insertChunkStage.run(row);
        }
      });
      const maxBatchBytes = resolvedBatchSize * 4096;
      let batchBytes = 0;
      const flush = () => {
        if (!rows.length) return;
        insert(rows);
        rows.length = 0;
        batchBytes = 0;
        recordBatch('chunkMetaBatches');
      };
      const estimateRowBytes = (row) => {
        if (!row) return 0;
        let bytes = 128;
        if (row.file) bytes += row.file.length;
        if (row.ext) bytes += row.ext.length;
        if (row.name) bytes += row.name.length;
        if (row.tokensText) bytes += row.tokensText.length;
        return bytes;
      };
      let chunkCount = 0;
      bumpChunkMetaCounter('passes', 1);
      const handleChunk = (chunk, fallbackId = null) => {
        if (!chunk) return;
        if (!Number.isFinite(chunk.id)) {
          chunk.id = Number.isFinite(fallbackId) ? fallbackId : chunkCount;
        }
        const row = buildChunkRowBase(chunk, targetMode);
        rows.push(row);
        batchBytes += estimateRowBytes(row);
        chunkCount += 1;
        bumpChunkMetaCounter('rows', 1);
        if (sourceKind === 'jsonl') {
          bumpChunkMetaCounter('streamedRows', 1);
        }
        bumpChunkMetaBucket('sourceRows', sourceKind, 1);
        if (rows.length >= resolvedBatchSize || batchBytes >= maxBatchBytes) flush();
      };
      const finish = () => {
        flush();
        recordTable('chunks_stage', chunkCount, performance.now() - start);
        return chunkCount;
      };
      return { handleChunk, finish };
    };

    const ingestChunkMetaPieces = async (targetMode, indexDir) => {
      const sources = resolveChunkMetaSources(indexDir);
      if (!sources) return { count: 0 };
      const sourceKind = sources.format === 'jsonl' ? 'jsonl' : (sources.format === 'columnar' ? 'columnar' : 'json');
      const ingestor = createChunkMetaStageIngestor({ targetMode, sourceKind });
      if (sources.format === 'json') {
        bumpChunkMetaBucket('sourceFiles', 'json', 1);
        const data = readJson(sources.paths[0]);
        if (Array.isArray(data)) {
          for (const chunk of data) ingestor.handleChunk(chunk);
        }
      } else if (sources.format === 'columnar') {
        bumpChunkMetaBucket('sourceFiles', 'columnar', 1);
        const data = inflateColumnarRows(readJson(sources.paths[0]));
        if (Array.isArray(data)) {
          for (const chunk of data) ingestor.handleChunk(chunk);
        }
      } else {
        for (const chunkPath of sources.paths) {
          if (chunkPath) {
            bumpChunkMetaBucket('sourceFiles', 'jsonl', 1);
          }
          await readJsonLinesFile(chunkPath, ingestor.handleChunk, { requiredKeys: CHUNK_META_REQUIRED_KEYS });
        }
      }
      return { count: ingestor.finish() };
    };

    const finalizeChunkIngest = (targetMode, chunkCount) => {
      if (!chunkCount) return;
      const start = performance.now();
      db.exec(`
        INSERT OR REPLACE INTO chunks (
          id,
          chunk_id,
          mode,
          file,
          start,
          end,
          startLine,
          endLine,
          ext,
          kind,
          name,
          metaV2_json,
          headline,
          preContext,
          postContext,
          weight,
          tokens,
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
        )
        SELECT
          c.id,
          c.chunk_id,
          c.mode,
          COALESCE(c.file, f.file),
          c.start,
          c.end,
          c.startLine,
          c.endLine,
          COALESCE(c.ext, f.ext),
          c.kind,
          c.name,
          c.metaV2_json,
          c.headline,
          c.preContext,
          c.postContext,
          c.weight,
          c.tokens,
          c.ngrams,
          c.codeRelations,
          c.docmeta,
          c.stats,
          c.complexity,
          c.lint,
          COALESCE(c.externalDocs, f.externalDocs),
          COALESCE(c.last_modified, f.last_modified),
          COALESCE(c.last_author, f.last_author),
          COALESCE(c.churn, f.churn),
          COALESCE(c.churn_added, f.churn_added),
          COALESCE(c.churn_deleted, f.churn_deleted),
          COALESCE(c.churn_commits, f.churn_commits),
          c.chunk_authors
        FROM chunks_stage c
        LEFT JOIN file_meta_stage f ON c.file_id = f.id;

        INSERT OR REPLACE INTO chunks_fts (rowid, file, name, signature, kind, headline, doc, tokens)
        SELECT
          c.id,
          COALESCE(c.file, f.file),
          c.name,
          c.signature,
          c.kind,
          c.headline,
          c.doc,
          c.tokensText
        FROM chunks_stage c
        LEFT JOIN file_meta_stage f ON c.file_id = f.id;
      `);
      const durationMs = performance.now() - start;
      recordTable('chunks', chunkCount, durationMs);
      recordTable('chunks_fts', chunkCount, durationMs);
      db.exec('DELETE FROM chunks_stage;');
    };

    const ingestFileManifestFromChunks = (targetMode) => {
      const start = performance.now();
      const rows = db.prepare(`
        SELECT
          c.file AS file,
          COUNT(*) AS chunk_count,
          f.hash AS file_hash,
          f.size AS file_size
        FROM chunks c
        LEFT JOIN file_meta_stage f ON f.file = c.file
        WHERE c.mode = ?
        GROUP BY c.file
      `).all(targetMode);
      if (!rows.length) return;
      const insertTx = db.transaction((batch) => {
        for (const row of batch) {
          const normalizedFile = normalizeFilePath(row.file);
          if (!normalizedFile) continue;
          const entry = manifestByNormalized.get(normalizedFile)?.entry || null;
          const hash = entry?.hash || row.file_hash || null;
          const mtimeMs = Number.isFinite(entry?.mtimeMs) ? entry.mtimeMs : null;
          const size = Number.isFinite(entry?.size)
            ? entry.size
            : (Number.isFinite(row.file_size) ? row.file_size : null);
          insertFileManifest.run(
            targetMode,
            normalizedFile,
            hash,
            mtimeMs,
            size,
            row.chunk_count
          );
        }
      });
      const batch = [];
      for (const entry of rows) {
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
      recordTable('file_manifest', rows.length, performance.now() - start);
    };

    async function ingestIndex(indexData, targetMode, indexDir) {
      if (!indexData && !indexDir) return 0;
      const fileMetaSource = indexData?.fileMeta
        ?? (indexDir ? loadOptionalFileMetaRows(indexDir) : null);
      await ingestFileMetaRows(fileMetaSource);
      let chunkCount = 0;
      let chunkMetaLoaded = false;
      if (indexDir) {
        const result = await ingestChunkMetaPieces(targetMode, indexDir);
        chunkCount = result.count;
        chunkMetaLoaded = result.count > 0;
      }
      if (!chunkMetaLoaded && Array.isArray(indexData?.chunkMeta)) {
        const ingestor = createChunkMetaStageIngestor({ targetMode, sourceKind: 'array' });
        for (let i = 0; i < indexData.chunkMeta.length; i += 1) {
          const chunk = indexData.chunkMeta[i];
          ingestor.handleChunk(chunk, i);
        }
        chunkCount = ingestor.finish();
      }
      finalizeChunkIngest(targetMode, chunkCount);

      let tokenIngested = false;
      if (indexData?.tokenPostings) {
        ingestTokenIndex(indexData.tokenPostings, targetMode);
        tokenIngested = true;
      }
      if (!tokenIngested && indexDir) {
        tokenIngested = ingestTokenIndexFromPieces(targetMode, indexDir);
      }
      if (!tokenIngested && chunkCount > 0) {
        warn(`[sqlite] token_postings missing; rebuilding tokens for ${targetMode}.`);
        if (Array.isArray(indexData?.chunkMeta) && indexData.chunkMeta.length) {
          ingestTokenIndexFromChunks(indexData.chunkMeta, targetMode);
        } else if (!ingestTokenIndexFromStoredChunks(targetMode)) {
          warn(`[sqlite] chunk_meta unavailable for token rebuild (${targetMode}).`);
        }
      }

      ingestPostingIndex(
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
      ingestPostingIndex(
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
      await ingestMinhash(indexData?.minhash, targetMode);
      await ingestDense(indexData?.denseVec, targetMode);
      ingestFileManifestFromChunks(targetMode);
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

