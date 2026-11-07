import { addStorageFailureContext } from '../../../../shared/storage/operation-error.js';

const decisions = new WeakMap();
/** Only the actual shared health owner can classify admission. A matching code,
 * copied receipt or server response cannot suppress ordinary failure accounting. */
export const retainWorkspaceHealthDecision = (primary, { kind, method, failureClass = null, methodScoped = false }) => {
  if (!['not-admitted', 'failed-admitted'].includes(kind) || typeof method !== 'string') throw new TypeError('Invalid workspace-health decision.');
  const failure = addStorageFailureContext(primary, {}, undefined, { forceAggregate: true });
  decisions.set(failure, Object.freeze({ kind, method, failureClass, methodScoped: methodScoped === true }));
  return failure;
};
export const getWorkspaceHealthDecision = error => error !== null && ['object', 'function'].includes(typeof error)
  ? decisions.get(error) || null : null;
