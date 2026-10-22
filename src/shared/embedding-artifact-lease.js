import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import PQueue from 'p-queue';
import { openContainedFile, verifyContainedFileHandle } from './contained-file.js';
import { throwIfAborted } from './abort.js';
import { planEmbeddingArtifactInventory, buildVerifiedEmbeddingArtifact, unknownEmbeddingArtifact,
  assertEmbeddingArtifactCompatibility, embeddingArtifactReusable } from './embedding-artifact-identity.js';

const verificationQueue = new PQueue({ concurrency: 2 });
const pending = new Map();
const fields = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'];
const metrics = { verifications: 0, coalesced: 0, filesHashed: 0, bytesHashed: 0, peakActive: 0, active: 0 };
const changed = () => Object.assign(new Error('Embedding artifact changed during verified acquisition.'), { code: 'ERR_EMBEDDING_ARTIFACT_CHANGED' });
const sameFile = (left, right) => fields.every(field => left[field] === right[field]);
const fingerprint = async file => {
  const root = path.dirname(file), handle = await openContainedFile(root, file);
  try {
    const before = await handle.stat({ bigint: true }), hash = createHash('sha256'), scratch = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    for (;;) {
      const { bytesRead } = await handle.read(scratch, 0, scratch.length, null);
      if (!bytesRead) break;
      bytes += bytesRead; hash.update(scratch.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true }), current = await fs.stat(file, { bigint: true });
    verifyContainedFileHandle(handle, root, file);
    if (!sameFile(before, after) || !sameFile(after, current) || BigInt(bytes) !== after.size) throw changed();
    metrics.filesHashed++; metrics.bytesHashed += bytes;
    return { bytes, sha256: hash.digest('hex'), stat: after };
  } finally { await handle.close(); }
};
const verify = async options => {
  metrics.verifications++; metrics.active++; metrics.peakActive = Math.max(metrics.peakActive, metrics.active);
  try {
    const plan = planEmbeddingArtifactInventory(options);
    if (plan.immediate) return plan.immediate;
    if (!plan.hasWeights || !plan.hasTokenizer) return unknownEmbeddingArtifact(plan.modelPath ? (await fingerprint(plan.modelPath)).sha256 : null);
    const inventory = [], observed = [];
    for (const row of plan.files) {
      const value = await fingerprint(row.filePath);
      if (row.expected && (value.bytes !== row.expected.bytes || value.sha256 !== row.expected.sha256)) {
        throw Object.assign(new Error('Selected ONNX closure bytes disagree with their installation identity.'), { code: 'ERR_ONNX_ARTIFACT_INTEGRITY' });
      }
      inventory.push({ path: row.rel, bytes: value.bytes, sha256: value.sha256 });
      observed.push({ file: row.filePath, stat: value.stat });
    }
    // Revalidate the entire selected set after the last file, not only each
    // immediately-read file while later graph/tokenizer bytes are still hashed.
    for (const row of observed) if (!sameFile(row.stat, await fs.stat(row.file, { bigint: true }))) throw changed();
    return buildVerifiedEmbeddingArtifact(inventory);
  } finally { metrics.active--; }
};

/** Bounded concurrent verification is coalesced only while bytes are being
 * verified. There is no path/stat digest cache for mutable installations. */
export const acquireEmbeddingArtifactLease = async (options = {}, { signal = null, phase = 'selection' } = {}) => {
  throwIfAborted(signal);
  const key = JSON.stringify([phase, options.provider, options.modelId, options.modelsDir, options.rootDir,
    options.onnx, options.modelProfile, options.stub === true]);
  let work = pending.get(key);
  if (!work) {
    if (pending.size >= 32) throw Object.assign(new Error('Embedding artifact verification queue is full.'), { code: 'ERR_EMBEDDING_ARTIFACT_QUEUE_FULL' });
    work = verificationQueue.add(() => verify(options)); pending.set(key, work);
    work.then(() => { if (pending.get(key) === work) pending.delete(key); }, () => { if (pending.get(key) === work) pending.delete(key); });
  } else metrics.coalesced++;
  const result = await work;
  throwIfAborted(signal);
  // Missing provenance never gains a shared reusable attempt identity.
  const artifact = embeddingArtifactReusable(result) ? result : { ...result, attempt: randomUUID() };
  if (artifact.inventory && !Object.isFrozen(artifact.inventory)) {
    for (const row of artifact.inventory) Object.freeze(row);
    Object.freeze(artifact.inventory);
  }
  Object.freeze(artifact);
  let released = false;
  return Object.freeze({ artifact, release: () => { released = true; },
    verifyLoaded: async () => {
      if (released) throw new Error('Embedding artifact verification lease is released.');
      const next = await resolveEmbeddingArtifactIdentityAsync(options, { signal, phase: 'loaded' });
      if (embeddingArtifactReusable(artifact)) assertEmbeddingArtifactCompatibility(artifact, next);
      return next;
    } });
};

export const resolveEmbeddingArtifactIdentityAsync = async (options = {}, context = {}) => {
  const lease = await acquireEmbeddingArtifactLease(options, context);
  try { return lease.artifact; } finally { lease.release(); }
};
export const getEmbeddingArtifactLeaseMetrics = () => ({ ...metrics, pending: pending.size });
