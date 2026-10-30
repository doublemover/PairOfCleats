const contextStates = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const asError = value => objectLike(value) ? value : new Error(String(value), { cause: value });
const reserved = new Set(['cause', 'errors', 'message', 'stack', 'cacheOwnershipPending', 'cacheOwnershipReleased',
  'storageContextInspectionErrors']);

const snapshotContext = state => {
  const states = [state], visited = new Set(), errors = new Set(), observations = new Set();
  let complete = true;
  while (states.length) {
    const current = states.pop();
    if (visited.has(current)) continue;
    if (visited.size === 128) { complete = false; break; }
    visited.add(current);
    if (current.overflow()) complete = false;
    for (const error of current.inspections) {
      if (errors.size === 128 && !errors.has(error)) { complete = false; break; }
      errors.add(error);
    }
    for (const observation of current.inspectionObservations) {
      if (observations.size === 128 && !observations.has(observation)) { complete = false; break; }
      observations.add(observation);
    }
    states.push(...current.parents);
  }
  return Object.freeze({ complete, inspectionErrors: Object.freeze([...errors]), inspectionObservations: Object.freeze([...observations]) });
};

/** Read only actual producer diagnostics. This conveys independent blockers,
 * never deletion authority or evidence that any resource has been released.
 */
export const readStorageFailureContext = error => {
  const state = objectLike(error) ? contextStates.get(error) : null;
  return state ? snapshotContext(state) : null;
};

/** Attach diagnostics without replacing original cause/resource authority.
 * Explicit null remains the legacy no-secondary sentinel unless the actual
 * producer passes secondaryPresent:true for a caught null/undefined failure.
 */
export const addStorageFailureContext = (value, fields = {}, secondary,
  { nonEnumerable = [], secondaryPresent = secondary !== null && secondary !== undefined,
    forceAggregate = false } = {}) => {
  const primary = asError(value);
  const additional = secondaryPresent && secondary !== primary ? asError(secondary) : null;
  const inspections = [], inspectionObservations = [], observers = [], observed = new WeakSet();
  let overflow = false;
  const state = { inspections, inspectionObservations,
    parents: [...new Set([contextStates.get(primary), additional && contextStates.get(additional)].filter(Boolean))],
    overflow: () => overflow };
  const retainContext = error => { contextStates.set(error, state); return error; };
  const observeError = (error, inspection = false) => {
    if (observed.has(error)) return;
    observed.add(error);
    let original, marker;
    const retainObserver = observe => {
      if (observers.length === 128) { overflow = true; return; }
      observers.push(observe);
      if (inspection) inspectionObservations.push(Object.freeze({ error, observe }));
    };
    const unreadable = inspectionError => {
      retainObserver(() => false);
      retainInspection(inspectionError);
    };
    try { original = error.cacheOwnershipReleased; } catch (inspectionError) { unreadable(inspectionError); }
    try { marker = error.cacheOwnershipPending; } catch (inspectionError) { unreadable(inspectionError); }
    if (marker === true || typeof original === 'function') {
      retainObserver(() => {
        try { return typeof original === 'function' && original.call(error) === true; }
        catch (inspectionError) { retainInspection(inspectionError); return false; }
      });
    }
  };
  const retainInspection = value => {
    const error = asError(value);
    if (contextStates.get(error) === state) return;
    if (observed.has(error)) return;
    if (inspections.length === 64) { overflow = true; return; }
    inspections.push(error);
    const parent = contextStates.get(error);
    if (parent && !state.parents.includes(parent)) state.parents.push(parent);
    observeError(error, true);
  };
  observeError(primary);
  if (additional) observeError(additional);
  const capabilities = new Set(['storageOperationLocks', ...nonEnumerable]);
  const context = Object.create(null);
  let contextObservation = false;
  try {
    for (const key of Reflect.ownKeys(fields)) {
      if (typeof key !== 'string') continue;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(fields, key);
        if (!descriptor?.enumerable) continue;
        if (key === 'cacheOwnershipPending' || key === 'cacheOwnershipReleased') { contextObservation = true; continue; }
        if (reserved.has(key)) continue;
        context[key] = { value: Reflect.get(fields, key), configurable: true, enumerable: !capabilities.has(key) };
      } catch (inspectionError) { retainInspection(inspectionError); }
    }
  } catch (inspectionError) { retainInspection(inspectionError); }
  if (contextObservation) observeError(fields);
  const ownershipDescriptors = (live = false) => ({
    ...((live || observers.length || overflow) ? {
      cacheOwnershipPending: { get: () => Boolean(observers.length || overflow), configurable: true },
      cacheOwnershipReleased: { value: () => !overflow && observers.every(observe => observe()), configurable: true }
    } : {}),
    ...((live || observers.length || inspections.length || state.parents.length || overflow) ? {
      storageContextInspectionErrors: { get: () => snapshotContext(state).inspectionErrors, configurable: true }
    } : {})
  });
  let useAggregate = Boolean(forceAggregate || additional || inspections.length || state.parents.length || overflow);
  if (!useAggregate) {
    try {
      useAggregate = !Object.isExtensible(primary) || Object.hasOwn(primary, 'storageContextInspectionErrors')
        || Object.keys(context).some(key => Object.hasOwn(primary, key))
        || Object.keys(ownershipDescriptors()).some(key => Object.getOwnPropertyDescriptor(primary, key)?.configurable === false);
    }
    catch (inspectionError) { retainInspection(inspectionError); useAggregate = true; }
  }
  if (!useAggregate) {
    try {
      Object.defineProperties(primary, { ...context, ...ownershipDescriptors() });
      return retainContext(primary);
    } catch (inspectionError) { retainInspection(inspectionError); }
  }
  let message = 'Storage operation or recovery context failed.';
  try { const original = primary.message; if (typeof original === 'string') message = original; }
  catch (inspectionError) { retainInspection(inspectionError); }
  const aggregate = new AggregateError([primary, ...(additional ? [additional] : [])], message, { cause: primary });
  try {
    for (const key of Reflect.ownKeys(primary)) {
      if (reserved.has(key) || Object.hasOwn(context, key)) continue;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(primary, key);
        if (descriptor) {
          const getter = descriptor.get, setter = descriptor.set;
          if (typeof getter === 'function') descriptor.get = () => {
            try { return getter.call(primary); }
            catch (inspectionError) { retainInspection(inspectionError); throw inspectionError; }
          };
          if (typeof setter === 'function') descriptor.set = value => {
            try { return setter.call(primary, value); }
            catch (inspectionError) { retainInspection(inspectionError); throw inspectionError; }
          };
          Object.defineProperty(aggregate, key, descriptor);
        }
      } catch (inspectionError) { retainInspection(inspectionError); }
    }
  } catch (inspectionError) { retainInspection(inspectionError); }
  // Only this new array is changed. Earlier Error.errors/diagnostic fields stay
  // on their exact cause; lazy stack/message properties are never inspected.
  aggregate.errors.push(...inspections);
  Object.defineProperties(aggregate, { ...context, ...ownershipDescriptors(true) });
  return retainContext(aggregate);
};
