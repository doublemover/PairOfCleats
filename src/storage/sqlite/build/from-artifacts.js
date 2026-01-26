import fsSync from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
  buildChunkRow,
  buildTokenFrequency,
  prepareVectorAnnTable
} from '../build-helpers.js';
import { resolveChunkId } from '../../../index/chunk-id.js';
import { CREATE_INDEXES_SQL, CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../schema.js';
import { normalizeFilePath, readJson, loadOptional, removeSqliteSidecars } from '../utils.js';
import {
  packUint32,
  packUint8,
  dequantizeUint8ToFloat32,
  resolveQuantizationParams,
  toSqliteRowId
} from '../vector.js';
import { applyBuildPragmas, restoreBuildPragmas } from './pragmas.js';
import { normalizeManifestFiles } from './manifest.js';
import { validateSqliteDatabase } from './validate.js';
import { createInsertStatements } from './statements.js';
import {
  MAX_JSON_BYTES,
  parseJsonlLine,
  readJsonLinesArray,
  resolveJsonlRequiredKeys
} from '../../../shared/artifact-io.js';

const listShardFiles = (dir, prefix, extensions) => {
  if (!fsSync.existsSync(dir)) return [];
  const allowed = Array.isArray(extensions) && extensions.length
    ? extensions
    : ['.json', '.jsonl'];
  return fsSync
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && allowed.some((ext) => name.endsWith(ext)))
    .sort()
    .map((name) => path.join(dir, name));
};

const normalizeMetaParts = (parts) => (
  Array.isArray(parts)
    ? parts
      .map((part) => (typeof part === 'string' ? part : part?.path))
      .filter(Boolean)
    : []
);

const resolveChunkMetaSources = (dir) => {
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const partsDir = path.join(dir, 'chunk_meta.parts');
  if (fsSync.existsSync(metaPath) || fsSync.existsSync(partsDir)) {
    let parts = [];
    if (fsSync.existsSync(metaPath)) {
      try {
        const metaRaw = readJson(metaPath);
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        const entries = normalizeMetaParts(meta?.parts);
        if (entries.length) {
          parts = entries.map((name) => path.join(dir, name));
        }
      } catch {}
    }
    if (!parts.length) {
      parts = listShardFiles(partsDir, 'chunk_meta.part-', ['.jsonl', '.jsonl.gz', '.jsonl.zst']);
    }
    return parts.length ? { format: 'jsonl', paths: parts } : null;
  }
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const jsonlCandidates = [jsonlPath, `${jsonlPath}.gz`, `${jsonlPath}.zst`];
  const jsonlResolved = jsonlCandidates.find((candidate) => fsSync.existsSync(candidate));
  if (jsonlResolved) {
    return { format: 'jsonl', paths: [jsonlResolved] };
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
      const metaRaw = readJson(metaPath);
      const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
      const entries = normalizeMetaParts(meta?.parts);
      if (entries.length) {
        parts = entries.map((name) => path.join(dir, name));
      }
    } catch {}
  }
  if (!parts.length) {
    parts = listShardFiles(shardsDir, 'token_postings.part-', ['.json', '.json.gz', '.json.zst']);
  }
  return parts.length ? { metaPath, parts } : null;
};

const CHUNK_META_REQUIRED_KEYS = resolveJsonlRequiredKeys('chunk_meta');

const readJsonLinesFile = async (
  filePath,
  onEntry,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => {
  if (filePath.endsWith('.gz') || filePath.endsWith('.zst')) {
    const entries = await readJsonLinesArray(filePath, { maxBytes, requiredKeys });
    for (const entry of entries) onEntry(entry);
    return;
  }
  const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of rl) {
      lineNumber += 1;
      const entry = parseJsonlLine(line, filePath, lineNumber, maxBytes, requiredKeys);
      if (!entry) continue;
      onEntry(entry);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
};

export const loadIndexPieces = (dir, modelId) => {
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

export async function buildDatabaseFromArtifacts({
  Database,
  outPath,
  index,
  indexDir,
  mode,
  manifestFiles,
  emitOutput,
  validateMode,
  vectorConfig,
  modelConfig,
  logger
}) {
  const warn = (message) => {
    if (!emitOutput || !message) return;
    if (logger?.warn) {
      logger.warn(message);
      return;
    }
    if (logger?.log) {
      logger.log(message);
      return;
    }
    console.warn(message);
  };
  if (!index) return 0;
  const manifestLookup = normalizeManifestFiles(manifestFiles || {});
  if (emitOutput && manifestLookup.conflicts.length) {
    warn(`[sqlite] Manifest path conflicts for ${mode}; using normalized entries.`);
  }
  const manifestByNormalized = manifestLookup.map;
  const validationStats = { chunks: 0, dense: 0, minhash: 0 };
  const vectorExtension = vectorConfig?.extension || {};
  const encodeVector = vectorConfig?.encodeVector;
  const quantization = resolveQuantizationParams(vectorConfig?.quantization);

  const db = new Database(outPath);
  applyBuildPragmas(db);

  let count = 0;
  let succeeded = false;
  try {
    db.exec(CREATE_TABLES_BASE_SQL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    const vectorAnn = prepareVectorAnnTable({ db, indexData: index, mode, vectorConfig });

    const statements = createInsertStatements(db);
    const {
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
    } = statements;

    function ingestTokenIndex(tokenIndex, targetMode) {
      if (!tokenIndex?.vocab || !tokenIndex?.postings) return;
      const vocab = tokenIndex.vocab;
      const postings = tokenIndex.postings;
      const docLengths = Array.isArray(tokenIndex.docLengths) ? tokenIndex.docLengths : [];
      const avgDocLen = typeof tokenIndex.avgDocLen === 'number' ? tokenIndex.avgDocLen : null;
      const totalDocs = typeof tokenIndex.totalDocs === 'number' ? tokenIndex.totalDocs : docLengths.length;

      const insertVocabTx = db.transaction(() => {
        for (let i = 0; i < vocab.length; i += 1) {
          insertTokenVocab.run(targetMode, i, vocab[i]);
        }
      });
      insertVocabTx();

      const insertPostingsTx = db.transaction(() => {
        for (let tokenId = 0; tokenId < postings.length; tokenId += 1) {
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
        for (let docId = 0; docId < docLengths.length; docId += 1) {
          insertDocLength.run(targetMode, docId, docLengths[docId]);
        }
      });
      insertLengthsTx();

      insertTokenStats.run(targetMode, avgDocLen, totalDocs);
    }

    function ingestTokenIndexFromPieces(targetMode, indexDir) {
      const directPath = path.join(indexDir, 'token_postings.json');
      const directPathGz = `${directPath}.gz`;
      const directPathZst = `${directPath}.zst`;
      const sources = resolveTokenPostingsSources(indexDir);
      if (!sources && !fsSync.existsSync(directPath) && !fsSync.existsSync(directPathGz)
        && !fsSync.existsSync(directPathZst)) {
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
        for (let docId = 0; docId < docLengths.length; docId += 1) {
          insertDocLength.run(targetMode, docId, docLengths[docId]);
        }
      });
      insertLengthsTx();
      insertTokenStats.run(targetMode, avgDocLen, totalDocs);
      let tokenId = 0;
      for (const shardPath of sources.parts) {
        const shard = readJson(shardPath);
        const vocab = Array.isArray(shard?.vocab)
          ? shard.vocab
          : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
        const postings = Array.isArray(shard?.postings)
          ? shard.postings
          : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
        const insertVocabTx = db.transaction(() => {
          for (let i = 0; i < vocab.length; i += 1) {
            insertTokenVocab.run(targetMode, tokenId + i, vocab[i]);
          }
        });
        insertVocabTx();
        const insertPostingsTx = db.transaction(() => {
          for (let i = 0; i < postings.length; i += 1) {
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

    function ingestTokenIndexFromChunks(chunks, targetMode) {
      if (!Array.isArray(chunks) || !chunks.length) return;
      const tokenIdMap = new Map();
      let nextTokenId = 0;
      let totalDocs = 0;
      let totalLen = 0;
      const insertTx = db.transaction(() => {
        for (let i = 0; i < chunks.length; i += 1) {
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

    function ingestPostingIndex(indexData, targetMode, insertVocabStmt, insertPostingStmt) {
      if (!indexData?.vocab || !indexData?.postings) return;
      const vocab = indexData.vocab;
      const postings = indexData.postings;

      const insertVocabTx = db.transaction(() => {
        for (let i = 0; i < vocab.length; i += 1) {
          insertVocabStmt.run(targetMode, i, vocab[i]);
        }
      });
      insertVocabTx();

      const insertPostingsTx = db.transaction(() => {
        for (let tokenId = 0; tokenId < postings.length; tokenId += 1) {
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
        for (let docId = 0; docId < minhash.signatures.length; docId += 1) {
          const sig = minhash.signatures[docId];
          if (!sig) continue;
          insertMinhash.run(targetMode, docId, packUint32(sig));
          validationStats.minhash += 1;
        }
      });
      insertTx();
    }

    function ingestDense(dense, targetMode) {
      if (!dense?.vectors || !dense.vectors.length) return;
      const insertTx = db.transaction(() => {
        insertDenseMeta.run(
          targetMode,
          dense.dims || null,
          typeof dense.scale === 'number' ? dense.scale : 1.0,
          dense.model || modelConfig.id || null,
          quantization.minVal,
          quantization.maxVal,
          quantization.levels
        );
        for (let docId = 0; docId < dense.vectors.length; docId += 1) {
          const vec = dense.vectors[docId];
          if (!vec) continue;
          insertDense.run(targetMode, docId, packUint8(vec));
          validationStats.dense += 1;
          if (vectorAnn?.insert && encodeVector) {
            const floatVec = dequantizeUint8ToFloat32(
              vec,
              quantization.minVal,
              quantization.maxVal,
              quantization.levels
            );
            const encoded = encodeVector(floatVec, vectorExtension);
            if (encoded) vectorAnn.insert.run(toSqliteRowId(docId), encoded);
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
      const stableChunkId = resolveChunkId(chunk);
      return {
        id: Number.isFinite(chunk.id) ? chunk.id : null,
        chunk_id: stableChunkId,
        mode: targetMode,
        file: resolvedFile,
        start: chunk.start,
        end: chunk.end,
        startLine: chunk.startLine || null,
        endLine: chunk.endLine || null,
        ext: resolvedExt,
        kind: chunk.kind || null,
        name: chunk.name || null,
        metaV2_json: chunk.metaV2 ? JSON.stringify(chunk.metaV2) : null,
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
        chunk_authors: (() => {
          const authors = Array.isArray(chunk.chunk_authors)
            ? chunk.chunk_authors
            : (Array.isArray(chunk.chunkAuthors) ? chunk.chunkAuthors : null);
          return authors ? JSON.stringify(authors) : null;
        })()
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
      let chunkCount = 0;
      const handleChunk = (chunk) => {
        if (!chunk) return;
        if (!Number.isFinite(chunk.id)) {
          chunk.id = chunkCount;
        }
        const row = buildChunkRowWithMeta(chunk, targetMode, fileMetaById);
        if (row.file) {
          fileCounts.set(row.file, (fileCounts.get(row.file) || 0) + 1);
        }
        rows.push(row);
        chunkCount += 1;
        if (rows.length >= 500) flush();
      };
      if (sources.format === 'json') {
        const data = readJson(sources.paths[0]);
        if (Array.isArray(data)) {
          for (const chunk of data) handleChunk(chunk);
        }
      } else {
        for (const chunkPath of sources.paths) {
          await readJsonLinesFile(chunkPath, handleChunk, { requiredKeys: CHUNK_META_REQUIRED_KEYS });
        }
      }
      flush();
      return { count: chunkCount, fileCounts };
    };

    async function ingestIndex(indexData, targetMode, indexDir) {
      if (!indexData && !indexDir) return 0;
      const fileMetaById = new Map();
      const fileMetaRaw = Array.isArray(indexData?.fileMeta)
        ? indexData.fileMeta
        : (indexDir ? loadOptional(indexDir, 'file_meta.json') : null);
      if (Array.isArray(fileMetaRaw)) {
        for (const entry of fileMetaRaw) {
          if (!entry || !Number.isFinite(entry.id)) continue;
          fileMetaById.set(entry.id, entry);
        }
      }
      let chunkCount = 0;
      let fileCounts = new Map();
      let chunkMetaLoaded = false;
      if (indexDir) {
        const result = await ingestChunkMetaPieces(targetMode, indexDir, fileMetaById);
        chunkCount = result.count;
        fileCounts = result.fileCounts;
        chunkMetaLoaded = result.count > 0;
      }
      if (!chunkMetaLoaded && Array.isArray(indexData?.chunkMeta)) {
        const insert = db.transaction((rows) => {
          for (const row of rows) {
            insertChunk.run(row);
            insertFts.run(row);
          }
        });
        const rows = [];
        const flush = () => {
          if (!rows.length) return;
          insert(rows);
          rows.length = 0;
        };
        for (let i = 0; i < indexData.chunkMeta.length; i += 1) {
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
          chunkCount += 1;
          if (rows.length >= 500) flush();
        }
        flush();
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
        warn(`[sqlite] token_postings missing; rebuilding tokens for ${targetMode}.`);
        if (Array.isArray(indexData?.chunkMeta)) {
          ingestTokenIndexFromChunks(indexData.chunkMeta, targetMode);
        } else {
          warn(`[sqlite] chunk_meta unavailable for token rebuild (${targetMode}).`);
        }
      }

      ingestPostingIndex(indexData?.phraseNgrams, targetMode, insertPhraseVocab, insertPhrasePosting);
      ingestPostingIndex(indexData?.chargrams, targetMode, insertChargramVocab, insertChargramPosting);
      ingestMinhash(indexData?.minhash, targetMode);
      ingestDense(indexData?.denseVec, targetMode);
      ingestFileManifest(fileCounts, targetMode);

      return chunkCount;
    }

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
      emitOutput,
      logger,
      dbPath: outPath
    });
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {}
    succeeded = true;
  } finally {
    if (succeeded) {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (err) {
        warn(`[sqlite] WAL checkpoint failed for ${mode}: ${err?.message || err}`);
      }
    }
    restoreBuildPragmas(db);
    db.close();
    if (!succeeded) {
      try {
        fsSync.rmSync(outPath, { force: true });
      } catch {}
      await removeSqliteSidecars(outPath);
    }
  }
  return count;
}

