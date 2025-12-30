#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import { getIndexDir, getModelConfig, getRepoCacheRoot, loadUserConfig, resolveRepoRoot, resolveSqlitePaths } from './dict-utils.js';
import { encodeVector, ensureVectorTable, getVectorExtensionConfig, hasVectorTable, loadVectorExtension } from './vector-extension.js';
import { compactDatabase } from './compact-sqlite-index.js';
import { CREATE_TABLES_SQL, REQUIRED_TABLES, SCHEMA_VERSION } from '../src/sqlite/schema.js';
import { buildChunkRow, buildTokenFrequency, prepareVectorAnnTable } from '../src/sqlite/build-helpers.js';
import { loadIncrementalManifest } from '../src/sqlite/incremental.js';
import { chunkArray, hasRequiredTables, loadIndex, normalizeFilePath, readJson } from '../src/sqlite/utils.js';
import { dequantizeUint8ToFloat32, packUint32, packUint8, quantizeVec, toVectorId } from '../src/sqlite/vector.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required. Run npm install first.');
  process.exit(1);
}

const argv = minimist(process.argv.slice(2), {
  string: ['code-dir', 'prose-dir', 'out', 'mode', 'repo'],
  boolean: ['incremental', 'compact'],
  default: { mode: 'all', incremental: false, compact: false }
});

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
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



const codeIndex = loadIndex(codeDir, modelConfig.id);
const proseIndex = loadIndex(proseDir, modelConfig.id);
const incrementalCode = loadIncrementalManifest(repoCacheRoot, 'code');
const incrementalProse = loadIncrementalManifest(repoCacheRoot, 'prose');
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


/**
 * Build a full SQLite index from file-backed artifacts.
 * @param {string} outPath
 * @param {object} index
 * @param {'code'|'prose'} mode
 * @param {object|null} manifestFiles
 * @returns {number}
 */
function buildDatabase(outPath, index, mode, manifestFiles) {
  if (!index) return 0;
  const db = new Database(outPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  } catch {}

  db.exec(CREATE_TABLES_SQL);
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
        if (vectorAnn?.insert) {
          const floatVec = dequantizeUint8ToFloat32(vec);
          const encoded = encodeVector(floatVec, vectorExtension);
          if (encoded) vectorAnn.insert.run(toVectorId(docId), encoded);
        }
      }
    });
    insertTx();
  }

  /**
   * Ingest all index components for a mode.
   * @param {object} indexData
   * @param {'code'|'prose'} targetMode
   */
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

  /**
   * Ingest file manifest metadata if available.
   * @param {object} indexData
   * @param {'code'|'prose'} targetMode
   */
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
 * Load file manifest entries from SQLite.
 * @param {import('better-sqlite3').Database} db
 * @param {'code'|'prose'} mode
 * @returns {object}
 */
function getFileManifest(db, mode) {
  const rows = db.prepare('SELECT file, hash, mtimeMs, size FROM file_manifest WHERE mode = ?').all(mode);
  const map = new Map();
  for (const row of rows) {
    map.set(row.file, row);
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
 * Diff file manifests into added/changed/deleted sets.
 * @param {object} manifestFiles
 * @param {object} dbFiles
 * @returns {{added:string[],changed:string[],deleted:string[]}}
 */
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
  const incomingDimsSet = new Set();
  for (const bundle of bundles.values()) {
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

/**
 * Build or incrementally update an index for a mode.
 * @param {'code'|'prose'} mode
 * @param {object|null} index
 * @param {string} targetPath
 * @param {object|null} incrementalData
 * @returns {{count?:number,incremental:boolean,changedFiles?:number,deletedFiles?:number,insertedChunks?:number}}
 */
async function runMode(mode, index, targetPath, incrementalData) {
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
  const count = buildDatabase(targetPath, index, mode, incrementalData?.manifest?.files);
  return { count, incremental: false, changedFiles: null, deletedFiles: null, insertedChunks: count };
}

const results = {};
if (modeArg === 'all' || modeArg === 'code') {
  const targetPath = modeArg === 'all' ? codeOutPath : outPath;
  results.code = await runMode('code', codeIndex, targetPath, incrementalCode);
}
if (modeArg === 'all' || modeArg === 'prose') {
  const targetPath = modeArg === 'all' ? proseOutPath : outPath;
  results.prose = await runMode('prose', proseIndex, targetPath, incrementalProse);
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
