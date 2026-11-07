import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../shared/abort.js';
import { withSchedulerCpuSuspended } from '../../shared/concurrency/scheduler-task-scope.js';
import { semanticPreparedSourceAdmissionFor } from './planning.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';

const parents = new WeakMap(), MAX_PARENT_BYTES = 64 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
const identity = facts => {
  if (!facts || typeof facts.sourceHash !== 'string' || typeof facts.sourceUnitId !== 'string'
    || !/^[a-f0-9]{64}$/.test(facts.sourceHash) || !/^su1:[a-f0-9]{64}$/.test(facts.sourceUnitId)
    || typeof facts.repositoryNamespace !== 'string' || !facts.repositoryNamespace || facts.repositoryNamespace.length > 4096) {
    throw fail('Qualified embedded parent identity required.');
  }
  return Object.freeze({ sourceHash: facts.sourceHash, sourceUnitId: facts.sourceUnitId, repositoryNamespace: facts.repositoryNamespace });
};
const acquireAllowance = async (admission, bytes, signal) => {
  let acquiring, release, failed = false, failure, secondary, hasSecondary = false;
  try {
    await withSchedulerCpuSuspended(() => {
      acquiring = Promise.resolve().then(() => admission.acquire(bytes, { signal })).then(value => { release = value; });
      return acquiring;
    });
  } catch (error) { failed = true; failure = error; }
  if (acquiring) {
    try { await acquiring; }
    catch (error) {
      if (!failed) { failed = true; failure = error; }
      else if (error !== failure) { secondary = error; hasSecondary = true; }
    }
  }
  if (failed) {
    release?.();
    if (hasSecondary) throw addStorageFailureContext(failure, {}, secondary, { secondaryPresent: true });
    throw failure;
  }
  if (typeof release !== 'function') throw fail('Original embedded source allowance was not acquired.');
  return release;
};

/** One attempt owns one exact immutable parent snapshot and decoded string.
 * The existing FIFO owner admits worst-case snapshot + UTF-16 bytes before
 * either allocation. Source, writer and row-construction phases stay separate.
 */
export const withPreparedEmbeddedParent = async ({ parentFacts, parentBytes = null, loadBytes = null,
  parentByteLength = parentBytes?.byteLength, diskAccount = null, signal = null, metrics = null }, action) => {
  const source = identity(parentFacts);
  if (typeof action !== 'function' || !Number.isSafeInteger(parentByteLength) || parentByteLength < 0
    || parentByteLength > MAX_PARENT_BYTES || parentBytes === null && typeof loadBytes !== 'function') {
    throw fail('Bounded embedded parent bytes and scope required.');
  }
  throwIfAborted(signal);
  // A loader also owns its fresh input buffer until the private copy exists.
  const allowance = parentByteLength * (parentBytes === null ? 4 : 3);
  const release = await acquireAllowance(semanticPreparedSourceAdmissionFor(diskAccount), allowance, signal);
  const token = Object.freeze({}); let state;
  try {
    throwIfAborted(signal);
    let input = parentBytes ?? await loadBytes();
    if (!(input instanceof Uint8Array) || input.byteLength !== parentByteLength || input.buffer instanceof SharedArrayBuffer) {
      throw fail('Embedded parent snapshot changed or is not privately owned.');
    }
    const bytes = Buffer.from(input);
    input = null;
    if (metrics) { metrics.parentBytesHashed = (metrics.parentBytesHashed || 0) + bytes.length; metrics.parentHashes = (metrics.parentHashes || 0) + 1; }
    if (createHash('sha256').update(bytes).digest('hex') !== source.sourceHash) throw fail('Embedded cache parent bytes differ from their admitted source identity.');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (metrics) {
      metrics.parentBytesDecoded = (metrics.parentBytesDecoded || 0) + bytes.length;
      metrics.parentDecodes = (metrics.parentDecodes || 0) + 1;
      metrics.peakPreparedParentBytes = Math.max(metrics.peakPreparedParentBytes || 0, bytes.length + text.length * 2);
      metrics.peakPreparedParentAllowance = Math.max(metrics.peakPreparedParentAllowance || 0, allowance);
    }
    state = { source, bytes, text, active: true }; parents.set(token, state);
    throwIfAborted(signal);
    return await action(token);
  } finally {
    if (state) { state.active = false; state.bytes = null; state.text = null; }
    parents.delete(token); release();
  }
};

/** Data observation only; cannot supply partition-verification/replay authority. */
export const readPreparedEmbeddedParent = (token, parentFacts) => {
  const state = parents.get(token), expected = identity(parentFacts);
  if (!state?.active || Object.keys(expected).some(key => state.source[key] !== expected[key])) throw fail('Embedded parent scope or source identity changed.');
  return Object.freeze({ ...state.source, text: state.text });
};
