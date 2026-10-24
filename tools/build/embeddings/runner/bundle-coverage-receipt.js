import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { stableStringify, stableStringifyForSignature } from '../../../../src/shared/stable-json.js';
import { resolveManifestBundleNames, normalizeBundleFormat, resolveBundleJsonChecksumPath, resolveBundlePatchPath,
  resolveBundlePatchMetaPath, resolveBundlePatchLockPath } from '../../../../src/shared/bundle-io-paths.js';
import { openContainedFile, verifyContainedFileHandle } from '../../../../src/shared/contained-file.js';
import { throwIfAborted } from '../../../../src/shared/abort.js';

const MAX_RECEIPT_CHUNKS = 32768;
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (left, right) => stableStringify(left) === stableStringify(right);
const receiptDigest = ({ digest: unused, ...receipt }) => { void unused; return hash(stableStringify(receipt)); };
export const digestBundleMappingInventory = mappingIndex => hash(stableStringifyForSignature(mappingIndex));

const binding = ({ entry, normalizedFile, mappingDigest, embeddingIdentityKey, embeddingMode, vectorCount }) => {
  const { embeddingCoverageReceipt: ignored, ...source } = entry;
  return hash(stableStringify({ version: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    source, normalizedFile, mappingDigest, embeddingIdentityKey, embeddingMode, vectorCount }));
};

/** Content-addressed immutable bundle names plus exact opened-file metadata are
 * the existing publication owner's change boundary. No bundle payload is read. */
export const observeBundleCoverageFiles = async ({ bundleDir, entry, fallbackFormat, signal }) => {
  const names = resolveManifestBundleNames(entry), inventory = entry?.bundleInventory;
  if (!names.length || !Array.isArray(inventory) || inventory.length !== names.length || new Set(names).size !== names.length) return null;
  const format = normalizeBundleFormat(entry.bundleFormat || fallbackFormat), rows = [];
  try {
    for (let index = 0; index < names.length; index++) {
      throwIfAborted(signal);
      const name = names[index], part = inventory[index], match = /^(?:resume|snapshot)-([a-f0-9]{64})\.(json|mpk)$/.exec(name);
      if (!match || path.basename(name) !== name || part?.name !== name || part.index !== index || part.count !== names.length
        || part.hash !== match[1] || match[2] !== (format === 'json' ? 'json' : 'mpk')) return null;
      const filename = path.join(bundleDir, name);
      try { await fs.lstat(resolveBundlePatchLockPath(filename)); return null; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const candidate of [filename, resolveBundleJsonChecksumPath(filename), resolveBundlePatchPath(filename), resolveBundlePatchMetaPath(filename)]) {
        let handle;
        try {
          handle = await openContainedFile(bundleDir, candidate);
          const stat = await handle.stat({ bigint: true }); verifyContainedFileHandle(handle, bundleDir, candidate);
          rows.push({ name: path.basename(candidate), ...Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(field => [field, String(stat[field])])) });
        } catch (error) {
          if (candidate === filename || error.code !== 'ENOENT') throw error;
          rows.push({ name: path.basename(candidate), absent: true });
        } finally { await handle?.close(); }
      }
    }
    return rows;
  } catch (error) { throwIfAborted(signal); return null; }
};

const digestVectors = (vectors, ranges, expectedCount) => {
  if (!Array.isArray(ranges) || !Number.isSafeInteger(expectedCount) || expectedCount < 0 || expectedCount > MAX_RECEIPT_CHUNKS || ranges.length > MAX_RECEIPT_CHUNKS) return null;
  const digest = createHash('sha256'); let count = 0;
  for (const range of ranges) {
    if (!Number.isSafeInteger(range?.start) || range.start < 0 || !Number.isSafeInteger(range.count) || range.count <= 0
      || range.start + range.count > vectors.length || count + range.count > expectedCount) return null;
    for (let index = range.start; index < range.start + range.count; index++) {
      const vector = vectors[index];
      if (!vector?.length || !Number.isSafeInteger(vector.length)
        || !(Array.isArray(vector) || ArrayBuffer.isView(vector)) || typeof vector[Symbol.iterator] !== 'function') return null;
      for (const value of vector) if (!Number.isInteger(value) || value < 0 || value > 255) return null;
      const bytes = vector instanceof Uint8Array ? Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength) : Buffer.from(vector);
      digest.update(`${index}:${bytes.length}:`); digest.update(bytes); count++;
    }
  }
  return count === expectedCount ? digest.digest('hex') : null;
};

export const checkBundleCoverageReceipt = ({ entry, observedFiles, mergedVectors, ...selection }) => {
  const receipt = entry.embeddingCoverageReceipt;
  if (!receipt || receipt.version !== 1) return { reuse: false, reason: 'missing-or-unsupported-receipt' };
  if (receipt.digest !== receiptDigest(receipt)) return { reuse: false, reason: 'malformed-receipt' };
  if (!selection.embeddingIdentityKey || receipt.binding !== binding({ entry, vectorCount: mergedVectors.length, ...selection })) return { reuse: false, reason: 'identity-source-or-mapping' };
  if (!observedFiles || !same(receipt.files, observedFiles)) return { reuse: false, reason: 'immutable-file-generation' };
  const digest = digestVectors(mergedVectors, receipt.ranges, receipt.chunkCount);
  if (!digest || digest !== receipt.vectorDigest) return { reuse: false, reason: 'missing-or-changed-vector-range' };
  return { reuse: true, chunkCount: receipt.chunkCount };
};

export const createBundleCoverageReceipt = ({ entry, observedFiles, priorFiles, vectorIndices, mergedVectors, ...selection }) => {
  if (!selection.embeddingIdentityKey || !observedFiles || !same(observedFiles, priorFiles)
    || !Array.isArray(vectorIndices) || vectorIndices.length > MAX_RECEIPT_CHUNKS) return null;
  const ranges = [];
  for (const index of vectorIndices) {
    const previous = ranges[ranges.length - 1];
    if (previous && previous.start + previous.count === index) previous.count++;
    else ranges.push({ start: index, count: 1 });
  }
  const vectorDigest = digestVectors(mergedVectors, ranges, vectorIndices.length);
  if (!vectorDigest) return null;
  const receipt = { version: 1, binding: binding({ entry, vectorCount: mergedVectors.length, ...selection }), files: observedFiles,
    chunkCount: vectorIndices.length, ranges, vectorDigest };
  return { ...receipt, digest: receiptDigest(receipt) };
};
