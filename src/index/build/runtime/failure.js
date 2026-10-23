import { addStorageFailureContext, readStorageFailureContext } from '../../../shared/storage/operation-error.js';

/** Keep the original observation before any logging or later teardown step can
 * change its public fields. This adds no resource or retry authority. */
export const captureRuntimeFailureObservation = error => {
  const context = addStorageFailureContext(error, { runtimeFailurePhase: 'teardown' }, null,
    { forceAggregate: true });
  const original = Object.getOwnPropertyDescriptor(context, 'cacheOwnershipReleased').value;
  return Object.freeze({ error, context, observe: () => original.call(context) === true });
};

export const composeRuntimeTeardownFailures = observations => {
  const inspectionErrors = new Set();
  let unknown = false, pending = false;
  for (const observation of observations) {
    const context = readStorageFailureContext(observation.context);
    if (!context?.complete) unknown = true;
    for (const error of context?.inspectionErrors || []) inspectionErrors.add(error);
    pending ||= observation.context.cacheOwnershipPending === true;
  }
  if (observations.length === 1) {
    // Preserve exact ordinary rejections, including falsey values. A resource
    // observation or failed inspection needs the captured diagnostic wrapper.
    return !unknown && !pending && !inspectionErrors.size ? observations[0].error : observations[0].context;
  }
  return Object.defineProperties(new AggregateError([
    ...observations.map(observation => observation.error), ...inspectionErrors,
    ...observations.map(observation => observation.context)
  ], '[cleanup] runtime teardown failed.'), {
    cacheOwnershipPending: { value: unknown || pending, enumerable: true },
    cacheOwnershipReleased: { value: () => !unknown && observations.every(observation => observation.observe()) }
  });
};

/** Compose diagnostic context without mutating the exact rejected values.
 * Presence is explicit: undefined/null/false/zero/empty rejections are failures.
 * This helper grants no resource-settlement or retry authority. */
export const createRuntimeFailure = (primary, {
  cleanupError, cleanupFailed = false, additionalErrors = []
} = {}) => {
  const errors = [primary, ...(cleanupFailed && cleanupError !== primary ? [cleanupError] : []), ...additionalErrors];
  const inspect = (value, key) => {
    try { return value?.[key]; }
    catch (error) { errors.push(error); return undefined; }
  };
  const message = inspect(primary, 'message');
  const code = inspect(primary, 'code');
  const secondaryCode = cleanupFailed && typeof code !== 'string' ? inspect(cleanupError, 'code') : null;
  const name = inspect(primary, 'name');
  const previous = inspect(primary, 'cleanupErrors');
  let cleanupErrors = [];
  try { if (Array.isArray(previous)) cleanupErrors = [...previous]; }
  catch (error) { errors.push(error); }
  if (cleanupFailed) cleanupErrors.push(cleanupError);
  const failure = new AggregateError(errors,
    typeof message === 'string' && message ? message : 'Build runtime initialization or cleanup failed.',
    { cause: primary });
  Object.defineProperties(failure, {
    ...(typeof code === 'string' || typeof secondaryCode === 'string'
      ? { code: { value: typeof code === 'string' ? code : secondaryCode, enumerable: true, configurable: true } } : {}),
    ...(typeof name === 'string' ? { name: { value: name, configurable: true } } : {}),
    ...(cleanupErrors.length ? { cleanupErrors: { value: cleanupErrors, enumerable: true } } : {})
  });
  return failure;
};
