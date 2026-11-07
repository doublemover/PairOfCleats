import { validateSemanticRecord } from '../contracts/validators/semantic.js';

const recordKeys = new Set(['partitionId', 'localId']);
const fieldGroups = new Set(['span', 'scope', 'data']);
const ownValue = (input, key, fail, message) => {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail(message);
  return descriptor.value;
};

/** Copy the finite RecordRef shape without invoking caller property accessors.
 * Reflection failures retain their original identity, including resource owners.
 */
export const captureSemanticRecordRef = (input, fail) => {
  const message = 'Invalid semantic RecordRef.';
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(message);
  for (const key in input) {
    if (Object.hasOwn(input, key) && !recordKeys.has(key)) throw fail(message);
  }
  const ref = {
    partitionId: ownValue(input, 'partitionId', fail, message),
    localId: ownValue(input, 'localId', fail, message)
  };
  if (!validateSemanticRecord('recordRef', ref).ok) throw fail(message);
  return Object.freeze(ref);
};

export const captureSemanticRecordRefs = (input, maximum, fail) => {
  const message = 'Semantic record request exceeds its limit.';
  if (!Array.isArray(input)) throw fail(message);
  const length = ownValue(input, 'length', fail, message);
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) throw fail(message);
  const refs = new Array(length);
  for (let index = 0; index < length; index++) {
    refs[index] = captureSemanticRecordRef(ownValue(input, String(index), fail,
      'Invalid semantic RecordRef.'), fail);
  }
  return Object.freeze(refs);
};

export const captureSemanticDetailFields = (input, fail) => {
  const message = 'Unknown semantic detail field group.';
  if (!Array.isArray(input)) throw fail(message);
  const length = ownValue(input, 'length', fail, message), selected = new Set();
  if (!Number.isSafeInteger(length) || length < 0) throw fail(message);
  for (let index = 0; index < length; index++) {
    const field = ownValue(input, String(index), fail, message);
    if (!fieldGroups.has(field)) throw fail(message);
    selected.add(field);
  }
  // Duplicate field names were already accepted and project the same value.
  // Retain at most the existing three groups without a new request length cap.
  return Object.freeze([...selected]);
};
