const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const captureFields = ['observedBytes', 'retainedBytes', 'droppedBytes', 'outputBytes'];

/** Fixed passive diagnostics. No path payload, command environment or ownership
 * token crosses the provider boundary. Partial output never supplies filenames. */
export const scmFileInventoryReceipt = ({ provider, operation, reason = null, capture = null }) => ({
  schemaVersion: 1, provider, operation, complete: reason === null,
  status: reason === null ? 'complete' : 'unavailable', reason,
  capture: capture ? { ...Object.fromEntries(captureFields.map(key => [key, count(capture[key])])),
    truncated: typeof capture.truncated === 'boolean' ? capture.truncated : null,
    encodingLoss: typeof capture.encodingLoss === 'boolean' ? capture.encodingLoss : null } : null
});

export const inspectScmFileInventory = (result, { provider, operation, framing = 'nul' }) => {
  const capture = result?.outputCapture?.stdout;
  let reason = null;
  if (result?.exitCode !== 0 || result.signal !== null || result.error != null || result.spawnError != null || result.timedOut === true) {
    reason = 'command-incomplete';
  } else if (!capture || capture.enabled !== true || typeof result.stdout !== 'string') reason = 'capture-unqualified';
  else if (result.truncated === true || capture.truncated === true || capture.droppedBytes !== 0) reason = 'stdout-truncated';
  else if (capture.truncated !== false) reason = 'capture-unqualified';
  else if (capture.encodingLoss !== false) reason = 'stdout-encoding-unqualified';
  else if (captureFields.some(key => count(capture[key]) === null)
    || capture.observedBytes !== capture.retainedBytes || capture.outputBytes !== Buffer.byteLength(result.stdout, 'utf8')
    || capture.retainedBytes !== capture.outputBytes) reason = 'capture-extent-mismatch';
  else if (result.stdout && (framing === 'nul' ? !result.stdout.endsWith('\0') : !result.stdout.endsWith('\n') || result.stdout.includes('\0'))) {
    reason = 'incomplete-record-framing';
  }
  return scmFileInventoryReceipt({ provider, operation, reason, capture });
};

export const unavailableScmFileInventory = inventory => ({ ok: false, reason: 'unavailable', complete: false, inventory });

export const declaredScmFileInventory = (result, { provider, operation }) => {
  const supplied = result?.inventory;
  const capture = supplied?.capture;
  const lossless = !capture || (captureFields.every(key => count(capture[key]) !== null) && capture.truncated === false
    && capture.encodingLoss === false && capture.droppedBytes === 0 && capture.observedBytes === capture.retainedBytes
    && capture.retainedBytes === capture.outputBytes);
  const complete = result?.complete === true && result?.ok !== false
    && lossless && (!supplied || (supplied.schemaVersion === 1 && supplied.provider === provider && supplied.operation === operation
      && supplied.complete === true && supplied.status === 'complete' && supplied.reason === null));
  const reason = complete ? null : typeof supplied?.reason === 'string' && /^[a-z0-9-]{1,128}$/.test(supplied.reason)
    ? supplied.reason : result?.reason === 'unsupported' ? 'unsupported' : 'provider-incomplete';
  return scmFileInventoryReceipt({ provider, operation, reason, capture: supplied?.capture || null });
};
