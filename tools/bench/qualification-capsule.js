import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

const data = (value, key) => { try { return value && Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; } };
const capturedResult = result => result ? Object.fromEntries(['pid', 'exitCode', 'signal', 'durationMs', 'timedOut', 'termination',
  'stdout', 'stderr', 'outputCapture'].map(key => [key, data(result, key)])) : null;

export const recordQualificationFailure = async ({ error, receiptPath, invocation = null }, { publish = atomicWriteJson } = {}) => {
  const failures = [], queue = [error], seen = new Set();
  while (queue.length && failures.length < 128) {
    const current = queue.shift(); if (seen.has(current)) continue; seen.add(current);
    failures.push({ name: data(current, 'name'), code: data(current, 'code'), message: data(current, 'message'),
      thrownType: current === null ? 'null' : typeof current,
      result: capturedResult(data(current, 'result') || data(current, 'workerResult')) });
    const cause = data(current, 'cause'); if (cause !== undefined) queue.push(cause);
    const errors = data(current, 'errors');
    if (Array.isArray(errors)) for (let index = 0; index < Math.min(errors.length, 128); index++) queue.push(data(errors, String(index)));
  }
  try { await publish(receiptPath, { schemaVersion: 1, historicalAuthorWorkspace: true,
    state: 'failed-capsule;not-resource-settlement-authority', invocation, failures, failureTraversalTruncated: queue.length > 0 }, { createOnly: true }); }
  catch (publication) { throw addStorageFailureContext(error, { phase: 'qualification-failure-publication' }, publication, { secondaryPresent: true }); }
};

/** One actual original subprocess owner, fixed30s and bounded captures. Failure
 * publication never replaces the original throwable or grants cleanup rights. */
export const runQualificationCapsule = async ({ args, receiptPath, maxOutputBytes = 1048576 }, {
  spawn = spawnSubprocess, publish = atomicWriteJson
} = {}) => {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 4 * 1024 * 1024) throw new RangeError('Invalid qualification capture bound.');
  const invocation = { executable: process.execPath, args, timeoutMs: 30000, maxOutputBytes };
  let result;
  try {
    result = await spawn(process.execPath, args, { timeoutMs: 30000, maxOutputBytes, outputMode: 'string',
      captureStdout: true, captureStderr: true, rejectOnNonZeroExit: true, killTree: true });
  } catch (error) {
    await recordQualificationFailure({ error, receiptPath, invocation }, { publish }); throw error;
  }
  try {
    await publish(receiptPath, { schemaVersion: 1, historicalAuthorWorkspace: true,
      state: 'original-process-returned;consumer-validation-still-required', invocation, result: capturedResult(result) }, { createOnly: true });
  } catch (publication) {
    throw addStorageFailureContext(publication, { result }, null, { forceAggregate: true, nonEnumerable: ['result'] });
  }
  return result;
};
