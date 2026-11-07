import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../../../src/shared/artifact-io/constants.js';
import { ARTIFACT_SCHEMA_DEFS, MANIFEST_ONLY_ARTIFACT_NAMES, validateArtifact } from '../../../src/contracts/artifact-schemas.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { checksumFileObservation } from '../../../src/shared/hash.js';
import { fromPosix } from '../../../src/shared/file-paths.js';
import { withGeneratedArtifactMetadata } from '../../../src/shared/generated-artifact-core.js';
import { readVerifiedContainedFileSync, assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { withIndexStatePublicationLock } from '../../../src/shared/index-state-publication.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { assertIndexStatePublicationSource } from './state.js';

const readPublicationJson = (indexDir, target) => JSON.parse(new TextDecoder('utf-8', { fatal: true })
  .decode(readVerifiedContainedFileSync(indexDir, target, { maxBytes: MAX_JSON_BYTES }).buffer));
const optionalJson = (indexDir, target) => {
  try { return { value: readPublicationJson(indexDir, target) }; }
  catch (error) {
    observeStorageResource(error, { phase: 'embedding-manifest-optional-json' }).requireSettled();
    if (error?.code !== 'ENOENT') throw error;
    return null;
  }
};
const optionalStat = async (indexDir, target) => {
  try { assertNoSymlinkPath(indexDir, target); return await fs.stat(target); }
  catch (error) {
    observeStorageResource(error, { phase: 'embedding-manifest-optional-stat' }).requireSettled();
    if (error?.code !== 'ENOENT') throw error;
    return null;
  }
};

/**
 * Update pieces manifest with embedding artifacts for a given mode.
 *
 * Deterministic: preserves non-embedding pieces and appends embedding pieces
 * in a stable order.
 *
 * @param {{ indexDir: string, mode: string, totalChunks: number, dims: number }} options
 * @returns {Promise<void>}
 */
const updatePieceManifestLocked = async ({ indexDir, mode, totalChunks, dims, backendPieces = null,
  embeddingGeneration = null }) => {
  const piecesDir = path.join(indexDir, 'pieces');
  const manifestPath = path.join(piecesDir, 'manifest.json');
  const manifestBakPath = `${manifestPath}.bak`;
  const loadMeta = (metaFile, schemaName, fallback) => {
    const metaPath = path.join(indexDir, metaFile);
    let meta;
    try { meta = readPublicationJson(indexDir, metaPath); }
    catch (error) {
      observeStorageResource(error, { phase: 'embedding-manifest-backend-meta' }).requireSettled();
      if (error?.code !== 'ENOENT') throw error;
      return fallback;
    }
    if (!validateArtifact(schemaName, meta).ok || !Number.isSafeInteger(meta.count) || meta.count < 0
      || !Number.isSafeInteger(meta.dims) || meta.dims < 1) throw Object.assign(
      new Error(`Cannot publish invalid embedding backend metadata: ${metaFile}`), { code: 'ERR_EMBEDDING_BACKEND_META' });
    return { count: meta.count, dims: meta.dims };
  };
  // Explicit generation pieces carry their own metadata. Old unselected legacy
  // backend files cannot determine admission for another requested backend.
  const legacyStats = suffix => backendPieces === null
    ? loadMeta(`dense_vectors${suffix}_hnsw.meta.json`, `dense_vectors${suffix}_hnsw_meta`, { count: totalChunks, dims })
    : { count: totalChunks, dims };
  const hnswStats = legacyStats(''), hnswDocStats = legacyStats('_doc'), hnswCodeStats = legacyStats('_code');
  let existing = null;
  {
    let loadError = null;
    for (const sourcePath of [manifestPath, manifestBakPath]) {
      try {
        // Validate each candidate before trusting it or cleaning up recovery
        // evidence; a syntactically valid but malformed primary is still corrupt.
        const candidate = readPublicationJson(indexDir, sourcePath);
        if (!validateArtifact('pieces_manifest', candidate).ok
          || candidate.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION) {
          throw new Error('Existing pieces manifest has an invalid shape or artifact surface version.');
        }
        existing = candidate;
        break;
      } catch (error) {
        observeStorageResource(error, { phase: 'embedding-manifest-existing-read' }).requireSettled();
        if (error instanceof AggregateError) throw error;
        if (error.code !== 'ENOENT') loadError ||= error;
      }
    }
    if (!existing && loadError) throw new Error(`Cannot refresh embedding pieces without a valid existing manifest: ${loadError.message}`, { cause: loadError });
  }
  if (!existing || typeof existing !== 'object') {
    existing = {
      version: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      compatibilityKey: null,
      generatedAt: new Date().toISOString(),
      updatedAt: null,
      mode,
      stage: 'stage3',
      repoId: null,
      buildId: null,
      pieces: []
    };
  }
  const priorPieces = Array.isArray(existing.pieces) ? existing.pieces : [];
  const priorEmbeddingPiecesByKey = new Map();
  for (const entry of priorPieces) {
    if (!entry || entry.type !== 'embeddings') continue;
    const name = typeof entry.name === 'string' ? entry.name : '';
    const relPath = typeof entry.path === 'string' ? entry.path : '';
    priorEmbeddingPiecesByKey.set(`${name}|${relPath}`, entry);
  }
  const retained = [];
  for (const entry of priorPieces) {
    if (!entry || entry.type === 'embeddings') continue;
    if (entry.path === 'index_state.json') {
      const absPath = path.join(indexDir, fromPosix(entry.path));
      const result = await checksumFileObservation(absPath, { containedRoot: indexDir });
      retained.push({
        ...entry,
        bytes: result.bytes,
        checksum: `${result.algo}:${result.value}`
      });
      continue;
    }
    retained.push(entry);
  }
  const embeddingPieces = [
    { type: 'embeddings', name: 'dense_vectors', format: 'bin', path: 'dense_vectors_uint8.bin', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_doc', format: 'bin', path: 'dense_vectors_doc_uint8.bin', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_code', format: 'bin', path: 'dense_vectors_code_uint8.bin', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_binary_meta', format: 'json', path: 'dense_vectors_uint8.bin.meta.json', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_doc_binary_meta', format: 'json', path: 'dense_vectors_doc_uint8.bin.meta.json', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_code_binary_meta', format: 'json', path: 'dense_vectors_code_uint8.bin.meta.json', count: totalChunks, dims },
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
  let selectedPieces = backendPieces === null ? embeddingPieces : [
    ...embeddingPieces.filter(entry => !/_hnsw(?:_meta)?$|_lancedb(?:_meta)?$/.test(entry.name)),
    ...backendPieces
  ];
  for (const suffix of ['', '_doc', '_code']) {
    const name = `dense_vectors${suffix}`;
    const base = `${name}_uint8`;
    const binaryStat = await optionalStat(indexDir, path.join(indexDir, `${base}.bin`));
    if (binaryStat && !binaryStat.isFile()) throw new Error(`Dense vector binary is not a regular file: ${name}`);
    let binaryCurrent = binaryStat !== null;
    if (binaryCurrent && embeddingGeneration) {
      const binaryMetaPath = path.join(indexDir, `${base}.bin.meta.json`);
      const metadata = optionalJson(indexDir, binaryMetaPath);
      if (metadata && (!metadata.value || typeof metadata.value !== 'object' || Array.isArray(metadata.value))) {
        throw new Error(`Invalid dense vector binary metadata: ${name}`);
      }
      binaryCurrent = metadata !== null && metadata.value.embeddingGeneration === embeddingGeneration;
    }
    if (binaryCurrent) continue;
    selectedPieces = selectedPieces.filter(piece => ![name, `${name}_binary_meta`].includes(piece.name));
    const metaPath = path.join(indexDir, `${base}.meta.json`);
    const metadata = optionalJson(indexDir, metaPath);
    if (!metadata) continue;
    const meta = metadata.value;
    if (!meta || typeof meta !== 'object' || !Array.isArray(meta.parts)) throw new Error(`Invalid dense vector shard metadata: ${name}`);
    for (const part of meta.parts) {
      if (typeof part.path !== 'string' || !part.path.startsWith(`${base}.parts/`)
        || part.path.split('/').some(component => component === '..')) {
        throw new Error(`Invalid dense vector shard path for ${name}`);
      }
      selectedPieces.push({ type: 'embeddings', name, format: 'jsonl', path: part.path,
        count: part.records, dims });
    }
  }
  for (const entry of selectedPieces) {
    if (!allowedNames.has(entry.name)) continue;
    const absPath = path.join(indexDir, entry.path);
    let bytes = null;
    let checksum = null;
    let checksumAlgo = null;
    try {
      assertNoSymlinkPath(indexDir, absPath);
      const stat = await fs.stat(absPath);
      if (stat.isDirectory()) {
        bytes = null;
      } else {
        const result = await checksumFileObservation(absPath, { containedRoot: indexDir });
        bytes = result.bytes;
        checksum = result.value;
        checksumAlgo = result.algo;
      }
    } catch (error) {
      observeStorageResource(error, { phase: 'embedding-manifest-piece-observation' }).requireSettled();
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const priorEmbedding = priorEmbeddingPiecesByKey.get(`${entry.name}|${entry.path}`);
    const preserved = priorEmbedding && typeof priorEmbedding === 'object'
      ? { ...priorEmbedding }
      : {};
    delete preserved.bytes;
    delete preserved.checksum;
    delete preserved.statError;
    delete preserved.checksumError;
    enriched.push({
      ...preserved,
      ...entry,
      bytes,
      checksum: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : null
    });
  }
  const now = new Date().toISOString();
  const manifest = withGeneratedArtifactMetadata({
    extensions: existing.extensions,
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
  }, 'pieces-manifest');
  await fs.mkdir(piecesDir, { recursive: true });
  await writeJsonObjectFile(manifestPath, { fields: manifest, atomic: true });
};

/** Snapshot producer JSON before waiting, then read/refresh under the same owner
 * as native/embedding state writes. Never acquire this lock recursively. */
export const updatePieceManifest = async ({ indexDir, publicationState = null, signal = null, ...options }) => {
  observeStorageResource(options.backendPieces, { phase: 'embedding-manifest-input-pieces' }).requireSettled();
  const requested = structuredClone(options);
  return withIndexStatePublicationLock(indexDir, root => {
    if (publicationState !== null) assertIndexStatePublicationSource(path.join(root, 'index_state.json'), publicationState);
    return updatePieceManifestLocked({ indexDir: root, ...requested });
  }, { signal });
};
