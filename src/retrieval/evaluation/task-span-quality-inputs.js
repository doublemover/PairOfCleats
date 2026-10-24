import { TASK_SPAN_TRACE_VERSION } from '../../contracts/schemas/task-span-trace.js';
import { TASK_SPAN_TRACE_POLICY } from './task-span-trace.js';

const hash = /^[a-f0-9]{64}$/u;
const statuses = new Set(['complete', 'failed', 'timeout', 'cancelled', 'incomplete']);
const fail = message => Object.assign(new Error(message), { code: 'ERR_TASK_SPAN_TRACE' });
const object = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Task-span comparison requires original receipt data objects.');
  return value;
};
const read = (original, name, optional = false) => {
  const descriptor = Object.getOwnPropertyDescriptor(original, name);
  if (!descriptor) {
    if (!optional || name in original) throw fail('Task-span comparison requires original own receipt evidence.');
    return undefined;
  }
  if (!Object.hasOwn(descriptor, 'value')) throw fail('Task-span comparison cannot execute receipt accessors.');
  return descriptor.value;
};
const identityHash = (original, name) => {
  const value = read(original, name);
  if (typeof value !== 'string' || !hash.test(value)) throw fail('Task-span comparison requires immutable receipt identity hashes.');
  return value;
};
const identityText = (original, name) => {
  const value = read(original, name);
  if (typeof value !== 'string' || !value || value.length > 256) throw fail('Task-span comparison requires original repository/family identity.');
  return value;
};

/** Capture only the bounded provenance and selected metric actually consumed by
 * comparison. Full traces remain with their producer; no getter or custom array
 * method can replace the receipt used later for pairing or run-key hashing. */
export const captureTaskSpanQualityReceipts = (original, metric) => {
  if (typeof metric !== 'string' || !metric || metric.length > 128) throw fail('Task-span comparison requires its selected scalar metric name.');
  if (!Array.isArray(original)) throw fail('Task-span comparison requires an explicit receipt array.');
  const count = read(original, 'length');
  if (!Number.isSafeInteger(count) || count < 0 || count > 128) throw fail('Task-span comparison populations exceed128 receipts.');
  const rows = [];
  for (let index = 0; index < count; index++) {
    const receipt = object(read(original, index));
    if (read(receipt, 'schemaVersion') !== TASK_SPAN_TRACE_VERSION || read(receipt, 'kind') !== 'task-span-evaluation'
      || read(receipt, 'complete') !== true || read(receipt, 'policy') !== TASK_SPAN_TRACE_POLICY) {
      throw fail('Comparable complete task-span evaluation receipts are required.');
    }
    const traceKey = identityHash(receipt, 'traceKey'), sourceDigest = identityHash(receipt, 'sourceDigest');
    const goldDigest = identityHash(receipt, 'goldDigest'), judgmentPolicyKey = identityHash(receipt, 'judgmentPolicyKey');
    const input = object(read(receipt, 'identity'));
    const identity = Object.freeze({ taskKey: identityHash(input, 'taskKey'), inputKey: identityHash(input, 'inputKey'),
      queryDigest: identityHash(input, 'queryDigest'), repoId: identityText(input, 'repoId'), familyId: identityText(input, 'familyId') });
    const runStatus = read(receipt, 'runStatus');
    if (!statuses.has(runStatus) || read(receipt, 'runComplete') !== (runStatus === 'complete')) {
      throw fail('Task-span run completion must retain its original status observation.');
    }
    let measurement = null;
    if (runStatus === 'complete') {
      const metrics = read(receipt, 'metrics', true);
      const value = metrics == null ? null : read(object(metrics), metric, true);
      if (Number.isFinite(value)) measurement = value;
    }
    rows.push(Object.freeze({ traceKey, sourceDigest, goldDigest, judgmentPolicyKey, identity, runStatus, measurement }));
  }
  return Object.freeze(rows);
};
