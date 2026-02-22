import { performance } from 'node:perf_hooks';
import {
  buildFileManifestRows,
  normalizeChunkForSqlite
} from '../../build-helpers.js';
import { normalizeFilePath } from '../../utils.js';
import {
  CHUNK_META_REQUIRED_KEYS,
  iterateChunkMetaSources,
  resolveChunkMetaSourceKind,
  resolveChunkMetaSources,
  resolveManifestByNormalized
} from './sources.js';

const createBatchInserter = ({
  batchSize,
  maxBatchBytes = null,
  estimateRowBytes = null,
  insertBatch,
  onFlush = null
}) => {
  const rows = [];
  let batchBytes = 0;
  const flush = () => {
    if (!rows.length) return 0;
    const pending = rows.splice(0, rows.length);
    insertBatch(pending);
    batchBytes = 0;
    if (typeof onFlush === 'function') onFlush();
    return pending.length;
  };
  const push = (row) => {
    rows.push(row);
    if (typeof estimateRowBytes === 'function') {
      const estimate = Number(estimateRowBytes(row));
      if (Number.isFinite(estimate) && estimate > 0) {
        batchBytes += estimate;
      }
    }
    if ((batchSize > 0 && rows.length >= batchSize)
      || (maxBatchBytes > 0 && batchBytes >= maxBatchBytes)) {
      flush();
    }
  };
  return { push, flush };
};

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
    manifestByNormalized: manifestByNormalizedInput
  } = ctx;
  const manifestByNormalized = resolveManifestByNormalized(manifestByNormalizedInput);

  const ingestFileMetaRows = async (fileMetaSource) => {
    if (!fileMetaSource) return 0;
    const start = performance.now();
    const maxBatchBytes = resolvedBatchSize * 4096;
    let count = 0;
    const insertTx = db.transaction((batch) => {
      for (const row of batch) {
        insertFileMetaStage.run(row);
      }
    });
    const estimateRowBytes = (row) => {
      if (!row) return 0;
      let bytes = 128;
      if (row.file) bytes += row.file.length;
      if (row.ext) bytes += row.ext.length;
      if (row.hash) bytes += row.hash.length;
      if (row.hashAlgo) bytes += row.hashAlgo.length;
      return bytes;
    };
    const batchInserter = createBatchInserter({
      batchSize: resolvedBatchSize,
      maxBatchBytes,
      estimateRowBytes,
      insertBatch: (batch) => insertTx(batch),
      onFlush: () => recordBatch('fileMetaBatches')
    });
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
      batchInserter.push(row);
      count += 1;
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
    batchInserter.flush();
    recordTable('file_meta_stage', count, performance.now() - start);
    return count;
  };

  const buildChunkRowBase = (chunk, targetMode) => {
    const tokensArray = Array.isArray(chunk.tokens) ? chunk.tokens : [];
    if (tokensArray.length > 0) {
      bumpChunkMetaCounter('tokenTextMaterialized', 1);
    } else {
      bumpChunkMetaCounter('tokenTextSkipped', 1);
    }
    return normalizeChunkForSqlite(chunk, {
      mode: targetMode,
      id: Number.isFinite(chunk.id) ? chunk.id : null,
      includeFileId: true,
      fileId: Number.isFinite(chunk.fileId) ? chunk.fileId : null,
      normalizeText: (value) => (value || null),
      emptyTokensText: null
    });
  };

  const createChunkMetaStageIngestor = ({ targetMode, sourceKind }) => {
    const start = performance.now();
    const insert = db.transaction((batch) => {
      for (const row of batch) {
        insertChunkStage.run(row);
      }
    });
    const maxBatchBytes = resolvedBatchSize * 4096;
    const estimateRowBytes = (row) => {
      if (!row) return 0;
      let bytes = 128;
      if (row.file) bytes += row.file.length;
      if (row.ext) bytes += row.ext.length;
      if (row.name) bytes += row.name.length;
      if (row.tokensText) bytes += row.tokensText.length;
      return bytes;
    };
    const batchInserter = createBatchInserter({
      batchSize: resolvedBatchSize,
      maxBatchBytes,
      estimateRowBytes,
      insertBatch: (batch) => insert(batch),
      onFlush: () => recordBatch('chunkMetaBatches')
    });
    let chunkCount = 0;
    bumpChunkMetaCounter('passes', 1);
    const handleChunk = (chunk, fallbackId = null) => {
      if (!chunk) return;
      if (!Number.isFinite(chunk.id)) {
        chunk.id = Number.isFinite(fallbackId) ? fallbackId : chunkCount;
      }
      const row = buildChunkRowBase(chunk, targetMode);
      batchInserter.push(row);
      chunkCount += 1;
      bumpChunkMetaCounter('rows', 1);
      if (sourceKind === 'jsonl') {
        bumpChunkMetaCounter('streamedRows', 1);
      }
      bumpChunkMetaBucket('sourceRows', sourceKind, 1);
    };
    const finish = () => {
      batchInserter.flush();
      recordTable('chunks_stage', chunkCount, performance.now() - start);
      return chunkCount;
    };
    return { handleChunk, finish };
  };

  const ingestChunkMetaPieces = async (targetMode, indexDir, chunkMetaSources = null) => {
    const sources = chunkMetaSources || resolveChunkMetaSources(indexDir);
    if (!sources) return { count: 0 };
    const sourceKind = resolveChunkMetaSourceKind(sources.format);
    const ingestor = createChunkMetaStageIngestor({ targetMode, sourceKind });
    await iterateChunkMetaSources(
      sources,
      (chunk, index) => ingestor.handleChunk(chunk, index),
      {
        requiredKeys: CHUNK_META_REQUIRED_KEYS,
        onSourceFile: (_, kind) => bumpChunkMetaBucket('sourceFiles', kind, 1)
      }
    );
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
    const fileCounts = new Map();
    const fallbackByNormalized = new Map();
    for (const row of rows) {
      const normalizedFile = normalizeFilePath(row.file);
      if (!normalizedFile) continue;
      const chunkCount = Number(row.chunk_count);
      fileCounts.set(normalizedFile, Number.isFinite(chunkCount) ? chunkCount : 0);
      const fileSize = Number(row.file_size);
      fallbackByNormalized.set(normalizedFile, {
        file_hash: row.file_hash || null,
        file_size: Number.isFinite(fileSize) ? fileSize : null
      });
    }
    const manifestRows = buildFileManifestRows({
      mode: targetMode,
      fileCounts,
      manifestByNormalized,
      fallbackByNormalized
    });
    if (!manifestRows.length) return;
    const insertTx = db.transaction((batch) => {
      for (const manifestRow of batch) {
        insertFileManifest.run(
          manifestRow.mode,
          manifestRow.file,
          manifestRow.hash,
          manifestRow.mtimeMs,
          manifestRow.size,
          manifestRow.chunk_count
        );
      }
    });
    const batchInserter = createBatchInserter({
      batchSize: resolvedBatchSize,
      insertBatch: (batch) => insertTx(batch),
      onFlush: () => recordBatch('fileManifestBatches')
    });
    for (const manifestRow of manifestRows) {
      batchInserter.push(manifestRow);
    }
    batchInserter.flush();
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
