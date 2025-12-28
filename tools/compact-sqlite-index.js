#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import minimist from 'minimist';
import { loadUserConfig, resolveSqlitePaths } from './dict-utils.js';
import { encodeVector, ensureVectorTable, getVectorExtensionConfig, hasVectorTable, loadVectorExtension } from './vector-extension.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required. Run npm install first.');
  process.exit(1);
}

const argv = minimist(process.argv.slice(2), {
  string: ['mode'],
  boolean: ['dry-run', 'keep-backup'],
  default: {
    mode: 'all',
    'dry-run': false,
    'keep-backup': false
  }
});

const root = process.cwd();
const userConfig = loadUserConfig(root);
const vectorExtension = getVectorExtensionConfig(root, userConfig);
const vectorAnnEnabled = vectorExtension.enabled;
const sqlitePaths = resolveSqlitePaths(root, userConfig);

const modeArg = (argv.mode || 'all').toLowerCase();
if (!['all', 'code', 'prose'].includes(modeArg)) {
  console.error('Invalid mode. Use --mode all|code|prose');
  process.exit(1);
}

const SCHEMA_VERSION = 4;
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

function normalizeFilePath(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\\/g, '/');
}

function parseTokens(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return trimmed.split(/\s+/).filter(Boolean);
  }
  return [];
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

function hasRequiredTables(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tables = new Set(rows.map((row) => row.name));
  return REQUIRED_TABLES.every((name) => tables.has(name));
}

function buildBackupPath(dbPath, keepBackup) {
  const base = `${dbPath}.bak`;
  if (!keepBackup) return base;
  if (!fs.existsSync(base)) return base;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${dbPath}.bak-${stamp}`;
}

async function compactDatabase(dbPath, mode) {
  if (!fs.existsSync(dbPath)) {
    console.warn(`[compact] ${mode} db missing: ${dbPath}`);
    return { skipped: true };
  }

  const sourceDb = new Database(dbPath, { readonly: true });
  if (!hasRequiredTables(sourceDb)) {
    sourceDb.close();
    console.error(`[compact] ${mode} db missing required tables. Rebuild first.`);
    process.exit(1);
  }

  const tempPath = `${dbPath}.compact`;
  if (fs.existsSync(tempPath)) await fsPromises.rm(tempPath, { force: true });

  const outDb = new Database(tempPath);
  try {
    outDb.pragma('journal_mode = WAL');
    outDb.pragma('synchronous = NORMAL');
  } catch {}
  outDb.exec(createTables);
  outDb.pragma(`user_version = ${SCHEMA_VERSION}`);

  let vectorAnnLoaded = false;
  let vectorAnnReady = false;
  let vectorAnnTable = vectorExtension.table || 'dense_vectors_ann';
  let vectorAnnColumn = vectorExtension.column || 'embedding';
  let insertVectorAnn = null;
  let vectorAnnWarned = false;
  if (vectorAnnEnabled) {
    const loadResult = loadVectorExtension(outDb, vectorExtension, `sqlite ${mode}`);
    if (loadResult.ok) {
      vectorAnnLoaded = true;
      if (hasVectorTable(outDb, vectorAnnTable)) {
        vectorAnnReady = true;
        insertVectorAnn = outDb.prepare(
          `INSERT OR REPLACE INTO ${vectorAnnTable} (rowid, ${vectorAnnColumn}) VALUES (?, ?)`
        );
      }
    } else {
      console.warn(`[compact] Vector extension unavailable for ${mode}: ${loadResult.reason}`);
    }
  }

  const insertChunk = outDb.prepare(`
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

  const insertFts = outDb.prepare(`
    INSERT OR REPLACE INTO chunks_fts (rowid, mode, file, name, kind, headline, tokens)
    VALUES (@id, @mode, @file, @name, @kind, @headline, @tokensText);
  `);

  const insertTokenVocab = outDb.prepare(
    'INSERT OR REPLACE INTO token_vocab (mode, token_id, token) VALUES (?, ?, ?)'
  );
  const insertTokenPosting = outDb.prepare(
    'INSERT OR REPLACE INTO token_postings (mode, token_id, doc_id, tf) VALUES (?, ?, ?, ?)'
  );
  const insertDocLength = outDb.prepare(
    'INSERT OR REPLACE INTO doc_lengths (mode, doc_id, len) VALUES (?, ?, ?)'
  );
  const insertTokenStats = outDb.prepare(
    'INSERT OR REPLACE INTO token_stats (mode, avg_doc_len, total_docs) VALUES (?, ?, ?)'
  );
  const insertPhraseVocab = outDb.prepare(
    'INSERT OR REPLACE INTO phrase_vocab (mode, phrase_id, ngram) VALUES (?, ?, ?)'
  );
  const insertPhrasePosting = outDb.prepare(
    'INSERT OR REPLACE INTO phrase_postings (mode, phrase_id, doc_id) VALUES (?, ?, ?)'
  );
  const insertChargramVocab = outDb.prepare(
    'INSERT OR REPLACE INTO chargram_vocab (mode, gram_id, gram) VALUES (?, ?, ?)'
  );
  const insertChargramPosting = outDb.prepare(
    'INSERT OR REPLACE INTO chargram_postings (mode, gram_id, doc_id) VALUES (?, ?, ?)'
  );
  const insertMinhash = outDb.prepare(
    'INSERT OR REPLACE INTO minhash_signatures (mode, doc_id, sig) VALUES (?, ?, ?)'
  );
  const insertDense = outDb.prepare(
    'INSERT OR REPLACE INTO dense_vectors (mode, doc_id, vector) VALUES (?, ?, ?)'
  );
  const insertDenseMeta = outDb.prepare(
    'INSERT OR REPLACE INTO dense_meta (mode, dims, scale, model) VALUES (?, ?, ?, ?)'
  );
  const insertFileManifest = outDb.prepare(
    'INSERT OR REPLACE INTO file_manifest (mode, file, hash, mtimeMs, size, chunk_count) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const fileManifest = new Map();
  const fileManifestStmt = sourceDb.prepare(
    'SELECT file, hash, mtimeMs, size FROM file_manifest WHERE mode = ?'
  );
  for (const row of fileManifestStmt.iterate(mode)) {
    fileManifest.set(normalizeFilePath(row.file), row);
  }

  const docIdMap = new Map();
  const fileCounts = new Map();
  let nextDocId = 0;

  const chunkStmt = sourceDb.prepare(
    'SELECT * FROM chunks WHERE mode = ? ORDER BY file, start, id'
  );
  const insertChunksTx = outDb.transaction(() => {
    for (const row of chunkStmt.iterate(mode)) {
      const normalizedFile = normalizeFilePath(row.file);
      const newId = nextDocId++;
      const oldId = Number(row.id);
      docIdMap.set(oldId, newId);

      const chunkRow = {
        ...row,
        id: newId,
        mode,
        file: normalizedFile
      };
      insertChunk.run(chunkRow);

      const tokensText = parseTokens(row.tokens).join(' ');
      insertFts.run({
        id: newId,
        mode,
        file: normalizedFile,
        name: row.name,
        kind: row.kind,
        headline: row.headline,
        tokensText
      });

      fileCounts.set(normalizedFile, (fileCounts.get(normalizedFile) || 0) + 1);
    }
  });
  insertChunksTx();

  const denseMeta = sourceDb.prepare('SELECT dims, scale, model FROM dense_meta WHERE mode = ?').get(mode);
  if (denseMeta) {
    insertDenseMeta.run(
      mode,
      denseMeta.dims ?? null,
      denseMeta.scale ?? 1.0,
      denseMeta.model ?? null
    );
  }
  const vectorAnnDims = Number.isFinite(denseMeta?.dims) ? denseMeta.dims : null;
  if (vectorAnnLoaded && !vectorAnnReady && vectorAnnDims) {
    const created = ensureVectorTable(outDb, vectorExtension, denseMeta.dims);
    if (created.ok) {
      vectorAnnReady = true;
      vectorAnnTable = created.tableName;
      vectorAnnColumn = created.column;
      insertVectorAnn = outDb.prepare(
        `INSERT OR REPLACE INTO ${vectorAnnTable} (rowid, ${vectorAnnColumn}) VALUES (?, ?)`
      );
    } else {
      console.warn(`[compact] Failed to create vector table for ${mode}: ${created.reason}`);
    }
  }

  const insertDocLengthsTx = outDb.transaction(() => {
    const stmt = sourceDb.prepare('SELECT doc_id, len FROM doc_lengths WHERE mode = ?');
    for (const row of stmt.iterate(mode)) {
      const newId = docIdMap.get(Number(row.doc_id));
      if (newId === undefined) continue;
      insertDocLength.run(mode, newId, row.len);
    }
  });
  insertDocLengthsTx();

  const insertMinhashTx = outDb.transaction(() => {
    const stmt = sourceDb.prepare('SELECT doc_id, sig FROM minhash_signatures WHERE mode = ?');
    for (const row of stmt.iterate(mode)) {
      const newId = docIdMap.get(Number(row.doc_id));
      if (newId === undefined) continue;
      insertMinhash.run(mode, newId, row.sig);
    }
  });
  insertMinhashTx();

  const insertDenseTx = outDb.transaction(() => {
    const stmt = sourceDb.prepare('SELECT doc_id, vector FROM dense_vectors WHERE mode = ?');
    for (const row of stmt.iterate(mode)) {
      const newId = docIdMap.get(Number(row.doc_id));
      if (newId === undefined) continue;
      insertDense.run(mode, newId, row.vector);
      if (vectorAnnLoaded && !vectorAnnReady && !vectorAnnWarned) {
        console.warn(`[compact] Skipping vector table for ${mode}: missing dense_meta dims.`);
        vectorAnnWarned = true;
      }
      if (vectorAnnReady && insertVectorAnn) {
        const floatVec = dequantizeUint8ToFloat32(row.vector);
        const encoded = encodeVector(floatVec, vectorExtension);
        if (encoded) insertVectorAnn.run(toVectorId(newId), encoded);
      }
    }
  });
  insertDenseTx();

  const tokenIdToValue = new Map();
  const tokenVocabStmt = sourceDb.prepare('SELECT token_id, token FROM token_vocab WHERE mode = ? ORDER BY token_id');
  for (const row of tokenVocabStmt.iterate(mode)) {
    tokenIdToValue.set(Number(row.token_id), row.token);
  }

  const tokenValueToNewId = new Map();
  let nextTokenId = 0;
  const insertTokenTx = outDb.transaction(() => {
    const stmt = sourceDb.prepare('SELECT token_id, doc_id, tf FROM token_postings WHERE mode = ? ORDER BY token_id, doc_id');
    for (const row of stmt.iterate(mode)) {
      const newDocId = docIdMap.get(Number(row.doc_id));
      if (newDocId === undefined) continue;
      const token = tokenIdToValue.get(Number(row.token_id));
      if (!token) continue;
      let newTokenId = tokenValueToNewId.get(token);
      if (newTokenId === undefined) {
        newTokenId = nextTokenId++;
        tokenValueToNewId.set(token, newTokenId);
        insertTokenVocab.run(mode, newTokenId, token);
      }
      insertTokenPosting.run(mode, newTokenId, newDocId, row.tf);
    }
  });
  insertTokenTx();

  const phraseIdToValue = new Map();
  const phraseVocabStmt = sourceDb.prepare('SELECT phrase_id, ngram FROM phrase_vocab WHERE mode = ? ORDER BY phrase_id');
  for (const row of phraseVocabStmt.iterate(mode)) {
    phraseIdToValue.set(Number(row.phrase_id), row.ngram);
  }

  const phraseValueToNewId = new Map();
  let nextPhraseId = 0;
  const insertPhraseTx = outDb.transaction(() => {
    const stmt = sourceDb.prepare('SELECT phrase_id, doc_id FROM phrase_postings WHERE mode = ? ORDER BY phrase_id, doc_id');
    for (const row of stmt.iterate(mode)) {
      const newDocId = docIdMap.get(Number(row.doc_id));
      if (newDocId === undefined) continue;
      const ngram = phraseIdToValue.get(Number(row.phrase_id));
      if (!ngram) continue;
      let newPhraseId = phraseValueToNewId.get(ngram);
      if (newPhraseId === undefined) {
        newPhraseId = nextPhraseId++;
        phraseValueToNewId.set(ngram, newPhraseId);
        insertPhraseVocab.run(mode, newPhraseId, ngram);
      }
      insertPhrasePosting.run(mode, newPhraseId, newDocId);
    }
  });
  insertPhraseTx();

  const gramIdToValue = new Map();
  const gramVocabStmt = sourceDb.prepare('SELECT gram_id, gram FROM chargram_vocab WHERE mode = ? ORDER BY gram_id');
  for (const row of gramVocabStmt.iterate(mode)) {
    gramIdToValue.set(Number(row.gram_id), row.gram);
  }

  const gramValueToNewId = new Map();
  let nextGramId = 0;
  const insertChargramTx = outDb.transaction(() => {
    const stmt = sourceDb.prepare('SELECT gram_id, doc_id FROM chargram_postings WHERE mode = ? ORDER BY gram_id, doc_id');
    for (const row of stmt.iterate(mode)) {
      const newDocId = docIdMap.get(Number(row.doc_id));
      if (newDocId === undefined) continue;
      const gram = gramIdToValue.get(Number(row.gram_id));
      if (!gram) continue;
      let newGramId = gramValueToNewId.get(gram);
      if (newGramId === undefined) {
        newGramId = nextGramId++;
        gramValueToNewId.set(gram, newGramId);
        insertChargramVocab.run(mode, newGramId, gram);
      }
      insertChargramPosting.run(mode, newGramId, newDocId);
    }
  });
  insertChargramTx();

  const stats = outDb.prepare(
    'SELECT COUNT(*) AS total_docs, AVG(len) AS avg_doc_len FROM doc_lengths WHERE mode = ?'
  ).get(mode) || {};
  insertTokenStats.run(
    mode,
    typeof stats.avg_doc_len === 'number' ? stats.avg_doc_len : 0,
    typeof stats.total_docs === 'number' ? stats.total_docs : 0
  );

  const insertManifestTx = outDb.transaction(() => {
    for (const [file, count] of fileCounts.entries()) {
      const meta = fileManifest.get(file);
      insertFileManifest.run(
        mode,
        file,
        meta?.hash || null,
        Number.isFinite(meta?.mtimeMs) ? meta.mtimeMs : null,
        Number.isFinite(meta?.size) ? meta.size : null,
        count
      );
    }
  });
  insertManifestTx();

  outDb.exec('VACUUM');
  outDb.close();
  sourceDb.close();

  if (argv['dry-run']) {
    await fsPromises.rm(tempPath, { force: true });
    console.log(`[compact] dry-run: ${mode} would replace ${dbPath}`);
    return { skipped: true };
  }

  const backupPath = buildBackupPath(dbPath, argv['keep-backup']);
  if (!argv['keep-backup'] && fs.existsSync(backupPath)) {
    await fsPromises.rm(backupPath, { force: true });
  }

  await fsPromises.rename(dbPath, backupPath);
  await fsPromises.rename(tempPath, dbPath);

  if (!argv['keep-backup']) {
    await fsPromises.rm(backupPath, { force: true });
  }

  return { skipped: false };
}

const targets = [];
if (modeArg === 'all' || modeArg === 'code') {
  targets.push({ mode: 'code', path: sqlitePaths.codePath });
}
if (modeArg === 'all' || modeArg === 'prose') {
  targets.push({ mode: 'prose', path: sqlitePaths.prosePath });
}

for (const target of targets) {
  await compactDatabase(target.path, target.mode);
}

console.log('SQLite compaction complete.');
