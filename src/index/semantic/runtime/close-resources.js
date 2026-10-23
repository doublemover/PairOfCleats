import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';

/** Close every owned native/file resource even when one close fails. */
export const closeRuntimeResources = async (resources, operationError = null,
  { hasOperationError = operationError !== null && operationError !== undefined } = {}) => {
  const results = await Promise.allSettled(resources.filter(Boolean).map(resource => Promise.resolve().then(() => resource.close())));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  let failed = hasOperationError, failure = operationError;
  for (const error of errors) {
    failure = failed ? addStorageFailureContext(failure, {}, error, { secondaryPresent: true }) : error;
    failed = true;
  }
  if (errors.length && (hasOperationError || errors.length > 1)) {
    failure = addStorageFailureContext(failure, { ...(hasOperationError ? { operationError } : { code: 'ERR_RUNTIME_RESOURCE_CLOSE' }),
      cleanupErrors: Object.freeze([...errors]) });
  }
  if (failed) throw failure;
};
