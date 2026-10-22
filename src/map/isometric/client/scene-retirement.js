const pending = new Set();
const objectLike = value => value && (typeof value === 'object' || typeof value === 'function');
const describe = error => { try { return error?.message || 'Scene resource retirement remains pending.'; } catch { return 'Scene resource retirement remains pending.'; } };
const observe = error => {
  if (!objectLike(error)) return null;
  try {
    const method = error.sceneOwnershipReleased || error.cacheOwnershipReleased;
    if (error.sceneOwnershipPending !== true && error.cacheOwnershipPending !== true && typeof method !== 'function') return null;
    return () => { try { return typeof method === 'function' && method.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};
const failure = (primary, errors) => {
  const result = new AggregateError(errors, describe(primary), { cause: primary });
  if (objectLike(primary)) {
    const descriptors = Object.getOwnPropertyDescriptors(primary);
    const reserved = new Set(['cause', 'errors', 'message', 'stack', 'sceneResourceOwner', 'sceneResourceOwners',
      'sceneCleanupErrors', 'sceneOwnershipPending', 'sceneOwnershipReleased']);
    for (const key of Reflect.ownKeys(descriptors)) if (!reserved.has(key)) Object.defineProperty(result, key, descriptors[key]);
  }
  return result;
};

/** Keep the exact primary and every independently attempted cleanup outcome. */
export const preserveSceneCleanupFailures = (primary, cleanupErrors) => {
  const errors = primary ? [primary, ...cleanupErrors] : cleanupErrors;
  if (!errors.length) return null;
  if (!primary && errors.length === 1) return errors[0];
  const result = failure(primary || errors[0], errors), observers = errors.map(observe).filter(Boolean);
  const released = () => observers.every(check => check());
  const owners = errors.flatMap(error => error?.sceneResourceOwners || (error?.sceneResourceOwner ? [error.sceneResourceOwner] : []));
  Object.defineProperties(result, { sceneCleanupErrors: { value: Object.freeze([...cleanupErrors]) },
    sceneResourceOwners: { value: Object.freeze([...new Set(owners)]) },
    sceneOwnershipPending: { get: () => !released() }, sceneOwnershipReleased: { value: released } });
  return result;
};

/** Capture a resource's original method once. Lookup removal and a dispose
 * event dispatch are not proof that a throwing listener completed cleanup. */
export const captureSceneResource = (resource, label = 'scene resource', methodName = 'dispose', args = []) => {
  const capturedArgs = [...args];
  let dispose = null, captureError = null, closed = false, lastError = null, flight = null;
  const children = new Map();
  try { const method = resource?.[methodName]; dispose = typeof method === 'function' ? method : null; }
  catch (error) { captureError = error; }
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
      if (captureError) throw captureError;
      if (!disposed) {
        const result = dispose?.apply(resource, capturedArgs);
        if (result && typeof result.then === 'function') {
          const waiting = Object.assign(new Error(`${label} disposal has not settled.`), { code: 'ERR_MAP_SCENE_DISPOSAL_PENDING' });
          lastError = retain(waiting);
          flight = Promise.resolve(result).then(() => { disposed = true; confirm(); }, error => { throw error; })
            .catch(error => { retain(error); }).finally(() => { flight = null; });
          throw lastError;
        }
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
