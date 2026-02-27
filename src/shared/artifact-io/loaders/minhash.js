import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { coerceNonNegativeInt } from '../../number-coerce.js';
import { createPackedChecksumValidator } from '../checksum.js';
import { loadPiecesManifest, resolveManifestArtifactSources } from '../manifest.js';
import { readJsonFileCached, warnMaterializeFallback } from './shared.js';
import { loadJsonObjectArtifact } from './core.js';
import { resolveReadableArtifactPathState } from './core-source-resolution.js';

const resolvePackedMinhashArtifacts = ({
  dir,
  sources,
  maxBytes
}) => {
  if (!sources?.paths?.length || sources.format !== 'packed') return null;
  if (sources.paths.length > 1) {
    throw new Error('Ambiguous packed sources for minhash_signatures');
  }
  const packedPath = sources.paths[0];
  const metaPath = sources.metaPath || path.join(dir, 'minhash_signatures.packed.meta.json');
  const packedState = resolveReadableArtifactPathState(packedPath);
  const metaState = resolveReadableArtifactPathState(metaPath);
  if (!packedState.exists || !metaState.exists) {
    throw new Error('Missing packed minhash signature artifacts');
  }
  const resolvedPackedPath = packedState.path;
  const resolvedMetaPath = metaState.path;
  const metaRaw = readJsonFileCached(resolvedMetaPath, { maxBytes });
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  const dims = coerceNonNegativeInt(meta?.dims) ?? 0;
  const count = coerceNonNegativeInt(meta?.count) ?? 0;
  if (!dims || !count) {
    throw new Error('Invalid packed minhash meta');
  }
  return {
    dims,
    count,
    resolvedPackedPath,
    checksumValidator: createPackedChecksumValidator(meta, {
      label: 'Packed minhash signatures'
    })
  };
};

/**
 * Load minhash signatures, preferring packed binary representation when available.
 *
 * Returns `null` when signatures are absent.
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean
 * }} [options]
 * @returns {Promise<{ signatures: (Uint32Array|number[])[] }|null>}
 */
export const loadMinhashSignatures = async (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'minhash_signatures',
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) return null;
  if (sources.format === 'packed') {
    const packed = resolvePackedMinhashArtifacts({ dir, sources, maxBytes });
    const dims = packed.dims;
    const count = packed.count;
    const buffer = fs.readFileSync(packed.resolvedPackedPath);
    packed.checksumValidator?.update(buffer);
    packed.checksumValidator?.verify();
    const total = dims * count;
    if (buffer.byteLength % 4 !== 0) {
      throw new Error('Packed minhash signatures invalid byte alignment');
    }
    if (buffer.byteLength !== total * 4) {
      throw new Error('Packed minhash signatures size mismatch');
    }
    const view = new Uint32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
    const signatures = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const start = i * dims;
      signatures[i] = view.subarray(start, start + dims);
    }
    return { signatures };
  }
  if (sources.format !== 'json') {
    throw new Error(`Unsupported minhash_signatures format: ${sources.format}`);
  }
  try {
    return await loadJsonObjectArtifact(dir, 'minhash_signatures', {
      maxBytes,
      manifest: resolvedManifest,
      strict
    });
  } catch (err) {
    const message = err?.message || '';
    if (message.includes('Missing manifest entry for minhash_signatures')) {
      return null;
    }
    throw err;
  }
};

/**
 * Stream minhash signatures as `{ docId, sig }` rows.
 *
 * Uses batched binary reads for packed artifacts and falls back to JSON payloads.
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean,
 *   materialize?: boolean,
 *   batchSize?: number
 * }} [options]
 * @returns {AsyncGenerator<{ docId: number, sig: Uint32Array|number[] }, void, unknown>}
 */
export const loadMinhashSignatureRows = async function* (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    materialize = false,
    batchSize = 2048
  } = {}
) {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'minhash_signatures',
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) return;
  if (sources.format === 'packed') {
    const packed = resolvePackedMinhashArtifacts({ dir, sources, maxBytes });
    const dims = packed.dims;
    const count = packed.count;
    const bytesPerSig = dims * 4;
    const totalBytes = bytesPerSig * count;
    const stat = await fsPromises.stat(packed.resolvedPackedPath);
    if (stat.size % 4 !== 0) {
      throw new Error('Packed minhash signatures invalid byte alignment');
    }
    if (stat.size !== totalBytes) {
      throw new Error('Packed minhash signatures size mismatch');
    }
    const handle = await fsPromises.open(packed.resolvedPackedPath, 'r');
    const resolvedBatchSize = Math.max(1, Math.floor(Number(batchSize)) || 2048);
    const buffer = Buffer.allocUnsafe(resolvedBatchSize * bytesPerSig);
    try {
      let docId = 0;
      while (docId < count) {
        const remaining = count - docId;
        const batchCount = Math.min(resolvedBatchSize, remaining);
        const bytesToRead = batchCount * bytesPerSig;
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, docId * bytesPerSig);
        if (bytesRead < bytesToRead) {
          throw new Error('Packed minhash signatures truncated');
        }
        packed.checksumValidator?.update(buffer, 0, bytesRead);
        const view = new Uint32Array(buffer.buffer, buffer.byteOffset, bytesRead / 4);
        for (let i = 0; i < batchCount; i += 1) {
          const start = i * dims;
          const end = start + dims;
          // Copy each signature out of the reusable batch buffer so later reads
          // cannot mutate previously yielded rows.
          const sig = Uint32Array.from(view.subarray(start, end));
          yield { docId: docId + i, sig };
        }
        docId += batchCount;
      }
      packed.checksumValidator?.verify();
    } finally {
      await handle.close();
    }
    return;
  }
  if (sources.format !== 'json') {
    throw new Error(`Unsupported minhash_signatures format: ${sources.format}`);
  }
  let payload = null;
  try {
    payload = await loadJsonObjectArtifact(dir, 'minhash_signatures', {
      maxBytes,
      manifest: resolvedManifest,
      strict
    });
  } catch (err) {
    const message = err?.message || '';
    if (message.includes('Missing manifest entry for minhash_signatures')) {
      return;
    }
    throw err;
  }
  const signatures = Array.isArray(payload?.signatures) ? payload.signatures : null;
  if (!signatures) return;
  if (!materialize) {
    warnMaterializeFallback(dir, 'minhash_signatures', 'json');
  }
  for (let docId = 0; docId < signatures.length; docId += 1) {
    const sig = signatures[docId];
    if (!sig) continue;
    yield { docId, sig };
  }
};
