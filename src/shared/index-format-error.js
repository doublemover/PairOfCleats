import { observeStorageResource } from './storage/failure-observation.js';
const projecting = new WeakSet();

/** Preserve the exact-format diagnostic through public wrappers and cleanup
 * causes. Projection observes original prerequisites; it cannot settle them.
 */
export const projectIndexFormatError = (error) => {
  if (!error || !['object', 'function'].includes(typeof error)) return null;
  if (projecting.has(error)) throw Object.assign(new Error('Reentrant index format diagnostic cannot establish original resource settlement.', { cause: error }), { code: 'ERR_INDEX_FORMAT_DIAGNOSTIC_REENTRANCY' });
  const seen = new Set(), observations = new Map();
  const observe = value => {
    if (value === null || !['object', 'function'].includes(typeof value) || observations.has(value)) return;
    if (observations.size === 128) throw Object.assign(new RangeError('Index format diagnostic exceeds its bounded cause/metadata inventory.'), { code: 'ERR_INDEX_FORMAT_DIAGNOSTIC_LIMIT' });
    observations.set(value, observeStorageResource(value, { phase: 'index-format-error-projection' }));
  };
  const requireSettled = () => { for (const observation of observations.values()) observation.requireSettled(); };
  const read = (value, key) => {
    requireSettled();
    let result;
    try { result = value[key]; }
    catch (inspection) { throw observations.get(value).retain(inspection, { inspectionPresent: true }); }
    requireSettled(); return result;
  };
  const root = error;
  projecting.add(root);
  let original;
  try {
    observe(root); original = observations.get(root);
    while (error && ['object', 'function'].includes(typeof error) && !seen.has(error)) {
      seen.add(error); observe(error); requireSettled();
      if (read(error, 'code') === 'ERR_INDEX_FORMAT_UNSUPPORTED') {
        const supplied = read(error, 'details');
        const source = supplied && ['object', 'function'].includes(typeof supplied) ? supplied : error;
        observe(source); requireSettled();
        const details = {};
        for (const key of ['operation', 'component', 'expectedVersion', 'foundVersion', 'repoRoot', 'indexPath', 'rebuildCommand']) {
          const value = read(source, key);
          if (value !== undefined) details[key] = value;
        }
        requireSettled();
        return { nativeCode: 'ERR_INDEX_FORMAT_UNSUPPORTED', ...details };
      }
      error = read(error, 'cause');
    }
    requireSettled(); return null;
  } catch (inspection) {
    throw original ? original.retain(inspection, { inspectionPresent: true }) : inspection;
  } finally { projecting.delete(root); }
};

/** Restore metadata explicitly serialized across a worker boundary. */
export const restoreIndexFormatError = (diagnostic) => {
  const { message, nativeCode, ...details } = diagnostic;
  return Object.assign(new Error(message), details, { code: nativeCode, details });
};
