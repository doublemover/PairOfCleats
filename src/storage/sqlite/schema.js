export const SCHEMA_VERSION = 9;

export const REQUIRED_TABLES = [
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

export const CREATE_TABLES_BASE_SQL = `
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
    chunk_id TEXT,
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
    churn_added INTEGER,
    churn_deleted INTEGER,
    churn_commits INTEGER,
    chunk_authors TEXT
  );
  CREATE VIRTUAL TABLE chunks_fts USING fts5(
    mode UNINDEXED,
    file,
    name,
    signature,
    kind,
    headline,
    doc,
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
    model TEXT,
    min_val REAL,
    max_val REAL,
    levels INTEGER
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
`;

export const CREATE_INDEXES_SQL = `
  CREATE INDEX idx_chunks_file ON chunks (mode, file);
  CREATE INDEX idx_chunks_file_id ON chunks (mode, file, id);
  CREATE INDEX idx_token_postings_token ON token_postings (mode, token_id);
  CREATE INDEX idx_phrase_postings_phrase ON phrase_postings (mode, phrase_id);
  CREATE INDEX idx_chargram_postings_gram ON chargram_postings (mode, gram_id);
  CREATE INDEX idx_file_manifest_mode_file ON file_manifest (mode, file);
`;

export const CREATE_TABLES_SQL = `
${CREATE_TABLES_BASE_SQL}
${CREATE_INDEXES_SQL}
`;
