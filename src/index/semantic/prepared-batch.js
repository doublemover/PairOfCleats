import { canonicalSemanticJson } from './identity.js';

const preparedEntries = new WeakMap();
/** Mint an immutable producer snapshot; caller-provided encoded bytes are never trusted. */
export const prepareSemanticBatchEntry = (entry) => {
  if (preparedEntries.has(entry)) return entry;
  const rowDescriptor = Object.getOwnPropertyDescriptor(entry, 'row');
  if (!rowDescriptor || !Object.hasOwn(rowDescriptor, 'value')) throw new TypeError('Semantic row getters are not JSON.');
  let rowJson = null;
  const envelope = canonicalSemanticJson(entry, {
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
