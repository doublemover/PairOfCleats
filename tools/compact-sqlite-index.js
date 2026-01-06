#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCli } from '../src/shared/cli.js';
import { loadUserConfig, resolveRepoRoot, resolveSqlitePaths } from './dict-utils.js';
import { encodeVector, ensureVectorTable, getVectorExtensionConfig, hasVectorTable, loadVectorExtension } from './vector-extension.js';
import { CREATE_TABLES_SQL, REQUIRED_TABLES, SCHEMA_VERSION } from '../src/storage/sqlite/schema.js';
import { hasRequiredTables, normalizeFilePath, replaceSqliteDatabase } from '../src/storage/sqlite/utils.js';
import { dequantizeUint8ToFloat32, toVectorId } from '../src/storage/sqlite/vector.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required. Run npm install first.');
  process.exit(1);
}


/**
 * Parse a token list from string or JSON.
 * @param {string|Array<string>|null} value
 * @returns {string[]}
 */
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

/**
 * Build a backup path for a sqlite db.
 * @param {string} dbPath
 * @param {boolean} keepBackup
 * @returns {string}
 */
function buildBackupPath(dbPath, keepBackup) {
  const base = `${dbPath}.bak`;
  if (!keepBackup) return base;
  if (!fs.existsSync(base)) return base;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${dbPath}.bak-${stamp}`;
}

/**
 * Compact a sqlite index by reassigning doc_ids and pruning tables.
 * @param {{dbPath:string,mode:'code'|'prose',vectorExtension:object,dryRun?:boolean,keepBackup?:boolean}} input
 * @returns {Promise<{skipped:boolean}>}
 */
export async function compactDatabase(input) {
  const { dbPath, mode, vectorExtension, dryRun = false, keepBackup = false } = input || {};
  const vectorAnnEnabled = vectorExtension?.enabled === true;
  if (!fs.existsSync(dbPath)) {
    console.warn(`[compact] ${mode} db missing: ${dbPath}`);
    return { skipped: true };
  }

  const sourceDb = new Database(dbPath, { readonly: true });
  if (!hasRequiredTables(sourceDb, REQUIRED_TABLES)) {
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
  outDb.exec(CREATE_TABLES_SQL);
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
      id, chunk_id, mode, file, start, end, startLine, endLine, ext, kind, name,
      headline, preContext, postContext, weight, tokens, ngrams, codeRelations,
      docmeta, stats, complexity, lint, externalDocs, last_modified, last_author,
      churn, chunk_authors
    ) VALUES (
      @id, @chunk_id, @mode, @file, @start, @end, @startLine, @endLine, @ext, @kind,
      @name, @headline, @preContext, @postContext, @weight, @tokens, @ngrams,
      @codeRelations, @docmeta, @stats, @complexity, @lint, @externalDocs,
      @last_modified, @last_author, @churn, @chunk_authors
    );
  `);

  const insertFts = outDb.prepare(`
    INSERT OR REPLACE INTO chunks_fts (rowid, mode, file, name, signature, kind, headline, doc, tokens)
    VALUES (@id, @mode, @file, @name, @signature, @kind, @headline, @doc, @tokensText);
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
      let signature = null;
      let doc = null;
      if (row.docmeta) {
        try {
          const meta = JSON.parse(row.docmeta);
          signature = typeof meta?.signature === 'string' ? meta.signature : null;
          doc = typeof meta?.doc === 'string' ? meta.doc : null;
        } catch {}
      }
      insertFts.run({
        id: newId,
        mode,
        file: normalizedFile,
        name: row.name,
        signature,
        kind: row.kind,
        headline: row.headline,
        doc,
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

  if (dryRun) {
    await fsPromises.rm(tempPath, { force: true });
    console.log(`[compact] dry-run: ${mode} would replace ${dbPath}`);
    return { skipped: true };
  }

  const backupPath = buildBackupPath(dbPath, keepBackup);
  if (!keepBackup && fs.existsSync(backupPath)) {
    await fsPromises.rm(backupPath, { force: true });
  }
  await replaceSqliteDatabase(tempPath, dbPath, { keepBackup, backupPath });

  return { skipped: false };
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const argv = createCli({
    scriptName: 'compact-sqlite-index',
    options: {
      mode: { type: 'string', default: 'all' },
      repo: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'keep-backup': { type: 'boolean', default: false }
    }
  }).parse();

  const rootArg = argv.repo ? path.resolve(argv.repo) : null;
  const root = rootArg || resolveRepoRoot(process.cwd());
  const userConfig = loadUserConfig(root);
  const vectorExtension = getVectorExtensionConfig(root, userConfig);
  const sqlitePaths = resolveSqlitePaths(root, userConfig);

  const modeArg = (argv.mode || 'all').toLowerCase();
  if (!['all', 'code', 'prose'].includes(modeArg)) {
    console.error('Invalid mode. Use --mode all|code|prose');
    process.exit(1);
  }

  const targets = [];
  if (modeArg === 'all' || modeArg === 'code') {
    targets.push({ mode: 'code', path: sqlitePaths.codePath });
  }
  if (modeArg === 'all' || modeArg === 'prose') {
    targets.push({ mode: 'prose', path: sqlitePaths.prosePath });
  }

  for (const target of targets) {
    await compactDatabase({
      dbPath: target.path,
      mode: target.mode,
      vectorExtension,
      dryRun: argv['dry-run'],
      keepBackup: argv['keep-backup']
    });
  }

  console.log('SQLite compaction complete.');
}
