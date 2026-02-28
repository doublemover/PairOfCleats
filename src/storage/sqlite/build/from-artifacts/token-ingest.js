import fsSync from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildTokenFrequency } from '../../build-helpers.js';
import {
  INTEGER_COERCE_MODE_STRICT,
  coerceNonNegativeInt
} from '../../../../shared/number-coerce.js';
import {
  MAX_JSON_BYTES,
  loadTokenPostings,
  readJson,
  resolveTokenPostingsSources,
  normalizeTfPostingRows
} from './sources.js';

const SQLITE_TOKEN_CARDINALITY_ERROR_CODE = 'ERR_SQLITE_TOKEN_CARDINALITY';

const isCardinalityInvariantError = (error) => (
  error?.code === SQLITE_TOKEN_CARDINALITY_ERROR_CODE
  || String(error?.message || '').includes('cardinality invariant failed')
);

const coerceStrictNonNegativeIntOrNull = (value) => {
  const parsed = coerceNonNegativeInt(value, { mode: INTEGER_COERCE_MODE_STRICT });
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const normalizeDocLengthsStrict = (docLengths, contextLabel) => {
  if (!Array.isArray(docLengths)) return [];
  const normalized = new Array(docLengths.length);
  for (let i = 0; i < docLengths.length; i += 1) {
    const parsed = coerceStrictNonNegativeIntOrNull(docLengths[i]);
    if (parsed == null) {
      const error = new Error(
        `[sqlite] ${contextLabel} docLengths[${i}] must be a non-negative integer (received ${String(docLengths[i])}).`
      );
      error.code = SQLITE_TOKEN_CARDINALITY_ERROR_CODE;
      throw error;
    }
    normalized[i] = parsed;
  }
  return normalized;
};

const assertTokenPostingsCardinalityInvariant = ({
  vocab,
  postings,
  vocabIds,
  contextLabel
}) => {
  const diagnostics = [];
  const vocabCount = Array.isArray(vocab) ? vocab.length : 0;
  const postingsCount = Array.isArray(postings) ? postings.length : 0;
  const vocabIdsCount = Array.isArray(vocabIds) ? vocabIds.length : 0;
  if (postingsCount !== vocabCount) {
    diagnostics.push(`postings=${postingsCount} does not match vocab=${vocabCount}`);
  }
  if (vocabIdsCount > 0 && vocabIdsCount !== vocabCount) {
    diagnostics.push(`vocabIds=${vocabIdsCount} does not match vocab=${vocabCount}`);
  }
  if (!diagnostics.length) return;
  const error = new Error(
    `[sqlite] ${contextLabel} cardinality invariant failed: ${diagnostics.join('; ')}`
  );
  error.code = SQLITE_TOKEN_CARDINALITY_ERROR_CODE;
  error.diagnostics = diagnostics;
  throw error;
};

/**
 * Create token/posting ingest helpers bound to sqlite statements and stats hooks.
 * @param {object} ctx
 * @returns {object}
 */
export const createTokenIngestor = (ctx) => {
  const {
    db,
    insertClause,
    resolvedStatementStrategy,
    resolvedBatchSize,
    recordBatch,
    recordTable,
    warn,
    insertTokenVocab,
    insertTokenPosting,
    insertDocLength,
    insertTokenStats,
    insertTokenVocabMany,
    insertTokenPostingMany,
    insertDocLengthMany
  } = ctx;

  let tokenMetaCache = null;

  const ingestTokenIndex = (tokenIndex, targetMode) => {
    if (!Array.isArray(tokenIndex?.vocab) || !Array.isArray(tokenIndex?.postings)) return;
    const vocab = tokenIndex.vocab;
    const postings = tokenIndex.postings;
    assertTokenPostingsCardinalityInvariant({
      vocab,
      postings,
      vocabIds: Array.isArray(tokenIndex?.vocabIds) ? tokenIndex.vocabIds : [],
      contextLabel: `token_postings (${targetMode})`
    });
    const docLengths = normalizeDocLengthsStrict(
      Array.isArray(tokenIndex.docLengths) ? tokenIndex.docLengths : [],
      `token_postings (${targetMode})`
    );
    const avgDocLen = typeof tokenIndex.avgDocLen === 'number' ? tokenIndex.avgDocLen : null;
    const totalDocs = tokenIndex.totalDocs == null
      ? docLengths.length
      : coerceStrictNonNegativeIntOrNull(tokenIndex.totalDocs);
    if (tokenIndex.totalDocs != null && totalDocs == null) {
      const error = new Error(
        `[sqlite] token_postings (${targetMode}) totalDocs must be a non-negative integer ` +
        `(received ${String(tokenIndex.totalDocs)}).`
      );
      error.code = SQLITE_TOKEN_CARDINALITY_ERROR_CODE;
      throw error;
    }

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
        const posting = normalizeTfPostingRows(postings[tokenId], {
          mode: INTEGER_COERCE_MODE_STRICT,
          rejectInvalid: true,
          contextLabel: `token_postings (${targetMode}) tokenId=${tokenId}`
        });
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
          const posting = normalizeTfPostingRows(postings[tokenId], {
            mode: INTEGER_COERCE_MODE_STRICT,
            rejectInvalid: true,
            contextLabel: `token_postings (${targetMode}) tokenId=${tokenId}`
          });
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
  };

  const ingestTokenIndexFromPieces = (targetMode, indexDir, tokenPostingsSources = null) => {
    const directPath = path.join(indexDir, 'token_postings.json');
    const directPathGz = `${directPath}.gz`;
    const directPathZst = `${directPath}.zst`;
    const sources = tokenPostingsSources || resolveTokenPostingsSources(indexDir);
    const hasDirect = fsSync.existsSync(directPath)
      || fsSync.existsSync(directPathGz)
      || fsSync.existsSync(directPathZst);
    const tryManifestAwareLoad = () => {
      try {
        const tokenIndex = loadTokenPostings(indexDir, {
          maxBytes: MAX_JSON_BYTES,
          strict: false
        });
        if (!tokenIndex?.vocab || !tokenIndex?.postings) return false;
        ingestTokenIndex(tokenIndex, targetMode);
        return true;
      } catch (error) {
        if (isCardinalityInvariantError(error)) throw error;
        const loadWithLegacyManifest = (piece) => {
          try {
            const tokenIndex = loadTokenPostings(indexDir, {
              maxBytes: MAX_JSON_BYTES,
              strict: false,
              manifest: { pieces: [piece] }
            });
            if (!tokenIndex?.vocab || !tokenIndex?.postings) return false;
            ingestTokenIndex(tokenIndex, targetMode);
            return true;
          } catch (legacyError) {
            if (isCardinalityInvariantError(legacyError)) throw legacyError;
            return false;
          }
        };
        const directPiecePath = fsSync.existsSync(directPath)
          ? 'token_postings.json'
          : (fsSync.existsSync(directPathGz)
            ? 'token_postings.json.gz'
            : (fsSync.existsSync(directPathZst) ? 'token_postings.json.zst' : null));
        if (
          directPiecePath
          && loadWithLegacyManifest({ name: 'token_postings', format: 'json', path: directPiecePath })
        ) {
          return true;
        }
        if (
          fsSync.existsSync(path.join(indexDir, 'token_postings.packed.bin'))
          && loadWithLegacyManifest({ name: 'token_postings', format: 'packed', path: 'token_postings.packed.bin' })
        ) {
          return true;
        }
        if (
          fsSync.existsSync(path.join(indexDir, 'token_postings.binary-columnar.bin'))
          && loadWithLegacyManifest({
            name: 'token_postings',
            format: 'binary-columnar',
            path: 'token_postings.binary-columnar.bin'
          })
        ) {
          return true;
        }
        return false;
      }
    };
    if (!sources && !hasDirect) {
      return tryManifestAwareLoad();
    }
    if (!sources) {
      if (!fsSync.existsSync(directPath)) {
        return tryManifestAwareLoad();
      }
      try {
        const tokenIndex = readJson(directPath);
        ingestTokenIndex(tokenIndex, targetMode);
        return true;
      } catch (error) {
        if (isCardinalityInvariantError(error)) throw error;
        return tryManifestAwareLoad();
      }
    }
    try {
      const meta = (() => {
        if (tokenMetaCache) return tokenMetaCache;
        if (!fsSync.existsSync(sources.metaPath)) {
          tokenMetaCache = {};
          return tokenMetaCache;
        }
        tokenMetaCache = readJson(sources.metaPath) || {};
        return tokenMetaCache;
      })();
      const docLengthsRaw = Array.isArray(meta?.docLengths)
        ? meta.docLengths
        : (Array.isArray(meta?.arrays?.docLengths) ? meta.arrays.docLengths : []);
      const docLengths = normalizeDocLengthsStrict(docLengthsRaw, `token_postings shards (${targetMode})`);
      const totalDocsRaw = meta?.totalDocs ?? meta?.fields?.totalDocs;
      const totalDocs = totalDocsRaw == null
        ? docLengths.length
        : coerceStrictNonNegativeIntOrNull(totalDocsRaw);
      if (totalDocsRaw != null && totalDocs == null) {
        const error = new Error(
          `[sqlite] token_postings shards (${targetMode}) totalDocs must be a non-negative integer ` +
          `(received ${String(totalDocsRaw)}).`
        );
        error.code = SQLITE_TOKEN_CARDINALITY_ERROR_CODE;
        throw error;
      }
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

      // Prepare once for this ingest to avoid per-shard compilation churn.
      const perShardTokenVocabStmt = resolvedStatementStrategy === 'prepare-per-shard'
        ? db.prepare(`${insertClause} INTO token_vocab (mode, token_id, token) VALUES (?, ?, ?)`)
        : null;
      const perShardTokenPostingStmt = resolvedStatementStrategy === 'prepare-per-shard'
        ? db.prepare(`${insertClause} INTO token_postings (mode, token_id, doc_id, tf) VALUES (?, ?, ?, ?)${tokenPostingsConflictClause}`)
        : null;

      for (const shardPath of sources.parts) {
        const shard = readJson(shardPath);
        const vocab = Array.isArray(shard?.vocab)
          ? shard.vocab
          : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
        const postings = Array.isArray(shard?.postings)
          ? shard.postings
          : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
        const shardLabel = `token_postings shard ${path.basename(shardPath)} (${targetMode})`;
        assertTokenPostingsCardinalityInvariant({
          vocab,
          postings,
          vocabIds: Array.isArray(shard?.vocabIds)
            ? shard.vocabIds
            : (Array.isArray(shard?.arrays?.vocabIds) ? shard.arrays.vocabIds : []),
          contextLabel: shardLabel
        });
        const postingCount = postings.length;
        const insertTokenVocabStmt = perShardTokenVocabStmt || insertTokenVocab;
        const insertTokenPostingStmt = perShardTokenPostingStmt || insertTokenPosting;
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
            const postingTokenId = tokenId + i;
            const posting = normalizeTfPostingRows(postings[i], {
              mode: INTEGER_COERCE_MODE_STRICT,
              rejectInvalid: true,
              contextLabel: `${shardLabel} tokenId=${postingTokenId}`
            });
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
              const postingTokenId = tokenId + i;
              const posting = normalizeTfPostingRows(postings[i], {
                mode: INTEGER_COERCE_MODE_STRICT,
                rejectInvalid: true,
                contextLabel: `${shardLabel} tokenId=${postingTokenId}`
              });
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
    } catch (error) {
      if (isCardinalityInvariantError(error)) {
        warn(String(error?.message || '[sqlite] token_postings cardinality invariant failed'));
        throw error;
      }
      return tryManifestAwareLoad();
    }
  };

  const ingestTokenIndexFromChunks = (chunks, targetMode) => {
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
  };

  const ingestTokenIndexFromStoredChunks = (targetMode) => {
    const selectChunks = db.prepare(
      'SELECT id, tokens FROM chunks WHERE mode = ? AND id > ? ORDER BY id LIMIT ?'
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
    let lastId = -1;
    while (true) {
      const batch = selectChunks.all(targetMode, lastId, resolvedBatchSize);
      if (!Array.isArray(batch) || !batch.length) break;
      insertTx(batch);
      recordBatch('tokenPostingBatches');
      recordBatch('tokenVocabBatches');
      recordBatch('docLengthBatches');
      const tail = batch[batch.length - 1];
      const tailId = Number(tail?.id);
      if (!Number.isFinite(tailId)) break;
      lastId = tailId;
    }
    if (!sawRows) return false;
    insertTokenStats.run(targetMode, totalDocs ? totalLen / totalDocs : 0, totalDocs);
    recordTable('doc_lengths', docLengthRows, performance.now() - lengthsStart);
    recordTable('token_vocab', tokenVocabRows, performance.now() - vocabStart);
    recordTable('token_postings', tokenPostingRows, performance.now() - postingStart);
    recordTable('token_stats', 1, 0);
    return true;
  };

  const ingestPostingIndex = (
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
  ) => {
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
  };

  return {
    ingestTokenIndex,
    ingestTokenIndexFromPieces,
    ingestTokenIndexFromChunks,
    ingestTokenIndexFromStoredChunks,
    ingestPostingIndex
  };
};
