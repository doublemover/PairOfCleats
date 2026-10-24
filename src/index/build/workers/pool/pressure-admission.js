export const TOKENIZER_PRESSURE_NO_PROGRESS_MS = 5000;
export const TOKENIZER_PRESSURE_MAX_WAIT_MS = 15000;

/** Hard-pressure liveness limits are internal; they never authorize compute or relax memory caps. */
export const evaluateTokenizerPressureWait = ({ startedAt, now, lastProgressAt, draining }) => {
  const elapsed = Math.max(0, now - startedAt);
  const progressAt = Math.max(startedAt, lastProgressAt);
  const noProgressMs = Math.max(0, now - progressAt);
  const absoluteDeadline = startedAt + TOKENIZER_PRESSURE_MAX_WAIT_MS;
  if (elapsed >= TOKENIZER_PRESSURE_MAX_WAIT_MS) return { reason: 'pressure-drain-deadline', elapsed, noProgressMs, deadline: absoluteDeadline };
  if (draining === 0 && noProgressMs >= TOKENIZER_PRESSURE_NO_PROGRESS_MS) return { reason: 'pressure-no-safe-drain', elapsed, noProgressMs,
    deadline: progressAt + TOKENIZER_PRESSURE_NO_PROGRESS_MS };
  return { reason: null, elapsed, noProgressMs, deadline: draining === 0
    ? Math.min(absoluteDeadline, progressAt + TOKENIZER_PRESSURE_NO_PROGRESS_MS) : absoluteDeadline };
};
export const createTokenizerPressureError = receipt => Object.assign(new Error(
  `Tokenizer resource pressure could not admit work (${receipt.reason}; waited ${Math.ceil(receipt.waitMs)}ms). `
  + 'The build must drain and resume from completed checkpoints.'), {
  code: 'ERR_TOKENIZER_RESOURCE_PRESSURE', retryable: true, resumable: true,
  reasonCode: receipt.reason === 'pressure-no-safe-drain' ? 'USR-R-RESOURCE-PRESSURE-NO-DRAIN' : 'USR-R-RESOURCE-PRESSURE-DEADLINE',
  resourcePressure: Object.freeze(receipt)
});
