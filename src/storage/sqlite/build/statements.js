export const createInsertStatements = (db) => {
  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO chunks (
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
    'INSERT OR REPLACE INTO dense_meta (mode, dims, scale, model, min_val, max_val, levels) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertFileManifest = db.prepare(
    'INSERT OR REPLACE INTO file_manifest (mode, file, hash, mtimeMs, size, chunk_count) VALUES (?, ?, ?, ?, ?, ?)'
  );

  return {
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
