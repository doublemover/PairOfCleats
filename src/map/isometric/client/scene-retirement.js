import { captureSceneFailure, projectSceneFailure, observeSceneFailureOwnership as observe } from './scene-failure-inspection.js';

const pending = new Set();
const compositions = new WeakMap(), resourceFailures = new WeakMap();
const objectLike = value => value && (typeof value === 'object' || typeof value === 'function');
export { observe as observeSceneOwnership };

/** Read-only proof for a local prerequisite walker. Only private original
 * producers can delegate their own scene closure; public owner/cause fields
 * cannot name a producer or authorize another resource's closure delegation. */
export const captureScenePrerequisiteProducer = (error, scopedOwners = []) => {
  if (!objectLike(error)) return null;
  const composition = compositions.get(error);
  if (composition) return composition;
  const resource = resourceFailures.get(error);
  if (!resource || !scopedOwners.includes(resource.owner)) return null;
  return Object.freeze({ errors: Object.freeze([resource.original]), observation: resource.observation });
};
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
export const preserveSceneCleanupFailures = (primary, cleanupErrors, { hasPrimary = primary !== null && primary !== undefined, forceAggregate = false, diagnostics = true } = {}) => {
  const errors = hasPrimary ? [primary, ...cleanupErrors] : cleanupErrors;
  if (!errors.length) return null;
  const captured = errors.map(error => captureSceneFailure(error, { diagnostics }));
  if (!hasPrimary && !forceAggregate && errors.length === 1 && objectLike(errors[0])
    && !captured[0].inspectionErrors.length && !captured[0].overflow) return errors[0];
  const inspectionErrors = captured.flatMap(snapshot => snapshot.inspectionErrors);
  const result = failure(hasPrimary ? primary : errors[0], errors, captured[0], inspectionErrors,
    captured.some(snapshot => snapshot.overflow));
  // An originally absent channel may receive its first evidence on later
  // admission. Keep every original snapshot's stable predicate in the wrapper.
  const observers = captured.map(snapshot => snapshot.released);
  const released = () => observers.every(check => check());
  const owners = captured.flatMap(snapshot => snapshot.owners);
  Object.defineProperties(result, { sceneCleanupErrors: { value: Object.freeze([...cleanupErrors]) },
    sceneResourceOwners: { value: Object.freeze([...new Set(owners)]) },
    sceneOwnershipPending: { get: () => !released() }, sceneOwnershipReleased: { value: released } });
  compositions.set(result, Object.freeze({ errors: Object.freeze([...errors]), observation: released }));
  return result;
};

/** Capture a resource's original method once. Lookup removal and a dispose
 * event dispatch are not proof that a throwing listener completed cleanup. */
export const captureSceneResource = (resource, label = 'scene resource', methodName = 'dispose', args = [], { required = false } = {}) => {
  const capturedArgs = [...args];
  let dispose = null, captureError, captureFailed = false, closed = false, lastError = null, flight = null;
  const children = new Map();
  const retainFailure = error => {
    const inspect = [error], visited = new Set();
    while (inspect.length) {
      const original = inspect.pop();
      if (visited.has(original)) continue; visited.add(original);
      const composition = objectLike(original) && compositions.get(original);
      const resource = objectLike(original) && resourceFailures.get(original);
      const ownResource = resource?.owner === owner;
      const excluded = composition?.observation || (ownResource ? resource.observation : null);
      const captured = captureSceneFailure(original);
      if (captured.hasOwnership) {
        const check = excluded ? () => captured.releasedExcept(excluded) : captured.released;
        children.set(original, check);
        if (!check()) { closed = false; pending.add(owner); }
      }
      // Only original producer records may remove their own closure observer.
      // Every independent original/inspection/cache observation is retained.
      if (composition) inspect.push(...composition.errors);
      else if (ownResource) inspect.push(resource.original);
    }
  };
  const assertReady = () => { for (const [error, check] of children) if (!check()) throw error; };
  try {
    const method = resource?.[methodName]; dispose = typeof method === 'function' ? method : null;
    if (required && !dispose) throw new TypeError(`${label} has no original ${methodName} method.`);
  }
  catch (error) { captureFailed = true; captureError = error; }
  const retain = error => {
    retainFailure(error);
    const captured = captureSceneFailure(error), retained = failure(error, [error], captured);
    const released = () => closed;
    Object.defineProperties(retained, { sceneResourceOwner: { value: owner },
      sceneResourceOwners: { value: Object.freeze([...new Set([...captured.owners, owner])]) },
      sceneOwnershipPending: { get: () => !closed }, sceneOwnershipReleased: { value: released } });
    resourceFailures.set(retained, { owner, original: error, observation: released });
    lastError = retained; pending.add(owner); return retained;
  };
  let disposed = false;
  const confirm = () => {
    assertReady();
    closed = true; pending.delete(owner); return Object.freeze({ settled: true, pending: false });
  };
  const release = ({ retry = false } = {}) => {
    if (closed) return Object.freeze({ settled: true, pending: false });
    if (flight || (lastError && !retry)) throw lastError;
    // Register a pending parent only when its disposal actually fails or waits.
    // Nested child owners then precede that parent during explicit recovery.
    try {
      if (captureFailed) throw captureError;
      assertReady();
      if (!disposed) {
        const result = dispose?.apply(resource, capturedArgs);
        if (result && typeof result.then === 'function') {
          const waiting = Object.assign(new Error(`${label} disposal has not settled.`), { code: 'ERR_MAP_SCENE_DISPOSAL_PENDING' });
          lastError = retain(waiting);
          flight = Promise.resolve(result).then(value => {
            if (value === false) throw Object.assign(new Error(`${label} disposal was explicitly unconfirmed.`), { code: 'ERR_MAP_SCENE_DISPOSAL_UNCONFIRMED' });
            disposed = true; return confirm();
          }, error => { throw error; })
            .catch(error => Object.freeze({ settled: true, pending: true, error: retain(error) })).finally(() => { flight = null; });
          throw lastError;
        }
        if (result === false) throw Object.assign(new Error(`${label} disposal was explicitly unconfirmed.`), { code: 'ERR_MAP_SCENE_DISPOSAL_UNCONFIRMED' });
        disposed = true;
      }
      return confirm();
    } catch (error) {
      if (lastError !== null && error === lastError) throw error;
      // A later prerequisite failure cannot replace the original failed native
      // disposal while this same resource remains retained.
      const retained = lastError === null ? error : preserveSceneCleanupFailures(lastError, [error],
        { hasPrimary: true, forceAggregate: true });
      throw retain(retained);
    }
  };
  const settleAsync = async retry => {
    try { return release({ retry }); }
    catch (error) {
      const waiting = flight;
      if (!waiting) throw error;
      const outcome = await waiting;
      if (outcome.pending) throw outcome.error;
      return outcome;
    }
  };
  const owner = Object.freeze({ label, resource, get pending() { return !closed; }, get lastError() { return lastError; },
    retainFailure, assertReady, assertCaptured: () => { if (captureFailed) throw retain(captureError); },
    retireAsync: () => settleAsync(false), releaseAsync: () => settleAsync(true),
    retire: () => release(), release: () => release({ retry: true }) });
  return owner;
};

/** Strong references retain failed/unfinished exact owners after scene removal. */
export const getPendingSceneResourceOwners = () => Object.freeze([...pending]);
