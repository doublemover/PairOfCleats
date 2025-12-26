#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import { getIndexDir, loadUserConfig } from './dict-utils.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required. Run npm install first.');
  process.exit(1);
}

const argv = minimist(process.argv.slice(2), {
  string: ['code-dir', 'prose-dir', 'out']
});

const root = process.cwd();
const userConfig = loadUserConfig(root);
const sqliteConfig = userConfig.sqlite || {};
const codeDir = argv['code-dir'] ? path.resolve(argv['code-dir']) : getIndexDir(root, 'code', userConfig);
const proseDir = argv['prose-dir'] ? path.resolve(argv['prose-dir']) : getIndexDir(root, 'prose', userConfig);
const outPath = argv.out
  ? path.resolve(argv.out)
  : (sqliteConfig.dbPath ? path.resolve(sqliteConfig.dbPath) : path.join(root, 'index-sqlite', 'index.db'));

await fs.mkdir(path.dirname(outPath), { recursive: true });

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
  return {
    chunkMeta,
    denseVec: loadOptional(dir, 'dense_vectors_uint8.json'),
    phraseNgrams: loadOptional(dir, 'phrase_ngrams.json'),
    chargrams: loadOptional(dir, 'chargram_postings.json'),
    minhash: loadOptional(dir, 'minhash_signatures.json'),
    tokenPostings: loadOptional(dir, 'token_postings.json')
  };
}

const codeIndex = loadIndex(codeDir);
const proseIndex = loadIndex(proseDir);
if (!codeIndex && !proseIndex) {
  console.error('No index found. Build index-code/index-prose first.');
  process.exit(1);
}

const db = new Database(outPath);
try {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
} catch {}

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
    scale REAL
  );
`;

db.exec(createTables);

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
  'INSERT OR REPLACE INTO dense_meta (mode, dims, scale) VALUES (?, ?, ?)'
);

function packUint32(values) {
  const arr = Uint32Array.from(values || []);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function packUint8(values) {
  const arr = Uint8Array.from(values || []);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function ingestTokenIndex(tokenIndex, mode) {
  if (!tokenIndex?.vocab || !tokenIndex?.postings) return;
  const vocab = tokenIndex.vocab;
  const postings = tokenIndex.postings;
  const docLengths = Array.isArray(tokenIndex.docLengths) ? tokenIndex.docLengths : [];
  const avgDocLen = typeof tokenIndex.avgDocLen === 'number' ? tokenIndex.avgDocLen : null;
  const totalDocs = typeof tokenIndex.totalDocs === 'number' ? tokenIndex.totalDocs : docLengths.length;

  const insertVocabTx = db.transaction(() => {
    for (let i = 0; i < vocab.length; i++) {
      insertTokenVocab.run(mode, i, vocab[i]);
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
        insertTokenPosting.run(mode, tokenId, docId, tf);
      }
    }
  });
  insertPostingsTx();

  const insertLengthsTx = db.transaction(() => {
    for (let docId = 0; docId < docLengths.length; docId++) {
      insertDocLength.run(mode, docId, docLengths[docId]);
    }
  });
  insertLengthsTx();

  insertTokenStats.run(mode, avgDocLen, totalDocs);
}

function ingestPostingIndex(index, mode, insertVocabStmt, insertPostingStmt) {
  if (!index?.vocab || !index?.postings) return;
  const vocab = index.vocab;
  const postings = index.postings;

  const insertVocabTx = db.transaction(() => {
    for (let i = 0; i < vocab.length; i++) {
      insertVocabStmt.run(mode, i, vocab[i]);
    }
  });
  insertVocabTx();

  const insertPostingsTx = db.transaction(() => {
    for (let vocabId = 0; vocabId < postings.length; vocabId++) {
      const posting = postings[vocabId] || [];
      for (const docId of posting) {
        insertPostingStmt.run(mode, vocabId, docId);
      }
    }
  });
  insertPostingsTx();
}

function ingestMinhash(minhash, mode) {
  if (!minhash?.signatures) return;
  const insertTx = db.transaction(() => {
    for (let docId = 0; docId < minhash.signatures.length; docId++) {
      const sig = minhash.signatures[docId];
      if (!sig) continue;
      insertMinhash.run(mode, docId, packUint32(sig));
    }
  });
  insertTx();
}

function ingestDense(dense, mode) {
  if (!dense?.vectors || !dense.vectors.length) return;
  insertDenseMeta.run(mode, dense.dims || null, typeof dense.scale === 'number' ? dense.scale : 1.0);
  const insertTx = db.transaction(() => {
    for (let docId = 0; docId < dense.vectors.length; docId++) {
      const vec = dense.vectors[docId];
      if (!vec) continue;
      insertDense.run(mode, docId, packUint8(vec));
    }
  });
  insertTx();
}

function ingestIndex(index, mode, idOffset) {
  if (!index) return 0;
  const { chunkMeta } = index;
  let count = 0;

  const insert = db.transaction((rows) => {
    for (const row of rows) {
      insertChunk.run(row);
      insertFts.run(row);
    }
  });

  const rows = [];
  for (const chunk of chunkMeta) {
    const id = idOffset + chunk.id;
    const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
    const tokensText = tokensArray.join(' ');
    rows.push({
      id,
      mode,
      file: chunk.file,
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
  ingestTokenIndex(index.tokenPostings, mode);
  ingestPostingIndex(index.phraseNgrams, mode, insertPhraseVocab, insertPhrasePosting);
  ingestPostingIndex(index.chargrams, mode, insertChargramVocab, insertChargramPosting);
  ingestMinhash(index.minhash, mode);
  ingestDense(index.denseVec, mode);

  return count;
}

const codeOffset = 0;
const proseOffset = 1000000000;
const countCode = ingestIndex(codeIndex, 'code', codeOffset);
const countProse = ingestIndex(proseIndex, 'prose', proseOffset);

console.log(`SQLite index built at ${outPath}. code=${countCode} prose=${countProse}`);
