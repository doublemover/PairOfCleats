import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES, readJsonFile } from '../../src/shared/artifact-io.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { checksumFile } from '../../src/shared/hash.js';

export const updatePieceManifest = async ({ indexDir, mode, totalChunks, dims }) => {
  const piecesDir = path.join(indexDir, 'pieces');
  const manifestPath = path.join(piecesDir, 'manifest.json');
  let existing = {};
  if (fsSync.existsSync(manifestPath)) {
    try {
      existing = readJsonFile(manifestPath, { maxBytes: MAX_JSON_BYTES }) || {};
    } catch {
      existing = {};
    }
  }
  const priorPieces = Array.isArray(existing.pieces) ? existing.pieces : [];
  const retained = [];
  for (const entry of priorPieces) {
    if (!entry || entry.type === 'embeddings') continue;
    if (entry.path === 'index_state.json') {
      const absPath = path.join(indexDir, entry.path.split('/').join(path.sep));
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
    { type: 'embeddings', name: 'dense_vectors_hnsw', format: 'bin', path: 'dense_vectors_hnsw.bin', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_hnsw_meta', format: 'json', path: 'dense_vectors_hnsw.meta.json', count: totalChunks, dims }
  ];
  const enriched = [];
  for (const entry of embeddingPieces) {
    const absPath = path.join(indexDir, entry.path);
    if (!fsSync.existsSync(absPath)) continue;
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
    enriched.push({
      ...entry,
      bytes,
      checksum: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : null
    });
  }
  const now = new Date().toISOString();
  const manifest = {
    version: existing.version || 2,
    generatedAt: existing.generatedAt || now,
    updatedAt: now,
    mode,
    stage: existing.stage || 'stage3',
    pieces: [...retained, ...enriched]
  };
  await fs.mkdir(piecesDir, { recursive: true });
  await writeJsonObjectFile(manifestPath, { fields: manifest, atomic: true });
};
