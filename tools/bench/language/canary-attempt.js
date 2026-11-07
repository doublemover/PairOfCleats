import fs from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { createHash } from 'node:crypto';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { persistenceDirectoryIdentity, assertPersistenceDirectoryIdentity } from '../../../src/shared/io/directory-identity.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';

export const CANARY_CAPTURE_MAX_BYTES = 256 * 1024;
export const CANARY_RESULT_MAX_BYTES = 8 * 1024 * 1024;
const owners = new WeakMap();
const failure = (code, message, cause) => Object.assign(new Error(message, { cause }), { code });
const limit = (value, maximum) => {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError('Private canary limits may only lower the fixed byte allowance.');
  return value;
};
export const resolveCanaryAttemptLimits = (limits = {}) => ({
  captureBytes: limit(limits.captureBytes, CANARY_CAPTURE_MAX_BYTES),
  resultBytes: limit(limits.resultBytes, CANARY_RESULT_MAX_BYTES)
});

/** Retain the original child's or read owner's observer. A report and an elapsed
 * deadline never grant cleanup authority. Recovery is explicit and idempotent. */
export const createCanaryAttemptOwner = async workDir => {
  const identity = persistenceDirectoryIdentity(await fs.lstat(workDir, { bigint: true }));
  const observations = [];
  let released = false, releasing = null, overflow = false;
  const remember = (error, phase) => {
    if (observations.length === 128) { overflow = true; return; }
    observations.push(observeStorageResource(error, { phase }));
  };
  const releaseAfterSettlement = () => {
    if (released) return Promise.resolve(true);
    if (releasing) return releasing;
    releasing = (async () => {
      if (overflow) throw Object.assign(new Error('Canary attempt prerequisite history exceeded its bounded allowance.'),
        { code: 'ERR_CANARY_OWNERSHIP_HISTORY', cacheOwnershipPending: true });
      for (const observation of observations) observation.requireSettled();
      assertPersistenceDirectoryIdentity(await fs.lstat(workDir, { bigint: true }), identity);
      for (const observation of observations) observation.requireSettled();
      const result = await removePathWithRetry(workDir, { attempts: 1 });
      if (!result.ok) throw result.error;
      released = true;
      return true;
    })().catch(error => {
      remember(error, 'canary-attempt-cleanup');
      throw error;
    }).finally(() => { releasing = null; });
    return releasing;
  };
  return Object.freeze({
    remember(error) { remember(error, 'canary-attempt'); },
    releaseAfterSettlement,
    async finalize() {
      try { await releaseAfterSettlement(); return { state: 'removed', workDir, ownershipPending: false }; }
      catch { return { state: 'retained', workDir, ownershipPending: true,
        reason: 'original-resource-release-or-owned-path-cleanup-unconfirmed' }; }
    }
  });
};

export const retainCanaryAttemptOwner = (result, owner, originalFailure) => {
  owners.set(result, owner);
  if (originalFailure !== undefined) Object.defineProperty(result, 'originalFailure', { value: originalFailure });
  return result;
};
export const getCanaryAttemptOwner = result => owners.get(result) || null;

export const admitCanaryResult = async ({ workDir, outJsonPath, result, maxBytes, signal }) => {
  let bytes, source = 'artifact', hash = null;
  try {
    const read = await readVerifiedContainedFile(workDir, outJsonPath, { maxBytes, signal });
    bytes = read.buffer; hash = read.hash;
  } catch (error) {
    // A failed close or read remains with its original owner before classifying
    // absence or considering an independent stdout fallback.
    observeStorageResource(error, { phase: 'canary-result-read' }).requireSettled();
    if (error.code !== 'ENOENT') throw error;
    const capture = result.outputCapture?.stdout;
    if (!capture?.enabled || capture.truncated || capture.encodingLoss || capture.droppedBytes !== 0) {
      throw failure('ERR_CANARY_RESULT_INCOMPLETE', 'A diagnostic stdout tail cannot establish a complete result.');
    }
    source = 'stdout'; bytes = Buffer.from(result.stdout || '', 'utf8');
    if (bytes.length > maxBytes) throw failure('ERR_FILE_TOO_LARGE', 'Canary stdout result exceeds its byte allowance.');
    hash = createHash('sha256').update(bytes).digest('hex');
  }
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (cause) { throw failure('ERR_CANARY_RESULT_PARSE', 'Canary result is not complete UTF-8 JSON.', cause); }
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(payload) || !(object(payload.canaryMetrics) && typeof payload.canaryMetrics.resultClass === 'string'
    && payload.canaryMetrics.resultClass.trim() || object(payload.run) && typeof payload.run.aggregateResultClass === 'string'
    && payload.run.aggregateResultClass.trim())) {
    throw failure('ERR_CANARY_RESULT_SCHEMA', 'Canary result requires explicit canary metrics or an aggregate benchmark result.');
  }
  return { payload, receipt: { state: 'complete', source, bytes: bytes.length, maxBytes, sha256: hash } };
};
