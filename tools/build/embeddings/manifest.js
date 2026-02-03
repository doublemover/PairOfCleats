import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES, loadPiecesManifest, readJsonFile } from '../../../src/shared/artifact-io.js';
import { ARTIFACT_SCHEMA_DEFS, MANIFEST_ONLY_ARTIFACT_NAMES } from '../../../src/shared/artifact-schemas.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { checksumFile } from '../../../src/shared/hash.js';
import { fromPosix } from '../../../src/shared/files.js';

export const updatePieceManifest = async ({ indexDir, mode, totalChunks, dims }) => {
  const piecesDir = path.join(indexDir, 'pieces');
  const manifestPath = path.join(piecesDir, 'manifest.json');
  const loadMeta = (metaFile, fallback) => {
    const metaPath = path.join(indexDir, metaFile);
    let meta = null;
    if (fsSync.existsSync(metaPath)) {
      try {
        meta = readJsonFile(metaPath, { maxBytes: MAX_JSON_BYTES }) || null;
      } catch {
        meta = null;
      }
    }
    const count = Number.isFinite(Number(meta?.count)) ? Number(meta.count) : fallback.count;
    const dimsValue = Number.isFinite(Number(meta?.dims)) ? Number(meta.dims) : fallback.dims;
    return { count, dims: dimsValue };
  };
  const hnswStats = loadMeta('dense_vectors_hnsw.meta.json', { count: totalChunks, dims });
  const hnswDocStats = loadMeta('dense_vectors_doc_hnsw.meta.json', { count: totalChunks, dims });
  const hnswCodeStats = loadMeta('dense_vectors_code_hnsw.meta.json', { count: totalChunks, dims });
  let existing = {};
  if (fsSync.existsSync(manifestPath)) {
    try {
      existing = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: false }) || {};
    } catch {
      existing = {};
    }
  }
  const priorPieces = Array.isArray(existing.pieces) ? existing.pieces : [];
  const retained = [];
  for (const entry of priorPieces) {
    if (!entry || entry.type === 'embeddings') continue;
    if (entry.path === 'index_state.json') {
      const absPath = path.join(indexDir, fromPosix(entry.path));
      let bytes = null;
      let checksum = null;
      let checksumAlgo = null;
      try {
        const stat = await fs.stat(absPath);
        bytes = stat.size;
        const result = await checksumFile(absPath);
        checksum = result?.value || null;
        checksumAlgo = result?.algo || null;
      } catch {}
      retained.push({
        ...entry,
        bytes,
        checksum: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : null
      });
      continue;
    }
    retained.push(entry);
  }
  const embeddingPieces = [
    { type: 'embeddings', name: 'dense_vectors', format: 'json', path: 'dense_vectors_uint8.json', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_doc', format: 'json', path: 'dense_vectors_doc_uint8.json', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_code', format: 'json', path: 'dense_vectors_code_uint8.json', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_hnsw', format: 'bin', path: 'dense_vectors_hnsw.bin', count: hnswStats.count, dims: hnswStats.dims },
    { type: 'embeddings', name: 'dense_vectors_hnsw_meta', format: 'json', path: 'dense_vectors_hnsw.meta.json', count: hnswStats.count, dims: hnswStats.dims },
    { type: 'embeddings', name: 'dense_vectors_doc_hnsw', format: 'bin', path: 'dense_vectors_doc_hnsw.bin', count: hnswDocStats.count, dims: hnswDocStats.dims },
    { type: 'embeddings', name: 'dense_vectors_doc_hnsw_meta', format: 'json', path: 'dense_vectors_doc_hnsw.meta.json', count: hnswDocStats.count, dims: hnswDocStats.dims },
    { type: 'embeddings', name: 'dense_vectors_code_hnsw', format: 'bin', path: 'dense_vectors_code_hnsw.bin', count: hnswCodeStats.count, dims: hnswCodeStats.dims },
    { type: 'embeddings', name: 'dense_vectors_code_hnsw_meta', format: 'json', path: 'dense_vectors_code_hnsw.meta.json', count: hnswCodeStats.count, dims: hnswCodeStats.dims },
    { type: 'embeddings', name: 'dense_vectors_lancedb', format: 'dir', path: 'dense_vectors.lancedb', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_lancedb_meta', format: 'json', path: 'dense_vectors.lancedb.meta.json', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_doc_lancedb', format: 'dir', path: 'dense_vectors_doc.lancedb', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_doc_lancedb_meta', format: 'json', path: 'dense_vectors_doc.lancedb.meta.json', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_code_lancedb', format: 'dir', path: 'dense_vectors_code.lancedb', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_code_lancedb_meta', format: 'json', path: 'dense_vectors_code.lancedb.meta.json', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_sqlite_vec_meta', format: 'json', path: 'dense_vectors_sqlite_vec.meta.json', count: totalChunks, dims }
  ];
  const schemaNames = new Set(Object.keys(ARTIFACT_SCHEMA_DEFS));
  const allowedNames = new Set([...schemaNames, ...MANIFEST_ONLY_ARTIFACT_NAMES]);
  const enriched = [];
  for (const entry of embeddingPieces) {
    if (!allowedNames.has(entry.name)) continue;
    const absPath = path.join(indexDir, entry.path);
    if (!fsSync.existsSync(absPath)) continue;
    let bytes = null;
    let checksum = null;
    let checksumAlgo = null;
    try {
      const stat = await fs.stat(absPath);
      if (stat.isDirectory()) {
        bytes = null;
      } else {
        bytes = stat.size;
        const result = await checksumFile(absPath);
        checksum = result?.value || null;
        checksumAlgo = result?.algo || null;
      }
    } catch {}
    enriched.push({
      ...entry,
      bytes,
      checksum: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : null
    });
  }
  const now = new Date().toISOString();
  const manifest = {
    version: existing.version || 2,
    artifactSurfaceVersion: existing.artifactSurfaceVersion || ARTIFACT_SURFACE_VERSION,
    compatibilityKey: existing.compatibilityKey ?? null,
    generatedAt: existing.generatedAt || now,
    updatedAt: now,
    mode: existing.mode || mode,
    stage: existing.stage || 'stage3',
    repoId: existing.repoId ?? null,
    buildId: existing.buildId ?? null,
    pieces: [...retained, ...enriched]
  };
  await fs.mkdir(piecesDir, { recursive: true });
  await writeJsonObjectFile(manifestPath, { fields: manifest, atomic: true });
};
