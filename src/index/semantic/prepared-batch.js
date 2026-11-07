import { canonicalSemanticJson } from './identity.js';
import { isSemanticJsonBudgetError, semanticJsonBudgetError } from './canonical-json-bounds.js';

const preparedEntries = new WeakMap();
/** Mint an immutable producer snapshot; caller-provided encoded bytes are never trusted. */
export const prepareSemanticBatchEntry = (entry, { maxBytes = null, check = null } = {}) => {
  if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 2)) throw new TypeError('Prepared semantic entry allowance must contain a row and newline.');
  if (preparedEntries.has(entry)) {
    check?.();
    if (maxBytes !== null && preparedEntries.get(entry).byteCount > maxBytes) throw semanticJsonBudgetError('Prepared semantic entry exceeds its byte allowance.');
    return entry;
  }
  const rowDescriptor = Object.getOwnPropertyDescriptor(entry, 'row');
  if (!rowDescriptor || !Object.hasOwn(rowDescriptor, 'value')) throw new TypeError('Semantic row getters are not JSON.');
  let rowJson = null;
  const envelope = canonicalSemanticJson(entry, {
    maxBytes: maxBytes === null ? null : maxBytes - 1, check,
    onObjectEncoded: (value, encoded) => { if (value === rowDescriptor.value) rowJson = encoded; }
  });
  if (!rowJson) throw new TypeError('Expected an explicit semantic row object.');
  const snapshot = JSON.parse(envelope), pending = [snapshot];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) continue;
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
    Object.freeze(value);
  }
  preparedEntries.set(snapshot, Object.freeze({ rowJson, byteCount: Buffer.byteLength(envelope) + 1 }));
  return snapshot;
};
/** Immutable strings/accounting only: no mutable prepared buffer escapes. */
export const readPreparedSemanticBatchEntry = entry => preparedEntries.get(entry) || null;
export const semanticBatchEntryBytes = entry => {
  const prepared = preparedEntries.get(entry);
  if (!prepared) throw new TypeError('Expected an owned prepared semantic entry.');
  return prepared.byteCount;
};

/** Producer admission precedes JSON encoding, snapshotting and freezing. The
 * sink still independently checks schema, sequence and aggregate byteCount. */
export const prepareSemanticProducerEntry = (entry, maxBytes, check = null, limitCode = 'ERR_SEMANTIC_RECORD_LIMIT') => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('Positive semantic producer byte allowance required.');
  const limitError = cause => Object.assign(new Error('Semantic record exceeds producer batch allowance.', { cause }),
    { code: limitCode });
  check?.();
  if (maxBytes < 2) throw limitError();
  try { return prepareSemanticBatchEntry(entry, { maxBytes, check }); }
  catch (error) {
    if (isSemanticJsonBudgetError(error)) throw limitError(error);
    throw error;
  }
};
