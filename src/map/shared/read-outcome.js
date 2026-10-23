const snapshots = new WeakMap(), compositions = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');

/** Passive diagnostics only: never evaluate message/stack/ownership getters. */
const capture = original => {
  if (objectLike(original) && snapshots.has(original)) return snapshots.get(original);
  const fields = {}, inspectionErrors = [], unavailable = [];
  if (objectLike(original)) for (const key of ['status', 'code', 'name', 'message']) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(original, key);
      if (descriptor && Object.hasOwn(descriptor, 'value')) fields[key] = descriptor.value;
      else if (descriptor) unavailable.push(key);
    } catch (error) { inspectionErrors.push(error); unavailable.push(key); }
  }
  const text = (value, limit) => typeof value === 'string' && value.length ? value.slice(0, limit) : null;
  const captured = Object.freeze({
    status: Number.isInteger(fields.status) && fields.status >= 400 && fields.status <= 599 ? fields.status : null,
    code: text(fields.code, 128), name: text(fields.name, 128) || 'Error',
    message: text(fields.message, 1024) || text(original, 1024) || 'Artifact read failed.',
    inspectionErrors: Object.freeze(inspectionErrors), unavailable: Object.freeze(unavailable)
  });
  if (objectLike(original)) snapshots.set(original, captured);
  return captured;
};

/** Exact read primary and release failures, without mutating either original. */
export const combineMapReadCleanupFailure = (primary, cleanupErrors, { hasPrimary = true, terminal = false } = {}) => {
  const errors = [...cleanupErrors];
  if (!errors.length) return hasPrimary ? primary : null;
  const primarySnapshot = hasPrimary ? capture(primary) : null;
  const captured = errors.map(capture);
  const inspectionErrors = [...(primarySnapshot?.inspectionErrors || []), ...captured.flatMap(value => value.inspectionErrors)];
  const failure = new AggregateError(hasPrimary ? [primary, ...errors] : errors,
    hasPrimary ? primarySnapshot.message : 'Artifact reader cleanup failed.', { cause: hasPrimary ? primary : errors[0] });
  Object.defineProperties(failure, {
    code: { value: 'ERR_MAP_READ_CLEANUP' },
    errors: { value: Object.freeze(hasPrimary ? [primary, ...errors] : errors) },
    mapReadCleanupErrors: { value: Object.freeze(errors) }, mapReadInspectionErrors: { value: Object.freeze(inspectionErrors) }
  });
  compositions.set(failure, Object.freeze({ hasPrimary, primary, primarySnapshot,
    cleanupErrors: Object.freeze(errors), cleanupSnapshots: Object.freeze(captured), terminal: terminal === true }));
  return failure;
};

/** Only this module's original producer records define primary/cleanup roles. */
export const getMapReadFailure = error => compositions.get(error) || Object.freeze({ hasPrimary: true, primary: error,
  primarySnapshot: capture(error), cleanupErrors: Object.freeze([]), cleanupSnapshots: Object.freeze([]), terminal: false });

/** JSON-safe classification; exact error identities remain in the owner. */
export const projectMapReadFailure = (error, { terminal = false, cleanupError } = {}) => {
  const cleanupOnly = terminal && !compositions.has(error) && Object.is(error, cleanupError);
  const record = cleanupOnly ? { hasPrimary: false, primarySnapshot: null, cleanupErrors: [error], cleanupSnapshots: [capture(error)], terminal: true }
    : getMapReadFailure(error);
  const primary = record.primarySnapshot || capture(record.cleanupErrors[0]);
  const cancelled = primary.name === 'AbortError' || primary.code === 'ABORT_ERR';
  const cleanupFailed = record.cleanupErrors.length > 0 || terminal === true;
  const status = primary.status || (record.hasPrimary ? cancelled ? 499 : 400 : 503);
  return Object.freeze({ status,
    code: cancelled ? 'CANCELLED' : status >= 500 ? 'INTERNAL' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'INVALID_REQUEST',
    message: primary.message,
    details: Object.freeze({ artifactFailure: Object.freeze({
      read: record.hasPrimary ? Object.freeze({ status, code: primary.code, name: primary.name }) : null,
      cleanup: Object.freeze({ failed: cleanupFailed, terminal: record.terminal || terminal === true,
        failures: Object.freeze(record.cleanupSnapshots.map(value => Object.freeze({ code: value.code, name: value.name, message: value.message }))) }),
      diagnosticFieldsUnavailable: primary.unavailable,
      diagnosticInspectionFailures: primary.inspectionErrors.length + record.cleanupSnapshots.reduce((sum, value) => sum + value.inspectionErrors.length, 0)
    }) }) });
};
