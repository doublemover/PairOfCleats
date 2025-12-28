#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import { getIndexDir, getModelConfig, getRepoCacheRoot, loadUserConfig, resolveSqlitePaths } from './dict-utils.js';
import { encodeVector, ensureVectorTable, getVectorExtensionConfig, hasVectorTable, loadVectorExtension } from './vector-extension.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required. Run npm install first.');
  process.exit(1);
}

const argv = minimist(process.argv.slice(2), {
  string: ['code-dir', 'prose-dir', 'out', 'mode'],
  boolean: ['incremental'],
  default: { mode: 'all', incremental: false }
});

const root = process.cwd();
const userConfig = loadUserConfig(root);
const modelConfig = getModelConfig(root, userConfig);
const vectorExtension = getVectorExtensionConfig(root, userConfig);
const vectorAnnEnabled = vectorExtension.enabled;
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const codeDir = argv['code-dir'] ? path.resolve(argv['code-dir']) : getIndexDir(root, 'code', userConfig);
const proseDir = argv['prose-dir'] ? path.resolve(argv['prose-dir']) : getIndexDir(root, 'prose', userConfig);
const sqlitePaths = resolveSqlitePaths(root, userConfig);
const incrementalRequested = argv.incremental === true;

const modeArg = (argv.mode || 'all').toLowerCase();
if (!['all', 'code', 'prose'].includes(modeArg)) {
  console.error('Invalid mode. Use --mode all|code|prose');
  process.exit(1);
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

const SCHEMA_VERSION = 4;
const SQLITE_IN_LIMIT = 900;
const REQUIRED_TABLES = [
  'chunks',
  'chunks_fts',
  'token_vocab',
  'token_postings',
  'doc_lengths',
  'token_stats',
  'phrase_vocab',
  'phrase_postings',
  'chargram_vocab',
  'chargram_postings',
  'minhash_signatures',
  'dense_vectors',
  'dense_meta',
  'file_manifest'
];

function quantizeVec(vec, minVal = -1, maxVal = 1, levels = 256) {
  if (!Array.isArray(vec)) return [];
  return vec.map((val) =>
    Math.max(0, Math.min(levels - 1, Math.round(((val - minVal) / (maxVal - minVal)) * (levels - 1))))
  );
}

function dequantizeUint8ToFloat32(vec, minVal = -1, maxVal = 1, levels = 256) {
  if (!vec || typeof vec.length !== 'number') return null;
  const scale = (maxVal - minVal) / (levels - 1);
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] * scale + minVal;
  }
  return out;
}

function toVectorId(value) {
  try {
    return BigInt(value);
  } catch {
    return value;
  }
}

function packUint32(values) {
  const arr = Uint32Array.from(values || []);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function packUint8(values) {
  const arr = Uint8Array.from(values || []);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function chunkArray(items, size = SQLITE_IN_LIMIT) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getTableNames(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  return new Set(rows.map((row) => row.name));
}

function hasRequiredTables(db) {
  const tableNames = getTableNames(db);
  return REQUIRED_TABLES.every((name) => tableNames.has(name));
}

function getIncrementalPaths(mode) {
  const incrementalDir = path.join(repoCacheRoot, 'incremental', mode);
  return {
    incrementalDir,
    bundleDir: path.join(incrementalDir, 'files'),
    manifestPath: path.join(incrementalDir, 'manifest.json')
  };
}

function loadIncrementalManifest(mode) {
  const paths = getIncrementalPaths(mode);
  if (!fsSync.existsSync(paths.manifestPath)) return null;
  try {
    const manifest = JSON.parse(fsSync.readFileSync(paths.manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object') return null;
    return { manifest, ...paths };
  } catch {
    return null;
  }
}

function buildChunkRow(chunk, mode, id) {
  const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
  return {
    id,
    mode,
    file: normalizeFilePath(chunk.file),
    start: chunk.start,
    end: chunk.end,
    startLine: chunk.startLine || null,
    endLine: chunk.endLine || null,
    ext: chunk.ext || null,
    kind: chunk.kind || null,
    name: chunk.name || null,
    headline: chunk.headline || null,
    preContext: chunk.preContext ? JSON.stringify(chunk.preContext) : null,
    postContext: chunk.postContext ? JSON.stringify(chunk.postContext) : null,
    weight: typeof chunk.weight === 'number' ? chunk.weight : 1,
    tokens: tokensArray.length ? JSON.stringify(tokensArray) : null,
    tokensText: tokensArray.join(' '),
    ngrams: chunk.ngrams ? JSON.stringify(chunk.ngrams) : null,
    codeRelations: chunk.codeRelations ? JSON.stringify(chunk.codeRelations) : null,
    docmeta: chunk.docmeta ? JSON.stringify(chunk.docmeta) : null,
    stats: chunk.stats ? JSON.stringify(chunk.stats) : null,
    complexity: chunk.complexity ? JSON.stringify(chunk.complexity) : null,
    lint: chunk.lint ? JSON.stringify(chunk.lint) : null,
    externalDocs: chunk.externalDocs ? JSON.stringify(chunk.externalDocs) : null,
    last_modified: chunk.last_modified || null,
    last_author: chunk.last_author || null,
    churn: typeof chunk.churn === 'number' ? chunk.churn : null,
    chunk_authors: chunk.chunk_authors ? JSON.stringify(chunk.chunk_authors) : null
  };
}

function buildTokenFrequency(tokensArray) {
  const freq = new Map();
  for (const token of tokensArray) {
    if (!token) continue;
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return freq;
}

function normalizeFilePath(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
}

function loadOptional(dir, name) {
  const target = path.join(dir, name);
  if (!fsSync.existsSync(target)) return null;
  return readJson(target);
}

function loadIndex(dir) {
  const chunkMetaPath = path.join(dir, 'chunk_meta.json');
  if (!fsSync.existsSync(chunkMetaPath)) return null;
  const chunkMeta = readJson(chunkMetaPath);
  const denseVec = loadOptional(dir, 'dense_vectors_uint8.json');
  if (denseVec && !denseVec.model) denseVec.model = modelConfig.id || null;
  return {
    chunkMeta,
    denseVec,
    phraseNgrams: loadOptional(dir, 'phrase_ngrams.json'),
    chargrams: loadOptional(dir, 'chargram_postings.json'),
    minhash: loadOptional(dir, 'minhash_signatures.json'),
    tokenPostings: loadOptional(dir, 'token_postings.json')
  };
}

function prepareVectorAnnTable(db, indexData, mode) {
  if (!vectorAnnEnabled) return null;
  const dense = indexData?.denseVec;
  const dims = dense?.dims || dense?.vectors?.find((vec) => vec && vec.length)?.length || 0;
  if (!Number.isFinite(dims) || dims <= 0) return null;
  const loadResult = loadVectorExtension(db, vectorExtension, `sqlite ${mode}`);
  if (!loadResult.ok) {
    console.warn(`[sqlite] Vector extension unavailable for ${mode}: ${loadResult.reason}`);
    return null;
  }
  if (vectorExtension.table) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${vectorExtension.table}`);
    } catch {}
  }
  const created = ensureVectorTable(db, vectorExtension, dims);
  if (!created.ok) {
    console.warn(`[sqlite] Failed to create vector table for ${mode}: ${created.reason}`);
    return null;
  }
  const insertSql = `INSERT OR REPLACE INTO ${created.tableName} (rowid, ${created.column}) VALUES (?, ?)`;
  return {
    tableName: created.tableName,
    column: created.column,
    insert: db.prepare(insertSql)
  };
}

const codeIndex = loadIndex(codeDir);
const proseIndex = loadIndex(proseDir);
const incrementalCode = loadIncrementalManifest('code');
const incrementalProse = loadIncrementalManifest('prose');
if (!codeIndex && !proseIndex) {
  console.error('No index found. Build index-code/index-prose first.');
  process.exit(1);
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
if (modeArg === 'code' && !codeIndex && !canIncrementalCode) {
  console.error('Code index missing; build index-code first.');
  process.exit(1);
}
if (modeArg === 'prose' && !proseIndex && !canIncrementalProse) {
  console.error('Prose index missing; build index-prose first.');
  process.exit(1);
}

const createTables = `
  DROP TABLE IF EXISTS chunks_fts;
  DROP TABLE IF EXISTS chunks;
  DROP TABLE IF EXISTS token_postings;
  DROP TABLE IF EXISTS token_vocab;
  DROP TABLE IF EXISTS doc_lengths;
  DROP TABLE IF EXISTS token_stats;
  DROP TABLE IF EXISTS phrase_postings;
  DROP TABLE IF EXISTS phrase_vocab;
  DROP TABLE IF EXISTS chargram_postings;
  DROP TABLE IF EXISTS chargram_vocab;
  DROP TABLE IF EXISTS minhash_signatures;
  DROP TABLE IF EXISTS dense_vectors;
  DROP TABLE IF EXISTS dense_meta;
  DROP TABLE IF EXISTS file_manifest;

  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    mode TEXT,
    file TEXT,
    start INTEGER,
    end INTEGER,
    startLine INTEGER,
    endLine INTEGER,
    ext TEXT,
    kind TEXT,
    name TEXT,
    headline TEXT,
    preContext TEXT,
    postContext TEXT,
    weight REAL,
    tokens TEXT,
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
    chunk_authors TEXT
  );
  CREATE INDEX idx_chunks_file ON chunks (mode, file);
  CREATE VIRTUAL TABLE chunks_fts USING fts5(
    mode UNINDEXED,
    file,
    name,
    kind,
    headline,
    tokens,
    tokenize = 'unicode61'
  );
  CREATE TABLE token_vocab (
    mode TEXT NOT NULL,
    token_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    PRIMARY KEY (mode, token_id),
    UNIQUE (mode, token)
  );
  CREATE TABLE token_postings (
    mode TEXT NOT NULL,
    token_id INTEGER NOT NULL,
    doc_id INTEGER NOT NULL,
    tf INTEGER NOT NULL,
    PRIMARY KEY (mode, token_id, doc_id)
  );
  CREATE INDEX idx_token_postings_token ON token_postings (mode, token_id);
  CREATE TABLE doc_lengths (
    mode TEXT NOT NULL,
    doc_id INTEGER NOT NULL,
    len INTEGER NOT NULL,
    PRIMARY KEY (mode, doc_id)
  );
  CREATE TABLE token_stats (
    mode TEXT PRIMARY KEY,
    avg_doc_len REAL,
    total_docs INTEGER
  );
  CREATE TABLE phrase_vocab (
    mode TEXT NOT NULL,
    phrase_id INTEGER NOT NULL,
    ngram TEXT NOT NULL,
    PRIMARY KEY (mode, phrase_id),
    UNIQUE (mode, ngram)
  );
  CREATE TABLE phrase_postings (
    mode TEXT NOT NULL,
    phrase_id INTEGER NOT NULL,
    doc_id INTEGER NOT NULL,
    PRIMARY KEY (mode, phrase_id, doc_id)
  );
  CREATE INDEX idx_phrase_postings_phrase ON phrase_postings (mode, phrase_id);
  CREATE TABLE chargram_vocab (
    mode TEXT NOT NULL,
    gram_id INTEGER NOT NULL,
    gram TEXT NOT NULL,
    PRIMARY KEY (mode, gram_id),
    UNIQUE (mode, gram)
  );
  CREATE TABLE chargram_postings (
    mode TEXT NOT NULL,
    gram_id INTEGER NOT NULL,
    doc_id INTEGER NOT NULL,
    PRIMARY KEY (mode, gram_id, doc_id)
  );
  CREATE INDEX idx_chargram_postings_gram ON chargram_postings (mode, gram_id);
  CREATE TABLE minhash_signatures (
    mode TEXT NOT NULL,
    doc_id INTEGER NOT NULL,
    sig BLOB NOT NULL,
    PRIMARY KEY (mode, doc_id)
  );
  CREATE TABLE dense_vectors (
    mode TEXT NOT NULL,
    doc_id INTEGER NOT NULL,
    vector BLOB NOT NULL,
    PRIMARY KEY (mode, doc_id)
  );
  CREATE TABLE dense_meta (
    mode TEXT PRIMARY KEY,
    dims INTEGER,
    scale REAL,
    model TEXT
  );
  CREATE TABLE file_manifest (
    mode TEXT NOT NULL,
    file TEXT NOT NULL,
    hash TEXT,
    mtimeMs INTEGER,
    size INTEGER,
    chunk_count INTEGER,
    PRIMARY KEY (mode, file)
  );
  CREATE INDEX idx_file_manifest_mode_file ON file_manifest (mode, file);
`;

function buildDatabase(outPath, index, mode, manifestFiles) {
  if (!index) return 0;
  const db = new Database(outPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  } catch {}

  db.exec(createTables);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  const vectorAnn = prepareVectorAnnTable(db, index, mode);

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
    INSERT OR REPLACE INTO chunks_fts (rowid, mode, file, name, kind, headline, tokens)
    VALUES (@id, @mode, @file, @name, @kind, @headline, @tokensText);
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

  function ingestMinhash(minhash, targetMode) {
    if (!minhash?.signatures || !minhash.signatures.length) return;
    const insertTx = db.transaction(() => {
      for (let docId = 0; docId < minhash.signatures.length; docId++) {
        const sig = minhash.signatures[docId];
        if (!sig) continue;
        insertMinhash.run(targetMode, docId, packUint32(sig));
      }
    });
    insertTx();
  }

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
        if (vectorAnn?.insert) {
          const floatVec = dequantizeUint8ToFloat32(vec);
          const encoded = encodeVector(floatVec, vectorExtension);
          if (encoded) vectorAnn.insert.run(toVectorId(docId), encoded);
        }
      }
    });
    insertTx();
  }

  function ingestIndex(indexData, targetMode) {
    if (!indexData) return 0;
    const { chunkMeta } = indexData;
    let count = 0;

    const insert = db.transaction((rows) => {
      for (const row of rows) {
        insertChunk.run(row);
        insertFts.run(row);
      }
    });

    const rows = [];
    for (const chunk of chunkMeta) {
      const id = chunk.id;
      const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
      const tokensText = tokensArray.join(' ');
      rows.push({
        id,
        mode: targetMode,
        file: normalizeFilePath(chunk.file),
        start: chunk.start,
        end: chunk.end,
        startLine: chunk.startLine || null,
        endLine: chunk.endLine || null,
        ext: chunk.ext || null,
        kind: chunk.kind || null,
        name: chunk.name || null,
        headline: chunk.headline || null,
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
        externalDocs: chunk.externalDocs ? JSON.stringify(chunk.externalDocs) : null,
        last_modified: chunk.last_modified || null,
        last_author: chunk.last_author || null,
        churn: typeof chunk.churn === 'number' ? chunk.churn : null,
        chunk_authors: chunk.chunk_authors ? JSON.stringify(chunk.chunk_authors) : null
      });
      count++;
    }

    insert(rows);
    ingestTokenIndex(indexData.tokenPostings, targetMode);
    ingestPostingIndex(indexData.phraseNgrams, targetMode, insertPhraseVocab, insertPhrasePosting);
    ingestPostingIndex(indexData.chargrams, targetMode, insertChargramVocab, insertChargramPosting);
    ingestMinhash(indexData.minhash, targetMode);
    ingestDense(indexData.denseVec, targetMode);

    return count;
  }

  function ingestFileManifest(indexData, targetMode) {
    if (!indexData?.chunkMeta) return;
    const fileCounts = new Map();
    for (const chunk of indexData.chunkMeta) {
      if (!chunk?.file) continue;
      const normalizedFile = normalizeFilePath(chunk.file);
      fileCounts.set(normalizedFile, (fileCounts.get(normalizedFile) || 0) + 1);
    }
    const insertTx = db.transaction(() => {
      for (const [file, count] of fileCounts.entries()) {
        const entry = manifestFiles && manifestFiles[file] ? manifestFiles[file] : null;
        insertFileManifest.run(
          targetMode,
          file,
          entry?.hash || null,
          Number.isFinite(entry?.mtimeMs) ? entry.mtimeMs : null,
          Number.isFinite(entry?.size) ? entry.size : null,
          count
        );
      }
    });
    insertTx();
  }

  const count = ingestIndex(index, mode);
  ingestFileManifest(index, mode);
  db.close();
  return count;
}

function getFileManifest(db, mode) {
  const rows = db.prepare('SELECT file, hash, mtimeMs, size FROM file_manifest WHERE mode = ?').all(mode);
  const map = new Map();
  for (const row of rows) {
    map.set(row.file, row);
  }
  return map;
}

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

function diffFileManifests(manifestFiles, dbFiles) {
  const changed = [];
  const deleted = [];
  const manifestKeys = Object.keys(manifestFiles || {});
  const manifestSet = new Set(manifestKeys);

  for (const file of manifestKeys) {
    const entry = manifestFiles[file];
    const dbEntry = dbFiles.get(file);
    if (!isManifestMatch(entry, dbEntry)) {
      changed.push(file);
    }
  }

  for (const [file] of dbFiles.entries()) {
    if (!manifestSet.has(file)) deleted.push(file);
  }

  return { changed, deleted };
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

function ensureVocabIds(db, mode, table, idColumn, valueColumn, values, insertStmt) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (!unique.length) return new Map();
  const existing = fetchVocabRows(db, mode, table, idColumn, valueColumn, unique);
  const map = new Map(existing.map((row) => [row.value, row.id]));
  const missing = unique.filter((value) => !map.has(value));
  if (!missing.length) return map;

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

  return map;
}

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

function incrementalUpdateDatabase(outPath, mode, incrementalData) {
  if (!incrementalData?.manifest) {
    return { used: false, reason: 'missing incremental manifest' };
  }
  if (!fsSync.existsSync(outPath)) {
    return { used: false, reason: 'sqlite db missing' };
  }

  const db = new Database(outPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  } catch {}

  if (!hasRequiredTables(db)) {
    db.close();
    return { used: false, reason: 'schema missing' };
  }

  const manifestFiles = incrementalData.manifest.files || {};
  const dbFiles = getFileManifest(db, mode);
  const { changed, deleted } = diffFileManifests(manifestFiles, dbFiles);
  if (!changed.length && !deleted.length) {
    db.close();
    return { used: true, changedFiles: 0, deletedFiles: 0, insertedChunks: 0 };
  }

  const bundles = new Map();
  for (const file of changed) {
    const entry = manifestFiles[file];
    const bundleName = entry?.bundle;
    if (!bundleName) {
      db.close();
      return { used: false, reason: `missing bundle for ${file}` };
    }
    const bundlePath = path.join(incrementalData.bundleDir, bundleName);
    if (!fsSync.existsSync(bundlePath)) {
      db.close();
      return { used: false, reason: `bundle missing for ${file}` };
    }
    const bundle = readJson(bundlePath);
    if (!bundle || !Array.isArray(bundle.chunks)) {
      db.close();
      return { used: false, reason: `invalid bundle for ${file}` };
    }
    bundles.set(file, bundle);
  }

  const tokenValues = [];
  const phraseValues = [];
  const chargramValues = [];
  for (const bundle of bundles.values()) {
    for (const chunk of bundle.chunks || []) {
      const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
      if (tokensArray.length) tokenValues.push(...tokensArray);
      if (Array.isArray(chunk.ngrams)) phraseValues.push(...chunk.ngrams);
      if (Array.isArray(chunk.chargrams)) chargramValues.push(...chunk.chargrams);
    }
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
    INSERT OR REPLACE INTO chunks_fts (rowid, mode, file, name, kind, headline, tokens)
    VALUES (@id, @mode, @file, @name, @kind, @headline, @tokensText);
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

  const tokenIdMap = ensureVocabIds(db, mode, 'token_vocab', 'token_id', 'token', tokenValues, insertTokenVocab);
  const phraseIdMap = ensureVocabIds(db, mode, 'phrase_vocab', 'phrase_id', 'ngram', phraseValues, insertPhraseVocab);
  const chargramIdMap = ensureVocabIds(db, mode, 'chargram_vocab', 'gram_id', 'gram', chargramValues, insertChargramVocab);

  const maxRow = db.prepare('SELECT MAX(id) AS maxId FROM chunks WHERE mode = ?').get(mode);
  let nextDocId = Number.isFinite(maxRow?.maxId) ? maxRow.maxId + 1 : 0;
  const denseMetaRow = db.prepare('SELECT dims, scale, model FROM dense_meta WHERE mode = ?').get(mode);
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
      const docRows = db.prepare('SELECT id FROM chunks WHERE mode = ? AND file = ?').all(mode, normalizedFile);
      const docIds = docRows.map((row) => row.id);
      deleteDocIds(db, mode, docIds, vectorDeleteTargets);
      db.prepare('DELETE FROM file_manifest WHERE mode = ? AND file = ?').run(mode, normalizedFile);
    }

    for (const file of changed) {
      const normalizedFile = normalizeFilePath(file);
      const docRows = db.prepare('SELECT id FROM chunks WHERE mode = ? AND file = ?').all(mode, normalizedFile);
      const docIds = docRows.map((row) => row.id);
      deleteDocIds(db, mode, docIds, vectorDeleteTargets);

      const bundle = bundles.get(file);
      let chunkCount = 0;
      for (const chunk of bundle.chunks || []) {
        const docId = nextDocId;
        nextDocId += 1;
        const row = buildChunkRow(chunk, mode, docId);
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

      const entry = manifestFiles[file] || {};
      insertFileManifest.run(
        mode,
        normalizedFile,
        entry?.hash || null,
        Number.isFinite(entry?.mtimeMs) ? entry.mtimeMs : null,
        Number.isFinite(entry?.size) ? entry.size : null,
        chunkCount
      );
    }

    updateTokenStats(db, mode, insertTokenStats);
  });

  applyChanges();
  db.close();
  return {
    used: true,
    changedFiles: changed.length,
    deletedFiles: deleted.length,
    insertedChunks
  };
}

function runMode(mode, index, targetPath, incrementalData) {
  if (incrementalRequested) {
    const result = incrementalUpdateDatabase(targetPath, mode, incrementalData);
    if (result.used) return { ...result, incremental: true };
    if (result.reason) {
      console.warn(`[sqlite] Incremental ${mode} update skipped (${result.reason}); rebuilding full index.`);
    }
  }
  const count = buildDatabase(targetPath, index, mode, incrementalData?.manifest?.files);
  return { count, incremental: false, changedFiles: null, deletedFiles: null, insertedChunks: count };
}

const results = {};
if (modeArg === 'all' || modeArg === 'code') {
  const targetPath = modeArg === 'all' ? codeOutPath : outPath;
  results.code = runMode('code', codeIndex, targetPath, incrementalCode);
}
if (modeArg === 'all' || modeArg === 'prose') {
  const targetPath = modeArg === 'all' ? proseOutPath : outPath;
  results.prose = runMode('prose', proseIndex, targetPath, incrementalProse);
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
