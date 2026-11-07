import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readContainedFile } from '../../../src/shared/contained-file.js';
import { createXxhash64Hasher } from '../../../src/shared/hash/xxhash-backend.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { resolveBinaryArtifactPath, resolveDirArtifactPath } from '../../../src/shared/artifact-io/manifest.js';
import { resolveHnswPaths } from '../../../src/shared/hnsw.js';
import { resolveLanceDbPaths, assertLanceDbPayload } from '../../../src/shared/lancedb.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { buildNativeBackendReuseKey } from './backend-reuse-key.js';
import { copyBackendPayloadFile, copyBackendPayloadInventory } from './backend-payload-copy.js';

const readMeta = async (root, filename, piece, signal) => {
  if (!piece?.checksum || !/^(sha256|sha1|xxh64):[a-f0-9]+$/i.test(piece.checksum)) throw new Error('Missing backend metadata checksum.');
  const raw = await readContainedFile(root, filename, { maxBytes: 1024 * 1024, expectedBytes: piece.bytes ?? null, signal });
  const [algorithm, expected] = piece.checksum.toLowerCase().split(':');
  const digest = algorithm === 'xxh64' ? await createXxhash64Hasher() : createHash(algorithm);
  digest.update(raw);
  if (digest.digest('hex') !== expected) throw new Error('Backend metadata checksum differs from its manifest.');
  const parsed = JSON.parse(raw.toString('utf8')); return parsed.fields || parsed;
};

/** Carry only a complete unchanged generation into this attempt's private
 * staging. Legacy metadata and uncertain proofs conservatively rebuild. */
export const reuseNativeBackend = async ({ backend, variant, indexDir, stageDir, priorManifest, priorState,
  embeddingIdentity, embeddingGeneration, config, normalize, dims, modelId, quantization, scale, signal = null }) => {
  if (!priorState?.ready || priorState.pending || priorState.embeddingGeneration !== embeddingGeneration
    || stableStringify(priorState.embeddingIdentity) !== stableStringify(embeddingIdentity)
    || !/^[a-f0-9]{64}$/.test(embeddingGeneration)) return { reused: false, reason: 'changed-or-unready-generation' };
  const key = buildNativeBackendReuseKey({ backend, config, normalize, dims, modelId, quantization, scale });
  if (!key) return { reused: false, reason: 'unknown-native-runtime' };
  const base = variant === 'merged' ? 'dense_vectors' : `dense_vectors_${variant}`, name = `${base}_${backend}`;
  const pieces = priorManifest?.pieces || [];
  const dataPieces = pieces.filter(piece => piece.name === name), metaPieces = pieces.filter(piece => piece.name === `${name}_meta`);
  if (dataPieces.length !== 1 || metaPieces.length !== 1) return { reused: false, reason: 'missing-manifest-pair' };
  const target = backend === 'hnsw' ? resolveHnswPaths(stageDir, variant) : resolveLanceDbPaths(stageDir)[variant];
  const targetData = target.indexPath || target.dir;
  const work = { copiedBytes: 0 };
  let touchedData = false, touchedMeta = false, copyPhase = 'data';
  try {
    throwIfAborted(signal);
    const metadataPath = resolveBinaryArtifactPath(indexDir, `${name}_meta`, { manifest: priorManifest, strict: true });
    const meta = await readMeta(indexDir, metadataPath, metaPieces[0], signal);
    if (meta.embeddingGeneration !== embeddingGeneration || meta.variant !== variant || meta.dims !== dims || meta.model !== (modelId || null)
      || stableStringify(meta.embeddingIdentity) !== stableStringify(embeddingIdentity)
      || meta.extensions?.nativeBuildKey !== key || !Number.isSafeInteger(meta.count) || meta.count <= 0
      || !new RegExp(`^\\.embeddings-backends/${embeddingGeneration}-[a-f0-9-]{36}$`).test(meta.backendGeneration || '')) {
      return { reused: false, reason: 'changed-native-build-proof' };
    }
    const source = backend === 'hnsw'
      ? resolveBinaryArtifactPath(indexDir, name, { manifest: priorManifest, strict: true })
      : resolveDirArtifactPath(indexDir, name, { manifest: priorManifest, strict: true });
    if (path.dirname(source) !== path.join(indexDir, meta.backendGeneration)
      || path.dirname(metadataPath) !== path.dirname(source) || dataPieces[0].count !== meta.count) {
      return { reused: false, reason: 'mismatched-generation-path' };
    }
    if (backend === 'hnsw') {
      await copyBackendPayloadFile({ sourceRoot: indexDir, source, target: targetData,
        bytes: dataPieces[0].bytes, checksum: dataPieces[0].checksum, signal, metrics: work });
    } else {
      assertLanceDbPayload(source, { table: meta.table, count: meta.count });
      await copyBackendPayloadInventory({ sourceRoot: source, targetRoot: targetData,
        inventory: meta.extensions?.nativePayloadInventory, signal, metrics: work });
      touchedData = true;
      assertLanceDbPayload(targetData, { table: meta.table, count: meta.count });
    }
    touchedData = true; copyPhase = 'metadata';
    await copyBackendPayloadFile({ sourceRoot: indexDir, source: metadataPath, target: target.metaPath,
      bytes: metaPieces[0].bytes, checksum: metaPieces[0].checksum, signal, metrics: work });
    touchedMeta = true;
    return { reused: true, result: { skipped: false, count: meta.count, reused: true, copiedBytes: work.copiedBytes }, work };
  } catch (error) {
    if (error.backendCopyTargetCreated) {
      if (copyPhase === 'data') touchedData = true; else touchedMeta = true;
    }
    if (touchedData || touchedMeta) {
      try {
        if (touchedData) await fs.rm(targetData, { recursive: backend === 'lancedb', force: true });
        if (touchedMeta) await fs.rm(target.metaPath, { force: true });
      } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Backend reuse staging cleanup failed.', { cause: error }); }
    }
    throwIfAborted(signal);
    return { reused: false, reason: error.code || error.message };
  }
};
