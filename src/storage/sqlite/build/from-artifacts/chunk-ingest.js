import { performance } from 'node:perf_hooks';
import { resolveChunkId } from '../../../../index/chunk-id.js';
import { normalizeFilePath } from '../../utils.js';
import {
  CHUNK_META_REQUIRED_KEYS,
  inflateColumnarRows,
  readJson,
  readJsonLinesFile,
  resolveChunkMetaSources
} from './sources.js';

/**
 * Create chunk/file-meta ingestion helpers bound to sqlite state.
 * @param {object} ctx
 * @returns {object}
 */
export const createChunkIngestor = (ctx) => {
  const {
    db,
    resolvedBatchSize,
    recordBatch,
    recordTable,
    bumpChunkMetaCounter,
    bumpChunkMetaBucket,
    insertFileMetaStage,
    insertChunkStage,
    insertFileManifest,
    manifestByNormalized
  } = ctx;

  const ingestFileMetaRows = async (fileMetaSource) => {
    if (!fileMetaSource) return 0;
    const start = performance.now();
    const rows = [];
    let batchBytes = 0;
    const maxBatchBytes = resolvedBatchSize * 4096;
    let count = 0;
    const insertTx = db.transaction((batch) => {
      for (const row of batch) {
        insertFileMetaStage.run(row);
      }
    });
    const flush = () => {
      if (!rows.length) return;
      insertTx(rows);
      rows.length = 0;
      batchBytes = 0;
      recordBatch('fileMetaBatches');
    };
    const estimateRowBytes = (row) => {
      if (!row) return 0;
      let bytes = 128;
      if (row.file) bytes += row.file.length;
      if (row.ext) bytes += row.ext.length;
      if (row.hash) bytes += row.hash.length;
      if (row.hashAlgo) bytes += row.hashAlgo.length;
      return bytes;
    };
    const handleRow = (entry) => {
      if (!entry || !Number.isFinite(entry.id)) return;
      const normalizedFile = normalizeFilePath(entry.file);
      const row = {
        id: entry.id,
        file: normalizedFile,
        ext: entry.ext || null,
        size: Number.isFinite(entry.size) ? entry.size : null,
        hash: entry.hash || null,
        hashAlgo: entry.hashAlgo || entry.hash_algo || null,
        encoding: entry.encoding || null,
        encodingFallback: typeof entry.encodingFallback === 'boolean'
          ? (entry.encodingFallback ? 1 : 0)
          : null,
        encodingConfidence: Number.isFinite(entry.encodingConfidence)
          ? entry.encodingConfidence
          : null,
        externalDocs: entry.externalDocs ? JSON.stringify(entry.externalDocs) : null,
        last_modified: entry.last_modified || null,
        last_author: entry.last_author || null,
        churn: typeof entry.churn === 'number' ? entry.churn : null,
        churn_added: typeof entry.churn_added === 'number' ? entry.churn_added : null,
        churn_deleted: typeof entry.churn_deleted === 'number' ? entry.churn_deleted : null,
        churn_commits: typeof entry.churn_commits === 'number' ? entry.churn_commits : null
      };
      rows.push(row);
      batchBytes += estimateRowBytes(row);
      count += 1;
      if (rows.length >= resolvedBatchSize || batchBytes >= maxBatchBytes) flush();
    };
    if (Array.isArray(fileMetaSource)) {
      for (const entry of fileMetaSource) {
        handleRow(entry);
      }
    } else if (typeof fileMetaSource?.[Symbol.asyncIterator] === 'function') {
      for await (const entry of fileMetaSource) {
        handleRow(entry);
      }
    }
    flush();
    recordTable('file_meta_stage', count, performance.now() - start);
    return count;
  };

  const buildChunkRowBase = (chunk, targetMode) => {
    const resolvedFile = normalizeFilePath(chunk.file || null);
    const resolvedExt = chunk.ext || null;
    const resolvedExternalDocs = chunk.externalDocs || null;
    const resolvedLastModified = chunk.last_modified || null;
    const resolvedLastAuthor = chunk.last_author || null;
    const resolvedChurn = typeof chunk.churn === 'number' ? chunk.churn : null;
    const resolvedChurnAdded = typeof chunk.churn_added === 'number' ? chunk.churn_added : null;
    const resolvedChurnDeleted = typeof chunk.churn_deleted === 'number' ? chunk.churn_deleted : null;
    const resolvedChurnCommits = typeof chunk.churn_commits === 'number' ? chunk.churn_commits : null;
    const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
    const hasTokens = tokensArray.length > 0;
    const tokensText = hasTokens ? tokensArray.join(' ') : null;
    if (hasTokens) {
      bumpChunkMetaCounter('tokenTextMaterialized', 1);
    } else {
      bumpChunkMetaCounter('tokenTextSkipped', 1);
    }
    const signatureText = typeof chunk.docmeta?.signature === 'string'
      ? chunk.docmeta.signature
      : (typeof chunk.signature === 'string' ? chunk.signature : null);
    const docText = typeof chunk.docmeta?.doc === 'string' ? chunk.docmeta.doc : null;
    const stableChunkId = resolveChunkId(chunk);
    return {
      id: Number.isFinite(chunk.id) ? chunk.id : null,
      chunk_id: stableChunkId,
      mode: targetMode,
      file_id: Number.isFinite(chunk.fileId) ? chunk.fileId : null,
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

  const createChunkMetaStageIngestor = ({ targetMode, sourceKind }) => {
    const rows = [];
    const start = performance.now();
    const insert = db.transaction((batch) => {
      for (const row of batch) {
        insertChunkStage.run(row);
      }
    });
    const maxBatchBytes = resolvedBatchSize * 4096;
    let batchBytes = 0;
    const flush = () => {
      if (!rows.length) return;
      insert(rows);
      rows.length = 0;
      batchBytes = 0;
      recordBatch('chunkMetaBatches');
    };
    const estimateRowBytes = (row) => {
      if (!row) return 0;
      let bytes = 128;
      if (row.file) bytes += row.file.length;
      if (row.ext) bytes += row.ext.length;
      if (row.name) bytes += row.name.length;
      if (row.tokensText) bytes += row.tokensText.length;
      return bytes;
    };
    let chunkCount = 0;
    bumpChunkMetaCounter('passes', 1);
    const handleChunk = (chunk, fallbackId = null) => {
      if (!chunk) return;
      if (!Number.isFinite(chunk.id)) {
        chunk.id = Number.isFinite(fallbackId) ? fallbackId : chunkCount;
      }
      const row = buildChunkRowBase(chunk, targetMode);
      rows.push(row);
      batchBytes += estimateRowBytes(row);
      chunkCount += 1;
      bumpChunkMetaCounter('rows', 1);
      if (sourceKind === 'jsonl') {
        bumpChunkMetaCounter('streamedRows', 1);
      }
      bumpChunkMetaBucket('sourceRows', sourceKind, 1);
      if (rows.length >= resolvedBatchSize || batchBytes >= maxBatchBytes) flush();
    };
    const finish = () => {
      flush();
      recordTable('chunks_stage', chunkCount, performance.now() - start);
      return chunkCount;
    };
    return { handleChunk, finish };
  };

  const ingestChunkMetaPieces = async (targetMode, indexDir, chunkMetaSources = null) => {
    const sources = chunkMetaSources || resolveChunkMetaSources(indexDir);
    if (!sources) return { count: 0 };
    const sourceKind = sources.format === 'jsonl' ? 'jsonl' : (sources.format === 'columnar' ? 'columnar' : 'json');
    const ingestor = createChunkMetaStageIngestor({ targetMode, sourceKind });
    if (sources.format === 'json') {
      bumpChunkMetaBucket('sourceFiles', 'json', 1);
      const data = readJson(sources.paths[0]);
      if (Array.isArray(data)) {
        for (const chunk of data) ingestor.handleChunk(chunk);
      }
    } else if (sources.format === 'columnar') {
      bumpChunkMetaBucket('sourceFiles', 'columnar', 1);
      const data = inflateColumnarRows(readJson(sources.paths[0]));
      if (Array.isArray(data)) {
        for (const chunk of data) ingestor.handleChunk(chunk);
      }
    } else {
      for (const chunkPath of sources.paths) {
        if (chunkPath) {
          bumpChunkMetaBucket('sourceFiles', 'jsonl', 1);
        }
        await readJsonLinesFile(chunkPath, ingestor.handleChunk, { requiredKeys: CHUNK_META_REQUIRED_KEYS });
      }
    }
    return { count: ingestor.finish() };
  };

  const finalizeChunkIngest = (targetMode, chunkCount) => {
    if (!chunkCount) return;
    const start = performance.now();
    db.exec(`
      INSERT OR REPLACE INTO chunks (
        id,
        chunk_id,
        mode,
        file,
        start,
        end,
        startLine,
        endLine,
        ext,
        kind,
        name,
        metaV2_json,
        headline,
        preContext,
        postContext,
        weight,
        tokens,
        ngrams,
        codeRelations,
        docmeta,
        stats,
        complexity,
        lint,
        externalDocs,
        last_modified,
        last_author,
        churn,
        churn_added,
        churn_deleted,
        churn_commits,
        chunk_authors
      )
      SELECT
        c.id,
        c.chunk_id,
        c.mode,
        COALESCE(c.file, f.file),
        c.start,
        c.end,
        c.startLine,
        c.endLine,
        COALESCE(c.ext, f.ext),
        c.kind,
        c.name,
        c.metaV2_json,
        c.headline,
        c.preContext,
        c.postContext,
        c.weight,
        c.tokens,
        c.ngrams,
        c.codeRelations,
        c.docmeta,
        c.stats,
        c.complexity,
        c.lint,
        COALESCE(c.externalDocs, f.externalDocs),
        COALESCE(c.last_modified, f.last_modified),
        COALESCE(c.last_author, f.last_author),
        COALESCE(c.churn, f.churn),
        COALESCE(c.churn_added, f.churn_added),
        COALESCE(c.churn_deleted, f.churn_deleted),
        COALESCE(c.churn_commits, f.churn_commits),
        c.chunk_authors
      FROM chunks_stage c
      LEFT JOIN file_meta_stage f ON c.file_id = f.id;

      INSERT OR REPLACE INTO chunks_fts (rowid, file, name, signature, kind, headline, doc, tokens)
      SELECT
        c.id,
        COALESCE(c.file, f.file),
        c.name,
        c.signature,
        c.kind,
        c.headline,
        c.doc,
        c.tokensText
      FROM chunks_stage c
      LEFT JOIN file_meta_stage f ON c.file_id = f.id;
    `);
    const durationMs = performance.now() - start;
    recordTable('chunks', chunkCount, durationMs);
    recordTable('chunks_fts', chunkCount, durationMs);
    db.exec('DELETE FROM chunks_stage;');
  };

  const ingestFileManifestFromChunks = (targetMode) => {
    const start = performance.now();
    const rows = db.prepare(`
      SELECT
        c.file AS file,
        COUNT(*) AS chunk_count,
        f.hash AS file_hash,
        f.size AS file_size
      FROM chunks c
      LEFT JOIN file_meta_stage f ON f.file = c.file
      WHERE c.mode = ?
      GROUP BY c.file
    `).all(targetMode);
    if (!rows.length) return;
    const insertTx = db.transaction((batch) => {
      for (const row of batch) {
        const normalizedFile = normalizeFilePath(row.file);
        if (!normalizedFile) continue;
        const entry = manifestByNormalized.get(normalizedFile)?.entry || null;
        const hash = entry?.hash || row.file_hash || null;
        const mtimeMs = Number.isFinite(entry?.mtimeMs) ? entry.mtimeMs : null;
        const size = Number.isFinite(entry?.size)
          ? entry.size
          : (Number.isFinite(row.file_size) ? row.file_size : null);
        insertFileManifest.run(
          targetMode,
          normalizedFile,
          hash,
          mtimeMs,
          size,
          row.chunk_count
        );
      }
    });
    const batch = [];
    for (const entry of rows) {
      batch.push(entry);
      if (batch.length >= resolvedBatchSize) {
        insertTx(batch);
        batch.length = 0;
        recordBatch('fileManifestBatches');
      }
    }
    if (batch.length) {
      insertTx(batch);
      recordBatch('fileManifestBatches');
    }
    recordTable('file_manifest', rows.length, performance.now() - start);
  };

  return {
    createChunkMetaStageIngestor,
    ingestChunkMetaPieces,
    finalizeChunkIngest,
    ingestFileMetaRows,
    ingestFileManifestFromChunks
  };
};
