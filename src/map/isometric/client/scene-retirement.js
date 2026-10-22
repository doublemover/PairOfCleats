import { captureSceneFailure, projectSceneFailure, observeSceneFailureOwnership as observe } from './scene-failure-inspection.js';

const pending = new Set();
const objectLike = value => value && (typeof value === 'object' || typeof value === 'function');
export { observe as observeSceneOwnership };
const failure = (primary, errors, captured = captureSceneFailure(primary),
  inspectionErrors = captured.inspectionErrors, overflow = captured.overflow) => {
  const result = new AggregateError([...errors, ...inspectionErrors], captured.message, { cause: primary });
  const reserved = new Set(['cause', 'errors', 'message', 'stack', 'sceneResourceOwner', 'sceneResourceOwners',
    'sceneCleanupErrors', 'sceneOwnershipPending', 'sceneOwnershipReleased', 'cacheOwnershipPending', 'cacheOwnershipReleased',
    'sceneInspectionErrors', 'sceneInspectionOverflow',
    'rendererTransactionCommitted', 'rendererTransactionStamp', 'rendererTransactionPhase', 'rendererTransactionCleanupFailed']);
  projectSceneFailure(result, captured, reserved);
  Object.defineProperties(result, { sceneInspectionErrors: { value: Object.freeze([...inspectionErrors]) },
    sceneInspectionOverflow: { value: overflow } });
  return result;
};

/** Keep the exact primary and every independently attempted cleanup outcome. */
export const preserveSceneCleanupFailures = (primary, cleanupErrors, { hasPrimary = primary !== null && primary !== undefined, forceAggregate = false } = {}) => {
  const errors = hasPrimary ? [primary, ...cleanupErrors] : cleanupErrors;
  if (!errors.length) return null;
  const captured = errors.map(captureSceneFailure);
  if (!hasPrimary && !forceAggregate && errors.length === 1 && objectLike(errors[0])
    && !captured[0].inspectionErrors.length && !captured[0].overflow) return errors[0];
  const inspectionErrors = captured.flatMap(snapshot => snapshot.inspectionErrors);
  const result = failure(hasPrimary ? primary : errors[0], errors, captured[0], inspectionErrors,
    captured.some(snapshot => snapshot.overflow));
  const observers = captured.filter(snapshot => snapshot.hasOwnership).map(snapshot => snapshot.released);
  const released = () => observers.every(check => check());
  const owners = captured.flatMap(snapshot => snapshot.owners);
  Object.defineProperties(result, { sceneCleanupErrors: { value: Object.freeze([...cleanupErrors]) },
    sceneResourceOwners: { value: Object.freeze([...new Set(owners)]) },
    sceneOwnershipPending: { get: () => !released() }, sceneOwnershipReleased: { value: released } });
  return result;
};

/** Capture a resource's original method once. Lookup removal and a dispose
 * event dispatch are not proof that a throwing listener completed cleanup. */
export const captureSceneResource = (resource, label = 'scene resource', methodName = 'dispose', args = [], { required = false } = {}) => {
  const capturedArgs = [...args];
  let dispose = null, captureError, captureFailed = false, closed = false, lastError = null, flight = null;
  const children = new Map();
  try {
    const method = resource?.[methodName]; dispose = typeof method === 'function' ? method : null;
    if (required && !dispose) throw new TypeError(`${label} has no original ${methodName} method.`);
  }
  catch (error) { captureFailed = true; captureError = error; }
  const retain = error => {
    const check = observe(error); if (check && !children.has(error)) children.set(error, check);
    const retained = failure(error, [error]);
    Object.defineProperties(retained, { sceneResourceOwner: { value: owner }, sceneResourceOwners: { value: Object.freeze([owner]) },
      sceneOwnershipPending: { get: () => !closed }, sceneOwnershipReleased: { value: () => closed } });
    lastError = retained; pending.add(owner); return retained;
  };
  let disposed = false;
  const confirm = () => {
    for (const [error, check] of children) if (!check()) throw error;
    closed = true; pending.delete(owner); return Object.freeze({ settled: true, pending: false });
  };
  const release = ({ retry = false } = {}) => {
    if (closed) return Object.freeze({ settled: true, pending: false });
    if (flight || (lastError && !retry)) throw lastError;
    pending.add(owner);
    try {
      if (captureFailed) throw captureError;
      if (!disposed) {
        const result = dispose?.apply(resource, capturedArgs);
        if (result && typeof result.then === 'function') {
          const waiting = Object.assign(new Error(`${label} disposal has not settled.`), { code: 'ERR_MAP_SCENE_DISPOSAL_PENDING' });
          lastError = retain(waiting);
          flight = Promise.resolve(result).then(value => {
            if (value === false) throw Object.assign(new Error(`${label} disposal was explicitly unconfirmed.`), { code: 'ERR_MAP_SCENE_DISPOSAL_UNCONFIRMED' });
            disposed = true; confirm();
          }, error => { throw error; })
            .catch(error => { retain(error); }).finally(() => { flight = null; });
          throw lastError;
        }
        if (result === false) throw Object.assign(new Error(`${label} disposal was explicitly unconfirmed.`), { code: 'ERR_MAP_SCENE_DISPOSAL_UNCONFIRMED' });
        disposed = true;
      }
      return confirm();
    } catch (error) { if (error === lastError) throw error; throw retain(error); }
  };
  const owner = Object.freeze({ label, resource, get pending() { return !closed; }, get lastError() { return lastError; },
    retire: () => release(), release: () => release({ retry: true }) });
  return owner;
};

/** Strong references retain failed/unfinished exact owners after scene removal. */
export const getPendingSceneResourceOwners = () => Object.freeze([...pending]);
