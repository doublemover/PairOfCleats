/**
 * Create and return the sqlite insert statement set for one build pass.
 * @param {any} db
 * @param {{updateMode?:'full'|'incremental',stats?:object}} [options]
 * @returns {object}
 */
export const createInsertStatements = (db, options = {}) => {
  const updateMode = options?.updateMode === 'full' ? 'full' : 'incremental';
  const insertClause = updateMode === 'full' ? 'INSERT' : 'INSERT OR REPLACE';
  const tokenPostingsConflictClause = updateMode === 'full'
    ? ' ON CONFLICT(mode, token_id, doc_id) DO UPDATE SET tf = token_postings.tf + excluded.tf'
    : '';
  const stats = options?.stats && typeof options.stats === 'object' ? options.stats : null;
  if (stats) {
    stats.insertStatements = stats.insertStatements || {};
    stats.insertStatements.updateMode = updateMode;
    stats.insertStatements.insertClause = insertClause;
  }

  const insertChunk = db.prepare(`
    ${insertClause} INTO chunks (
      id, chunk_id, mode, file, start, end, startLine, endLine, ext, kind, name,
      metaV2_json, headline, preContext, postContext, weight, tokens, ngrams, codeRelations,
      docmeta, stats, complexity, lint, externalDocs, last_modified, last_author,
      churn, churn_added, churn_deleted, churn_commits, chunk_authors
    ) VALUES (
      @id, @chunk_id, @mode, @file, @start, @end, @startLine, @endLine, @ext, @kind,
      @name, @metaV2_json, @headline, @preContext, @postContext, @weight, @tokens, @ngrams,
      @codeRelations, @docmeta, @stats, @complexity, @lint, @externalDocs,
      @last_modified, @last_author, @churn, @churn_added, @churn_deleted, @churn_commits,
      @chunk_authors
    );
  `);

  const insertFts = db.prepare(`
    ${insertClause} INTO chunks_fts (rowid, file, name, signature, kind, headline, doc, tokens)
    VALUES (@id, @file, @name, @signature, @kind, @headline, @doc, @tokensText);
  `);

  const insertTokenVocab = db.prepare(
    `${insertClause} INTO token_vocab (mode, token_id, token) VALUES (?, ?, ?)`
  );
  const insertTokenPosting = db.prepare(
    `${insertClause} INTO token_postings (mode, token_id, doc_id, tf) VALUES (?, ?, ?, ?)${tokenPostingsConflictClause}`
  );
  const insertDocLength = db.prepare(
    `${insertClause} INTO doc_lengths (mode, doc_id, len) VALUES (?, ?, ?)`
  );
  const insertTokenStats = db.prepare(
    `${insertClause} INTO token_stats (mode, avg_doc_len, total_docs) VALUES (?, ?, ?)`
  );
  const insertPhraseVocab = db.prepare(
    `${insertClause} INTO phrase_vocab (mode, phrase_id, ngram) VALUES (?, ?, ?)`
  );
  const insertPhrasePosting = db.prepare(
    `${insertClause} INTO phrase_postings (mode, phrase_id, doc_id) VALUES (?, ?, ?)`
  );
  const insertChargramVocab = db.prepare(
    `${insertClause} INTO chargram_vocab (mode, gram_id, gram) VALUES (?, ?, ?)`
  );
  const insertChargramPosting = db.prepare(
    `${insertClause} INTO chargram_postings (mode, gram_id, doc_id) VALUES (?, ?, ?)`
  );
  const insertMinhash = db.prepare(
    `${insertClause} INTO minhash_signatures (mode, doc_id, sig) VALUES (?, ?, ?)`
  );
  const insertDense = db.prepare(
    `${insertClause} INTO dense_vectors (mode, doc_id, vector) VALUES (?, ?, ?)`
  );
  const insertDenseMeta = db.prepare(
    `${insertClause} INTO dense_meta (mode, dims, scale, model, min_val, max_val, levels) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertFileManifest = db.prepare(
    `${insertClause} INTO file_manifest (mode, file, hash, mtimeMs, size, chunk_count) VALUES (?, ?, ?, ?, ?, ?)`
  );

  return {
    insertClause,
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
  };
};
