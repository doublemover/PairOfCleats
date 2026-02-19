import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak } from '../fs.js';
import { createPackedChecksumValidator } from '../checksum.js';
import { readJsonFileCached, warnMaterializeFallback } from './shared.js';
import { loadJsonObjectArtifact } from './core.js';

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
  const packedPath = path.join(dir, 'minhash_signatures.packed.bin');
  const metaPath = path.join(dir, 'minhash_signatures.packed.meta.json');
  if (existsOrBak(packedPath) && existsOrBak(metaPath)) {
    const metaRaw = readJsonFileCached(metaPath, { maxBytes });
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const dims = Number.isFinite(Number(meta?.dims)) ? Math.max(0, Math.floor(Number(meta.dims))) : 0;
    const count = Number.isFinite(Number(meta?.count)) ? Math.max(0, Math.floor(Number(meta.count))) : 0;
    if (!dims || !count) {
      throw new Error('Invalid packed minhash meta');
    }
    const checksumValidator = createPackedChecksumValidator(meta, {
      label: 'Packed minhash signatures'
    });
    const buffer = fs.readFileSync(packedPath);
    checksumValidator?.update(buffer);
    checksumValidator?.verify();
    const total = dims * count;
    const view = new Uint32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
    if (view.length < total) {
      throw new Error('Packed minhash signatures truncated');
    }
    const signatures = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const start = i * dims;
      signatures[i] = view.subarray(start, start + dims);
    }
    return { signatures };
  }
  try {
    return await loadJsonObjectArtifact(dir, 'minhash_signatures', { maxBytes, manifest, strict });
  } catch (err) {
    const message = err?.message || '';
    if (message.includes('Missing manifest entry for minhash_signatures')
      || message.includes('Missing index artifact: minhash_signatures.json')) {
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
  const packedPath = path.join(dir, 'minhash_signatures.packed.bin');
  const metaPath = path.join(dir, 'minhash_signatures.packed.meta.json');
  if (existsOrBak(packedPath) && existsOrBak(metaPath)) {
    const metaRaw = readJsonFileCached(metaPath, { maxBytes });
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const dims = Number.isFinite(Number(meta?.dims)) ? Math.max(0, Math.floor(Number(meta.dims))) : 0;
    const count = Number.isFinite(Number(meta?.count)) ? Math.max(0, Math.floor(Number(meta.count))) : 0;
    if (!dims || !count) {
      throw new Error('Invalid packed minhash meta');
    }
    const checksumValidator = createPackedChecksumValidator(meta, {
      label: 'Packed minhash signatures'
    });
    const bytesPerSig = dims * 4;
    const totalBytes = bytesPerSig * count;
    const stat = await fsPromises.stat(packedPath);
    if (stat.size < totalBytes) {
      throw new Error('Packed minhash signatures truncated');
    }
    const handle = await fsPromises.open(packedPath, 'r');
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
        checksumValidator?.update(buffer, 0, bytesRead);
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
      checksumValidator?.verify();
    } finally {
      await handle.close();
    }
    return;
  }
  let payload = null;
  try {
    payload = await loadJsonObjectArtifact(dir, 'minhash_signatures', { maxBytes, manifest, strict });
  } catch (err) {
    const message = err?.message || '';
    if (message.includes('Missing manifest entry for minhash_signatures')
      || message.includes('Missing index artifact: minhash_signatures.json')) {
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
