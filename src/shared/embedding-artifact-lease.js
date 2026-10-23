import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import PQueue from 'p-queue';
import { withContainedFile } from './contained-file.js';
import { throwIfAborted, raceAbort, isAbortError } from './abort.js';
import { stableStringify } from './stable-json.js';
import { snapshotEmbeddingArtifactSelection } from './embedding-selection-snapshot.js';
import { planEmbeddingArtifactInventory, buildVerifiedEmbeddingArtifact, unknownEmbeddingArtifact,
  assertEmbeddingArtifactCompatibility, embeddingArtifactReusable } from './embedding-artifact-identity.js';

const verificationQueue = new PQueue({ concurrency: 2 });
const pending = new Map();
const MAX_FILE_BYTES = 64n * 1024n ** 3n;
const MAX_CLOSURE_BYTES = 128 * 1024 ** 3;
const fields = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'];
const metrics = { verifications: 0, coalesced: 0, filesHashed: 0, bytesHashed: 0, peakActive: 0, active: 0 };
const changed = () => Object.assign(new Error('Embedding artifact changed during verified acquisition.'), { code: 'ERR_EMBEDDING_ARTIFACT_CHANGED' });
const sameFile = (left, right) => fields.every(field => left[field] === right[field]);
const fingerprint = async (file, remainingBytes = BigInt(MAX_CLOSURE_BYTES)) => {
  const root = path.dirname(file);
  return withContainedFile(root, file, async handle => {
    const before = await handle.stat({ bigint: true }), hash = createHash('sha256'), scratch = Buffer.allocUnsafe(1024 * 1024);
    if (before.size < 0n || before.size > MAX_FILE_BYTES || before.size > remainingBytes) {
      throw Object.assign(new Error('Selected embedding artifact exceeds its bounded file size.'), { code: 'ERR_EMBEDDING_ARTIFACT_LIMIT' });
    }
    let bytes = 0;
    while (BigInt(bytes) < before.size) {
      const count = Math.min(scratch.length, Number(before.size) - bytes);
      const { bytesRead } = await handle.read(scratch, 0, count, bytes);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > count) throw changed();
      bytes += bytesRead; hash.update(scratch.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true }), current = await fs.stat(file, { bigint: true });
    handle.verify();
    if (!sameFile(before, after) || !sameFile(after, current) || BigInt(bytes) !== after.size) throw changed();
    metrics.filesHashed++; metrics.bytesHashed += bytes;
    return { bytes, sha256: hash.digest('hex'), stat: after };
  });
};
const verify = async (options, selectedPlan = null) => {
  metrics.verifications++; metrics.active++; metrics.peakActive = Math.max(metrics.peakActive, metrics.active);
  try {
    const plan = selectedPlan || planEmbeddingArtifactInventory(options);
    if (plan.immediate) return plan.immediate;
    if (!plan.hasWeights || !plan.hasTokenizer) return unknownEmbeddingArtifact();
    const inventory = [], observed = [];
    let closureBytes = 0;
    for (const row of plan.files) {
      const value = await fingerprint(row.filePath, BigInt(MAX_CLOSURE_BYTES - closureBytes));
      closureBytes += value.bytes;
      if (closureBytes > MAX_CLOSURE_BYTES) throw Object.assign(new Error('Selected embedding closure exceeds its total byte bound.'), { code: 'ERR_EMBEDDING_ARTIFACT_LIMIT' });
      if (row.expected && (value.bytes !== row.expected.bytes || value.sha256 !== row.expected.sha256)) {
        throw Object.assign(new Error('Selected ONNX closure bytes disagree with their installation identity.'), { code: 'ERR_ONNX_ARTIFACT_INTEGRITY' });
      }
      inventory.push({ path: row.rel, bytes: value.bytes, sha256: value.sha256 });
      observed.push({ file: row.filePath, stat: value.stat });
    }
    // Revalidate the entire selected set after the last file, not only each
    // immediately-read file while later graph/tokenizer bytes are still hashed.
    for (const row of observed) if (!sameFile(row.stat, await fs.stat(row.file, { bigint: true }))) throw changed();
    return buildVerifiedEmbeddingArtifact(inventory, plan.revision ?? null);
  } finally { metrics.active--; }
};

/** Bounded concurrent verification is coalesced only while bytes are being
 * verified. There is no path/stat digest cache for mutable installations. */
export const acquireEmbeddingArtifactLease = async (options = {}, { signal = null, phase = 'selection' } = {}) => {
  throwIfAborted(signal);
  options = snapshotEmbeddingArtifactSelection(options);
  // Coalesce the exact already-selected closure, not resource tuning knobs or a
  // mutable selector path that may now point at a different installation.
  const plan = planEmbeddingArtifactInventory(options);
  const key = stableStringify([phase, plan.immediate ?? null, plan.modelPath ?? null,
    plan.revision ?? null, plan.hasWeights, plan.hasTokenizer, plan.files]);
  let entry = pending.get(key);
  if (!entry) {
    if (pending.size >= 32) throw Object.assign(new Error('Embedding artifact verification queue is full.'), { code: 'ERR_EMBEDDING_ARTIFACT_QUEUE_FULL' });
    const work = verificationQueue.add(() => verify(options, plan));
    entry = { work, settled: false }; pending.set(key, entry);
    const observed = entry;
    const settle = () => { observed.settled = true; if (pending.get(key) === observed) pending.delete(key); };
    work.then(settle, settle);
  } else metrics.coalesced++;
  let result;
  try { result = await raceAbort(signal, entry.work); }
  catch (error) {
    if (isAbortError(error) && !entry.settled) {
      const observed = entry;
      const owner = Object.freeze({ kind: 'embedding-artifact-verification',
        get pending() { return !observed.settled; }, drain: () => observed.work });
      Object.defineProperties(error, { artifactVerificationOwner: { value: owner },
        cacheOwnershipPending: { get: () => owner.pending }, cacheOwnershipReleased: { value: () => !owner.pending } });
    }
    throw error;
  }
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
