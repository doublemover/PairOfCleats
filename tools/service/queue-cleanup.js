import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { admitQueueJobPaths, assertQueueArtifactPath, assertQueueJobId } from './queue-authority.js';

const recoveries = new WeakMap();
export const QUEUE_CLEANUP_HOLD_SCHEMA_VERSION = 1;
const objectLike = value => value !== null && ['object', 'function'].includes(typeof value);
const failure = (code, message) => Object.assign(new Error(message), { code });
const token = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const queueIdentity = queueName => (typeof queueName === 'string' ? queueName.trim().toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-') : '') || 'index';

export const captureQueueFailureOwnership = (error, { required = false } = {}) => {
  const inspections = [];
  let observe, marker;
  if (objectLike(error)) {
    try { observe = error.cacheOwnershipReleased; } catch (inspection) { inspections.push(inspection); }
    try { marker = error.cacheOwnershipPending; } catch (inspection) { inspections.push(inspection); }
  }
  const present = required || inspections.length > 0 || marker === true || typeof observe === 'function';
  return { error, present, inspections,
    released: () => {
      if (!present) return true;
      if (inspections.length || typeof observe !== 'function') return false;
      try { return observe.call(error) === true; }
      catch (inspection) { inspections.push(inspection); return false; }
    } };
};

export const getQueueCleanupPath = (dirPath, queueName) => path.join(dirPath,
  `cleanup-holds${queueIdentity(queueName) === 'index' ? '' : `-${queueIdentity(queueName)}`}.json`);

export const normalizeQueueCleanupHolds = (dirPath, holds) => {
  if (holds === undefined) return [];
  if (!Array.isArray(holds)) throw failure('QUEUE_INVALID_CLEANUP_STATE', 'Queue cleanup holds must be an array.');
  const ids = new Set();
  return holds.map(hold => {
    if (!hold || typeof hold !== 'object' || typeof hold.id !== 'string' || !/^[a-f0-9-]{36}$/.test(hold.id)
      || ids.has(hold.id) || !token(hold.ownerId) || !Number.isSafeInteger(hold.leaseVersion) || hold.leaseVersion < 1
      || !token(hold.retainedAt) || !Number.isFinite(Date.parse(hold.retainedAt))
      || (hold.attemptId !== null && !token(hold.attemptId)) || !token(hold.failureCode)) {
      throw failure('QUEUE_INVALID_CLEANUP_STATE', 'Queue cleanup hold identity is invalid.');
    }
    ids.add(hold.id); assertQueueJobId(hold.jobId);
    if (hold.job?.id !== hold.jobId || hold.job?.lease?.owner !== hold.ownerId
      || hold.job?.lease?.version !== hold.leaseVersion
      || (hold.job?.delivery?.activeAttemptId || null) !== hold.attemptId) {
      throw failure('QUEUE_INVALID_CLEANUP_STATE', 'Cleanup snapshot does not match its original claim.');
    }
    return { id: hold.id, jobId: hold.jobId, ownerId: hold.ownerId, leaseVersion: hold.leaseVersion,
      attemptId: hold.attemptId, retainedAt: hold.retainedAt, failureCode: hold.failureCode,
      job: admitQueueJobPaths(dirPath, hold.job) };
  });
};

export const loadQueueCleanupHolds = async (dirPath, queueName) => {
  const file = getQueueCleanupPath(dirPath, queueName); assertQueueArtifactPath(dirPath, file);
  try {
    const payload = JSON.parse(await fs.readFile(file, 'utf8'));
    if (payload?.schemaVersion !== QUEUE_CLEANUP_HOLD_SCHEMA_VERSION || !Array.isArray(payload?.holds)) {
      throw failure('QUEUE_INVALID_CLEANUP_STATE', 'Queue cleanup receipt version or hold inventory is invalid.');
    }
    return normalizeQueueCleanupHolds(dirPath, payload.holds);
  }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};

export const saveQueueCleanupHolds = async (dirPath, queueName, holds) => {
  const file = getQueueCleanupPath(dirPath, queueName); assertQueueArtifactPath(dirPath, file);
  await atomicWriteJson(file, { schemaVersion: QUEUE_CLEANUP_HOLD_SCHEMA_VERSION,
    holds: normalizeQueueCleanupHolds(dirPath, holds) }, { spaces: 2 });
};

export const assertQueueCleanupClear = (queue, jobId = null) => {
  const holds = queue.cleanupHolds.filter(hold => jobId === null || hold.jobId === jobId);
  if (holds.length) throw Object.assign(failure('QUEUE_CLEANUP_PENDING', 'Original queue claim resource cleanup remains unconfirmed.'),
    { cleanupHolds: holds.map(({ id, jobId: originalJobId, ownerId, leaseVersion, attemptId, failureCode }) =>
      ({ id, jobId: originalJobId, ownerId, leaseVersion, attemptId, failureCode })), retryable: false });
};

/** Private capabilities retain exact observers and causes; serialized IDs,
 * matching PIDs, elapsed leases and changed advisory flags cannot mint one.
 */
export const createQueueCleanupRecovery = ({ dirPath, queueName, job, observations, causes }) => {
  const snapshot = JSON.parse(JSON.stringify(admitQueueJobPaths(dirPath, job)));
  const retainedCauses = [...causes];
  let originalCode;
  for (const error of causes) {
    try { const code = error?.code; if (typeof code === 'string' && code) { originalCode = code; break; } }
    catch (inspection) {
      retainedCauses.push(inspection);
      const observation = captureQueueFailureOwnership(inspection);
      if (observation.present) observations.push(observation);
    }
  }
  const hold = normalizeQueueCleanupHolds(dirPath, [{ id: randomUUID(), jobId: snapshot.id,
    ownerId: snapshot.lease?.owner, leaseVersion: snapshot.lease?.version,
    attemptId: snapshot.delivery?.activeAttemptId || null, retainedAt: new Date().toISOString(),
    failureCode: typeof originalCode === 'string' && originalCode ? originalCode.slice(0, 256) : 'QUEUE_RESOURCE_CLEANUP_FAILED', job: snapshot }])[0];
  const capability = Object.freeze({});
  const state = { dirPath: path.resolve(dirPath), queueName: queueIdentity(queueName), hold,
    observations, causes: retainedCauses, released: false, retained: false };
  recoveries.set(capability, state);
  return { capability, error: queueCleanupRecoveryError(capability) };
};

export const requireQueueCleanupRecovery = (dirPath, queueName, capability) => {
  const state = objectLike(capability) ? recoveries.get(capability) : null;
  if (!state || state.dirPath !== path.resolve(dirPath) || state.queueName !== queueIdentity(queueName)) {
    throw failure('QUEUE_CLEANUP_AUTHORITY', 'Cleanup recovery requires the original claim capability and queue.');
  }
  return state;
};

export const queueCleanupRecoveryError = (capability, secondary = []) => {
  const state = recoveries.get(capability);
  const inspections = state.observations.flatMap(observation => observation.inspections);
  const error = new AggregateError([...state.causes, ...inspections, ...secondary],
    'Queue execution resource cleanup remains retained.', { cause: state.causes[0] });
  Object.defineProperties(error, { code: { value: 'QUEUE_CLEANUP_PENDING', enumerable: true },
    retryable: { value: false }, queueCleanupRecovery: { value: capability },
    cacheOwnershipPending: { get: () => !state.released },
    cacheOwnershipReleased: { value: () => state.released && state.observations.every(observation => observation.released()) } });
  return error;
};
