const observations = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');

/** Original scene/cache functions are independent channels. Missing evidence
 * may attach later; observed functions and unknown inspection outcomes persist. */
export const captureSceneOwnershipObservation = error => {
  if (!objectLike(error)) return { observe: null, inspectionErrors: [] };
  let captured = observations.get(error);
  if (!captured) {
    const observers = new Map(), inspectionErrors = [];
    captured = { observers, inspectionErrors,
      released: () => [...observers.values()].map(record => record.observe()).every(Boolean) };
    observations.set(error, captured);
  }
  for (const [marker, released] of [['sceneOwnershipPending', 'sceneOwnershipReleased'], ['cacheOwnershipPending', 'cacheOwnershipReleased']]) {
    if (captured.observers.has(marker)) continue;
    try {
      const method = error[released];
      if (error[marker] !== true && typeof method !== 'function') continue;
      captured.observers.set(marker, { method,
        observe: () => { try { return typeof method === 'function' && method.call(error) === true; } catch { return false; } } });
    } catch (inspectionError) {
      captured.inspectionErrors.push(inspectionError); captured.observers.set(marker, { method: null, observe: () => false });
    }
  }
  return { observe: captured.observers.size ? captured.released : null,
    observeExcept: method => [...captured.observers].every(([marker, record]) =>
      (marker === 'sceneOwnershipPending' && typeof method === 'function' && record.method === method) || record.observe()),
    inspectionErrors: [...captured.inspectionErrors] };
};
