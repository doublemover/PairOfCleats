/** Close every owned native/file resource even when one close fails. */
export const closeRuntimeResources = async (resources, operationError = null) => {
  const results = await Promise.allSettled(resources.filter(Boolean).map(resource => Promise.resolve().then(() => resource.close())));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (operationError && errors.length) throw Object.assign(new AggregateError([operationError, ...errors],
    `${operationError.message}; runtime resource cleanup also failed`, { cause: operationError }),
  { code: operationError.code || 'ERR_RUNTIME_RESOURCE_CLOSE', operationError, cleanupErrors: errors });
  if (operationError) throw operationError;
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw Object.assign(new AggregateError(errors, 'Runtime resource cleanup failed.'), { code: 'ERR_RUNTIME_RESOURCE_CLOSE' });
};
