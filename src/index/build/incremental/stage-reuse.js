import fs from 'node:fs/promises';
import { sourceEntryIsFresh } from './source-freshness.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { readParseCheckpointDescriptor } from './parse-checkpoint-descriptor.js';
import { validateChunkBounds } from '../file-processor/cpu/chunking.js';

export const resolveStageRefresh = (current, previous) => {
  const changed = key => !current?.[key] || current[key] !== previous?.[key];
  return {
    parse: changed('parse'),
    lexical: changed('lexical'),
    enrichment: changed('enrichment'),
    embeddings: changed('embeddings'),
    sourceAdmission: Boolean(current?.sourceAdmission && current.sourceAdmission !== previous?.sourceAdmission)
  };
};

// Checkpoints are optional acceleration, never a new failure mode for parsing.
export const captureChunkingCheckpoint = (chunks, diagnostics, textLength) => {
  try {
    const encoded = JSON.stringify({ chunks, diagnostics, textLength });
    return Buffer.byteLength(encoded) <= 16 * 1024 * 1024 ? JSON.parse(encoded) : null;
  } catch {
    return null;
  }
};

export const resolveChunkingCheckpoint = async ({ cached, textLength, chunker, input }) => {
  if (
    cached?.textLength === textLength
    && Array.isArray(cached.chunks)
    && !validateChunkBounds(cached.chunks, textLength)
    && cached.diagnostics
  ) {
    return {
      chunks: structuredClone(cached.chunks),
      chunkingDiagnostics: { ...cached.diagnostics },
      checkpointReused: true
    };
  }
  return chunker(input);
};

/** Checkpoint eligibility is a small manifest-authorized projection. Stream all
 * eligible entries with bounded concurrent descriptor/source reads; retain only
 * paths, never whole lexical bundles. This is planning acceleration, not replay
 * authority: ordinary file processing still verifies its complete snapshot. */
export const preloadParseCheckpoints = async ({ entries, incrementalState, repoRoot = process.cwd(),
  signal = null, maxBytes = 64 * 1024 * 1024, maxFiles = Infinity }) => {
  const reusable = new Set();
  if (!incrementalState?.enabled || !(maxBytes > 0)) return reusable;
  const metrics = { descriptorReads: 0, descriptorBytes: 0, sourceVerificationBytes: 0,
    candidates: 0, eligible: 0, peakAdmittedBytes: 0, maxConcurrentReads: 0 };
  incrementalState.parseCheckpointPreloadMetrics = metrics;
  const pending = new Set(); let admittedBytes = 0, candidates = 0, firstFailure = null;
  const load = async (entry, previous) => {
    throwIfAborted(signal);
    const checkpoint = await readParseCheckpointDescriptor({ bundleDir: incrementalState.bundleDir,
      relKey: entry.rel, entry: previous, signal, metrics });
    if (!checkpoint?.diagnostics || !Number.isSafeInteger(checkpoint.textLength)
      || validateChunkBounds(checkpoint.chunks, checkpoint.textLength)) return;
    const before = await fs.lstat(entry.abs);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== previous.size) return;
    if (!await sourceEntryIsFresh({ absPath: entry.abs, entry: { ...previous, mtimeMs: before.mtimeMs },
      stat: before, repoRoot, strict: true, signal, metrics })) return;
    reusable.add(entry.abs); metrics.eligible++;
  };
  let primary = null;
  try {
    for (const entry of entries) {
      throwIfAborted(signal);
      if (firstFailure) throw firstFailure;
      const previous = incrementalState.manifest.files?.[entry.rel];
      const descriptor = previous?.parseCheckpointDescriptor;
      if (!descriptor || resolveStageRefresh(incrementalState.manifest.dependencySignatures,
        previous.dependencySignatures).parse) continue;
      const charge = descriptor.bytes + 65536;
      if (!Number.isSafeInteger(charge) || charge < 65537 || charge > maxBytes) continue;
      if (candidates >= maxFiles) break;
      candidates++; metrics.candidates++;
      while (pending.size && (pending.size >= 4 || admittedBytes + charge > maxBytes)) await Promise.race(pending);
      admittedBytes += charge;
      metrics.peakAdmittedBytes = Math.max(metrics.peakAdmittedBytes, admittedBytes);
      let task;
      task = load(entry, previous).catch(error => {
        if (['ENOENT', 'ENOTDIR', 'ERR_FILE_CHANGED', 'ERR_UNSAFE_FILE_PATH'].includes(error.code)) return;
        if (!firstFailure) firstFailure = error;
        throw error;
      }).finally(() => { admittedBytes -= charge; pending.delete(task); });
      task.catch(() => {}); pending.add(task);
      metrics.maxConcurrentReads = Math.max(metrics.maxConcurrentReads, pending.size);
    }
    await Promise.all(pending);
    throwIfAborted(signal);
    if (firstFailure) throw firstFailure;
  } catch (error) { primary = error; throw error; }
  finally {
    // A first failure/cancellation does not abandon descriptor/source readers.
    const settled = await Promise.allSettled(pending);
    if (!primary) { const failed = settled.find(result => result.status === 'rejected'); if (failed) throw failed.reason; }
  }
  return reusable;
};
