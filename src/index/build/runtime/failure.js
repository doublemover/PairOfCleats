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
