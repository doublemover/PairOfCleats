import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { MAX_JSON_BYTES } from '../constants.js';
import {
  INTEGER_COERCE_MODE_STRICT,
  coerceNonNegativeInt
} from '../../number-coerce.js';
import { createPackedChecksumValidator } from '../checksum.js';
import { loadPiecesManifest, resolveManifestArtifactSources } from '../manifest.js';
import {
  createLoaderError,
  readJsonFileCached,
  warnMaterializeFallback
} from './shared.js';
import { loadJsonObjectArtifact } from './core.js';
import { resolveReadableArtifactPathState } from './core-source-resolution.js';

const BYTES_PER_U32 = 4;
const MAX_STREAM_BUFFER_HARD_CAP_BYTES = 64 * 1024 * 1024;
const HEAP_BUFFER_BUDGET_FRACTION = 0.02;

const toStrictPositiveSafeInt = (value, label) => {
  const parsed = coerceNonNegativeInt(value, { mode: INTEGER_COERCE_MODE_STRICT });
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw createLoaderError(
      'ERR_ARTIFACT_INVALID',
      `Invalid packed minhash ${label}: ${String(value)}`
    );
  }
  return parsed;
};

const multiplySafeInts = (left, right, label) => {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    throw createLoaderError('ERR_ARTIFACT_INVALID', `Invalid packed minhash ${label}`);
  }
  const product = left * right;
  if (!Number.isSafeInteger(product) || product < 0) {
    throw createLoaderError(
      'ERR_ARTIFACT_INVALID',
      `Packed minhash ${label} exceeds safe integer bounds`
    );
  }
  return product;
};

const resolvePositiveFiniteByteLimit = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
};

const assertWithinMaxBytes = (actualBytes, maxBytes, label) => {
  const resolvedMaxBytes = resolvePositiveFiniteByteLimit(maxBytes);
  if (!resolvedMaxBytes) return;
  if (Number(actualBytes) > resolvedMaxBytes) {
    throw createLoaderError(
      'ERR_ARTIFACT_TOO_LARGE',
      `${label} exceeds maxBytes (${actualBytes} > ${resolvedMaxBytes})`
    );
  }
};

const resolveMinhashStreamBufferBudgetBytes = (maxBytes) => {
  const candidates = [MAX_STREAM_BUFFER_HARD_CAP_BYTES];
  const resolvedMaxBytes = resolvePositiveFiniteByteLimit(maxBytes);
  if (resolvedMaxBytes) {
    candidates.push(resolvedMaxBytes);
  }
  try {
    const heapLimit = Number(getHeapStatistics()?.heap_size_limit);
    if (Number.isFinite(heapLimit) && heapLimit > 0) {
      const heapBudget = Math.floor(heapLimit * HEAP_BUFFER_BUDGET_FRACTION);
      if (heapBudget > 0) {
        candidates.push(heapBudget);
      }
    }
  } catch {}
  return Math.max(BYTES_PER_U32, Math.floor(Math.min(...candidates)));
};

const resolvePackedShapeAndByteLengths = ({ dims, count }) => {
  const totalValues = multiplySafeInts(dims, count, 'shape product');
  const totalBytes = multiplySafeInts(totalValues, BYTES_PER_U32, 'size');
  const bytesPerSig = multiplySafeInts(dims, BYTES_PER_U32, 'row size');
  return {
    totalValues,
    totalBytes,
    bytesPerSig
  };
};

const assertPackedRowFitsStreamBudget = ({ bytesPerSig, maxBytes }) => {
  const budgetBytes = resolveMinhashStreamBufferBudgetBytes(maxBytes);
  if (bytesPerSig > budgetBytes) {
    throw createLoaderError(
      'ERR_ARTIFACT_TOO_LARGE',
      `Packed minhash signature row exceeds stream buffer budget (${bytesPerSig} > ${budgetBytes})`
    );
  }
  return budgetBytes;
};

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
  const dims = toStrictPositiveSafeInt(meta?.dims, 'dims');
  const count = toStrictPositiveSafeInt(meta?.count, 'count');
  const shape = resolvePackedShapeAndByteLengths({ dims, count });
  assertWithinMaxBytes(shape.totalBytes, maxBytes, 'Packed minhash signatures');
  return {
    dims,
    count,
    totalValues: shape.totalValues,
    totalBytes: shape.totalBytes,
    bytesPerSig: shape.bytesPerSig,
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
    const stat = fs.statSync(packed.resolvedPackedPath);
    const packedSize = Number(stat?.size);
    if (!Number.isSafeInteger(packedSize) || packedSize < 0) {
      throw createLoaderError('ERR_ARTIFACT_INVALID', 'Packed minhash signatures invalid size');
    }
    assertWithinMaxBytes(packedSize, maxBytes, 'Packed minhash signatures');
    if (packedSize % BYTES_PER_U32 !== 0) {
      throw createLoaderError('ERR_ARTIFACT_CORRUPT', 'Packed minhash signatures invalid byte alignment');
    }
    if (packedSize !== packed.totalBytes) {
      throw createLoaderError('ERR_ARTIFACT_CORRUPT', 'Packed minhash signatures size mismatch');
    }
    const buffer = fs.readFileSync(packed.resolvedPackedPath);
    if (buffer.byteLength % BYTES_PER_U32 !== 0) {
      throw createLoaderError('ERR_ARTIFACT_CORRUPT', 'Packed minhash signatures invalid byte alignment');
    }
    if (buffer.byteLength !== packed.totalBytes) {
      throw createLoaderError('ERR_ARTIFACT_CORRUPT', 'Packed minhash signatures size mismatch');
    }
    packed.checksumValidator?.update(buffer);
    packed.checksumValidator?.verify();
    const view = new Uint32Array(buffer.buffer, buffer.byteOffset, packed.totalValues);
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
    const bytesPerSig = packed.bytesPerSig;
    const totalBytes = packed.totalBytes;
    const streamBudgetBytes = assertPackedRowFitsStreamBudget({
      bytesPerSig,
      maxBytes
    });
    const stat = await fsPromises.stat(packed.resolvedPackedPath);
    const packedSize = Number(stat?.size);
    if (!Number.isSafeInteger(packedSize) || packedSize < 0) {
      throw createLoaderError('ERR_ARTIFACT_INVALID', 'Packed minhash signatures invalid size');
    }
    assertWithinMaxBytes(packedSize, maxBytes, 'Packed minhash signatures');
    if (packedSize % BYTES_PER_U32 !== 0) {
      throw createLoaderError('ERR_ARTIFACT_CORRUPT', 'Packed minhash signatures invalid byte alignment');
    }
    if (packedSize !== totalBytes) {
      throw createLoaderError('ERR_ARTIFACT_CORRUPT', 'Packed minhash signatures size mismatch');
    }
    const handle = await fsPromises.open(packed.resolvedPackedPath, 'r');
    const resolvedBatchSize = Math.max(1, Math.floor(Number(batchSize)) || 2048);
    const cappedBatchSize = Math.max(1, Math.floor(streamBudgetBytes / bytesPerSig));
    const safeBatchSize = Math.min(resolvedBatchSize, cappedBatchSize);
    const batchBufferBytes = multiplySafeInts(safeBatchSize, bytesPerSig, 'stream batch size');
    const buffer = Buffer.allocUnsafe(batchBufferBytes);
    try {
      let docId = 0;
      while (docId < count) {
        const remaining = count - docId;
        const batchCount = Math.min(safeBatchSize, remaining);
        const bytesToRead = batchCount * bytesPerSig;
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, docId * bytesPerSig);
        if (bytesRead < bytesToRead) {
          throw createLoaderError('ERR_ARTIFACT_CORRUPT', 'Packed minhash signatures truncated');
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
