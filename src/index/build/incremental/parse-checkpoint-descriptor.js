import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { atomicWriteText } from '../../../shared/io/atomic-write.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../../shared/contained-file.js';
import { syncParentDirectory } from '../../../shared/io/persistence-helpers.js';
import { BUNDLE_PARSE_CHECKPOINT_SUFFIX } from '../../../shared/bundle-io-constants.js';
import { canonicalBundleSourceKey } from '../../../shared/bundle-source-key.js';
import { resolveManifestBundleNames } from '../../../shared/bundle-io-paths.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { withSemanticDiskWriter } from './accounted-bundle.js';
export const MAX_PARSE_CHECKPOINT_DESCRIPTOR_BYTES = 16 * 1024 * 1024;
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const nameFor = name => /^(snapshot|resume)-[a-f0-9]{64}\.(json|mpk)$/.test(name || '')
  ? name + BUNDLE_PARSE_CHECKPOINT_SUFFIX : null;
const identity = (relKey, entry) => ({ file: canonicalBundleSourceKey(relKey), sourceHash: entry.hash,
  parseSignature: entry.dependencySignatures?.parse, bundleInventory: entry.bundleInventory });

/** Optional acceleration beside the immutable first shard. Its manifest locator
 * is returned only after durable bytes exist; no decoded lexical rows survive. */
export const writeParseCheckpointDescriptor = async ({ bundleDir, relKey, entry, checkpoint,
  diskAccount = null, signal = null }) => {
  if (!checkpoint?.diagnostics || !Array.isArray(checkpoint.chunks)
    || !Number.isSafeInteger(checkpoint.textLength) || checkpoint.textLength < 0
    || typeof entry.dependencySignatures?.parse !== 'string') return null;
  const name = nameFor(resolveManifestBundleNames(entry)[0]); if (!name) return null;
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    identity: identity(relKey, entry), checkpoint }));
  if (bytes.length > MAX_PARSE_CHECKPOINT_DESCRIPTOR_BYTES) return null;
  const descriptor = { schemaVersion: 1, bytes: bytes.length, hash: hashBytes(bytes) };
  const filename = path.join(bundleDir, name);
  const write = async () => {
    throwIfAborted(signal); assertNoSymlinkPath(bundleDir, filename, { allowMissing: true });
    try {
      await readVerifiedContainedFile(bundleDir, filename, { maxBytes: bytes.length,
        expectedBytes: bytes.length, expectedHash: descriptor.hash, signal });
      return descriptor;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    diskAccount?.reserve(bytes.length);
    // Unknown failures retain disk credits until the existing physical inventory
    // reconciles them; an old manifest never points at a partial descriptor.
    await atomicWriteText(filename, bytes, { newline: false });
    await syncParentDirectory(filename);
    return descriptor;
  };
  return diskAccount ? withSemanticDiskWriter(diskAccount, filename, write) : write();
};

export const readParseCheckpointDescriptor = async ({ bundleDir, relKey, entry, signal = null, metrics = null }) => {
  const descriptor = entry?.parseCheckpointDescriptor;
  const name = nameFor(resolveManifestBundleNames(entry)[0]);
  if (!name || descriptor?.schemaVersion !== 1 || !Number.isSafeInteger(descriptor.bytes)
    || descriptor.bytes < 1 || descriptor.bytes > MAX_PARSE_CHECKPOINT_DESCRIPTOR_BYTES
    || !/^[a-f0-9]{64}$/.test(descriptor.hash || '')) return null;
  try {
    const read = await readVerifiedContainedFile(bundleDir, path.join(bundleDir, name), {
      maxBytes: descriptor.bytes, expectedBytes: descriptor.bytes, expectedHash: descriptor.hash, signal });
    if (metrics) { metrics.descriptorReads++; metrics.descriptorBytes += read.buffer.length; }
    const envelope = JSON.parse(read.buffer.toString('utf8'));
    if (envelope.schemaVersion !== 1 || envelope.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
      || JSON.stringify(envelope.identity) !== JSON.stringify(identity(relKey, entry))) return null;
    return envelope.checkpoint;
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof SyntaxError || ['ENOENT', 'ENOTDIR', 'ERR_FILE_INTEGRITY', 'ERR_FILE_CHANGED',
      'ERR_FILE_TOO_LARGE', 'ERR_UNSAFE_FILE_PATH'].includes(error.code)) return null;
    throw error;
  }
};
