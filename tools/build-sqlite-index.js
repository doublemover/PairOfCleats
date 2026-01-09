#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import Piscina from 'piscina';
import { createCli } from '../src/shared/cli.js';
import { getEnvConfig } from '../src/shared/env.js';
import { resolveThreadLimits } from '../src/shared/threads.js';
import { getIndexDir, getModelConfig, getRepoCacheRoot, loadUserConfig, resolveIndexRoot, resolveRepoRoot, resolveSqlitePaths } from './dict-utils.js';
import { encodeVector, ensureVectorTable, getVectorExtensionConfig, hasVectorTable, loadVectorExtension } from './vector-extension.js';
import { compactDatabase } from './compact-sqlite-index.js';
import { CREATE_INDEXES_SQL, CREATE_TABLES_BASE_SQL, REQUIRED_TABLES, SCHEMA_VERSION } from '../src/storage/sqlite/schema.js';
import { buildChunkRow, buildTokenFrequency, prepareVectorAnnTable } from '../src/storage/sqlite/build-helpers.js';
import { loadIncrementalManifest } from '../src/storage/sqlite/incremental.js';
import { chunkArray, hasRequiredTables, loadIndex, loadOptional, normalizeFilePath, readJson } from '../src/storage/sqlite/utils.js';
import { dequantizeUint8ToFloat32, packUint32, packUint8, quantizeVec, toVectorId } from '../src/storage/sqlite/vector.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {}

const applyBuildPragmas = (db) => {
  try { db.pragma('journal_mode = WAL'); } catch {}
  try { db.pragma('synchronous = OFF'); } catch {}
  try { db.pragma('temp_store = MEMORY'); } catch {}
  try { db.pragma('cache_size = -200000'); } catch {}
  try { db.pragma('mmap_size = 268435456'); } catch {}
};

const createTempPath = (filePath) => (
  `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
);

const replaceFile = async (tempPath, finalPath) => {
  try {
    await fs.rename(tempPath, finalPath);
    return;
  } catch (err) {
    if (err?.code !== 'EEXIST' && err?.code !== 'EPERM' && err?.code !== 'ENOTEMPTY') {
      throw err;
    }
  }
  try {
    await fs.rm(finalPath, { force: true });
  } catch {}
  await fs.rename(tempPath, finalPath);
};

const restoreBuildPragmas = (db) => {
  try { db.pragma('synchronous = NORMAL'); } catch {}
  try { db.pragma('temp_store = DEFAULT'); } catch {}
};

const MAX_INCREMENTAL_CHANGE_RATIO = 0.35;
const VOCAB_GROWTH_LIMITS = {
  token_vocab: { ratio: 0.4, absolute: 200000 },
  phrase_vocab: { ratio: 0.5, absolute: 150000 },
  chargram_vocab: { ratio: 1.0, absolute: 250000 }
};

const normalizeValidateMode = (value) => {
  if (value === false || value == null) return 'off';
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === 'true') return 'smoke';
  if (['off', 'false', '0', 'no'].includes(normalized)) return 'off';
  if (['full', 'integrity'].includes(normalized)) return 'full';
  return 'smoke';
};

const listShardFiles = (dir, prefix) => {
  if (!fsSync.existsSync(dir)) return [];
  return fsSync
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && (name.endsWith('.json') || name.endsWith('.jsonl')))
    .sort()
    .map((name) => path.join(dir, name));
};

const resolveChunkMetaSources = (dir) => {
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const partsDir = path.join(dir, 'chunk_meta.parts');
  if (fsSync.existsSync(metaPath) || fsSync.existsSync(partsDir)) {
    let parts = [];
    if (fsSync.existsSync(metaPath)) {
      try {
        const meta = readJson(metaPath);
        if (Array.isArray(meta?.parts) && meta.parts.length) {
          parts = meta.parts.map((name) => path.join(dir, name));
        }
      } catch {}
    }
    if (!parts.length) {
      parts = listShardFiles(partsDir, 'chunk_meta.part-');
    }
    return parts.length ? { format: 'jsonl', paths: parts } : null;
  }
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  if (fsSync.existsSync(jsonlPath)) {
    return { format: 'jsonl', paths: [jsonlPath] };
  }
  const jsonPath = path.join(dir, 'chunk_meta.json');
  if (fsSync.existsSync(jsonPath)) {
    return { format: 'json', paths: [jsonPath] };
  }
  return null;
};

const resolveTokenPostingsSources = (dir) => {
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const shardsDir = path.join(dir, 'token_postings.shards');
  if (!fsSync.existsSync(metaPath) && !fsSync.existsSync(shardsDir)) return null;
  let parts = [];
  if (fsSync.existsSync(metaPath)) {
    try {
      const meta = readJson(metaPath);
      if (Array.isArray(meta?.parts) && meta.parts.length) {
        parts = meta.parts.map((name) => path.join(dir, name));
      }
    } catch {}
  }
  if (!parts.length) {
    parts = listShardFiles(shardsDir, 'token_postings.part-');
  }
  return parts.length ? { metaPath, parts } : null;
};

const readJsonLinesFile = async (filePath, onEntry) => {
  const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    onEntry(JSON.parse(trimmed));
  }
};

const loadIndexPieces = (dir, modelId) => {
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

export async function runBuildSqliteIndex(rawArgs = process.argv.slice(2), options = {}) {
  const emitOutput = options.emitOutput !== false;
  const exitOnError = options.exitOnError !== false;
  const argv = createCli({
    scriptName: 'build-sqlite-index',
    argv: ['node', 'build-sqlite-index.js', ...rawArgs],
    options: {
      'code-dir': { type: 'string' },
      'prose-dir': { type: 'string' },
      out: { type: 'string' },
      mode: { type: 'string', default: 'all' },
      repo: { type: 'string' },
      incremental: { type: 'boolean', default: false },
      compact: { type: 'boolean', default: false },
      validate: { type: 'string', default: 'smoke' },
      'index-root': { type: 'string' }
    }
  }).parse();
  const bail = (message, code = 1) => {
    if (emitOutput && message) console.error(message);
    if (exitOnError) process.exit(code);
    throw new Error(message || 'SQLite index build failed.');
  };
  if (!Database) return bail('better-sqlite3 is required. Run npm install first.');

const rootArg = options.root ? path.resolve(options.root) : (argv.repo ? path.resolve(argv.repo) : null);
const root = rootArg || resolveRepoRoot(process.cwd());
const envConfig = getEnvConfig();
const userConfig = loadUserConfig(root);
const validateMode = normalizeValidateMode(argv.validate);
const indexRoot = argv['index-root']
  ? path.resolve(argv['index-root'])
  : resolveIndexRoot(root, userConfig);
const threadLimits = resolveThreadLimits({
  argv,
  rawArgv: rawArgs,
  envConfig,
  configConcurrency: userConfig?.indexing?.concurrency,
  importConcurrencyConfig: userConfig?.indexing?.importConcurrency
});
if (emitOutput && envConfig.verbose === true) {
  console.log(
    `[sqlite] Thread limits (${threadLimits.source}): ` +
    `cpu=${threadLimits.cpuCount}, cap=${threadLimits.maxConcurrencyCap}, ` +
    `files=${threadLimits.fileConcurrency}, imports=${threadLimits.importConcurrency}, ` +
    `io=${threadLimits.ioConcurrency}, cpuWork=${threadLimits.cpuConcurrency}.`
  );
}
const modelConfig = getModelConfig(root, userConfig);
const vectorExtension = getVectorExtensionConfig(root, userConfig);
const vectorAnnEnabled = vectorExtension.enabled;
const vectorConfig = {
  enabled: vectorAnnEnabled,
  extension: vectorExtension,
  loadVectorExtension,
  ensureVectorTable
};
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const compactFlag = argv.compact;
const compactOnIncremental = compactFlag === true
  || (compactFlag !== false && userConfig?.sqlite?.compactOnIncremental === true);
const codeDir = argv['code-dir']
  ? path.resolve(argv['code-dir'])
  : getIndexDir(root, 'code', userConfig, { indexRoot });
const proseDir = argv['prose-dir']
  ? path.resolve(argv['prose-dir'])
  : getIndexDir(root, 'prose', userConfig, { indexRoot });
const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
const incrementalRequested = argv.incremental === true;

const modeArg = (argv.mode || 'all').toLowerCase();
if (!['all', 'code', 'prose'].includes(modeArg)) {
  return bail('Invalid mode. Use --mode all|code|prose');
}

const outArg = argv.out ? path.resolve(argv.out) : null;
let outPath = null;
let codeOutPath = sqlitePaths.codePath;
let proseOutPath = sqlitePaths.prosePath;
if (outArg) {
  if (modeArg === 'all') {
    const outDir = outArg.endsWith('.db') ? path.dirname(outArg) : outArg;
    codeOutPath = path.join(outDir, 'index-code.db');
    proseOutPath = path.join(outDir, 'index-prose.db');
  } else {
    const targetName = modeArg === 'code' ? 'index-code.db' : 'index-prose.db';
    outPath = outArg.endsWith('.db') ? outArg : path.join(outArg, targetName);
  }
}
if (!outPath && modeArg !== 'all') {
  outPath = modeArg === 'code' ? codeOutPath : proseOutPath;
}

if (modeArg === 'all') {
  await fs.mkdir(path.dirname(codeOutPath), { recursive: true });
  await fs.mkdir(path.dirname(proseOutPath), { recursive: true });
} else if (outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
}



const loadIndexSafe = (dir, label) => {
  try {
    const index = loadIndex(dir, modelConfig.id);
    if (index) return { index, tooLarge: false, pieces: null };
    return { index: null, tooLarge: false, pieces: loadIndexPieces(dir, modelConfig.id) };
  } catch (err) {
    if (err?.code === 'ERR_JSON_TOO_LARGE') {
      console.warn(`[sqlite] ${label} chunk_meta too large; will use pieces if available.`);
      return { index: null, tooLarge: true, pieces: loadIndexPieces(dir, modelConfig.id) };
    }
    throw err;
  }
};

const { index: codeIndex, pieces: codePieces } = loadIndexSafe(codeDir, 'code');
const { index: proseIndex, pieces: prosePieces } = loadIndexSafe(proseDir, 'prose');
const incrementalCode = loadIncrementalManifest(repoCacheRoot, 'code');
const incrementalProse = loadIncrementalManifest(repoCacheRoot, 'prose');
if (!codeIndex && !codePieces && !proseIndex && !prosePieces
  && !incrementalCode?.manifest && !incrementalProse?.manifest) {
  return bail('No index found. Build index-code/index-prose first.');
}

if (sqlitePaths.legacyExists) {
  try {
    await fs.rm(sqlitePaths.legacyPath, { force: true });
    console.warn(`Removed legacy SQLite index at ${sqlitePaths.legacyPath}`);
  } catch (err) {
    console.warn(`Failed to remove legacy SQLite index at ${sqlitePaths.legacyPath}: ${err?.message || err}`);
  }
}

const canIncrementalCode = incrementalRequested && incrementalCode?.manifest;
const canIncrementalProse = incrementalRequested && incrementalProse?.manifest;
if (modeArg === 'code' && !codeIndex && !codePieces && !incrementalCode?.manifest) {
  return bail('Code index missing; build index-code first.');
}
if (modeArg === 'prose' && !proseIndex && !prosePieces && !incrementalProse?.manifest) {
  return bail('Prose index missing; build index-prose first.');
}


/**
 * Build a full SQLite index from file-backed artifacts.
 * @param {string} outPath
 * @param {object} index
 * @param {'code'|'prose'} mode
 * @param {object|null} manifestFiles
 * @returns {number}
 */
  async function buildDatabase(outPath, index, indexDir, mode, manifestFiles) {
    if (!index) return 0;
    const manifestLookup = normalizeManifestFiles(manifestFiles || {});
    if (emitOutput && manifestLookup.conflicts.length) {
      console.warn(`[sqlite] Manifest path conflicts for ${mode}; using normalized entries.`);
    }
    const manifestByNormalized = manifestLookup.map;
    const validationStats = { chunks: 0, dense: 0, minhash: 0 };

    const db = new Database(outPath);
    applyBuildPragmas(db);

    let count = 0;
    let succeeded = false;
    try {
      db.exec(CREATE_TABLES_BASE_SQL);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
      const vectorAnn = prepareVectorAnnTable({ db, indexData: index, mode, vectorConfig });

  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO chunks (
      id, mode, file, start, end, startLine, endLine, ext, kind, name, headline,
      preContext, postContext, weight, tokens, ngrams, codeRelations, docmeta,
      stats, complexity, lint, externalDocs, last_modified, last_author, churn,
      chunk_authors
    ) VALUES (
      @id, @mode, @file, @start, @end, @startLine, @endLine, @ext, @kind, @name, @headline,
      @preContext, @postContext, @weight, @tokens, @ngrams, @codeRelations, @docmeta,
      @stats, @complexity, @lint, @externalDocs, @last_modified, @last_author, @churn,
      @chunk_authors
    );
  `);

  const insertFts = db.prepare(`
    INSERT OR REPLACE INTO chunks_fts (rowid, mode, file, name, signature, kind, headline, doc, tokens)
    VALUES (@id, @mode, @file, @name, @signature, @kind, @headline, @doc, @tokensText);
  `);

  const insertTokenVocab = db.prepare(
    'INSERT OR REPLACE INTO token_vocab (mode, token_id, token) VALUES (?, ?, ?)'
  );
  const insertTokenPosting = db.prepare(
    'INSERT OR REPLACE INTO token_postings (mode, token_id, doc_id, tf) VALUES (?, ?, ?, ?)'
  );
  const insertDocLength = db.prepare(
    'INSERT OR REPLACE INTO doc_lengths (mode, doc_id, len) VALUES (?, ?, ?)'
  );
  const insertTokenStats = db.prepare(
    'INSERT OR REPLACE INTO token_stats (mode, avg_doc_len, total_docs) VALUES (?, ?, ?)'
  );
  const insertPhraseVocab = db.prepare(
    'INSERT OR REPLACE INTO phrase_vocab (mode, phrase_id, ngram) VALUES (?, ?, ?)'
  );
  const insertPhrasePosting = db.prepare(
    'INSERT OR REPLACE INTO phrase_postings (mode, phrase_id, doc_id) VALUES (?, ?, ?)'
  );
  const insertChargramVocab = db.prepare(
    'INSERT OR REPLACE INTO chargram_vocab (mode, gram_id, gram) VALUES (?, ?, ?)'
  );
  const insertChargramPosting = db.prepare(
    'INSERT OR REPLACE INTO chargram_postings (mode, gram_id, doc_id) VALUES (?, ?, ?)'
  );
  const insertMinhash = db.prepare(
    'INSERT OR REPLACE INTO minhash_signatures (mode, doc_id, sig) VALUES (?, ?, ?)'
  );
  const insertDense = db.prepare(
    'INSERT OR REPLACE INTO dense_vectors (mode, doc_id, vector) VALUES (?, ?, ?)'
  );
  const insertDenseMeta = db.prepare(
    'INSERT OR REPLACE INTO dense_meta (mode, dims, scale, model) VALUES (?, ?, ?, ?)'
  );
  const insertFileManifest = db.prepare(
    'INSERT OR REPLACE INTO file_manifest (mode, file, hash, mtimeMs, size, chunk_count) VALUES (?, ?, ?, ?, ?, ?)'
  );
  /**
   * Ingest token postings into SQLite.
   * @param {object} tokenIndex
   * @param {'code'|'prose'} targetMode
   */
  function ingestTokenIndex(tokenIndex, targetMode) {
    if (!tokenIndex?.vocab || !tokenIndex?.postings) return;
    const vocab = tokenIndex.vocab;
    const postings = tokenIndex.postings;
    const docLengths = Array.isArray(tokenIndex.docLengths) ? tokenIndex.docLengths : [];
    const avgDocLen = typeof tokenIndex.avgDocLen === 'number' ? tokenIndex.avgDocLen : null;
    const totalDocs = typeof tokenIndex.totalDocs === 'number' ? tokenIndex.totalDocs : docLengths.length;

    const insertVocabTx = db.transaction(() => {
      for (let i = 0; i < vocab.length; i++) {
        insertTokenVocab.run(targetMode, i, vocab[i]);
      }
    });
    insertVocabTx();

    const insertPostingsTx = db.transaction(() => {
      for (let tokenId = 0; tokenId < postings.length; tokenId++) {
        const posting = postings[tokenId] || [];
        for (const entry of posting) {
          if (!entry) continue;
          const docId = entry[0];
          const tf = entry[1];
          insertTokenPosting.run(targetMode, tokenId, docId, tf);
        }
      }
    });
    insertPostingsTx();

    const insertLengthsTx = db.transaction(() => {
      for (let docId = 0; docId < docLengths.length; docId++) {
        insertDocLength.run(targetMode, docId, docLengths[docId]);
      }
    });
    insertLengthsTx();

    insertTokenStats.run(targetMode, avgDocLen, totalDocs);
  }

  /**
   * Ingest token postings from sharded pieces when available.
   * @param {'code'|'prose'} targetMode
   * @param {string} indexDir
   * @returns {boolean}
   */
  function ingestTokenIndexFromPieces(targetMode, indexDir) {
    const directPath = path.join(indexDir, 'token_postings.json');
    const directPathGz = `${directPath}.gz`;
    const sources = resolveTokenPostingsSources(indexDir);
    if (!sources && !fsSync.existsSync(directPath) && !fsSync.existsSync(directPathGz)) {
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
    const insertLengthsTx = db.transaction(() => {
      for (let docId = 0; docId < docLengths.length; docId++) {
        insertDocLength.run(targetMode, docId, docLengths[docId]);
      }
    });
    insertLengthsTx();
    insertTokenStats.run(targetMode, avgDocLen, totalDocs);
    let tokenId = 0;
    for (const shardPath of sources.parts) {
      const shard = readJson(shardPath);
      const vocab = Array.isArray(shard?.vocab) ? shard.vocab : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
      const postings = Array.isArray(shard?.postings) ? shard.postings : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
      const insertVocabTx = db.transaction(() => {
        for (let i = 0; i < vocab.length; i++) {
          insertTokenVocab.run(targetMode, tokenId + i, vocab[i]);
        }
      });
      insertVocabTx();
      const insertPostingsTx = db.transaction(() => {
        for (let i = 0; i < postings.length; i++) {
          const posting = postings[i] || [];
          const postingTokenId = tokenId + i;
          for (const entry of posting) {
            if (!entry) continue;
            insertTokenPosting.run(targetMode, postingTokenId, entry[0], entry[1]);
          }
        }
      });
      insertPostingsTx();
      tokenId += vocab.length;
    }
    return true;
  }

  /**
   * Rebuild token postings directly from chunk metadata.
   * @param {Array<object>} chunks
   * @param {'code'|'prose'} targetMode
   */
  function ingestTokenIndexFromChunks(chunks, targetMode) {
    if (!Array.isArray(chunks) || !chunks.length) {
      insertTokenStats.run(targetMode, 0, 0);
      return;
    }
    const tokenIdMap = new Map();
    let nextTokenId = 0;
    let totalDocs = 0;
    let totalLen = 0;
    const insertTx = db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk) continue;
        const docId = Number.isFinite(chunk.id) ? chunk.id : i;
        const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
        const docLen = tokensArray.length;
        totalDocs += 1;
        totalLen += docLen;
        insertDocLength.run(targetMode, docId, docLen);
        if (!docLen) continue;
        const freq = buildTokenFrequency(tokensArray);
        for (const [token, tf] of freq.entries()) {
          let tokenId = tokenIdMap.get(token);
          if (tokenId === undefined) {
            tokenId = nextTokenId;
            nextTokenId += 1;
            tokenIdMap.set(token, tokenId);
            insertTokenVocab.run(targetMode, tokenId, token);
          }
          insertTokenPosting.run(targetMode, tokenId, docId, tf);
        }
      }
    });
    insertTx();
    insertTokenStats.run(targetMode, totalDocs ? totalLen / totalDocs : 0, totalDocs);
  }

  /**
   * Ingest a generic postings index (phrase/chargram).
   * @param {object} indexData
   * @param {'code'|'prose'} targetMode
   * @param {import('better-sqlite3').Statement} insertVocabStmt
   * @param {import('better-sqlite3').Statement} insertPostingStmt
   */
  function ingestPostingIndex(indexData, targetMode, insertVocabStmt, insertPostingStmt) {
    if (!indexData?.vocab || !indexData?.postings) return;
    const vocab = indexData.vocab;
    const postings = indexData.postings;

    const insertVocabTx = db.transaction(() => {
      for (let i = 0; i < vocab.length; i++) {
        insertVocabStmt.run(targetMode, i, vocab[i]);
      }
    });
    insertVocabTx();

    const insertPostingsTx = db.transaction(() => {
      for (let tokenId = 0; tokenId < postings.length; tokenId++) {
        const posting = postings[tokenId] || [];
        for (const docId of posting) {
          insertPostingStmt.run(targetMode, tokenId, docId);
        }
      }
    });
    insertPostingsTx();
  }

  /**
   * Ingest minhash signatures into SQLite.
   * @param {object} minhash
   * @param {'code'|'prose'} targetMode
   */
  function ingestMinhash(minhash, targetMode) {
    if (!minhash?.signatures || !minhash.signatures.length) return;
    const insertTx = db.transaction(() => {
      for (let docId = 0; docId < minhash.signatures.length; docId++) {
        const sig = minhash.signatures[docId];
        if (!sig) continue;
        insertMinhash.run(targetMode, docId, packUint32(sig));
        validationStats.minhash += 1;
      }
    });
    insertTx();
  }

  /**
   * Ingest dense vectors into SQLite.
   * @param {object} dense
   * @param {'code'|'prose'} targetMode
   */
  function ingestDense(dense, targetMode) {
    if (!dense?.vectors || !dense.vectors.length) return;
    insertDenseMeta.run(
      targetMode,
      dense.dims || null,
      typeof dense.scale === 'number' ? dense.scale : 1.0,
      dense.model || modelConfig.id || null
    );
    const insertTx = db.transaction(() => {
      for (let docId = 0; docId < dense.vectors.length; docId++) {
        const vec = dense.vectors[docId];
        if (!vec) continue;
        insertDense.run(targetMode, docId, packUint8(vec));
        validationStats.dense += 1;
        if (vectorAnn?.insert) {
          const floatVec = dequantizeUint8ToFloat32(vec);
          const encoded = encodeVector(floatVec, vectorExtension);
          if (encoded) vectorAnn.insert.run(toVectorId(docId), encoded);
        }
      }
    });
    insertTx();
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
    return {
      id: Number.isFinite(chunk.id) ? chunk.id : null,
      mode: targetMode,
      file: resolvedFile,
      start: chunk.start,
      end: chunk.end,
      startLine: chunk.startLine || null,
      endLine: chunk.endLine || null,
      ext: resolvedExt,
      kind: chunk.kind || null,
      name: chunk.name || null,
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
      chunk_authors: chunk.chunk_authors ? JSON.stringify(chunk.chunk_authors) : null
    };
  };

  const ingestChunkMetaPieces = async (targetMode, indexDir, fileMetaById) => {
    const sources = resolveChunkMetaSources(indexDir);
    if (!sources) return { count: 0, fileCounts: new Map() };
    const fileCounts = new Map();
    const rows = [];
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
    };
    let count = 0;
    const handleChunk = (chunk) => {
      if (!chunk) return;
      if (!Number.isFinite(chunk.id)) {
        chunk.id = count;
      }
      const row = buildChunkRowWithMeta(chunk, targetMode, fileMetaById);
      if (row.file) {
        fileCounts.set(row.file, (fileCounts.get(row.file) || 0) + 1);
      }
      rows.push(row);
      count += 1;
      if (rows.length >= 500) flush();
    };
    if (sources.format === 'json') {
      const data = readJson(sources.paths[0]);
      if (Array.isArray(data)) {
        for (const chunk of data) handleChunk(chunk);
      }
    } else {
      for (const chunkPath of sources.paths) {
        await readJsonLinesFile(chunkPath, handleChunk);
      }
    }
    flush();
    return { count, fileCounts };
  };

  /**
   * Ingest all index components for a mode.
   * @param {object} indexData
   * @param {'code'|'prose'} targetMode
   */
  async function ingestIndex(indexData, targetMode, indexDir) {
    if (!indexData && !indexDir) return 0;
    const fileMetaById = new Map();
    if (Array.isArray(indexData?.fileMeta)) {
      for (const entry of indexData.fileMeta) {
        if (!entry || !Number.isFinite(entry.id)) continue;
        fileMetaById.set(entry.id, entry);
      }
    }
    let count = 0;
    let fileCounts = new Map();
    if (Array.isArray(indexData?.chunkMeta)) {
      const insert = db.transaction((rows) => {
        for (const row of rows) {
          insertChunk.run(row);
          insertFts.run(row);
        }
      });
      const rows = [];
      for (let i = 0; i < indexData.chunkMeta.length; i++) {
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
        count += 1;
      }
      insert(rows);
    } else if (indexDir) {
      const result = await ingestChunkMetaPieces(targetMode, indexDir, fileMetaById);
      count = result.count;
      fileCounts = result.fileCounts;
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
      console.warn(`[sqlite] token_postings missing; rebuilding tokens for ${targetMode}.`);
      if (Array.isArray(indexData?.chunkMeta)) {
        ingestTokenIndexFromChunks(indexData.chunkMeta, targetMode);
      } else {
        console.warn(`[sqlite] chunk_meta unavailable for token rebuild (${targetMode}).`);
      }
    }

    ingestPostingIndex(indexData?.phraseNgrams, targetMode, insertPhraseVocab, insertPhrasePosting);
    ingestPostingIndex(indexData?.chargrams, targetMode, insertChargramVocab, insertChargramPosting);
    ingestMinhash(indexData?.minhash, targetMode);
    ingestDense(indexData?.denseVec, targetMode);
    ingestFileManifest(fileCounts, targetMode);

    return count;
  }

  /**
   * Ingest file manifest metadata if available.
   * @param {Map<string,number>} fileCounts
   * @param {'code'|'prose'} targetMode
   */
  function ingestFileManifest(fileCounts, targetMode) {
    if (!fileCounts || !fileCounts.size) return;
    const insertTx = db.transaction(() => {
      for (const [file, count] of fileCounts.entries()) {
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
    insertTx();
  }

      count = await ingestIndex(index, mode, indexDir);
      validationStats.chunks = count;
      db.exec(CREATE_INDEXES_SQL);
      validateSqliteDatabase(db, mode, {
        validateMode,
        expected: validationStats,
        emitOutput
      });
      succeeded = true;
    } finally {
      restoreBuildPragmas(db);
      db.close();
      if (!succeeded) {
        try {
          fsSync.rmSync(outPath, { force: true });
        } catch {}
      }
    }
    return count;
  }

/**
 * Build a full SQLite index from incremental bundles.
 * @param {string} outPath
 * @param {'code'|'prose'} mode
 * @param {object|null} incrementalData
 * @returns {{count:number,reason?:string}}
 */
  async function buildDatabaseFromBundles(outPath, mode, incrementalData) {
    if (!incrementalData?.manifest) {
      return { count: 0, reason: 'missing incremental manifest' };
    }
  const manifestFiles = incrementalData.manifest.files || {};
  const manifestLookup = normalizeManifestFiles(manifestFiles);
  const manifestEntries = manifestLookup.entries;
  if (!manifestEntries.length) {
    return { count: 0, reason: 'incremental manifest empty' };
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
  const useBundleWorkers = bundleThreads > 1;
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

  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO chunks (
      id, mode, file, start, end, startLine, endLine, ext, kind, name, headline,
      preContext, postContext, weight, tokens, ngrams, codeRelations, docmeta,
      stats, complexity, lint, externalDocs, last_modified, last_author, churn,
      chunk_authors
    ) VALUES (
      @id, @mode, @file, @start, @end, @startLine, @endLine, @ext, @kind, @name,
      @headline,
      @preContext, @postContext, @weight, @tokens, @ngrams, @codeRelations, @docmeta,
      @stats, @complexity, @lint, @externalDocs, @last_modified, @last_author, @churn,
      @chunk_authors
    );
  `);

  const insertFts = db.prepare(`
    INSERT OR REPLACE INTO chunks_fts (rowid, mode, file, name, signature, kind, headline, doc, tokens)
    VALUES (@id, @mode, @file, @name, @signature, @kind, @headline, @doc, @tokensText);
  `);

  const insertTokenVocab = db.prepare(
    'INSERT OR REPLACE INTO token_vocab (mode, token_id, token) VALUES (?, ?, ?)'
  );
  const insertTokenPosting = db.prepare(
    'INSERT OR REPLACE INTO token_postings (mode, token_id, doc_id, tf) VALUES (?, ?, ?, ?)'
  );
  const insertDocLength = db.prepare(
    'INSERT OR REPLACE INTO doc_lengths (mode, doc_id, len) VALUES (?, ?, ?)'
  );
  const insertTokenStats = db.prepare(
    'INSERT OR REPLACE INTO token_stats (mode, avg_doc_len, total_docs) VALUES (?, ?, ?)'
  );
  const insertPhraseVocab = db.prepare(
    'INSERT OR REPLACE INTO phrase_vocab (mode, phrase_id, ngram) VALUES (?, ?, ?)'
  );
  const insertPhrasePosting = db.prepare(
    'INSERT OR REPLACE INTO phrase_postings (mode, phrase_id, doc_id) VALUES (?, ?, ?)'
  );
  const insertChargramVocab = db.prepare(
    'INSERT OR REPLACE INTO chargram_vocab (mode, gram_id, gram) VALUES (?, ?, ?)'
  );
  const insertChargramPosting = db.prepare(
    'INSERT OR REPLACE INTO chargram_postings (mode, gram_id, doc_id) VALUES (?, ?, ?)'
  );
  const insertMinhash = db.prepare(
    'INSERT OR REPLACE INTO minhash_signatures (mode, doc_id, sig) VALUES (?, ?, ?)'
  );
  const insertDense = db.prepare(
    'INSERT OR REPLACE INTO dense_vectors (mode, doc_id, vector) VALUES (?, ?, ?)'
  );
  const insertDenseMeta = db.prepare(
    'INSERT OR REPLACE INTO dense_meta (mode, dims, scale, model) VALUES (?, ?, ?, ?)'
  );
  const insertFileManifest = db.prepare(
    'INSERT OR REPLACE INTO file_manifest (mode, file, hash, mtimeMs, size, chunk_count) VALUES (?, ?, ?, ?, ?, ?)'
  );

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

  let denseMetaSet = false;
  let denseDims = null;
  let vectorAnnLoaded = false;
  let vectorAnnReady = false;
  let vectorAnnTable = vectorExtension.table || 'vector_ann';
  let vectorAnnColumn = vectorExtension.column || 'embedding';
  let insertVectorAnn = null;
  if (vectorAnnEnabled) {
    const loadResult = loadVectorExtension(db, vectorExtension, `sqlite ${mode}`);
    if (loadResult.ok) {
      vectorAnnLoaded = true;
      if (hasVectorTable(db, vectorAnnTable)) {
        vectorAnnReady = true;
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

      if (Array.isArray(chunk.embedding) && chunk.embedding.length) {
        const dims = chunk.embedding.length;
        if (!denseMetaSet) {
          insertDenseMeta.run(mode, dims, 1.0, modelConfig.id || null);
          denseMetaSet = true;
          denseDims = dims;
        }
        insertDense.run(mode, docId, packUint8(quantizeVec(chunk.embedding)));
        validationStats.dense += 1;
        if (vectorAnnLoaded) {
          if (!vectorAnnReady) {
            const created = ensureVectorTable(db, vectorExtension, dims);
            if (created.ok) {
              vectorAnnReady = true;
              vectorAnnTable = created.tableName;
              vectorAnnColumn = created.column;
              insertVectorAnn = db.prepare(
                `INSERT OR REPLACE INTO ${vectorAnnTable} (rowid, ${vectorAnnColumn}) VALUES (?, ?)`
              );
            }
          }
          if (vectorAnnReady && insertVectorAnn) {
            const encoded = encodeVector(chunk.embedding, vectorExtension);
            if (encoded) insertVectorAnn.run(toVectorId(docId), encoded);
          }
        }
      }

      chunkCount += 1;
    }

    fileCounts.set(normalizedFile, (fileCounts.get(normalizedFile) || 0) + chunkCount);
  });

  let count = 0;
  let pool = null;
  if (useBundleWorkers) {
    pool = new Piscina({
      filename: fileURLToPath(new URL('./workers/bundle-reader.js', import.meta.url)),
      maxThreads: bundleThreads
    });
  }
  const batchSize = useBundleWorkers
    ? Math.max(1, Math.min(totalFiles, Math.max(1, bundleThreads * 2)))
    : 1;
  try {
    for (let i = 0; i < manifestEntries.length; i += batchSize) {
      const batch = manifestEntries.slice(i, i + batchSize);
      const tasks = batch.map(async (record) => {
        const file = record.file;
        const entry = record.entry;
        const bundleName = entry?.bundle;
        if (!bundleName) {
          return { file, ok: false, reason: 'missing bundle entry' };
        }
        const bundlePath = path.join(incrementalData.bundleDir, bundleName);
        if (!fsSync.existsSync(bundlePath)) {
          return { file, ok: false, reason: 'bundle file missing' };
        }
        try {
          if (pool) {
            const result = await pool.run({ bundlePath });
            if (!result?.ok) {
              return { file, ok: false, reason: result?.reason || 'invalid bundle' };
            }
            return { file, ok: true, bundle: result.bundle };
          }
          const bundle = readJson(bundlePath);
          if (!bundle || !Array.isArray(bundle.chunks)) {
            return { file, ok: false, reason: 'invalid bundle' };
          }
          return { file, ok: true, bundle };
        } catch (err) {
          return { file, ok: false, reason: err?.message || String(err) };
        }
      });
      const results = await Promise.all(tasks);
      for (const result of results) {
        if (!result.ok) {
          console.warn(`[sqlite] ${result.reason} for ${result.file}; skipping.`);
          processedFiles += 1;
          logBundleProgress(result.file, processedFiles === totalFiles);
          continue;
        }
        insertBundle(result.bundle, result.file);
        count += result.bundle.chunks.length;
        processedFiles += 1;
        logBundleProgress(result.file, processedFiles === totalFiles);
      }
    }
  } finally {
    if (pool) {
      await pool.destroy();
    }
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
      return { count };
    } finally {
      restoreBuildPragmas(db);
      db.close();
      if (!succeeded) {
        try {
          fsSync.rmSync(outPath, { force: true });
        } catch {}
      }
    }
  }

/**
 * Read the SQLite schema version.
 * @param {import('better-sqlite3').Database} db
 * @returns {number|null}
 */
function getSchemaVersion(db) {
  try {
    const value = db.pragma('user_version', { simple: true });
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Validate a SQLite index after build/update.
 * @param {import('better-sqlite3').Database} db
 * @param {'code'|'prose'} mode
 * @param {{validateMode?:string,expected?:{chunks?:number,dense?:number,minhash?:number},emitOutput?:boolean}} options
 */
function validateSqliteDatabase(db, mode, options = {}) {
  const validateMode = options.validateMode || 'off';
  if (validateMode === 'off') return;

  const errors = [];
  if (!hasRequiredTables(db, REQUIRED_TABLES)) {
    errors.push('missing required tables');
  }

  const pragmaName = validateMode === 'full' ? 'integrity_check' : 'quick_check';
  try {
    const rows = db.prepare(`PRAGMA ${pragmaName}`).all();
    const messages = [];
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (value !== 'ok') messages.push(value);
      }
    }
    if (messages.length) {
      errors.push(`${pragmaName} failed: ${messages.join('; ')}`);
    }
  } catch (err) {
    errors.push(`${pragmaName} failed: ${err?.message || err}`);
  }

  const expected = options.expected || {};
  const expectedChunks = Number.isFinite(expected.chunks) ? expected.chunks : null;
  if (expectedChunks !== null) {
    const chunkCount = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get(mode)?.total ?? 0;
    if (chunkCount !== expectedChunks) {
      errors.push(`chunks=${chunkCount} expected=${expectedChunks}`);
    }
    const ftsCount = db.prepare('SELECT COUNT(*) AS total FROM chunks_fts WHERE mode = ?').get(mode)?.total ?? 0;
    if (ftsCount !== expectedChunks) {
      errors.push(`chunks_fts=${ftsCount} expected=${expectedChunks}`);
    }
    const lengthCount = db.prepare('SELECT COUNT(*) AS total FROM doc_lengths WHERE mode = ?').get(mode)?.total ?? 0;
    if (lengthCount !== expectedChunks) {
      errors.push(`doc_lengths=${lengthCount} expected=${expectedChunks}`);
    }
  }

  const expectedDense = Number.isFinite(expected.dense) ? expected.dense : null;
  if (expectedDense !== null) {
    const denseCount = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors WHERE mode = ?').get(mode)?.total ?? 0;
    if (denseCount !== expectedDense) {
      errors.push(`dense_vectors=${denseCount} expected=${expectedDense}`);
    }
  }

  const expectedMinhash = Number.isFinite(expected.minhash) ? expected.minhash : null;
  if (expectedMinhash !== null) {
    const minhashCount = db.prepare('SELECT COUNT(*) AS total FROM minhash_signatures WHERE mode = ?').get(mode)?.total ?? 0;
    if (minhashCount !== expectedMinhash) {
      errors.push(`minhash_signatures=${minhashCount} expected=${expectedMinhash}`);
    }
  }

  if (errors.length) {
    throw new Error(`[sqlite] Validation (${validateMode}) failed for ${mode}: ${errors.join(', ')}`);
  }
  if (options.emitOutput) {
    console.log(`[sqlite] Validation (${validateMode}) ok for ${mode}.`);
  }
}

/**
 * Load file manifest entries from SQLite.
 * @param {import('better-sqlite3').Database} db
 * @param {'code'|'prose'} mode
 * @returns {object}
 */
function getFileManifest(db, mode) {
  const rows = db.prepare('SELECT file, hash, mtimeMs, size FROM file_manifest WHERE mode = ?').all(mode);
  const map = new Map();
  for (const row of rows) {
    map.set(normalizeFilePath(row.file), row);
  }
  return map;
}

/**
 * Check if a manifest entry matches the DB entry.
 * @param {object} entry
 * @param {object} dbEntry
 * @returns {boolean}
 */
function isManifestMatch(entry, dbEntry) {
  if (!dbEntry) return false;
  if (entry?.hash && dbEntry.hash) return entry.hash === dbEntry.hash;
  const mtimeMatch = Number.isFinite(entry?.mtimeMs) && Number.isFinite(dbEntry.mtimeMs)
    ? entry.mtimeMs === dbEntry.mtimeMs
    : false;
  const sizeMatch = Number.isFinite(entry?.size) && Number.isFinite(dbEntry.size)
    ? entry.size === dbEntry.size
    : false;
  return mtimeMatch && sizeMatch;
}

/**
 * Normalize manifest entries for consistent lookups.
 * @param {object} manifestFiles
 * @returns {{entries:Array<{file:string,normalized:string,entry:object}>,map:Map<string,{file:string,normalized:string,entry:object}>,conflicts:string[]}}
 */
function normalizeManifestFiles(manifestFiles) {
  const entries = [];
  const map = new Map();
  const conflicts = [];
  for (const [file, entry] of Object.entries(manifestFiles || {})) {
    const normalized = normalizeFilePath(file);
    const record = { file, normalized, entry };
    const existing = map.get(normalized);
    if (!existing) {
      map.set(normalized, record);
      continue;
    }
    if (isManifestMatch(entry, existing.entry)) {
      if (!existing.entry?.hash && entry?.hash) {
        map.set(normalized, record);
      }
      continue;
    }
    const score = (candidate) => (candidate?.hash ? 3 : 0)
      + (Number.isFinite(candidate?.mtimeMs) ? 1 : 0)
      + (Number.isFinite(candidate?.size) ? 1 : 0);
    if (score(entry) > score(existing.entry)) {
      map.set(normalized, record);
    }
    conflicts.push(normalized);
  }
  entries.push(...map.values());
  return { entries, map, conflicts };
}

/**
 * Diff file manifests into added/changed/deleted sets.
 * @param {Array<{file:string,normalized:string,entry:object}>} manifestEntries
 * @param {object} dbFiles
 * @returns {{changed:Array<{file:string,normalized:string,entry:object}>,deleted:string[]}}
 */
function diffFileManifests(manifestEntries, dbFiles) {
  const changed = [];
  const deleted = [];
  const manifestSet = new Set();

  for (const record of manifestEntries || []) {
    if (!record?.normalized) continue;
    manifestSet.add(record.normalized);
    const dbEntry = dbFiles.get(record.normalized);
    if (!isManifestMatch(record.entry, dbEntry)) {
      changed.push(record);
    }
  }

  for (const [file] of dbFiles.entries()) {
    if (!manifestSet.has(file)) deleted.push(file);
  }

  return { changed, deleted };
}

/**
 * Fetch vocab rows by value for a given mode/table.
 * @param {import('better-sqlite3').Database} db
 * @param {'code'|'prose'} mode
 * @param {string} table
 * @param {string} idColumn
 * @param {string} valueColumn
 * @param {string[]} values
 * @returns {Array<{id:number,value:string}>}
 */
function getVocabCount(db, mode, table) {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE mode = ?`).get(mode) || {};
  return Number.isFinite(row.total) ? row.total : 0;
}

function fetchVocabRows(db, mode, table, idColumn, valueColumn, values) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (!unique.length) return [];
  const rows = [];
  for (const chunk of chunkArray(unique)) {
    const placeholders = chunk.map(() => '?').join(',');
    const stmt = db.prepare(
      `SELECT ${idColumn} AS id, ${valueColumn} AS value FROM ${table} WHERE mode = ? AND ${valueColumn} IN (${placeholders})`
    );
    rows.push(...stmt.all(mode, ...chunk));
  }
  return rows;
}

/**
 * Ensure vocab ids exist for a list of values.
 * @param {import('better-sqlite3').Database} db
 * @param {'code'|'prose'} mode
 * @param {string} table
 * @param {string} idColumn
 * @param {string} valueColumn
 * @param {string[]} values
 * @param {import('better-sqlite3').Statement} insertStmt
 * @returns {Map<string,number>}
 */
function ensureVocabIds(db, mode, table, idColumn, valueColumn, values, insertStmt, options = {}) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  const totalBefore = getVocabCount(db, mode, table);
  if (!unique.length) {
    return { map: new Map(), inserted: 0, total: totalBefore, skip: false };
  }
  const existing = fetchVocabRows(db, mode, table, idColumn, valueColumn, unique);
  const map = new Map(existing.map((row) => [row.value, row.id]));
  const missing = unique.filter((value) => !map.has(value));
  if (!missing.length) {
    return { map, inserted: 0, total: totalBefore, skip: false };
  }

  const limits = options?.limits || null;
  if (limits && totalBefore > 0) {
    const ratio = missing.length / totalBefore;
    const ratioLimit = Number.isFinite(limits.ratio) ? limits.ratio : null;
    const absLimit = Number.isFinite(limits.absolute) ? limits.absolute : null;
    if ((ratioLimit !== null && ratio > ratioLimit) || (absLimit !== null && missing.length > absLimit)) {
      return {
        map,
        inserted: 0,
        total: totalBefore,
        skip: true,
        reason: `${table} growth ${missing.length}/${totalBefore}`
      };
    }
  }

  missing.sort();
  const maxRow = db.prepare(`SELECT MAX(${idColumn}) AS maxId FROM ${table} WHERE mode = ?`).get(mode);
  let nextId = Number.isFinite(maxRow?.maxId) ? maxRow.maxId + 1 : 0;
  const insertTx = db.transaction(() => {
    for (const value of missing) {
      insertStmt.run(mode, nextId, value);
      map.set(value, nextId);
      nextId += 1;
    }
  });
  insertTx();

  return { map, inserted: missing.length, total: totalBefore + missing.length, skip: false };
}

/**
 * Delete doc ids from all tables for a mode.
 * @param {import('better-sqlite3').Database} db
 * @param {'code'|'prose'} mode
 * @param {number[]} docIds
 * @param {Array<{table:string,column:string,withMode:boolean,transform?:(value:any)=>any}>} [extraTables]
 */
function deleteDocIds(db, mode, docIds, extraTables = []) {
  if (!docIds.length) return;
  const deleteTargets = [
    { table: 'chunks', column: 'id' },
    { table: 'chunks_fts', column: 'rowid' },
    { table: 'token_postings', column: 'doc_id' },
    { table: 'phrase_postings', column: 'doc_id' },
    { table: 'chargram_postings', column: 'doc_id' },
    { table: 'minhash_signatures', column: 'doc_id' },
    { table: 'dense_vectors', column: 'doc_id' },
    { table: 'doc_lengths', column: 'doc_id' }
  ];
  for (const extra of extraTables) {
    if (extra?.table && extra?.column) deleteTargets.push(extra);
  }
  for (const chunk of chunkArray(docIds)) {
    const placeholders = chunk.map(() => '?').join(',');
    for (const target of deleteTargets) {
      const withMode = target.withMode !== false;
      const values = target.transform ? chunk.map(target.transform) : chunk;
      const where = withMode
        ? `mode = ? AND ${target.column} IN (${placeholders})`
        : `${target.column} IN (${placeholders})`;
      const stmt = db.prepare(
        `DELETE FROM ${target.table} WHERE ${where}`
      );
      if (withMode) {
        stmt.run(mode, ...values);
      } else {
        stmt.run(...values);
      }
    }
  }
}

/**
 * Recompute and update token stats for a mode.
 * @param {import('better-sqlite3').Database} db
 * @param {'code'|'prose'} mode
 * @param {import('better-sqlite3').Statement} insertTokenStats
 */
function updateTokenStats(db, mode, insertTokenStats) {
  const row = db.prepare(
    'SELECT COUNT(*) AS total_docs, AVG(len) AS avg_doc_len FROM doc_lengths WHERE mode = ?'
  ).get(mode) || {};
  insertTokenStats.run(
    mode,
    typeof row.avg_doc_len === 'number' ? row.avg_doc_len : 0,
    typeof row.total_docs === 'number' ? row.total_docs : 0
  );
}

/**
 * Apply incremental updates to a SQLite index using cached bundles.
 * @param {string} outPath
 * @param {'code'|'prose'} mode
 * @param {object|null} incrementalData
 * @param {{expectedDense?:{model?:string|null,dims?:number|null}}} [options]
 * @returns {{used:boolean,reason?:string,changedFiles?:number,deletedFiles?:number,insertedChunks?:number}}
 */
function incrementalUpdateDatabase(outPath, mode, incrementalData, options = {}) {
  if (!incrementalData?.manifest) {
    return { used: false, reason: 'missing incremental manifest' };
  }
  if (!fsSync.existsSync(outPath)) {
    return { used: false, reason: 'sqlite db missing' };
  }

  const expectedDense = options.expectedDense || null;
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
    const chunkRow = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get(mode) || {};
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
    const bundle = readJson(bundlePath);
    if (!bundle || !Array.isArray(bundle.chunks)) {
      db.close();
      return { used: false, reason: `invalid bundle for ${fileKey}` };
    }
    bundles.set(normalizedFile, { bundle, entry, fileKey, normalizedFile });
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

  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO chunks (
      id, mode, file, start, end, startLine, endLine, ext, kind, name, headline,
      preContext, postContext, weight, tokens, ngrams, codeRelations, docmeta,
      stats, complexity, lint, externalDocs, last_modified, last_author, churn,
      chunk_authors
    ) VALUES (
      @id, @mode, @file, @start, @end, @startLine, @endLine, @ext, @kind, @name, @headline,
      @preContext, @postContext, @weight, @tokens, @ngrams, @codeRelations, @docmeta,
      @stats, @complexity, @lint, @externalDocs, @last_modified, @last_author, @churn,
      @chunk_authors
    );
  `);

  const insertFts = db.prepare(`
    INSERT OR REPLACE INTO chunks_fts (rowid, mode, file, name, signature, kind, headline, doc, tokens)
    VALUES (@id, @mode, @file, @name, @signature, @kind, @headline, @doc, @tokensText);
  `);

  const insertTokenVocab = db.prepare(
    'INSERT OR REPLACE INTO token_vocab (mode, token_id, token) VALUES (?, ?, ?)'
  );
  const insertTokenPosting = db.prepare(
    'INSERT OR REPLACE INTO token_postings (mode, token_id, doc_id, tf) VALUES (?, ?, ?, ?)'
  );
  const insertDocLength = db.prepare(
    'INSERT OR REPLACE INTO doc_lengths (mode, doc_id, len) VALUES (?, ?, ?)'
  );
  const insertTokenStats = db.prepare(
    'INSERT OR REPLACE INTO token_stats (mode, avg_doc_len, total_docs) VALUES (?, ?, ?)'
  );
  const insertPhraseVocab = db.prepare(
    'INSERT OR REPLACE INTO phrase_vocab (mode, phrase_id, ngram) VALUES (?, ?, ?)'
  );
  const insertPhrasePosting = db.prepare(
    'INSERT OR REPLACE INTO phrase_postings (mode, phrase_id, doc_id) VALUES (?, ?, ?)'
  );
  const insertChargramVocab = db.prepare(
    'INSERT OR REPLACE INTO chargram_vocab (mode, gram_id, gram) VALUES (?, ?, ?)'
  );
  const insertChargramPosting = db.prepare(
    'INSERT OR REPLACE INTO chargram_postings (mode, gram_id, doc_id) VALUES (?, ?, ?)'
  );
  const insertMinhash = db.prepare(
    'INSERT OR REPLACE INTO minhash_signatures (mode, doc_id, sig) VALUES (?, ?, ?)'
  );
  const insertDense = db.prepare(
    'INSERT OR REPLACE INTO dense_vectors (mode, doc_id, vector) VALUES (?, ?, ?)'
  );
  const insertDenseMeta = db.prepare(
    'INSERT OR REPLACE INTO dense_meta (mode, dims, scale, model) VALUES (?, ?, ?, ?)'
  );
  const insertFileManifest = db.prepare(
    'INSERT OR REPLACE INTO file_manifest (mode, file, hash, mtimeMs, size, chunk_count) VALUES (?, ?, ?, ?, ?, ?)'
  );

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
    db.close();
    return { used: false, reason: tokenVocab.reason || 'token vocab growth too large' };
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
    db.close();
    return { used: false, reason: phraseVocab.reason || 'phrase vocab growth too large' };
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
    db.close();
    return { used: false, reason: chargramVocab.reason || 'chargram vocab growth too large' };
  }

  const tokenIdMap = tokenVocab.map;
  const phraseIdMap = phraseVocab.map;
  const chargramIdMap = chargramVocab.map;

  const existingIdsByFile = new Map();
  const freeDocIds = [];
  const loadDocIds = (file) => {
    const normalizedFile = normalizeFilePath(file);
    const docRows = db.prepare('SELECT id FROM chunks WHERE mode = ? AND file = ? ORDER BY id').all(mode, normalizedFile);
    const ids = docRows.map((row) => row.id).filter((id) => Number.isFinite(id));
    existingIdsByFile.set(normalizedFile, { normalizedFile, ids });
    return ids;
  };
  for (const file of deleted) {
    const ids = loadDocIds(file);
    if (ids.length) freeDocIds.push(...ids);
  }
  for (const record of changed) {
    loadDocIds(record.normalized);
  }

  const maxRow = db.prepare('SELECT MAX(id) AS maxId FROM chunks WHERE mode = ?').get(mode);
  let nextDocId = Number.isFinite(maxRow?.maxId) ? maxRow.maxId + 1 : 0;
  const denseMetaRow = dbDenseMeta;
  let denseMetaSet = !!denseMetaRow;
  let denseDims = typeof denseMetaRow?.dims === 'number' ? denseMetaRow.dims : null;
  let denseWarned = false;
  let insertedChunks = 0;
  let vectorAnnLoaded = false;
  let vectorAnnReady = false;
  let vectorAnnTable = vectorExtension.table || 'dense_vectors_ann';
  let vectorAnnColumn = vectorExtension.column || 'embedding';
  let insertVectorAnn = null;
  if (vectorAnnEnabled) {
    const loadResult = loadVectorExtension(db, vectorExtension, `sqlite ${mode}`);
    if (loadResult.ok) {
      vectorAnnLoaded = true;
      if (hasVectorTable(db, vectorAnnTable)) {
        vectorAnnReady = true;
      } else if (denseDims) {
        const created = ensureVectorTable(db, vectorExtension, denseDims);
        if (created.ok) {
          vectorAnnReady = true;
          vectorAnnTable = created.tableName;
          vectorAnnColumn = created.column;
        } else {
          console.warn(`[sqlite] Failed to create vector table for ${mode}: ${created.reason}`);
        }
      }
      if (vectorAnnReady) {
        insertVectorAnn = db.prepare(
          `INSERT OR REPLACE INTO ${vectorAnnTable} (rowid, ${vectorAnnColumn}) VALUES (?, ?)`
        );
      }
    } else {
      console.warn(`[sqlite] Vector extension unavailable for ${mode}: ${loadResult.reason}`);
    }
  }
  const vectorDeleteTargets = vectorAnnLoaded && vectorAnnReady
    ? [{ table: vectorAnnTable, column: 'rowid', withMode: false, transform: toVectorId }]
    : [];

  const applyChanges = db.transaction(() => {
    for (const file of deleted) {
      const normalizedFile = normalizeFilePath(file);
      const entry = existingIdsByFile.get(normalizedFile);
      const docIds = entry?.ids || [];
      deleteDocIds(db, mode, docIds, vectorDeleteTargets);
      db.prepare('DELETE FROM file_manifest WHERE mode = ? AND file = ?').run(mode, normalizedFile);
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
              const created = ensureVectorTable(db, vectorExtension, dims);
              if (created.ok) {
                vectorAnnReady = true;
                vectorAnnTable = created.tableName;
                vectorAnnColumn = created.column;
                insertVectorAnn = db.prepare(
                  `INSERT OR REPLACE INTO ${vectorAnnTable} (rowid, ${vectorAnnColumn}) VALUES (?, ?)`
                );
              }
            }
            if (vectorAnnReady && insertVectorAnn) {
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
  });

  applyChanges();
  validateSqliteDatabase(db, mode, { validateMode, emitOutput });
  db.close();
  return {
    used: true,
    changedFiles: changed.length,
    deletedFiles: deleted.length,
    insertedChunks
  };
}

/**
 * Build or incrementally update an index for a mode.
 * @param {'code'|'prose'} mode
 * @param {object|null} index
 * @param {string} targetPath
 * @param {object|null} incrementalData
 * @returns {{count?:number,incremental:boolean,changedFiles?:number,deletedFiles?:number,insertedChunks?:number}}
 */
async function runMode(mode, index, indexDir, targetPath, incrementalData) {
  const hasBundles = incrementalData?.manifest?.files
    ? Object.keys(incrementalData.manifest.files).length > 0
    : false;

  if (incrementalRequested) {
    const expectedDense = index?.denseVec
      ? { model: index.denseVec.model, dims: index.denseVec.dims }
      : null;
    const result = incrementalUpdateDatabase(targetPath, mode, incrementalData, {
      expectedDense
    });
    if (result.used) {
      if (compactOnIncremental && (result.changedFiles || result.deletedFiles)) {
        console.log(`[sqlite] Compaction requested for ${mode} index...`);
        await compactDatabase({
          dbPath: targetPath,
          mode,
          vectorExtension,
          dryRun: false,
          keepBackup: false
        });
      }
      return { ...result, incremental: true };
    }
    if (result.reason) {
      console.warn(`[sqlite] Incremental ${mode} update skipped (${result.reason}); rebuilding full index.`);
    }
  }
  if (hasBundles) {
    console.log(`[sqlite] Using incremental bundles for ${mode} full rebuild.`);
    const tempPath = createTempPath(targetPath);
    let bundleResult = { count: 0 };
    try {
      bundleResult = await buildDatabaseFromBundles(tempPath, mode, incrementalData);
      if (bundleResult.count) {
        await replaceFile(tempPath, targetPath);
      } else {
        await fs.rm(tempPath, { force: true });
      }
    } catch (err) {
      try { await fs.rm(tempPath, { force: true }); } catch {}
      throw err;
    }
    if (bundleResult.count) {
      return { count: bundleResult.count, incremental: false, changedFiles: null, deletedFiles: null, insertedChunks: bundleResult.count };
    }
    if (bundleResult.reason) {
      console.warn(`[sqlite] Bundle build skipped (${bundleResult.reason}); falling back to file-backed artifacts.`);
    }
  }
  const tempPath = createTempPath(targetPath);
  let count = 0;
  try {
    count = await buildDatabase(tempPath, index, indexDir, mode, incrementalData?.manifest?.files);
    await replaceFile(tempPath, targetPath);
  } catch (err) {
    try { await fs.rm(tempPath, { force: true }); } catch {}
    throw err;
  }
  return { count, incremental: false, changedFiles: null, deletedFiles: null, insertedChunks: count };
}

const results = {};
if (modeArg === 'all' || modeArg === 'code') {
  const targetPath = modeArg === 'all' ? codeOutPath : outPath;
  const codeInput = codeIndex || codePieces;
  results.code = await runMode('code', codeInput, codeDir, targetPath, incrementalCode);
}
if (modeArg === 'all' || modeArg === 'prose') {
  const targetPath = modeArg === 'all' ? proseOutPath : outPath;
  const proseInput = proseIndex || prosePieces;
  results.prose = await runMode('prose', proseInput, proseDir, targetPath, incrementalProse);
}

if (modeArg === 'all') {
  const codeResult = results.code || {};
  const proseResult = results.prose || {};
  if (codeResult.incremental || proseResult.incremental) {
    console.log(`SQLite indexes updated at code=${codeOutPath} prose=${proseOutPath}. code+${codeResult.insertedChunks || 0} prose+${proseResult.insertedChunks || 0}`);
  } else {
    console.log(`SQLite indexes built at code=${codeOutPath} prose=${proseOutPath}. code=${codeResult.count || 0} prose=${proseResult.count || 0}`);
  }
} else {
  const result = modeArg === 'code' ? results.code : results.prose;
  if (result?.incremental) {
    console.log(`SQLite ${modeArg} index updated at ${outPath}. +${result.insertedChunks || 0} chunks`);
  } else {
    console.log(`SQLite ${modeArg} index built at ${outPath}. ${modeArg}=${result?.count || 0}`);
  }
}

return {
  mode: modeArg,
  results,
  paths: {
    code: codeOutPath,
    prose: proseOutPath,
    out: outPath
  }
};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBuildSqliteIndex().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
