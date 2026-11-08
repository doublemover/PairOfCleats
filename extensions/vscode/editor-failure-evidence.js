const snapshots = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');

/** Diagnostic data is observational. Never coerce an error, prepare lazy stack
 * descriptors, or copy public ownership fields into a new owner. */
function captureEditorFailure(primaryError) {
  if (objectLike(primaryError) && snapshots.has(primaryError)) return snapshots.get(primaryError);
  const inspectionErrors = []; let message = typeof primaryError === 'string' && primaryError ? primaryError : 'Operation failed.';
  try { const value = primaryError?.message; if (typeof value === 'string' && value) message = value; }
  catch (error) { inspectionErrors.push(error); }
  const snapshot = Object.freeze({ primaryError, message, inspectionErrors: Object.freeze(inspectionErrors) });
  if (objectLike(primaryError)) snapshots.set(primaryError, snapshot);
  return snapshot;
}

async function reportEditorFailure(primaryError, { isCurrent, notify, prefix = '', suffix = '' }) {
  const original = captureEditorFailure(primaryError), inspectionErrors = [...original.inspectionErrors];
  let current = false;
  try { current = isCurrent() === true; } catch (error) { inspectionErrors.push(error); }
  if (current) {
    try { await notify(`${prefix}${original.message}${suffix}`); }
    catch (error) { inspectionErrors.push(error); }
  }
  return Object.freeze({ ...original, inspectionErrors: Object.freeze(inspectionErrors) });
}

/** Recoverable errors remain evidence beside later successful UI actions.
 * This private command result does not classify the entire workflow outcome. */
function editorFailureEvidence(failures) {
  if (!failures.length) return undefined;
  return Object.freeze({ kind: 'editor-failure-evidence', primaryError: failures[0].primaryError,
    failures: Object.freeze([...failures]), inspectionErrors: Object.freeze(failures.flatMap(record => record.inspectionErrors)) });
}

module.exports = { captureEditorFailure, reportEditorFailure, editorFailureEvidence };
